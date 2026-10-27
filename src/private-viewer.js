// Private, password-gated viewer for the two R2 buckets that aren't part of
// the public site: trackmarc-raw-backup (camera RAWs + their generated
// previews) and trackmarc-photos (the site's own originals, browsable here
// as a second copy independent of the built/watermarked site pages). Lives
// at /private/* on the same Worker as the public site.
//
// This repo is public, so the only thing protecting this route is a real
// server-side password check + a signed session cookie -- never security
// through an obscure URL. PRIVATE_VIEWER_PASSWORD and SESSION_SECRET are
// Worker secrets (set via the Cloudflare dashboard), not in wrangler.json.

const COOKIE_NAME = 'private_session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function isAuthed(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) return false;
  const [expiryStr, sig] = decodeURIComponent(match[1]).split('.');
  const expiry = Number(expiryStr);
  if (!expiry || Date.now() > expiry || !sig) return false;
  const expected = await hmac(env.SESSION_SECRET, expiryStr);
  return sig === expected;
}

async function sessionCookie(env) {
  const expiry = Date.now() + SESSION_MS;
  const sig = await hmac(env.SESSION_SECRET, String(expiry));
  const value = encodeURIComponent(`${expiry}.${sig}`);
  return `${COOKIE_NAME}=${value}; Path=/private; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MS / 1000}`;
}

function bucketFor(env, name) {
  if (name === 'raw') return env.RAW_BUCKET;
  if (name === 'photos') return env.PHOTOS_BUCKET;
  return null;
}

function loginPage(error) {
  return `<!doctype html><html><head><title>Private — TrackMarc</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{font-family:system-ui,sans-serif;background:#0d1114;color:#eee;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
form{background:#161b1e;padding:2rem;border-radius:8px;width:min(320px,90vw)}
input{width:100%;box-sizing:border-box;padding:0.7rem;margin-top:0.75rem;background:#0d1114;border:1px solid #333;color:#eee;border-radius:4px}
button{width:100%;margin-top:1rem;padding:0.7rem;background:#00d2be;border:none;border-radius:4px;font-weight:600;cursor:pointer}
p.err{color:#ff8080;margin:0}
</style></head><body>
<form method="POST" action="/private/login">
<h2>Private Viewer</h2>
${error ? '<p class="err">Wrong password.</p>' : ''}
<input type="password" name="password" placeholder="Password" autofocus required>
<button type="submit">Enter</button>
</form></body></html>`;
}

function appPage() {
  return `<!doctype html><html><head><title>Private — TrackMarc</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root{color-scheme:dark}
body{font-family:system-ui,sans-serif;background:#0d1114;color:#eee;margin:0}
header{position:sticky;top:0;background:#161b1e;padding:0.75rem 1rem;display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap;z-index:10}
.tab{padding:0.5rem 1rem;border-radius:4px;cursor:pointer;background:#0d1114;border:1px solid #333}
.tab.active{background:#00d2be;color:#0d1114;font-weight:600;border-color:#00d2be}
#path{font-size:0.85rem;color:#aaa;padding:0.75rem 1rem 0}
#crumbs a{color:#00d2be;text-decoration:none}
#grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:0.5rem;padding:1rem}
.folder,.file{background:#161b1e;border-radius:6px;overflow:hidden;cursor:pointer;position:relative}
.folder{display:flex;align-items:center;justify-content:center;height:100px;font-size:2rem}
.file img{width:100%;height:100px;object-fit:cover;display:block;background:#000}
.name{font-size:0.68rem;padding:0.3rem;word-break:break-all;color:#ccc}
.pid{font-size:0.9rem;font-weight:700;color:#fff;padding:0.35rem 0.4rem 0;letter-spacing:0.02em}
.pdir{font-size:0.62rem;color:#888;padding:0 0.4rem 0.35rem;word-break:break-all}
#sort{padding:0.5rem;border-radius:4px;border:1px solid #333;background:#0d1114;color:#eee;font-size:0.85rem}
#search{flex:1;min-width:160px;max-width:280px;padding:0.5rem 0.7rem;border-radius:4px;border:1px solid #333;background:#0d1114;color:#eee;font-size:0.9rem}
#lb-id{font-size:1.3rem;font-weight:700;color:#fff}
#lightbox{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:100;align-items:center;justify-content:center;flex-direction:column;gap:1rem}
#lightbox img{max-width:92vw;max-height:78vh;object-fit:contain}
#lightbox a.dl{background:#00d2be;color:#0d1114;padding:0.6rem 1.2rem;border-radius:4px;text-decoration:none;font-weight:600}
#lightbox .close{position:absolute;top:1rem;right:1.5rem;font-size:1.8rem;cursor:pointer;color:#fff}
#empty{padding:2rem;color:#888;text-align:center}
#selbtn{padding:0.5rem 0.9rem;border-radius:4px;border:1px solid #333;background:#0d1114;color:#eee;font-size:0.85rem;cursor:pointer}
#selbtn.on{background:#00d2be;color:#0d1114;border-color:#00d2be;font-weight:600}
.file .tick{display:none;position:absolute;top:6px;left:6px;width:22px;height:22px;border-radius:50%;border:2px solid #fff;background:rgba(0,0,0,0.45);color:#0d1114;font-weight:700;font-size:14px;line-height:18px;text-align:center}
body.selecting .file .tick{display:block}
.file.sel{outline:3px solid #00d2be;outline-offset:-3px}
.file.sel .tick{background:#00d2be;border-color:#00d2be}
#selbar{display:none;position:fixed;left:0;right:0;bottom:0;background:#161b1e;border-top:1px solid #333;padding:0.7rem 1rem calc(0.7rem + env(safe-area-inset-bottom, 0px));gap:0.6rem;align-items:center;flex-wrap:wrap;z-index:50}
body.selecting #selbar{display:flex}
body.selecting #grid{padding-bottom:5rem}
#selbar button{padding:0.55rem 1rem;border-radius:4px;border:1px solid #333;background:#0d1114;color:#eee;font-size:0.85rem;cursor:pointer}
#selbar button.primary{background:#00d2be;color:#0d1114;border-color:#00d2be;font-weight:600}
#selbar button:disabled{opacity:0.45;cursor:default}
#selcount{font-weight:600;margin-right:auto}
</style></head><body>
<header>
  <div class="tab active" data-bucket="raw">RAW Backup</div>
  <div class="tab" data-bucket="photos">Site Photos</div>
  <input id="search" type="search" placeholder="Search photo ID, e.g. 0362" autocomplete="off">
  <select id="sort" title="Sort photos">
    <option value="newest">Newest added first</option>
    <option value="oldest">Oldest added first</option>
    <option value="name">By photo ID</option>
  </select>
  <button id="selbtn" type="button">Select</button>
  <a href="/private/logout" style="margin-left:auto;color:#888;font-size:0.8rem;">Log out</a>
</header>
<div id="selbar">
  <span id="selcount">0 selected</span>
  <button id="selall" type="button">Select all</button>
  <button id="selnone" type="button">Clear</button>
  <button id="seldl" class="primary" type="button" disabled>Download</button>
</div>
<div id="path"><span id="crumbs"></span></div>
<div id="grid"></div>
<div id="lightbox">
  <span class="close">&#x2715;</span>
  <div id="lb-id"></div>
  <img id="lb-img">
  <a id="lb-dl" class="dl" download>Download original</a>
</div>
<script>
let bucket = 'raw';
let prefix = '';

async function load() {
  document.getElementById('grid').innerHTML = '<div id="empty">Loading…</div>';
  const res = await fetch('/private/api/list?bucket=' + bucket + '&prefix=' + encodeURIComponent(prefix));
  const data = await res.json();
  renderCrumbs();
  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  if (!data.folders.length && !data.files.length) {
    grid.innerHTML = '<div id="empty">Empty folder.</div>';
    return;
  }
  for (const f of data.folders) {
    const el = document.createElement('div');
    el.className = 'folder';
    el.textContent = '📁';
    const label = document.createElement('div');
    el.title = f.split('/').filter(Boolean).pop();
    el.onclick = () => { prefix = f; load(); };
    grid.appendChild(el);
    const nameEl = document.createElement('div');
    nameEl.className = 'name';
    nameEl.textContent = f.split('/').filter(Boolean).pop();
    el.appendChild(nameEl);
  }
  renderFiles(data.files, false);
}

function photoId(key) {
  return key.split('/').pop().replace(/\.[^.]+$/, '');
}

let sortMode = 'newest';
try { sortMode = localStorage.getItem('pv-sort') || 'newest'; } catch (e) {}

function sortFiles(files) {
  const t = f => (f.uploaded ? Date.parse(f.uploaded) : 0);
  const byName = (a, b) => a.key.localeCompare(b.key);
  const out = files.slice();
  if (sortMode === 'newest') out.sort((a, b) => t(b) - t(a) || byName(a, b));
  else if (sortMode === 'oldest') out.sort((a, b) => t(a) - t(b) || byName(a, b));
  else out.sort(byName);
  return out;
}

function renderFiles(files, showFolder) {
  files = sortFiles(files);
  const grid = document.getElementById('grid');
  for (const file of files) {
    const el = document.createElement('div');
    el.className = 'file';
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = '/private/api/thumb?bucket=' + bucket + '&key=' + encodeURIComponent(file.key);
    el.appendChild(img);
    const idEl = document.createElement('div');
    idEl.className = 'pid';
    idEl.textContent = photoId(file.key);
    el.appendChild(idEl);
    if (showFolder) {
      const dirEl = document.createElement('div');
      dirEl.className = 'pdir';
      dirEl.textContent = file.key.split('/').slice(0, -1).join('/') || '/';
      el.appendChild(dirEl);
    }
    const tick = document.createElement('div');
    tick.className = 'tick';
    tick.textContent = '✓';
    el.appendChild(tick);
    el.dataset.key = file.key;
    el.dataset.size = file.size || 0;
    if (selected.has(file.key)) el.classList.add('sel');
    el.title = file.key;
    el.onclick = () => selecting ? toggleSel(el) : openLightbox(file.key, img.src);
    grid.appendChild(el);
  }
}

let searchTimer = null;
let searchSeq = 0;
async function runSearch(q) {
  const seq = ++searchSeq;
  const grid = document.getElementById('grid');
  document.getElementById('crumbs').textContent = 'Searching ' + bucket + ' for "' + q + '"…';
  grid.innerHTML = '<div id="empty">Searching…</div>';
  const res = await fetch('/private/api/search?bucket=' + bucket + '&q=' + encodeURIComponent(q));
  const data = await res.json();
  if (seq !== searchSeq) return;
  document.getElementById('crumbs').textContent = data.files.length + (data.truncated ? '+' : '') + ' result(s) for "' + q + '" in ' + bucket;
  grid.innerHTML = '';
  if (!data.files.length) { grid.innerHTML = '<div id="empty">No photos match "' + q.replace(/[<>&]/g, '') + '".</div>'; return; }
  renderFiles(data.files, true);
}

const sortSel = document.getElementById('sort');
sortSel.value = sortMode;
sortSel.addEventListener('change', () => {
  sortMode = sortSel.value;
  try { localStorage.setItem('pv-sort', sortMode); } catch (e) {}
  const q = document.getElementById('search').value.trim();
  q ? runSearch(q) : load();
});

document.getElementById('search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  searchTimer = setTimeout(() => { q ? runSearch(q) : (searchSeq++, load()); }, 300);
});

function renderCrumbs() {
  const parts = prefix.split('/').filter(Boolean);
  let html = '<a href="#" data-i="-1">' + bucket + '</a>';
  parts.forEach((p, i) => { html += ' / <a href="#" data-i="' + i + '">' + p + '</a>'; });
  document.getElementById('crumbs').innerHTML = html;
  document.querySelectorAll('#crumbs a').forEach(a => {
    a.onclick = (e) => {
      e.preventDefault();
      const i = parseInt(a.dataset.i, 10);
      prefix = i === -1 ? '' : parts.slice(0, i + 1).join('/') + '/';
      load();
    };
  });
}

function openLightbox(key, thumbSrc) {
  document.getElementById('lb-img').src = thumbSrc;
  document.getElementById('lb-id').textContent = photoId(key);
  const dl = document.getElementById('lb-dl');
  dl.href = '/private/api/download?bucket=' + bucket + '&key=' + encodeURIComponent(key);
  dl.setAttribute('download', key.split('/').pop());
  document.getElementById('lightbox').style.display = 'flex';
}

document.querySelector('.close').onclick = () => { document.getElementById('lightbox').style.display = 'none'; };
document.getElementById('lightbox').onclick = (e) => { if (e.target.id === 'lightbox') e.target.style.display = 'none'; };

document.querySelectorAll('.tab').forEach(tab => {
  tab.onclick = () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    bucket = tab.dataset.bucket;
    prefix = '';
    // Selection is per bucket -- downloads are fetched from the current bucket.
    selected.clear(); updateSelBar();
    const q = document.getElementById('search').value.trim();
    q ? runSearch(q) : load();
  };
});

// ---- Multi-select + download as one zip ----
// Selection is kept per bucket view; switching bucket/folder keeps it so photos
// can be picked across folders or search results, then downloaded together.
let selecting = false;
const selected = new Map(); // key -> size
function updateSelBar() {
  const n = selected.size;
  let bytes = 0; selected.forEach(v => { bytes += v; });
  document.getElementById('selcount').textContent = n + ' selected' + (bytes ? ' (' + (bytes / 1048576).toFixed(0) + ' MB)' : '');
  document.getElementById('seldl').disabled = n === 0 || zipping;
}
function toggleSel(el) {
  const k = el.dataset.key;
  if (selected.has(k)) { selected.delete(k); el.classList.remove('sel'); }
  else { selected.set(k, Number(el.dataset.size) || 0); el.classList.add('sel'); }
  updateSelBar();
}
document.getElementById('selbtn').onclick = () => {
  selecting = !selecting;
  document.body.classList.toggle('selecting', selecting);
  document.getElementById('selbtn').classList.toggle('on', selecting);
  document.getElementById('selbtn').textContent = selecting ? 'Done' : 'Select';
  updateSelBar();
};
document.getElementById('selall').onclick = () => {
  document.querySelectorAll('#grid .file').forEach(el => {
    if (!selected.has(el.dataset.key)) { selected.set(el.dataset.key, Number(el.dataset.size) || 0); el.classList.add('sel'); }
  });
  updateSelBar();
};
document.getElementById('selnone').onclick = () => {
  selected.clear();
  document.querySelectorAll('#grid .file.sel').forEach(el => el.classList.remove('sel'));
  updateSelBar();
};

// Minimal "stored" (uncompressed) zip writer -- photos/RAWs don't compress anyway,
// and this avoids pulling in a library. Fine up to 4GB total (no zip64).
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function makeZip(entries) { // entries: [{name, data: Uint8Array}]
  const enc = new TextEncoder(); const parts = []; const central = []; let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const e of entries) {
    const name = enc.encode(e.name); const crc = crc32(e.data); const size = e.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(lh.buffer, name, e.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, size, true); ch.setUint32(24, size, true); ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(ch.buffer, name);
    offset += 30 + name.length + size;
  }
  let csize = 0; central.forEach(b => { csize += b.byteLength; });
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, csize, true); end.setUint32(16, offset, true);
  return new Blob(parts.concat(central, [end.buffer]), { type: 'application/zip' });
}
function saveBlob(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
let zipping = false;
document.getElementById('seldl').onclick = async () => {
  if (!selected.size || zipping) return;
  zipping = true; updateSelBar();
  const btn = document.getElementById('seldl');
  const keys = Array.from(selected.keys());
  try {
    if (keys.length === 1) {
      btn.textContent = 'Downloading…';
      const r = await fetch('/private/api/download?bucket=' + bucket + '&key=' + encodeURIComponent(keys[0]));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      saveBlob(await r.blob(), keys[0].split('/').pop());
    } else {
      const entries = []; const used = new Set();
      for (let i = 0; i < keys.length; i++) {
        btn.textContent = 'Fetching ' + (i + 1) + ' of ' + keys.length + '…';
        const r = await fetch('/private/api/download?bucket=' + bucket + '&key=' + encodeURIComponent(keys[i]));
        if (!r.ok) throw new Error(keys[i] + ': HTTP ' + r.status);
        let name = keys[i].split('/').pop();
        if (used.has(name)) name = keys[i].split('/').join('_');
        used.add(name);
        entries.push({ name, data: new Uint8Array(await r.arrayBuffer()) });
      }
      btn.textContent = 'Zipping…';
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
      saveBlob(makeZip(entries), 'trackmarc-' + bucket + '-' + keys.length + '-photos-' + stamp + '.zip');
    }
    btn.textContent = 'Download';
  } catch (err) {
    btn.textContent = 'Download';
    document.getElementById('selcount').textContent = 'Download failed: ' + err.message;
    zipping = false; return;
  }
  zipping = false; updateSelBar();
};

load();
</script>
</body></html>`;
}

export async function handlePrivateViewer(request, url, env) {
  const path = url.pathname;

  if (path === '/private/login' && request.method === 'POST') {
    const form = await request.formData();
    const password = form.get('password');
    if (!env.PRIVATE_VIEWER_PASSWORD || password !== env.PRIVATE_VIEWER_PASSWORD) {
      return new Response(loginPage(true), { status: 401, headers: { 'Content-Type': 'text/html' } });
    }
    return new Response(null, {
      status: 302,
      headers: { Location: '/private', 'Set-Cookie': await sessionCookie(env) },
    });
  }

  if (path === '/private/logout') {
    return new Response(null, {
      status: 302,
      headers: { Location: '/private', 'Set-Cookie': `${COOKIE_NAME}=; Path=/private; Max-Age=0` },
    });
  }

  if (path === '/private' || path === '/private/') {
    const authed = await isAuthed(request, env);
    return new Response(authed ? appPage() : loginPage(false), {
      headers: { 'Content-Type': 'text/html' },
    });
  }

  // Everything below requires a valid session.
  if (!(await isAuthed(request, env))) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (path === '/private/api/list') {
    const bucketName = url.searchParams.get('bucket');
    const bucket = bucketFor(env, bucketName);
    if (!bucket) return new Response('Unknown bucket', { status: 400 });
    let prefix = url.searchParams.get('prefix') || '';
    // The raw-backup bucket keeps generated previews under previews/ --
    // an implementation detail, never a real browsable folder.
    // R2 returns at most 1000 entries per call -- page through so big
    // folders show everything (needed for "newest first" to be right).
    const objects = [];
    const prefixes = new Set();
    let cursor;
    do {
      const listed = await bucket.list({ prefix, delimiter: '/', cursor, limit: 1000 });
      objects.push(...(listed.objects || []));
      for (const d of listed.delimitedPrefixes || []) prefixes.add(d);
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
    const folders = [...prefixes].filter(
      f => !(bucketName === 'raw' && prefix === '' && f === 'previews/')
    );
    const files = objects
      .filter(o => o.key !== prefix)
      .map(o => ({ key: o.key, size: o.size, uploaded: o.uploaded }));
    return new Response(JSON.stringify({ folders, files }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  if (path === '/private/api/search') {
    const bucketName = url.searchParams.get('bucket');
    const bucket = bucketFor(env, bucketName);
    if (!bucket) return new Response('Unknown bucket', { status: 400 });
    // Match on the filename only, ignoring case and punctuation, so "0362",
    // "dsc0362" and "DSC_0362" all find DSC_0362.jpg / .NEF.
    const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const q = norm(url.searchParams.get('q') || '');
    if (!q) return new Response(JSON.stringify({ files: [] }), { headers: { 'Content-Type': 'application/json' } });
    const files = [];
    const LIMIT = 200;
    let cursor;
    let truncated = false;
    do {
      const listed = await bucket.list({ cursor, limit: 1000 });
      for (const o of listed.objects || []) {
        if (bucketName === 'raw' && o.key.startsWith('previews/')) continue;
        if (o.key.endsWith('/')) continue;
        if (norm(o.key.split('/').pop()).includes(q)) {
          if (files.length >= LIMIT) { truncated = true; break; }
          files.push({ key: o.key, size: o.size, uploaded: o.uploaded });
        }
      }
      cursor = listed.truncated && !truncated ? listed.cursor : undefined;
    } while (cursor);
    files.sort((a, b) => a.key.localeCompare(b.key));
    return new Response(JSON.stringify({ files, truncated }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  if (path === '/private/api/thumb') {
    const bucketName = url.searchParams.get('bucket');
    const bucket = bucketFor(env, bucketName);
    const key = url.searchParams.get('key');
    if (!bucket || !key) return new Response('Bad request', { status: 400 });
    const thumbKey = bucketName === 'raw' ? `previews/${key.replace(/\.nef$/i, '.jpg')}` : key;
    const obj = await bucket.get(thumbKey);
    if (!obj) return new Response('Not found', { status: 404 });
    return new Response(obj.body, {
      headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' },
    });
  }

  if (path === '/private/api/download') {
    const bucketName = url.searchParams.get('bucket');
    const bucket = bucketFor(env, bucketName);
    const key = url.searchParams.get('key');
    if (!bucket || !key) return new Response('Bad request', { status: 400 });
    const obj = await bucket.get(key);
    if (!obj) return new Response('Not found', { status: 404 });
    return new Response(obj.body, {
      headers: {
        'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${key.split('/').pop()}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  }

  return new Response('Not found', { status: 404 });
}
