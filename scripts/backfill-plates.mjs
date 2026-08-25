// Fills in the `plate` field on already-captioned photos via Gemini — for
// photos captioned before plate extraction existed, or where the original
// caption pass just didn't spot one. Only ever touches `plate`; title and
// caption are left exactly as they are.
//
// Usage:
//   GEMINI_API_KEY=... node scripts/backfill-plates.mjs <category> [<category> ...]
//
// Each <category> must be a key in src/data/categories.json. Reads full-res
// originals directly from src/assets/images/<category>/ — unlike
// caption-batch.mjs this doesn't take a downscaled review folder, since
// reading a small plate needs the detail a downscale would throw away.
//
// Resumable: results are written to .plate-backfill-progress.json after
// every photo, so an aborted or quota-exhausted run picks up where it left
// off — same pattern as caption-batch.mjs, which this reuses the model
// rotation and JSON-extraction logic from.
//
// Skips Git LFS pointer files (tiny text stand-ins left behind when this
// machine's checkout doesn't have git-lfs installed) instead of sending
// pointer text to Gemini as if it were an image.
//
// CRITICAL: same rule as everywhere else — spot-check a handful of results,
// especially anything that looks off, before trusting them.

import fs from 'fs';
import path from 'path';

const categories = process.argv.slice(2);
if (categories.length === 0) {
  console.error('Usage: node scripts/backfill-plates.mjs <category> [<category> ...]');
  process.exit(1);
}

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('GEMINI_API_KEY is not set.');
  process.exit(1);
}

const categoriesFile = JSON.parse(fs.readFileSync('src/data/categories.json', 'utf8'));
const allCategories = [...categoriesFile.website, ...categoriesFile.instagramOnly];
for (const category of categories) {
  if (!allCategories.includes(category)) {
    console.error(`Unknown category "${category}". Known: ${allCategories.join(', ')}`);
    process.exit(1);
  }
}

const IMAGES_BASE = 'src/assets/images';
const CAPTIONS_JSON_PATH = 'src/data/captions.json';
const PROGRESS_PATH = 'scripts/.plate-backfill-progress.json';

const MODELS = ['gemini-3.5-flash', 'gemini-3.1-flash-lite'];

const PLATE_PROMPT = `Look at this motorsport/car photo. Is there a real road registration
plate clearly legible on the car, character by character? This means an actual road plate
(e.g. Irish/UK format: a year/county code plus numbers, like "141-D-12345", or a UK-format
plate like "WV05 APZ"), NOT any of the following, which are NOT plates even if they look like
one at a glance:
- A competition/race number painted on a door, bumper, or windscreen banner (e.g. "64" or "#21").
- A novelty/decorative plate styled to look Japanese/JDM (Japanese characters, a region code, or
  something referencing the engine/spec like "SR-20" or "RB26") mounted where a plate normally
  goes — these are common on drift/tuner cars and are not real registrations, even when they're
  the same size and shape as a real plate.
- Any sponsor/team name plate-shaped sticker.

Only report a plate if it's in a real Irish or UK road-plate format and you can read every
character with full confidence. If there's no such plate visible, or it's blurred, angled,
obscured, or you're not fully sure of even one character, say so instead of guessing or
reconstructing a partial one.

Return ONLY a JSON object in a \`\`\`json fenced code block: {"plate": "..."} — the plate string
exactly as it appears (spaces/dashes as shown), or {"plate": ""} if none is legible.`;

function isLfsPointer(fullPath) {
  const stat = fs.statSync(fullPath);
  if (stat.size > 1024) return false;
  const head = fs.readFileSync(fullPath, 'utf8').slice(0, 100);
  return head.startsWith('version https://git-lfs.github.com/spec/v1');
}

function loadCaptionsJson() {
  return JSON.parse(fs.readFileSync(CAPTIONS_JSON_PATH, 'utf8'));
}
function saveCaptionsJson(data) {
  fs.writeFileSync(CAPTIONS_JSON_PATH, JSON.stringify(data, null, 2) + '\n');
}
function loadProgress() {
  try { return JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8')); } catch { return {}; }
}
function saveProgress(progress) {
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2));
}
function extractJson(text) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i) ?? text.match(/```\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  return JSON.parse(raw.trim());
}

async function findPlate(imgPath) {
  const bytes = fs.readFileSync(imgPath);
  const b64 = bytes.toString('base64');
  const mimeType = /\.png$/i.test(imgPath) ? 'image/png' : 'image/jpeg';

  let lastErr;
  for (const model of MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;
    const body = {
      contents: [{
        parts: [
          { text: PLATE_PROMPT },
          { inline_data: { mime_type: mimeType, data: b64 } },
        ],
      }],
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.status === 429) {
      console.log(`[backfill-plates]   ${model} quota hit, trying next model...`);
      lastErr = new Error(`${model} returned 429`);
      continue;
    }
    if (!res.ok) {
      lastErr = new Error(`${model} returned ${res.status}: ${await res.text()}`);
      continue;
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error(`${model} returned no text: ${JSON.stringify(data)}`);
    return extractJson(text).plate ?? '';
  }
  throw lastErr ?? new Error('All models failed');
}

const captionsData = loadCaptionsJson();
const progress = loadProgress();

const targets = [];
for (const category of categories) {
  const dir = path.join(IMAGES_BASE, category);
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir)) {
    if (!/\.(jpe?g|png|webp)$/i.test(file)) continue;
    const entry = captionsData[file];
    if (!entry || !entry.caption?.trim()) continue; // not captioned yet — out of scope
    if (entry.plate) continue; // already has one
    targets.push({ category, file, fullPath: path.join(dir, file) });
  }
}

if (targets.length === 0) {
  console.log('[backfill-plates] Nothing to do — every captioned photo in scope already has a plate checked.');
  process.exit(0);
}

console.log(`[backfill-plates] ${targets.length} photo(s) to check across: ${categories.join(', ')}`);

let checked = 0, found = 0, skippedPointers = 0, failed = 0;
for (const { category, file, fullPath } of targets) {
  if (progress[file] !== undefined) {
    if (progress[file]) found++;
    checked++;
    continue;
  }

  if (isLfsPointer(fullPath)) {
    console.log(`[backfill-plates] ! ${category}/${file} is a Git LFS pointer, not a real image — skipping`);
    skippedPointers++;
    continue;
  }

  try {
    const plate = await findPlate(fullPath);
    progress[file] = plate;
    saveProgress(progress);
    if (plate) {
      captionsData[file] = { ...captionsData[file], plate };
      saveCaptionsJson(captionsData);
      console.log(`[backfill-plates] ✓ ${category}/${file} — ${plate}`);
      found++;
    } else {
      console.log(`[backfill-plates] - ${category}/${file} — no legible plate`);
    }
    checked++;
  } catch (err) {
    console.error(`[backfill-plates] ✗ ${category}/${file} — ${err.message}`);
    failed++;
  }
}

console.log(`[backfill-plates] Done — ${checked} checked, ${found} plate(s) found, ${skippedPointers} LFS pointer(s) skipped, ${failed} failed.`);
console.log('[backfill-plates] Spot-check a handful before trusting these, same as any Gemini output.');
