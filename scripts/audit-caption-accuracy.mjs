// Gemini-based second opinion on already-published captions — re-looks at
// each photo and checks whether its existing caption text still holds up:
// right make/model/colour/number, right livery/sponsor claims. Free-tier
// Gemini, same rotation as caption-batch.mjs/backfill-plates.mjs.
//
// Report-only: never edits captions.json. This is Gemini checking Gemini's
// earlier work, so it can be wrong in either direction — treat flagged
// results as candidates to spot-check by eye, not as ground truth.
//
// Usage:
//   GEMINI_API_KEY=... node scripts/audit-caption-accuracy.mjs <category> [<category> ...]
//
// Reads full-res originals from src/assets/images/<category>/. Resumable:
// results are written to .caption-audit-progress.json after every photo.

import fs from 'fs';
import path from 'path';

const categories = process.argv.slice(2);
if (categories.length === 0) {
  console.error('Usage: node scripts/audit-caption-accuracy.mjs <category> [<category> ...]');
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
const PROGRESS_PATH = 'scripts/.caption-audit-progress.json';

const MODELS = ['gemini-3.5-flash', 'gemini-3.1-flash-lite'];

function buildPrompt(title, caption) {
  return `Here is the caption currently published for this motorsport/car photo:

Title: "${title}"
Caption: "${caption}"

Check this caption against what's actually visible in the image. Specifically:
- Is the car's make and model correctly identified?
- Is the colour correct?
- If a race/car number is mentioned, is it actually visible and correct?
- If a livery, team, or sponsor is named, does it match what's on the car?

Only flag a CLEAR, CONFIDENT mismatch — something you can see is wrong, not a
stylistic nitpick or a detail you're unsure about. If the caption is
reasonably accurate, say so even if it's not perfectly worded.

Return ONLY a JSON object in a \`\`\`json fenced code block:
{"accurate": true} if the caption holds up, or
{"accurate": false, "issue": "specific description of what's wrong"} if not.`;
}

function isLfsPointer(fullPath) {
  const stat = fs.statSync(fullPath);
  if (stat.size > 1024) return false;
  const head = fs.readFileSync(fullPath, 'utf8').slice(0, 100);
  return head.startsWith('version https://git-lfs.github.com/spec/v1');
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

async function auditOne(imgPath, title, caption) {
  const bytes = fs.readFileSync(imgPath);
  const b64 = bytes.toString('base64');
  const mimeType = /\.png$/i.test(imgPath) ? 'image/png' : 'image/jpeg';

  let lastErr;
  for (const model of MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;
    const body = {
      contents: [{
        parts: [
          { text: buildPrompt(title, caption) },
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
      console.log(`[audit-captions]   ${model} quota hit, trying next model...`);
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
    return extractJson(text);
  }
  throw lastErr ?? new Error('All models failed');
}

const captionsData = JSON.parse(fs.readFileSync(CAPTIONS_JSON_PATH, 'utf8'));
const progress = loadProgress();

const targets = [];
for (const category of categories) {
  const dir = path.join(IMAGES_BASE, category);
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir)) {
    if (!/\.(jpe?g|png|webp)$/i.test(file)) continue;
    const entry = captionsData[file];
    if (!entry || !entry.caption?.trim()) continue; // not captioned — out of scope
    targets.push({ category, file, fullPath: path.join(dir, file), title: entry.title, caption: entry.caption });
  }
}

if (targets.length === 0) {
  console.log('[audit-captions] Nothing to check — no captioned photos in scope.');
  process.exit(0);
}

console.log(`[audit-captions] ${targets.length} photo(s) to audit across: ${categories.join(', ')}`);

let checked = 0, flagged = 0, skippedPointers = 0, failed = 0;
for (const { category, file, fullPath, title, caption } of targets) {
  if (progress[file] !== undefined) {
    if (progress[file].accurate === false) flagged++;
    checked++;
    continue;
  }

  if (isLfsPointer(fullPath)) {
    console.log(`[audit-captions] ! ${category}/${file} is a Git LFS pointer, not a real image — skipping`);
    skippedPointers++;
    continue;
  }

  try {
    const result = await auditOne(fullPath, title, caption);
    progress[file] = result;
    saveProgress(progress);
    checked++;
    if (result.accurate === false) {
      flagged++;
      console.log(`[audit-captions] ⚠ ${category}/${file} — ${result.issue}`);
    } else {
      console.log(`[audit-captions] ✓ ${category}/${file}`);
    }
  } catch (err) {
    console.error(`[audit-captions] ✗ ${category}/${file} — ${err.message}`);
    failed++;
  }
}

console.log(`\n[audit-captions] Done — ${checked} checked, ${flagged} flagged, ${skippedPointers} LFS pointer(s) skipped, ${failed} failed.`);
console.log('[audit-captions] This is Gemini double-checking Gemini — spot-check flagged photos');
console.log('[audit-captions] by eye before trusting them, same as any AI output. Nothing was');
console.log('[audit-captions] auto-changed in captions.json.');
