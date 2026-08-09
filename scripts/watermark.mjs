import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

function findImages(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findImages(full, results);
    } else if (/\.(jpe?g|png|webp)$/i.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

const INPUT_BASE  = 'src/assets/images';
const OUTPUT_BASE = 'src/assets/watermarked';
const IG_BASE     = 'public/ig';
// Category lists come from the single source of truth — src/data/categories.json.
// Any change to categories is made there and picked up by every script/page.
function loadCategories() {
  const raw = fs.readFileSync(new URL('../src/data/categories.json', import.meta.url), 'utf8');
  return JSON.parse(raw);
}
const categoriesFile = loadCategories();
const CATEGORIES  = categoriesFile.website;
const IG_ONLY_CATEGORIES = categoriesFile.instagramOnly;
const EXTS        = '{jpg,jpeg,png,webp,JPG,JPEG,PNG,WEBP}';

// Tracks a content hash per source file so re-runs can tell "unchanged" from
// "new/edited" without relying on file mtimes — CI checkouts reset every
// file's mtime to the checkout time, which defeats a timestamp-based check
// even when the cached outputs are perfectly valid. Lives inside
// OUTPUT_BASE so it round-trips through the same GitHub Actions cache as
// the watermarked/ig images it describes.
const MANIFEST_PATH = path.join(OUTPUT_BASE, '.manifest.json');
function loadManifest() {
  try { return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')); } catch { return {}; }
}
function saveManifest(manifest) {
  fs.mkdirSync(OUTPUT_BASE, { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest));
}
function hashFile(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function watermarkSVG(w, h) {
  const size   = Math.max(13, Math.round(w * 0.018));
  const padX   = Math.round(w * 0.025);
  const padY   = Math.round(h * 0.025);
  const text   = 'trackmarc.com';
  return Buffer.from(`
    <svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="s">
          <feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#000" flood-opacity="0.85"/>
        </filter>
      </defs>
      <text
        x="${w - padX}" y="${h - padY}"
        text-anchor="end"
        font-family="Helvetica Neue, Arial, sans-serif"
        font-size="${size}"
        font-weight="300"
        letter-spacing="${Math.round(size * 0.28)}"
        fill="rgba(255,255,255,0.75)"
        filter="url(#s)"
      >${text}</text>
    </svg>`);
}

// Embedded in every served image — machine-readable ownership signals for
// Google Images ("licensable" detection) and anyone inspecting the file.
const EXIF_METADATA = {
  IFD0: {
    Copyright: '© Marc Ronan / TrackMarc — https://trackmarc.com/licensing',
    Artist: 'Marc Ronan',
  },
};

const files       = CATEGORIES.flatMap(c => findImages(path.join(INPUT_BASE, c)));
const igOnlyFiles = IG_ONLY_CATEGORIES.flatMap(c => findImages(path.join(INPUT_BASE, c)));

if (!files.length && !igOnlyFiles.length) {
  console.log('[watermark] No images found — skipping.');
  process.exit(0);
}

let stamped = 0, skipped = 0;
const manifest = loadManifest();

// Instagram requires aspect ratio between 0.8 (4:5 portrait) and 1.91:1 (landscape)
async function writeIgVersion(src, igDest) {
  const meta = await sharp(src).metadata();
  fs.mkdirSync(path.dirname(igDest), { recursive: true });
  const igWidth  = Math.min(meta.width, 1080);
  const igHeight = Math.max(Math.round(igWidth * meta.height / meta.width), Math.ceil(igWidth / 1.91));
  await sharp(src)
    .resize({ width: igWidth, height: igHeight, fit: 'cover', position: 'centre', withoutEnlargement: true })
    .withMetadata({ exif: EXIF_METADATA })
    .jpeg({ quality: 88 })
    .toFile(igDest);
  return meta;
}

// Manifest is saved in `finally` so a crash partway through (bad image, etc.)
// still keeps credit for whatever was already processed this run.
try {
  for (const src of files) {
    const rel  = path.relative(INPUT_BASE, src);
    const dest = path.join(OUTPUT_BASE, rel).replace(/\.[^.]+$/, '.jpg');

    // Skip if the source's content hash matches the last processed run AND
    // both outputs already exist (manifest key: bare rel path)
    const igDest0 = path.join(IG_BASE, rel).replace(/\.[^.]+$/, '.jpg');
    const hash = hashFile(src);
    if (manifest[rel] === hash && fs.existsSync(dest) && fs.existsSync(igDest0)) {
      skipped++; continue;
    }

    fs.mkdirSync(path.dirname(dest), { recursive: true });

    const img  = sharp(src);
    const meta = await img.metadata();
    const wm   = watermarkSVG(meta.width, meta.height);

    await img
      .composite([{ input: wm, blend: 'over' }])
      .withMetadata({ exif: EXIF_METADATA })
      .jpeg({ quality: 88 })
      .toFile(dest);

    // Also write a 1080px-wide clean version to public/ig/ for Instagram posts
    await writeIgVersion(src, igDest0);

    manifest[rel] = hash;
    console.log(`[watermark] ✓ ${rel}`);
    stamped++;
  }

  // Instagram-only images: no watermarked/ copy, so they never appear in the website gallery.
  for (const src of igOnlyFiles) {
    const rel         = path.relative(INPUT_BASE, src);
    const igDest0     = path.join(IG_BASE, rel).replace(/\.[^.]+$/, '.jpg');
    const manifestKey = `igonly:${rel}`;
    const hash        = hashFile(src);

    if (manifest[manifestKey] === hash && fs.existsSync(igDest0)) {
      skipped++; continue;
    }

    await writeIgVersion(src, igDest0);
    manifest[manifestKey] = hash;
    console.log(`[watermark] ✓ ${rel} (Instagram-only)`);
    stamped++;
  }
} finally {
  saveManifest(manifest);
}

console.log(`[watermark] Done — ${stamped} stamped, ${skipped} unchanged.`);
