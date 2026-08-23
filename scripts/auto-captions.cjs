const fs   = require('fs');
const path = require('path');

const IMAGES_BASE = 'src/assets/images';
const CAPTIONS_FILE = 'src/data/captions.json';
// Categories come from the single source of truth — src/data/categories.json.
const CATEGORIES = require('../src/data/categories.json').website;

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

const images = collectImages();
const captions = JSON.parse(fs.readFileSync(CAPTIONS_FILE, 'utf8'));
const missing = images.filter(f => !(f in captions));

if (missing.length === 0) {
  console.log('No new images — nothing to do.');
  process.exit(0);
}

for (const f of missing) {
  const stem = f.replace(/\.[^.]+$/, '').replace(/-Enhanced-NR$/i, '').replace(/_/g, ' ');
  captions[f] = { title: stem, caption: '' };
}

fs.writeFileSync(CAPTIONS_FILE, JSON.stringify(captions, null, 2) + '\n');
console.log(`Added ${missing.length} placeholder(s): ${missing.join(', ')}`);
