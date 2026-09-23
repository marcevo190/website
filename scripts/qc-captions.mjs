// Quality-checks EXISTING captions against their actual photos using Gemini's
// vision API -- a second pass to catch misidentifications that slipped through
// the original caption-batch.mjs run (e.g. a driver/team/sponsor wrongly
// matched to the wrong car, as happened with a novelty AE86 kart wrongly
// credited to two different real drivers, caught by manual spot-check
// 2026-09-24). Read-only: writes a report, never edits captions.json or
// instagram-captions.json directly -- a QC pass can be wrong too, so flagged
// items need a human look before anything changes.
//
// Usage:
//   GEMINI_API_KEY=... node scripts/qc-captions.mjs <category> <imageDir>
//
// <imageDir> should hold downscaled review copies of already-captioned photos
// in that category (same resize approach as caption-batch.mjs). Only pass
// photos worth checking -- e.g. ones whose caption names a driver/team/sponsor,
// since a caption naming nobody can't have a misattribution error.
//
// Resumable: results written to .qc-captions-progress.json after every photo.

import fs from 'fs';
import path from 'path';

const [, , category, imageDirArg] = process.argv;

if (!category || !imageDirArg) {
  console.error('Usage: node scripts/qc-captions.mjs <category> <imageDir>');
  process.exit(1);
}

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('GEMINI_API_KEY is not set.');
  process.exit(1);
}

const categoriesFile = JSON.parse(fs.readFileSync('src/data/categories.json', 'utf8'));
const allCategories = [...categoriesFile.website, ...categoriesFile.instagramOnly];
if (!allCategories.includes(category)) {
  console.error(`Unknown category "${category}". Known: ${allCategories.join(', ')}`);
  process.exit(1);
}
const categoryLabel = categoriesFile.labels?.[category] ?? category;

const imageDir = imageDirArg;
if (!fs.existsSync(imageDir)) {
  console.error(`Image directory not found: ${imageDir}`);
  process.exit(1);
}

const CAPTIONS_JSON_PATH = 'src/data/captions.json';
const IG_CAPTIONS_PATH   = 'scripts/instagram-captions.json';
const PROGRESS_PATH      = 'scripts/.qc-captions-progress.json';
const REPORT_PATH        = 'scripts/qc-report.json';

const MODELS = ['gemini-3.5-flash', 'gemini-3.1-flash-lite'];

function loadDriverTags() {
  try {
    const data = JSON.parse(fs.readFileSync('scripts/driver-tags.json', 'utf8'));
    const lines = [];
    for (const d of data.drivers ?? []) lines.push(`- ${d.name} (${d.car}) -> ${d.handle}`);
    for (const t of data.teams ?? []) lines.push(`- ${t.name}${t.car ? ` (${t.car})` : ''} -> ${t.handle}`);
    for (const s of data.sponsors ?? []) lines.push(`- ${s.name} (sponsor, look for: ${s['identifying feature']}) -> ${s.handle}`);
    return lines.join('\n');
  } catch {
    return '';
  }
}
const DRIVER_TAGS = loadDriverTags();

function qcPrompt(title, caption, igCaption) {
  return `You are fact-checking an EXISTING caption against its photo for TrackMarc, a
professional Irish motorsport photography portfolio. This caption was already written by
an earlier automated pass -- your only job is to check it against what is ACTUALLY VISIBLE
in the image. Do not write a new caption.

Category: ${categoryLabel}

EXISTING CAPTION TO CHECK
Title: ${title}
Website caption: ${caption}
Instagram caption: ${igCaption ?? '(none)'}

Check specifically for:
1. Wrong car identification -- make, model, colour, number, or livery that doesn't match
   what's visible in the photo.
2. A named driver, team, or sponsor the image doesn't actually support -- no matching name
   text, number, or livery visible for that specific person or brand.
3. A claim that someone is "driving" or "in" the car when no driver is visible in the frame.
4. Any other specific factual claim (a detail presented as fact) that isn't actually visible
   or confirmable from the image.

${DRIVER_TAGS ? `Known confirmed drivers/teams/sponsors at this event, to cross-check a name
in the caption against what that person's/brand's car actually looks like:\n${DRIVER_TAGS}\n` : ''}
Do NOT flag stylistic choices, tone, or plain descriptions that don't make a specific claim.
Only flag a caption if you are confident something in it is factually wrong given what's
visible in the photo.

Return ONLY a JSON object in a \`\`\`json fenced block: {"ok": true} if the caption checks
out, or {"ok": false, "issue": "one clear sentence explaining exactly what's wrong and why"}
if not.`;
}

function loadCaptionsJson() {
  return JSON.parse(fs.readFileSync(CAPTIONS_JSON_PATH, 'utf8'));
}
function loadIgCaptions() {
  try { return JSON.parse(fs.readFileSync(IG_CAPTIONS_PATH, 'utf8')); } catch { return {}; }
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

async function qcOne(imgPath, title, caption, igCaption) {
  const bytes    = fs.readFileSync(imgPath);
  const b64      = bytes.toString('base64');
  const mimeType = /\.png$/i.test(imgPath) ? 'image/png' : 'image/jpeg';
  const prompt   = qcPrompt(title, caption, igCaption);

  let lastErr;
  for (const model of MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;
    const body = {
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mimeType, data: b64 } },
        ],
      }],
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 429 || res.status === 503) {
      console.log(`[qc-captions]   ${model} unavailable (${res.status}), trying next model...`);
      lastErr = new Error(`${model} returned ${res.status}`);
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

const captionsData = loadCaptionsJson();
const igCaptions   = loadIgCaptions();
const progress     = loadProgress();

const files = fs.readdirSync(imageDir)
  .filter(f => /\.(jpe?g|png)$/i.test(f))
  .filter(f => captionsData[f]?.caption?.trim().length > 0);

if (files.length === 0) {
  console.log('[qc-captions] No captioned images found in this directory.');
  process.exit(0);
}

console.log(`[qc-captions] ${files.length} captioned image(s) to check in ${imageDir} (category: ${category})`);

let checked = 0, flagged = 0, failed = 0;
for (const file of files) {
  if (progress[file]) {
    checked++;
    if (progress[file].ok === false) flagged++;
    continue;
  }
  try {
    const entry = captionsData[file];
    const result = await qcOne(path.join(imageDir, file), entry.title, entry.caption, igCaptions[file]);
    progress[file] = result;
    saveProgress(progress);
    if (result.ok === false) {
      flagged++;
      console.log(`[qc-captions] ⚠ ${file} — ${result.issue}`);
    } else {
      console.log(`[qc-captions] ✓ ${file}`);
    }
    checked++;
  } catch (err) {
    console.error(`[qc-captions] ✗ ${file} — ${err.message}`);
    failed++;
  }
}

const flaggedEntries = Object.fromEntries(
  Object.entries(progress).filter(([f]) => files.includes(f) && progress[f]?.ok === false)
);
fs.writeFileSync(REPORT_PATH, JSON.stringify(flaggedEntries, null, 2));

console.log(`[qc-captions] Done — ${checked} checked, ${flagged} flagged, ${failed} failed.`);
console.log(`[qc-captions] Flagged items written to ${REPORT_PATH} — review before editing captions.json.`);
