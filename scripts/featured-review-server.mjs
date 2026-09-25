// Local-only tool for picking the "best work" portfolio set. Never gets
// deployed — a plain Node HTTP server bound to localhost so Marc can browse
// the whole library as a click-to-toggle grid and mark ~50 standout photos,
// rather than trying to recall filenames from memory. Writes straight to
// src/data/featured-photos.json, which both the homepage hero carousel and
// the /portfolio page read from (see CLAUDE.md's "Featured portfolio" section).
//
// Usage:
//   node scripts/featured-review-server.mjs [category ...]
// With no category given, browses every category in src/data/categories.json.
// Then open http://localhost:5200 in a browser.
//
// Unlike plate-review-server.mjs (one photo at a time, since it's correcting
// a value per-photo), this is a grid -- picking ~50 out of 1500+ is a
// selection task, not a correction task, and clicking through a big contact
// sheet is much faster than paging one-by-one.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 5200;
const IMAGES_BASE = 'src/assets/images';
const CAPTIONS_JSON_PATH = 'src/data/captions.json';
const FEATURED_PATH = 'src/data/featured-photos.json';

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
function loadFeatured() {
  try { return JSON.parse(fs.readFileSync(FEATURED_PATH, 'utf8')); } catch { return []; }
}
function saveFeatured(list) {
  fs.writeFileSync(FEATURED_PATH, JSON.stringify(list, null, 2) + '\n');
}

function buildList() {
  const captions = loadCaptions();
  const featured = new Set(loadFeatured());
  const items = [];
  for (const category of scopeCategories) {
    const dir = path.join(IMAGES_BASE, category);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!/\.(jpe?g|png|webp)$/i.test(file)) continue;
      const entry = captions[file];
      items.push({
        category,
        filename: file,
        title: entry?.title ?? '',
        featured: featured.has(file),
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
<title>Featured portfolio picker (local only)</title>
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
  #count { font-size: 0.95rem; font-weight: 600; margin-left: auto; }
  #count.over { color: #f59e0b; }
  main { flex: 1; overflow-y: auto; padding: 1rem; }
  #grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 0.6rem;
  }
  .cell {
    position: relative; aspect-ratio: 3/2; border-radius: 6px; overflow: hidden;
    cursor: pointer; border: 3px solid transparent; background: #1a1a1a;
  }
  .cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .cell.on { border-color: #2dd4bf; }
  .cell .badge {
    position: absolute; top: 6px; right: 6px; width: 22px; height: 22px; border-radius: 50%;
    background: #2dd4bf; color: #04201c; font-weight: 700; font-size: 0.85rem;
    display: none; align-items: center; justify-content: center;
  }
  .cell.on .badge { display: flex; }
  .cell .fname {
    position: absolute; bottom: 0; left: 0; right: 0; padding: 3px 5px;
    background: rgba(0,0,0,0.75); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .cell .fname .title { font-size: 0.7rem; display: block; }
  .cell .fname .id { font-size: 0.6rem; opacity: 0.6; font-family: monospace; display: block; }
  .hint { font-size: 0.75rem; opacity: 0.5; }
</style>
</head>
<body>
  <header>
    <h1>FEATURED PICKER — local only, never deployed</h1>
    <select id="category-select"></select>
    <label><input type="checkbox" id="featured-only"> featured only</label>
    <span class="hint">click a photo to toggle featured</span>
    <span id="count"></span>
  </header>
  <main><div id="grid"></div></main>

<script>
let items = [];
let category = 'ALL';
let featuredOnly = false;

const grid = document.getElementById('grid');
const catSelect = document.getElementById('category-select');
const featuredToggle = document.getElementById('featured-only');
const countEl = document.getElementById('count');

function computeView() {
  return items.filter(it =>
    (category === 'ALL' || it.category === category) && (!featuredOnly || it.featured)
  );
}

function renderCount() {
  const total = items.filter(it => it.featured).length;
  countEl.textContent = total + ' featured total';
  countEl.className = total > 60 ? 'over' : '';
}

function render() {
  const view = computeView();
  renderCount();
  grid.innerHTML = view.map((it, i) => \`
    <div class="cell \${it.featured ? 'on' : ''}" data-i="\${i}">
      <img src="/img/\${it.category}/\${encodeURIComponent(it.filename)}" loading="lazy">
      <div class="badge">\${it.featured ? '&#10003;' : ''}</div>
      <div class="fname"><span class="title">\${it.title || '(no title)'}</span><span class="id">\${it.filename}</span></div>
    </div>
  \`).join('');
  grid.querySelectorAll('.cell').forEach(cell => {
    cell.addEventListener('click', () => toggle(view[+cell.dataset.i]));
  });
}

async function toggle(it) {
  const next = !it.featured;
  const res = await fetch('/api/toggle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: it.filename, featured: next }),
  });
  const data = await res.json();
  if (!data.ok) { alert('Save failed: ' + data.error); return; }
  it.featured = next;
  render();
}

catSelect.addEventListener('change', () => { category = catSelect.value; render(); });
featuredToggle.addEventListener('change', () => { featuredOnly = featuredToggle.checked; render(); });

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

  if (reqUrl.pathname === '/api/toggle' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { filename, featured } = JSON.parse(body);
        const list = loadFeatured();
        const idx = list.indexOf(filename);
        if (featured && idx === -1) list.push(filename);
        if (!featured && idx !== -1) list.splice(idx, 1);
        saveFeatured(list);
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
  console.log(`[featured-review] http://localhost:${PORT}  (categories: ${scopeCategories.join(', ')})`);
  console.log('[featured-review] Local only — nothing here is deployed or exposed publicly. Ctrl+C to stop.');
});
