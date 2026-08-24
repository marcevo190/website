// Uploads a folder of new photos straight to Cloudflare R2 — the new step
// for adding a photo batch, replacing `git add` + push of the image files
// themselves (see CLAUDE.md's "New photos pushed by Marc" section). Nothing
// under src/assets/images/ is committed to git any more; this script is how
// new originals actually reach the site.
//
// Usage:
//   node scripts/upload-photos-to-r2.mjs <category> <folder>
//
// <category> must be a key in src/data/categories.json (website or
// instagramOnly). <folder> is the folder of full-resolution originals to
// upload, named exactly as they should appear in the gallery.
//
// Credentials (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
// R2_BUCKET) come from the environment — locally from macOS Keychain
// (trackmarc-r2-*, see CLAUDE.md), in CI from GitHub repo secrets.

import fs from 'fs';
import path from 'path';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

const [, , category, folderArg] = process.argv;

if (!category || !folderArg) {
  console.error('Usage: node scripts/upload-photos-to-r2.mjs <category> <folder>');
  process.exit(1);
}

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
for (const [name, val] of Object.entries({ R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET })) {
  if (!val) {
    console.error(`${name} is not set.`);
    process.exit(1);
  }
}

const categoriesFile = JSON.parse(fs.readFileSync('src/data/categories.json', 'utf8'));
const allCategories = [...categoriesFile.website, ...categoriesFile.instagramOnly];
if (!allCategories.includes(category)) {
  console.error(`Unknown category "${category}". Known: ${allCategories.join(', ')}`);
  process.exit(1);
}

const folder = folderArg;
if (!fs.existsSync(folder)) {
  console.error(`Folder not found: ${folder}`);
  process.exit(1);
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

const files = fs.readdirSync(folder).filter(f => /\.(jpe?g|png|webp)$/i.test(f));
if (!files.length) {
  console.log('[upload-to-r2] No images found — nothing to upload.');
  process.exit(0);
}

function contentTypeFor(file) {
  const ext = file.toLowerCase();
  if (ext.endsWith('.png')) return 'image/png';
  if (ext.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

let uploaded = 0, skipped = 0;
for (const file of files) {
  const key = `originals/${category}/${file}`;
  const fullPath = path.join(folder, file);
  const localSize = fs.statSync(fullPath).size;

  // Skip files already in R2 with a matching size, so re-running this
  // against a folder that's a mix of new and already-uploaded photos
  // doesn't resend unchanged bytes.
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    if (head.ContentLength === localSize) {
      console.log(`[upload-to-r2] - ${file} (already in R2, skipping)`);
      skipped++;
      continue;
    }
  } catch (err) {
    if (err.name !== 'NotFound' && err.$metadata?.httpStatusCode !== 404) throw err;
  }

  const body = fs.readFileSync(fullPath);
  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: body,
    ContentType: contentTypeFor(file),
  }));
  console.log(`[upload-to-r2] ✓ ${file}`);
  uploaded++;
}

console.log(`[upload-to-r2] Done — ${uploaded} uploaded, ${skipped} already present.`);
