// Captions a batch of new photos via Google's Gemini vision API instead of
// having Claude read every photo directly. Reading + writing a caption for
// each photo in a batch (40-90+ images) in one Claude session is what burned
// through a week's Claude token allowance — this offloads that per-photo
// vision work to Gemini's free tier, which has its own quota, not ours.
//
// Usage:
//   GEMINI_API_KEY=... node scripts/caption-batch.mjs <category> <imageDir>
//
// <category> must be a key in src/data/categories.json (website or
// instagramOnly). <imageDir> is a folder of images to caption — pass the
// *downscaled* review copies (see resize-for-review.ps1 in CLAUDE.md), not
// full-res originals; Gemini doesn't need more than ~1800px to identify a car
// and smaller payloads mean faster, cheaper requests.
//
// Resumable: results are written to .caption-batch-progress.json after every
// photo, so an aborted or quota-exhausted run picks up where it left off.
//
// CRITICAL: same rule as manual captioning — Gemini is identifying cars from
// pixels, not filenames, but it is NOT infallible (the Corvette-labelled-as-
// Ferrari incident that this rule exists for could equally happen here).
// Spot-check identifications before trusting them, especially anything
// unusual — Marc knows these cars far better than any model does.

import fs from 'fs';
import path from 'path';

const [, , category, imageDirArg] = process.argv;

if (!category || !imageDirArg) {
  console.error('Usage: node scripts/caption-batch.mjs <category> <imageDir>');
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

const CAPTIONS_TS_PATH = 'src/data/captions.ts';
const IG_CAPTIONS_PATH = 'scripts/instagram-captions.json';
const PROGRESS_PATH    = 'scripts/.caption-batch-progress.json';

// Free-tier daily quotas are per-model and small (~20 requests/day on some
// models). Rotate to the next model on a 429 instead of stalling the whole
// batch — add more here as new free-tier models become available.
const MODELS = ['gemini-3.5-flash', 'gemini-3.1-flash-lite'];

const STYLE_PROMPT = `You are writing captions for TrackMarc, a professional Irish motorsport
photography portfolio (trackmarc.com) run by Marc Ronan. Identify the car (make, model, number,
livery/team if visible) from what is ACTUALLY VISIBLE in the photo — never guess, never invent
details you can't confirm from the image. If you can't confidently identify something, describe
only what you're sure of (e.g. "a GT3 car" rather than a wrong specific model).

Style rules:
- Write like a real person, not a press release or AI. No em dashes (—) — use a comma or full stop.
- Never use: breathtaking, stunning, incredible, delve, tapestry, realm, showcase, epitome,
  testament, captivating, remarkable, fascinating, meticulous, intricate, elevate, resonate,
  nestled, vibrant, game-changer, transformative.
- No exclamation marks.
- British/Irish English: colour, tyre, favour, organise. Contractions are fine (it's, that's).
- This photo is from: ${categoryLabel}.

Two different captions are needed:
- "caption": for the website. 1-2 plain sentences, no hook, no question.
- "igCaption": for Instagram. A hook in the first line (max 12 words), then 1-2 more sentences,
  ending with a question to invite comments. No exclamation marks anywhere.

Worked examples of the exact tone and format wanted:
1. {"title": "Aston Martin Vantage GT3 #11 — Le Mans 2026", "caption": "The Aston Martin Vantage GT3, number 11, on track during the Le Mans 24 Hours. Green and yellow livery cutting through the grey.", "igCaption": "Green and yellow, cutting through the Le Mans grey. The Aston Martin Vantage GT3, car 11, mid-stint at this year's 24 Hours. What livery would you run on a GT3 car?"}
2. {"title": "BMW M2, Teal — Bimmerfest, Mondello Park", "caption": "A teal BMW M2 parked up at Bimmerfest, Mondello Park. Clean, understated build, nothing overdone.", "igCaption": "Teal isn't a colour you see often on an M2. Spotted at Bimmerfest, Mondello Park, understated and clean, nothing overdone. Would you go this subtle or something louder?"}
3. {"title": "Pink E30 drift car at Mondello", "caption": "A pink E30 sideways at Mondello Park, smoke off the rear tyres. One of the louder builds on show that day.", "igCaption": "Pink E30, sideways, smoke off both rear tyres. One of the loudest builds at Mondello Park that day, in every sense. Pink on a drift car, yes or no?"}

Return ONLY a JSON object (no other text) in a \`\`\`json fenced code block, shaped exactly like
the examples above: {"title": "...", "caption": "...", "igCaption": "..."}. Title is short (like
a photo credit line).`;

function loadExistingCaptionKeys() {
  const src = fs.readFileSync(CAPTIONS_TS_PATH, 'utf8');
  const keys = new Set();
  for (const match of src.matchAll(/'([^']+\.(?:jpe?g|png|webp))'\s*:\s*\{\s*title:\s*'[^']*',\s*caption:\s*'([^']*)'/gi)) {
    if (match[2].trim().length > 0) keys.add(match[1]); // only truly captioned, not empty placeholders
  }
  return keys;
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

async function captionOne(imgPath) {
  const bytes    = fs.readFileSync(imgPath);
  const b64      = bytes.toString('base64');
  const mimeType = /\.png$/i.test(imgPath) ? 'image/png' : 'image/jpeg';

  let lastErr;
  for (const model of MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;
    const body = {
      contents: [{
        parts: [
          { text: STYLE_PROMPT },
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
      console.log(`[caption-batch]   ${model} quota hit, trying next model...`);
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

function mergeIntoCaptionsTs(entries) {
  let src = fs.readFileSync(CAPTIONS_TS_PATH, 'utf8');
  const lines = Object.entries(entries)
    .map(([filename, { title, caption }]) =>
      `  '${filename}': { title: ${JSON.stringify(title)}, caption: ${JSON.stringify(caption)} },`)
    .join('\n');

  // Replace any existing empty placeholder for this filename, else append before closing `};`
  for (const filename of Object.keys(entries)) {
    const placeholderRe = new RegExp(`\\n\\s*'${filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}':[^\\n]*\\n`);
    src = src.replace(placeholderRe, '\n');
  }
  src = src.replace(/\n};\n\nexport function/, `\n${lines}\n};\n\nexport function`);
  fs.writeFileSync(CAPTIONS_TS_PATH, src);
}

function mergeIntoIgCaptions(entries) {
  const igCaptions = JSON.parse(fs.readFileSync(IG_CAPTIONS_PATH, 'utf8'));
  for (const [filename, { title, caption, igCaption }] of Object.entries(entries)) {
    igCaptions[filename] = igCaption || caption || title;
  }
  fs.writeFileSync(IG_CAPTIONS_PATH, JSON.stringify(igCaptions, null, 2));
}

const existingKeys = loadExistingCaptionKeys();
const progress     = loadProgress();

const files = fs.readdirSync(imageDir)
  .filter(f => /\.(jpe?g|png)$/i.test(f))
  .filter(f => !existingKeys.has(f));

if (files.length === 0) {
  console.log('[caption-batch] Nothing to caption — every image already has a caption.');
  process.exit(0);
}

console.log(`[caption-batch] ${files.length} image(s) to caption in ${imageDir} (category: ${category})`);

let captioned = 0, failed = 0;
for (const file of files) {
  if (progress[file]?.title && progress[file]?.caption) {
    console.log(`[caption-batch] ✓ ${file} (already done, resuming)`);
    captioned++;
    continue;
  }
  try {
    const result = await captionOne(path.join(imageDir, file));
    progress[file] = result;
    saveProgress(progress);
    console.log(`[caption-batch] ✓ ${file} — ${result.title}`);
    captioned++;
  } catch (err) {
    console.error(`[caption-batch] ✗ ${file} — ${err.message}`);
    saveProgress(progress);
    failed++;
  }
}

const finished = Object.fromEntries(
  Object.entries(progress).filter(([f]) => files.includes(f) && progress[f]?.title)
);
if (Object.keys(finished).length > 0) {
  mergeIntoCaptionsTs(finished);
  mergeIntoIgCaptions(finished);
}

console.log(`[caption-batch] Done — ${captioned} captioned, ${failed} failed.`);
console.log('[caption-batch] Spot-check identifications before pushing — Gemini can misidentify cars just like any model can.');
if (failed === 0) {
  fs.rmSync(PROGRESS_PATH, { force: true });
}
