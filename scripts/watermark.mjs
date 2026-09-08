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

// Per-event collab watermark: drop a transparent PNG at
// src/assets/collab-logos/<category>.png and every photo in that category
// gets that logo instead of the plain "trackmarc.com" text — e.g. an
// "86 Fest x TrackMarc" lockup for the 86fest category. Categories with no
// file here are completely unaffected, still get the plain text mark.
const COLLAB_LOGOS_DIR = 'src/assets/collab-logos';
function collabLogoPath(category) {
  const p = path.join(COLLAB_LOGOS_DIR, `${category}.png`);
  return fs.existsSync(p) ? p : null;
}

// Most photos in a shoot share the same resolution (same camera, same
// session), so the resized-logo buffer is cached per (category, target
// width) instead of re-decoding + re-resizing the same PNG on every single
// photo — a few hundred photos in a category would otherwise mean a few
// hundred redundant resizes of an identical result.
const resizedLogoCache = new Map();
async function getResizedLogo(logoPath, targetWidth) {
  const key = `${logoPath}@${targetWidth}`;
  if (!resizedLogoCache.has(key)) {
    resizedLogoCache.set(key, sharp(logoPath).resize({ width: targetWidth }).toBuffer());
  }
  return resizedLogoCache.get(key);
}

// Sized as a fraction of photo width (not a fixed pixel size) so it scales
// with whatever resolution comes in, same as the text mark's font-size
// already does. Wider than the text mark on purpose — these are full brand
// lockups, meant to actually read, not a subtle corner credit.
async function buildWatermarkLayer(category, w, h) {
  const logoPath = collabLogoPath(category);
  if (!logoPath) return { input: watermarkSVG(w, h), blend: 'over' };

  const targetWidth = Math.round(w * 0.26);
  const resized      = await getResizedLogo(logoPath, targetWidth);
  const logoMeta     = await sharp(resized).metadata();
  const padX = Math.round(w * 0.025);
  const padY = Math.round(h * 0.025);
  return {
    input: resized,
    left: Math.max(0, w - logoMeta.width - padX),
    top:  Math.max(0, h - logoMeta.height - padY),
  };
}

// Part of the manifest comparison alongside the source photo's own hash —
// so adding/changing a collab logo for a category forces reprocessing of
// every photo already in that category (their existing watermark is now
// wrong). Categories with no logo keep the exact bare-hash manifest format
// used before this feature existed, on purpose: appending something like
// "|text" unconditionally would change every manifest entry at once and
// force a full-library reprocess for a change that only actually affects
// two categories. This way only 86fest/retrostock's entries invalidate;
// everything else keeps its existing cache hits untouched.
function combinedManifestValue(hash, category) {
  const logoPath = collabLogoPath(category);
  return logoPath ? `${hash}|logo:${hashFile(logoPath)}` : hash;
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
async function writeIgVersion(src, igDest, category) {
  const meta = await sharp(src).metadata();
  fs.mkdirSync(path.dirname(igDest), { recursive: true });
  const igWidth  = Math.min(meta.width, 1080);
  const igHeight = Math.max(Math.round(igWidth * meta.height / meta.width), Math.ceil(igWidth / 1.91));
  const wm = await buildWatermarkLayer(category, igWidth, igHeight);
  await sharp(src)
    .resize({ width: igWidth, height: igHeight, fit: 'cover', position: 'centre', withoutEnlargement: true })
    .composite([wm])
    .withMetadata({ exif: EXIF_METADATA })
    .jpeg({ quality: 88 })
    .toFile(igDest);
  return meta;
}

// Manifest is saved in `finally` so a crash partway through (bad image, etc.)
// still keeps credit for whatever was already processed this run.
try {
  for (const src of files) {
    const rel      = path.relative(INPUT_BASE, src);
    const category = rel.split(path.sep)[0];
    const dest     = path.join(OUTPUT_BASE, rel).replace(/\.[^.]+$/, '.jpg');

    // Skip if the source's content hash AND the applicable watermark are both
    // unchanged from the last processed run, and both outputs already exist.
    const igDest0 = path.join(IG_BASE, rel).replace(/\.[^.]+$/, '.jpg');
    const combinedHash = combinedManifestValue(hashFile(src), category);
    if (manifest[rel] === combinedHash && fs.existsSync(dest) && fs.existsSync(igDest0)) {
      skipped++; continue;
    }

    fs.mkdirSync(path.dirname(dest), { recursive: true });

    const img  = sharp(src);
    const meta = await img.metadata();
    const wm   = await buildWatermarkLayer(category, meta.width, meta.height);

    await img
      .composite([wm])
      .withMetadata({ exif: EXIF_METADATA })
      .jpeg({ quality: 88 })
      .toFile(dest);

    // Also write a 1080px-wide clean version to public/ig/ for Instagram posts
    await writeIgVersion(src, igDest0, category);

    manifest[rel] = combinedHash;
    console.log(`[watermark] ✓ ${rel}`);
    stamped++;
  }

  // Instagram-only images: no watermarked/ copy, so they never appear in the website gallery.
  for (const src of igOnlyFiles) {
    const rel         = path.relative(INPUT_BASE, src);
    const category    = rel.split(path.sep)[0];
    const igDest0     = path.join(IG_BASE, rel).replace(/\.[^.]+$/, '.jpg');
    const manifestKey = `igonly:${rel}`;
    const combinedHash = combinedManifestValue(hashFile(src), category);

    if (manifest[manifestKey] === combinedHash && fs.existsSync(igDest0)) {
      skipped++; continue;
    }

    await writeIgVersion(src, igDest0, category);
    manifest[manifestKey] = combinedHash;
    console.log(`[watermark] ✓ ${rel} (Instagram-only)`);
    stamped++;
  }
} finally {
  saveManifest(manifest);
}

// Prune outputs whose source photo no longer exists (deleted/renamed originals).
// Without this, a removed duplicate keeps showing on the site forever — the
// GitHub Actions cache round-trips whatever's in these directories regardless
// of whether src/assets/images still has a matching file, and Astro's gallery
// glob reads straight from here, not from the source list.
function pruneOrphans(base, expectedRelPaths) {
  if (!fs.existsSync(base)) return 0;
  let pruned = 0;
  for (const full of findImages(base)) {
    const rel = path.relative(base, full);
    if (!expectedRelPaths.has(rel)) {
      fs.rmSync(full);
      console.log(`[watermark] ✗ pruned orphan ${path.relative('.', full)}`);
      pruned++;
    }
  }
  return pruned;
}

const expectedDest   = new Set(files.map(src => path.relative(INPUT_BASE, src).replace(/\.[^.]+$/, '.jpg')));
const expectedIgDest = new Set(
  [...files, ...igOnlyFiles].map(src => path.relative(INPUT_BASE, src).replace(/\.[^.]+$/, '.jpg'))
);
const prunedCount = pruneOrphans(OUTPUT_BASE, expectedDest) + pruneOrphans(IG_BASE, expectedIgDest);

console.log(`[watermark] Done — ${stamped} stamped, ${skipped} unchanged, ${prunedCount} pruned.`);
