// Local-only manual plate review tool. This never gets deployed anywhere —
// it's a plain Node HTTP server bound to localhost, meant to run on your own
// machine so you can eyeball every photo and confirm or correct its `plate`
// field by hand. This is the human check on top of Gemini's automated reads
// (caption-batch.mjs / backfill-plates.mjs), not a replacement for them.
//
// Usage:
//   node scripts/plate-review-server.mjs [category ...]
// With no category given, reviews every category in src/data/categories.json.
// Then open http://localhost:5199 in a browser.
//
// Review progress is tracked separately from the plate value itself, in
// scripts/.plate-review-progress.json (gitignored) — so quitting partway
// through and running this again later resumes where you left off, same
// resumability pattern as caption-batch.mjs / backfill-plates.mjs.
//
// When you're done, just stop the server (Ctrl+C). There's nothing to
// "turn off" on the live site — this tool was never part of it.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 5199;
const IMAGES_BASE = 'src/assets/images';
const CAPTIONS_JSON_PATH = 'src/data/captions.json';
const PROGRESS_PATH = 'scripts/.plate-review-progress.json';

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

function loadCaptions() {
  return JSON.parse(fs.readFileSync(CAPTIONS_JSON_PATH, 'utf8'));
}
function saveCaptions(data) {
  fs.writeFileSync(CAPTIONS_JSON_PATH, JSON.stringify(data, null, 2) + '\n');
}
function loadProgress() {
  try { return JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8')); } catch { return {}; }
}
function saveProgress(data) {
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(data, null, 2));
}

function buildList() {
  const captions = loadCaptions();
  const progress = loadProgress();
  const items = [];
  for (const category of scopeCategories) {
    const dir = path.join(IMAGES_BASE, category);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!/\.(jpe?g|png|webp)$/i.test(file)) continue;
      const entry = captions[file];
      if (!entry || !entry.caption?.trim()) continue; // not captioned yet — out of scope
      items.push({
        category,
        filename: file,
        title: entry.title ?? '',
        plate: entry.plate ?? '',
        reviewed: !!progress[file],
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

const HTML_PAGE = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Plate review (local only)</title>
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
  #progress { font-size: 0.85rem; opacity: 0.75; margin-left: auto; }
  main {
    flex: 1; display: flex; align-items: center; justify-content: center;
    gap: 2rem; padding: 1.5rem; min-height: 0;
  }
  #imgwrap { flex: 1; height: 100%; display: flex; align-items: center; justify-content: center; min-width: 0; }
  #photo { max-width: 100%; max-height: 100%; object-fit: contain; border: 1px solid #2a2a2a; }
  #panel { width: 22rem; flex-shrink: 0; }
  #panel .filename { font-family: monospace; font-size: 0.8rem; opacity: 0.6; word-break: break-all; }
  #panel .title { margin: 0.5rem 0 1.25rem; font-size: 0.95rem; }
  #plate-input {
    width: 100%; font-size: 1.2rem; padding: 0.7rem 0.8rem; letter-spacing: 0.05em;
    background: #1a1a1a; border: 1px solid #333; color: #eee; border-radius: 6px;
  }
  #plate-input:focus { outline: none; border-color: #2dd4bf; }
  .row { display: flex; gap: 0.5rem; margin-top: 0.9rem; }
  button {
    flex: 1; padding: 0.65rem 0.8rem; font-size: 0.85rem; border-radius: 6px;
    border: 1px solid #333; background: #1a1a1a; color: #eee; cursor: pointer;
  }
  button:hover { border-color: #555; }
  button.primary { background: #14b8a6; border-color: #14b8a6; color: #04201c; font-weight: 600; }
  button.primary:hover { background: #2dd4bf; }
  .hint { font-size: 0.75rem; opacity: 0.5; margin-top: 1rem; line-height: 1.5; }
  #empty { text-align: center; opacity: 0.6; padding: 3rem; }
</style>
</head>
<body>
  <header>
    <h1>PLATE REVIEW — local only, never deployed</h1>
    <select id="category-select"></select>
    <label><input type="checkbox" id="unreviewed-only" checked> unreviewed only</label>
    <span id="progress"></span>
  </header>
  <main id="main"></main>

<script>
let items = [];
let category = 'ALL';
let onlyUnreviewed = true;
let idx = 0;

const main = document.getElementById('main');
const catSelect = document.getElementById('category-select');
const unreviewedToggle = document.getElementById('unreviewed-only');
const progressEl = document.getElementById('progress');

function filtered() {
  return items.filter(it =>
    (category === 'ALL' || it.category === category) &&
    (!onlyUnreviewed || !it.reviewed)
  );
}

function categoryCounts() {
  const catItems = items.filter(it => category === 'ALL' || it.category === category);
  return { reviewed: catItems.filter(it => it.reviewed).length, total: catItems.length };
}

function renderChrome() {
  const { reviewed, total } = categoryCounts();
  progressEl.textContent = total ? \`\${reviewed} / \${total} reviewed\` : '';
}

function render() {
  renderChrome();
  const f = filtered();
  if (idx >= f.length) idx = Math.max(0, f.length - 1);
  const it = f[idx];
  if (!it) {
    main.innerHTML = '<div id="empty">Nothing left to review here 🎉<br>Try a different category, or untick "unreviewed only".</div>';
    return;
  }
  main.innerHTML = \`
    <div id="imgwrap"><img id="photo" src="/img/\${it.category}/\${encodeURIComponent(it.filename)}"></div>
    <div id="panel">
      <div class="filename">\${it.category}/\${it.filename}</div>
      <p class="title">\${it.title || '(no title)'}</p>
      <input id="plate-input" placeholder="no plate" autocomplete="off" spellcheck="false" value="\${it.plate}">
      <div class="row">
        <button class="primary" id="save-btn">Save &amp; next (Enter)</button>
      </div>
      <div class="row">
        <button id="noplate-btn">No real plate</button>
        <button id="skip-btn">Skip</button>
      </div>
      <div class="row">
        <button id="prev-btn">&larr; Prev</button>
        <button id="next-btn">Next &rarr;</button>
      </div>
      <p class="hint">Enter saves the box above and marks this photo reviewed, then moves on.
      "No real plate" clears it and marks reviewed (use when there's genuinely no legible plate).
      "Skip" moves on without changing anything. Prev/Next just browse.</p>
    </div>
  \`;
  const input = document.getElementById('plate-input');
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); doSave(input.value, true); }
  });
  document.getElementById('save-btn').addEventListener('click', () => doSave(input.value, true));
  document.getElementById('noplate-btn').addEventListener('click', () => doSave('', true));
  document.getElementById('skip-btn').addEventListener('click', () => { idx++; render(); });
  document.getElementById('prev-btn').addEventListener('click', () => { idx = Math.max(0, idx - 1); render(); });
  document.getElementById('next-btn').addEventListener('click', () => { idx++; render(); });
}

async function doSave(plateValue, markReviewed) {
  const f = filtered();
  const it = f[idx];
  if (!it) return;
  const res = await fetch('/api/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: it.filename, plate: plateValue.trim(), reviewed: markReviewed }),
  });
  const data = await res.json();
  if (!data.ok) { alert('Save failed: ' + data.error); return; }
  it.plate = plateValue.trim();
  it.reviewed = it.reviewed || markReviewed;
  render();
}

catSelect.addEventListener('change', () => { category = catSelect.value; idx = 0; render(); });
unreviewedToggle.addEventListener('change', () => { onlyUnreviewed = unreviewedToggle.checked; idx = 0; render(); });

fetch('/api/list').then(r => r.json()).then(data => {
  items = data;
  const cats = [...new Set(items.map(it => it.category))];
  catSelect.innerHTML = '<option value="ALL">All categories</option>' +
    cats.map(c => \`<option value="\${c}">\${c}</option>\`).join('');
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

  if (reqUrl.pathname === '/api/save' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { filename, plate, reviewed } = JSON.parse(body);
        const captions = loadCaptions();
        if (!captions[filename]) throw new Error('unknown filename: ' + filename);
        captions[filename] = { ...captions[filename], plate: plate || undefined };
        saveCaptions(captions);
        if (reviewed) {
          const progress = loadProgress();
          progress[filename] = true;
          saveProgress(progress);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
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
  console.log(`[plate-review] http://localhost:${PORT}  (categories: ${scopeCategories.join(', ')})`);
  console.log('[plate-review] Local only — nothing here is deployed or exposed publicly. Ctrl+C to stop.');
});
