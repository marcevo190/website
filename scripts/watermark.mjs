import sharp from 'sharp';
import path from 'path';
import fs from 'fs';

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
const CATEGORIES  = ['formula', 'endurance', 'rally', 'gt', 'car-shows'];
const EXTS        = '{jpg,jpeg,png,webp,JPG,JPEG,PNG,WEBP}';

function watermarkSVG(w, h) {
  const size   = Math.max(14, Math.round(w * 0.022));
  const padX   = Math.round(w * 0.025);
  const padY   = Math.round(h * 0.025);
  const text   = '© MARC RONAN / TRACKMARC';
  return Buffer.from(`
    <svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="s">
          <feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#000" flood-opacity="0.9"/>
        </filter>
      </defs>
      <text
        x="${w - padX}" y="${h - padY}"
        text-anchor="end"
        font-family="Arial, sans-serif"
        font-size="${size}"
        font-weight="700"
        letter-spacing="${Math.round(size * 0.12)}"
        fill="rgba(255,255,255,0.82)"
        filter="url(#s)"
      >${text}</text>
    </svg>`);
}

const files = CATEGORIES.flatMap(c => findImages(path.join(INPUT_BASE, c)));

if (!files.length) {
  console.log('[watermark] No images found — skipping.');
  process.exit(0);
}

let stamped = 0, skipped = 0;

for (const src of files) {
  const rel  = path.relative(INPUT_BASE, src);
  const dest = path.join(OUTPUT_BASE, rel).replace(/\.[^.]+$/, '.jpg');

  // Skip if dest is newer than source
  if (fs.existsSync(dest)) {
    const srcMtime  = fs.statSync(src).mtimeMs;
    const destMtime = fs.statSync(dest).mtimeMs;
    if (destMtime >= srcMtime) { skipped++; continue; }
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });

  const img  = sharp(src);
  const meta = await img.metadata();
  const wm   = watermarkSVG(meta.width, meta.height);

  await img
    .composite([{ input: wm, blend: 'over' }])
    .jpeg({ quality: 88 })
    .toFile(dest);

  console.log(`[watermark] ✓ ${rel}`);
  stamped++;
}

console.log(`[watermark] Done — ${stamped} stamped, ${skipped} unchanged.`);
