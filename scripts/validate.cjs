// CI validation for the category wiring contract.
//
// Every photo folder must be hooked into the shared category list
// (src/data/categories.json) and the site pages, and every event must
// reference only wired categories. This catches the silent-failure class
// where a new event folder is added but one of the pages/scripts is never
// updated (blank gallery, no watermarked output, missed placeholders).
//
// Exit code 0 = OK (warnings allowed), 1 = one or more errors.

const fs   = require('fs');
const path = require('path');

const CATEGORIES_FILE = 'src/data/categories.json';
const CAPTIONS_FILE   = 'src/data/captions.json';
const EVENTS_FILE     = 'src/data/events.ts';
const IG_CAPTIONS_FILE = 'scripts/instagram-captions.json';

const errors   = [];
const warnings = [];

// ── Load shared category config ──────────────────────────────────────────────
let config;
try {
  config = JSON.parse(fs.readFileSync(CATEGORIES_FILE, 'utf8'));
} catch (e) {
  errors.push(`Cannot read ${CATEGORIES_FILE} — ${e.message}`);
  process.exitCode = 1;
  process.exit(1);
}
const websiteCat  = config.website || [];
const instaOnlyCat = config.instagramOnly || [];
const labels      = config.labels || {};
const allWired    = new Set([...websiteCat, ...instaOnlyCat]);

// Labels
for (const f of websiteCat) {
  if (!labels[f]) errors.push(`website category "${f}" is missing a label in ${CATEGORIES_FILE}`);
}

// ── Folders under src/assets/images that actually contain images ─────────────
const IMAGES_BASE = 'src/assets/images';
const usedFolders = [];
if (fs.existsSync(IMAGES_BASE)) {
  for (const name of fs.readdirSync(IMAGES_BASE)) {
    const dir = path.join(IMAGES_BASE, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    const hasImages = fs.readdirSync(dir).some(f => /\.(jpe?g|png|webp)$/i.test(f));
    if (hasImages) usedFolders.push(name);
  }
}

// Every folder that holds photos must be wired somewhere (website or instagram-only).
for (const f of usedFolders) {
  if (!allWired.has(f)) {
    errors.push(`Photo folder "src/assets/images/${f}" is not wired into ` +
      `${CATEGORIES_FILE} — add it to "website" (site + rotation) or "instagramOnly", ` +
      `plus the label and events entry.`);
  }
}

// ── Events (src/data/events.ts) must only reference wired categories ─────────
const eventsSrc = fs.readFileSync(EVENTS_FILE, 'utf8');
const eventCats = [];
for (const match of eventsSrc.matchAll(/categories\s*:\s*\[([^\]]*)\]/g)) {
  const list = [...match[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  eventCats.push(...list);
}
for (const c of eventCats) {
  if (!allWired.has(c)) {
    errors.push(`${EVENTS_FILE} references unwired category "${c}" — not present in ${CATEGORIES_FILE}.`);
  }
}

// ── Caption coverage (warnings — auto-captions fills placeholders later) ─────
// Real JSON now — this used to regex-parse captions.ts and only recognised
// single-quoted entries, so a double-quoted caption would silently read back
// as empty here too (same root cause as the caption-batch.mjs bug it shared
// this file with; see scripts/caption-batch.mjs's comment for the story).
const captionsData = JSON.parse(fs.readFileSync(CAPTIONS_FILE, 'utf8'));

const igCaptions = fs.existsSync(IG_CAPTIONS_FILE)
  ? JSON.parse(fs.readFileSync(IG_CAPTIONS_FILE, 'utf8'))
  : {};

for (const f of usedFolders) {
  const dir = path.join(IMAGES_BASE, f);
  for (const file of fs.readdirSync(dir)) {
    if (!/\.(jpe?g|png|webp)$/i.test(file)) continue;
    if (!(file in captionsData)) {
      warnings.push(`[${f}] ${file} has no entry in ${CAPTIONS_FILE} — add a caption or accept the auto-added placeholder.`);
      continue;
    }
    const siteCaption = captionsData[file].caption || '';
    const igCaption    = igCaptions[file] || '';
    if (!siteCaption.trim() && !igCaption.trim()) {
      warnings.push(`[${f}] ${file} has an empty caption — it won't be posted to Instagram (skipped by instagram-post.cjs).`);
    }
  }
}

// ── Build identity of images/wiring (site pages) — sanity ────────────────────
const lowercase = x => x.toLowerCase();
const dupWebsite = websiteCat.filter((c, i) => websiteCat.slice(0, i).some(p => lowercase(p) === lowercase(c)));
for (const c of dupWebsite) {
  errors.push(`Duplicate website category "${c}" in ${CATEGORIES_FILE}.`);
}

// ── Report ───────────────────────────────────────────────────────────────────
for (const e of errors)   console.error(`[error] ${e}`);
for (const w of warnings) console.warn(`[warn]  ${w}`);

const shown = warnings.length ? `, ${warnings.length} warning(s)` : '';
console.log(`validate: ${errors.length} error(s)${shown}`);

process.exit(errors.length ? 1 : 0);