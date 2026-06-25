const fs   = require('fs');
const path = require('path');

const IMAGES_BASE = 'src/assets/images';
const CAPTIONS_FILE = 'src/data/captions.ts';
const CATEGORIES = ['formula', 'endurance', 'rally', 'gt', 'car-shows'];

// Collect all image filenames in the repo
function collectImages() {
  const files = [];
  for (const cat of CATEGORIES) {
    const dir = path.join(IMAGES_BASE, cat);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (/\.(jpe?g|png|webp)$/i.test(file)) {
        files.push(file);
      }
    }
  }
  return files;
}

// Parse existing caption keys from captions.ts
function loadExistingKeys() {
  const src = fs.readFileSync(CAPTIONS_FILE, 'utf8');
  const keys = new Set();
  for (const match of src.matchAll(/'([^']+\.(jpe?g|png|webp))'\s*:/gi)) {
    keys.add(match[1]);
  }
  return keys;
}

const images = collectImages();
const existing = loadExistingKeys();
const missing = images.filter(f => !existing.has(f));

if (missing.length === 0) {
  console.log('No new images — nothing to do.');
  process.exit(0);
}

// Build placeholder entries
const placeholders = missing.map(f => {
  const stem = f.replace(/\.[^.]+$/, '').replace(/-Enhanced-NR$/i, '').replace(/_/g, ' ');
  return `  '${f}': { title: '${stem}', caption: '' },`;
}).join('\n');

// Insert before the closing }; of the captions object
let src = fs.readFileSync(CAPTIONS_FILE, 'utf8');
src = src.replace(
  /\n};\n\nexport function/,
  `\n\n  // ── Uncaptioned — edit title and caption above ────────────────────────────\n\n${placeholders}\n};\n\nexport function`
);

fs.writeFileSync(CAPTIONS_FILE, src);
console.log(`Added ${missing.length} placeholder(s): ${missing.join(', ')}`);
