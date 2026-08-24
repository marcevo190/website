// Populates src/assets/images/<category>/ from the R2 bucket — the R2-era
// replacement for `git lfs pull`. src/assets/images/ is git-ignored now (see
// .gitignore); this script is what actually puts real files there, locally
// or in CI, before scripts/watermark.mjs runs.
//
// Two modes:
//
//   node scripts/sync-images-from-r2.mjs
//     Full sync — downloads real bytes. Used by deploy.yml before
//     watermark.mjs runs, since watermark.mjs needs actual pixels to stamp.
//
//   node scripts/sync-images-from-r2.mjs --shallow
//     Creates empty placeholder files with the right names only, no
//     downloads. Used by auto-captions.yml, validate.yml, instagram-post.yml
//     and instagram-post-boost.yml — those only ever call readdirSync() on
//     these folders to get filenames, never read image bytes. This mirrors
//     what actions/checkout(lfs:false) already gave them under Git LFS
//     (pointer-sized stand-ins, not real images), so none of those four
//     scripts need any code changes.
//
// Both modes prune local files that no longer exist in R2 (mirroring
// watermark.mjs's own orphan-pruning), so a photo deleted from the bucket
// doesn't linger locally and confuse the watermark step's source list.
//
// Credentials (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
// R2_BUCKET) come from the environment — see CLAUDE.md.

import fs from 'fs';
import path from 'path';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';

const shallow = process.argv.includes('--shallow');

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
for (const [name, val] of Object.entries({ R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET })) {
  if (!val) {
    console.error(`${name} is not set.`);
    process.exit(1);
  }
}

const IMAGES_BASE = 'src/assets/images';
const PREFIX = 'originals/';

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

async function listAllObjects() {
  const objects = [];
  let ContinuationToken;
  do {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: R2_BUCKET,
      Prefix: PREFIX,
      ContinuationToken,
    }));
    for (const obj of res.Contents ?? []) objects.push(obj);
    ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return objects;
}

function findLocalFiles(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findLocalFiles(full, results);
    else if (entry.name !== '.gitkeep') results.push(full);
  }
  return results;
}

const objects = await listAllObjects();
if (!objects.length) {
  console.log('[sync-from-r2] Bucket has no originals yet — nothing to sync.');
  process.exit(0);
}

let downloaded = 0, skipped = 0, placeholders = 0;

for (const obj of objects) {
  const rel = obj.Key.slice(PREFIX.length); // "<category>/<filename>"
  const dest = path.join(IMAGES_BASE, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  if (shallow) {
    if (!fs.existsSync(dest)) {
      fs.writeFileSync(dest, '');
      placeholders++;
    }
    continue;
  }

  if (fs.existsSync(dest) && fs.statSync(dest).size === obj.Size) {
    skipped++;
    continue;
  }

  const res = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: obj.Key }));
  const bytes = await res.Body.transformToByteArray();
  fs.writeFileSync(dest, bytes);
  console.log(`[sync-from-r2] ✓ ${rel}`);
  downloaded++;
}

const expectedRelPaths = new Set(objects.map(o => o.Key.slice(PREFIX.length)));
let pruned = 0;
for (const full of findLocalFiles(IMAGES_BASE)) {
  const rel = path.relative(IMAGES_BASE, full);
  if (!expectedRelPaths.has(rel)) {
    fs.rmSync(full);
    pruned++;
  }
}

if (shallow) {
  console.log(`[sync-from-r2] Done (shallow) — ${placeholders} placeholder(s) created, ${pruned} pruned.`);
} else {
  console.log(`[sync-from-r2] Done — ${downloaded} downloaded, ${skipped} unchanged, ${pruned} pruned.`);
}
