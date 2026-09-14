// Local-only portfolio cleanup tool. Never deployed — a plain Node HTTP
// server bound to localhost, for browsing every photo and deciding which
// ones are worth permanently removing (weak shots dragging the portfolio
// down, and freeing R2 storage space in the process).
//
// Two-phase by design, because this is genuinely irreversible (no R2
// versioning/trash in this project — a deleted object is gone):
//   1. Browse and mark candidates. Nothing is deleted yet.
//   2. Review the marked list separately, type DELETE to confirm, then
//      execute. Only that step actually touches R2 or git-tracked data.
//
// Usage:
//   R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET=... \
//     node scripts/portfolio-review-server.mjs [category ...]
// R2 credentials are only required for the actual delete step, not for
// browsing/marking. With no category given, reviews every category.
// Then open http://localhost:5198.
//
// A deletion removes: the R2 object, the local src/assets/images copy, the
// captions.json entry, the scripts/instagram-captions.json entry, and the
// filename from post-queue.json's posted list. Watermarked/IG outputs
// aren't touched here — watermark.mjs already prunes orphaned outputs on
// its next run once the source image is gone.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 5198;
const IMAGES_BASE = 'src/assets/images';
const CAPTIONS_JSON_PATH = 'src/data/captions.json';
const IG_CAPTIONS_PATH = 'scripts/instagram-captions.json';
const QUEUE_PATH = 'post-queue.json';
const PROGRESS_PATH = 'scripts/.portfolio-review-progress.json';

const categoriesFile = JSON.parse(fs.readFileSync('src/data/categories.json', 'utf8'));
const allCategories = [...categoriesFile.website, ...categoriesFile.instagramOnly];
const requested = process.argv.slice(2);
for (const c of requested) {
  if (!allCategories.includes(c)) {
    console.error(`Unknown category "${c}". Known: ${allCategories.join(', ')}`);
    process.exit(1);
  }
}
const scopeCategories = requested.length ? requested : allCategories;

// Both of these are regex scans of events.ts rather than a real TS import,
// since this is a plain Node script — good enough for a UI label/warning,
// not meant to be a robust parser.
function loadHeroFilenames() {
  try {
    const text = fs.readFileSync('src/data/events.ts', 'utf8');
    const matches = [...text.matchAll(/hero:\s*['"]([^'"]+)['"]/g)];
    return new Set(matches.map(m => m[1]));
  } catch {
    return new Set();
  }
}

// Category and event are 1:1 in this project today (e.g. category
// "endurance" is the event "Le Mans 2026"), just under different names —
// so "filter by event" reuses the same category filter, showing each
// event's shortLabel instead of the raw category slug where one exists.
// Categories with no dedicated event page (formula, rally, gt, car-shows,
// instagram-only) just show their plain category name, same as before.
function loadEventLabels() {
  try {
    const text = fs.readFileSync('src/data/events.ts', 'utf8');
    const shortLabels = [...text.matchAll(/shortLabel:\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
    const categoryLists = [...text.matchAll(/categories:\s*\[([^\]]*)\]/g)]
      .map(m => [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]));
    const map = {};
    shortLabels.forEach((label, i) => {
      for (const cat of categoryLists[i] ?? []) map[cat] = label;
    });
    return map;
  } catch {
    return {};
  }
}

function loadJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function saveJson(p, data, trailingNewline = true) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + (trailingNewline ? '\n' : ''));
}
function loadProgress() { return loadJson(PROGRESS_PATH, {}); }
function saveProgress(progress) { fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2)); }

function buildList() {
  const captions = loadJson(CAPTIONS_JSON_PATH, {});
  const progress = loadProgress();
  const heroes = loadHeroFilenames();
  const eventLabels = loadEventLabels();
  const items = [];
  for (const category of scopeCategories) {
    const dir = path.join(IMAGES_BASE, category);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!/\.(jpe?g|png|webp)$/i.test(file)) continue;
      const entry = captions[file];
      items.push({
        category,
        eventLabel: eventLabels[category] ?? category,
        filename: file,
        title: entry?.title ?? '(no caption yet)',
        status: progress[file] ?? null, // null | 'kept' | 'marked'
        isHero: heroes.has(file),
      });
    }
  }
  items.sort((a, b) =>
    a.category === b.category
      ? a.filename.localeCompare(b.filename)
      : scopeCategories.indexOf(a.category) - scopeCategories.indexOf(b.category)
  );
  return items;
}

function mimeFor(file) {
  if (/\.png$/i.test(file)) return 'image/png';
  if (/\.webp$/i.test(file)) return 'image/webp';
  return 'image/jpeg';
}

let s3Client = null;
async function getS3() {
  if (s3Client) return s3Client;
  const { S3Client } = await import('@aws-sdk/client-s3');
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new Error('R2 credentials not set (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)');
  }
  s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });
  return s3Client;
}

async function deleteOne(category, filename) {
  const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
  const bucket = process.env.R2_BUCKET;
  if (!bucket) throw new Error('R2_BUCKET not set');
  const s3 = await getS3();
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: `originals/${category}/${filename}` }));

  const localPath = path.join(IMAGES_BASE, category, filename);
  if (fs.existsSync(localPath)) fs.unlinkSync(localPath);

  const captions = loadJson(CAPTIONS_JSON_PATH, {});
  if (captions[filename]) {
    delete captions[filename];
    saveJson(CAPTIONS_JSON_PATH, captions);
  }

  const igCaptions = loadJson(IG_CAPTIONS_PATH, {});
  if (igCaptions[filename]) {
    delete igCaptions[filename];
    saveJson(IG_CAPTIONS_PATH, igCaptions);
  }

  const queue = loadJson(QUEUE_PATH, { posted: [] });
  const idx = queue.posted.indexOf(filename);
  if (idx !== -1) {
    queue.posted.splice(idx, 1);
    saveJson(QUEUE_PATH, queue, false);
  }

  const progress = loadProgress();
  delete progress[filename];
  saveProgress(progress);
}

const HTML_PAGE = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Portfolio review (local only)</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: -apple-system, system-ui, sans-serif;
    background: #0d0d0d; color: #eee; height: 100vh; display: flex; flex-direction: column;
  }
  header {
    padding: 0.75rem 1.25rem; border-bottom: 1px solid #2a2a2a;
    display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;
  }
  header h1 { font-size: 0.95rem; margin: 0; opacity: 0.6; font-weight: 500; }
  select, label { font-size: 0.85rem; }
  #progress { font-size: 0.85rem; opacity: 0.75; }
  #review-link {
    margin-left: auto; font-size: 0.85rem; color: #ff6b6b; cursor: pointer;
    text-decoration: underline;
  }
  main {
    flex: 1; display: flex; align-items: center; justify-content: center;
    gap: 2rem; padding: 1.5rem; min-height: 0; overflow: auto;
  }
  #imgwrap { flex: 1; height: 100%; display: flex; align-items: center; justify-content: center; min-width: 0; }
  #photo { max-width: 100%; max-height: 100%; object-fit: contain; border: 1px solid #2a2a2a; }
  #panel { width: 22rem; flex-shrink: 0; }
  #panel .filename { font-family: monospace; font-size: 0.8rem; opacity: 0.6; word-break: break-all; }
  #panel .title { margin: 0.5rem 0 1rem; font-size: 0.95rem; }
  .hero-warning {
    background: rgba(255,180,0,0.12); border: 1px solid #ffb400; color: #ffb400;
    padding: 0.6rem 0.8rem; border-radius: 6px; font-size: 0.8rem; margin-bottom: 1rem;
  }
  .row { display: flex; gap: 0.5rem; margin-top: 0.9rem; }
  button {
    flex: 1; padding: 0.7rem 0.8rem; font-size: 0.85rem; border-radius: 6px;
    border: 1px solid #333; background: #1a1a1a; color: #eee; cursor: pointer;
  }
  button:hover { border-color: #555; }
  button.keep { background: #14b8a6; border-color: #14b8a6; color: #04201c; font-weight: 600; }
  button.keep:hover { background: #2dd4bf; }
  button.delete { background: #3a1414; border-color: #ff6b6b; color: #ff9d9d; font-weight: 600; }
  button.delete:hover { background: #4a1a1a; }
  button.marked { background: #ff6b6b; border-color: #ff6b6b; color: #2a0a0a; }
  .hint { font-size: 0.75rem; opacity: 0.5; margin-top: 1rem; line-height: 1.5; }
  #empty { text-align: center; opacity: 0.6; padding: 3rem; }

  #review-screen { display: none; padding: 1.5rem; overflow: auto; flex: 1; }
  #review-screen.active { display: block; }
  #review-screen h2 { margin-top: 0; }
  .review-item {
    display: flex; align-items: center; gap: 1rem; padding: 0.6rem 0;
    border-bottom: 1px solid #222;
  }
  .review-item img { width: 80px; height: 60px; object-fit: cover; border-radius: 4px; }
  .review-item .info { flex: 1; font-size: 0.85rem; }
  .review-item .info .fn { font-family: monospace; opacity: 0.7; font-size: 0.75rem; }
  .confirm-box {
    margin-top: 1.5rem; padding: 1.25rem; border: 1px solid #ff6b6b; border-radius: 8px;
    background: rgba(255,107,107,0.06);
  }
  .confirm-box p { margin-top: 0; }
  .confirm-box input {
    width: 100%; padding: 0.6rem 0.7rem; font-size: 1rem; background: #1a1a1a;
    border: 1px solid #444; color: #eee; border-radius: 6px; margin: 0.75rem 0;
  }
  #results { margin-top: 1rem; font-size: 0.85rem; }
  #results .ok { color: #2dd4bf; }
  #results .fail { color: #ff6b6b; }
  #main-view { display: flex; flex: 1; min-height: 0; }
</style>
</head>
<body>
  <header>
    <h1>PORTFOLIO REVIEW — local only, never deployed</h1>
    <select id="category-select"></select>
    <label><input type="checkbox" id="unreviewed-only" checked> unreviewed only</label>
    <span id="progress"></span>
    <span id="review-link">Review marked (<span id="marked-count">0</span>) &rarr;</span>
  </header>
  <div id="main-view"><main id="main"></main></div>
  <div id="review-screen"></div>

<script>
let items = [];
let category = 'ALL';
let onlyUnreviewed = true;
let idx = 0;

const main = document.getElementById('main');
const mainView = document.getElementById('main-view');
const reviewScreen = document.getElementById('review-screen');
const catSelect = document.getElementById('category-select');
const unreviewedToggle = document.getElementById('unreviewed-only');
const progressEl = document.getElementById('progress');
const reviewLink = document.getElementById('review-link');
const markedCountEl = document.getElementById('marked-count');

function computeView() {
  return items.filter(it => category === 'ALL' || it.category === category);
}
function markedItems() {
  return items.filter(it => it.status === 'marked');
}
function updateMarkedCount() {
  markedCountEl.textContent = markedItems().length;
}

function categoryCounts(view) {
  return { reviewed: view.filter(it => it.status).length, total: view.length };
}
function renderChrome() {
  const view = computeView();
  const { reviewed, total } = categoryCounts(view);
  progressEl.textContent = total ? \`\${reviewed} / \${total} reviewed\` : '';
  updateMarkedCount();
}

function render() {
  const view = computeView();
  renderChrome();
  if (idx < 0) idx = 0;
  if (idx >= view.length) idx = Math.max(0, view.length - 1);
  const it = view[idx];
  if (!it || (onlyUnreviewed && view.every(x => x.status))) {
    main.innerHTML = '<div id="empty">Nothing left to review here 🎉<br>Try a different category, or untick "unreviewed only".</div>';
    return;
  }
  main.innerHTML = \`
    <div id="imgwrap"><img id="photo" src="/img/\${it.category}/\${encodeURIComponent(it.filename)}"></div>
    <div id="panel">
      <div class="filename">\${it.category}/\${it.filename}</div>
      <p class="title">\${it.title}</p>
      \${it.isHero ? '<div class="hero-warning">⚠ This is an event cover photo (events.ts). Check before deleting.</div>' : ''}
      <div class="row">
        <button class="keep" id="keep-btn">Keep (Enter)</button>
      </div>
      <div class="row">
        <button class="\${it.status === 'marked' ? 'marked' : 'delete'}" id="delete-btn">
          \${it.status === 'marked' ? 'Marked for deletion ✓' : 'Mark for deletion'}
        </button>
      </div>
      <div class="row">
        <button id="prev-btn">&larr; Prev</button>
        <button id="next-btn">Next &rarr;</button>
      </div>
      <p class="hint">"Keep" confirms this one's fine and moves on. "Mark for deletion" flags
      it as a candidate — nothing is actually deleted yet. Review everything you've marked
      from the link up top before anything permanent happens. Prev/Next just browse.</p>
    </div>
  \`;
  document.getElementById('keep-btn').addEventListener('click', () => setStatus(it, 'kept', true));
  document.getElementById('delete-btn').addEventListener('click', () => {
    setStatus(it, it.status === 'marked' ? null : 'marked', it.status !== 'marked');
  });
  document.getElementById('prev-btn').addEventListener('click', () => { idx = Math.max(0, idx - 1); render(); });
  document.getElementById('next-btn').addEventListener('click', () => goNext());

  document.onkeydown = e => {
    if (reviewScreen.classList.contains('active')) return;
    if (e.key === 'Enter') setStatus(it, 'kept', true);
  };
}

function goNext() {
  const view = computeView();
  let next = idx + 1;
  if (onlyUnreviewed) {
    while (next < view.length && view[next].status) next++;
  }
  idx = Math.min(next, Math.max(0, view.length - 1));
  render();
}

async function setStatus(it, status, advance) {
  await fetch('/api/mark', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: it.filename, status }),
  });
  it.status = status;
  if (advance) goNext();
  else render();
}

function jumpToFirstRelevant() {
  const view = computeView();
  if (!onlyUnreviewed) { idx = 0; return; }
  const i = view.findIndex(it => !it.status);
  idx = i === -1 ? 0 : i;
}

catSelect.addEventListener('change', () => { category = catSelect.value; jumpToFirstRelevant(); render(); });
unreviewedToggle.addEventListener('change', () => { onlyUnreviewed = unreviewedToggle.checked; jumpToFirstRelevant(); render(); });

reviewLink.addEventListener('click', () => {
  mainView.style.display = 'none';
  reviewScreen.classList.add('active');
  renderReviewScreen();
});

function renderReviewScreen() {
  const marked = markedItems();
  reviewScreen.innerHTML = \`
    <button id="back-btn">&larr; Back to review</button>
    <h2>Marked for deletion (\${marked.length})</h2>
    \${marked.length === 0 ? '<p>Nothing marked yet.</p>' : marked.map(it => \`
      <div class="review-item" data-filename="\${it.filename}">
        <img src="/img/\${it.category}/\${encodeURIComponent(it.filename)}">
        <div class="info">
          <div>\${it.title}</div>
          <div class="fn">\${it.category}/\${it.filename}\${it.isHero ? ' — ⚠ event cover photo' : ''}</div>
        </div>
        <button class="unmark-btn">Unmark</button>
      </div>
    \`).join('')}
    \${marked.length > 0 ? \`
      <div class="confirm-box">
        <p><strong>This permanently deletes \${marked.length} photo(s) from R2 and this
        repo.</strong> There is no undo — R2 has no version history here. Type DELETE below
        to confirm.</p>
        <input type="text" id="confirm-input" placeholder="Type DELETE to confirm" autocomplete="off">
        <button class="delete" id="execute-btn" disabled>Permanently delete \${marked.length} photo(s)</button>
      </div>
      <div id="results"></div>
    \` : ''}
  \`;
  document.getElementById('back-btn').addEventListener('click', () => {
    reviewScreen.classList.remove('active');
    mainView.style.display = 'flex';
    render();
  });
  reviewScreen.querySelectorAll('.unmark-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const filename = e.target.closest('.review-item').dataset.filename;
      const it = items.find(i => i.filename === filename);
      await setStatus(it, null, false);
      renderReviewScreen();
    });
  });
  const confirmInput = document.getElementById('confirm-input');
  const executeBtn = document.getElementById('execute-btn');
  if (confirmInput) {
    confirmInput.addEventListener('input', () => {
      executeBtn.disabled = confirmInput.value.trim() !== 'DELETE';
    });
    executeBtn.addEventListener('click', executeDeletion);
  }
}

async function executeDeletion() {
  const marked = markedItems();
  const executeBtn = document.getElementById('execute-btn');
  const results = document.getElementById('results');
  executeBtn.disabled = true;
  executeBtn.textContent = 'Deleting...';
  const res = await fetch('/api/execute-delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filenames: marked.map(it => it.filename) }),
  });
  const data = await res.json();
  results.innerHTML = data.results.map(r =>
    \`<div class="\${r.ok ? 'ok' : 'fail'}">\${r.ok ? '✓' : '✗'} \${r.filename}\${r.error ? ' — ' + r.error : ''}</div>\`
  ).join('');
  items = items.filter(it => !data.results.some(r => r.ok && r.filename === it.filename));
  executeBtn.style.display = 'none';
  document.getElementById('confirm-input').style.display = 'none';
}

fetch('/api/list').then(r => r.json()).then(data => {
  items = data;
  // One dropdown entry per category, labelled with its event name where
  // one exists (falls back to the plain category name otherwise) — the
  // filter itself still matches on the underlying category.
  const catLabels = new Map();
  for (const it of items) if (!catLabels.has(it.category)) catLabels.set(it.category, it.eventLabel);
  catSelect.innerHTML = '<option value="ALL">All events</option>' +
    [...catLabels.entries()].map(([cat, label]) => \`<option value="\${cat}">\${label}</option>\`).join('');
  jumpToFirstRelevant();
  render();
});
</script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);

  if (reqUrl.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(HTML_PAGE);
    return;
  }

  if (reqUrl.pathname === '/api/list') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(buildList()));
    return;
  }

  if (reqUrl.pathname === '/api/mark' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { filename, status } = JSON.parse(body);
        const progress = loadProgress();
        if (status) progress[filename] = status;
        else delete progress[filename];
        saveProgress(progress);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  if (reqUrl.pathname === '/api/execute-delete' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { filenames } = JSON.parse(body);
        const all = buildList();
        const results = [];
        for (const filename of filenames) {
          const item = all.find(i => i.filename === filename);
          if (!item) { results.push({ filename, ok: false, error: 'not found' }); continue; }
          try {
            await deleteOne(item.category, filename);
            results.push({ filename, ok: true });
            console.log(`[portfolio-review] deleted ${item.category}/${filename}`);
          } catch (err) {
            results.push({ filename, ok: false, error: err.message });
            console.error(`[portfolio-review] failed to delete ${filename}: ${err.message}`);
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ results }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  const imgMatch = reqUrl.pathname.match(/^\/img\/([^/]+)\/([^/]+)$/);
  if (imgMatch) {
    const category = decodeURIComponent(imgMatch[1]);
    const filename = decodeURIComponent(imgMatch[2]);
    if (!scopeCategories.includes(category) || !/^[\w.-]+\.(jpe?g|png|webp)$/i.test(filename)) {
      res.writeHead(404);
      res.end();
      return;
    }
    const fullPath = path.join(IMAGES_BASE, category, filename);
    if (!fs.existsSync(fullPath)) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': mimeFor(filename) });
    fs.createReadStream(fullPath).pipe(res);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`[portfolio-review] http://localhost:${PORT}  (categories: ${scopeCategories.join(', ')})`);
  console.log('[portfolio-review] Local only — nothing here is deployed. Marking is instant and');
  console.log('[portfolio-review] reversible; actual deletion only happens from the review screen');
  console.log('[portfolio-review] after typing DELETE to confirm. Ctrl+C to stop.');
});
