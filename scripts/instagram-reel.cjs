// Weekly Instagram Reel generator.
//
// Two phases, run by .github/workflows/instagram-reel.yml:
//   build — picks the last 7 photos the daily automation posted, downloads
//           their clean 1080px versions from trackmarc.com/ig/, and uses
//           ffmpeg to build a 9:16 slideshow Reel (blurred-fill background,
//           centred photo, fade transitions). Writes public/reels/weekly.mp4
//           and public/reels/reel-meta.json. The workflow then commits both
//           so Cloudflare serves the video.
//   send  — after the Cloudflare build goes live, fires the Make.com Reel
//           webhook (MAKE_REEL_WEBHOOK_URL) with { video_url, caption }.
//
// The video must be publicly reachable before Instagram fetches it, hence
// the two-phase design with a deploy wait in between.

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const SITE        = 'https://trackmarc.com';
const REEL_DIR    = path.join('public', 'reels');
const VIDEO_PATH  = path.join(REEL_DIR, 'weekly.mp4');
const META_PATH   = path.join(REEL_DIR, 'reel-meta.json');
const PHOTO_COUNT = 7;
const SLIDE_SECS  = 2.2;
const FADE_SECS   = 0.35;

// ── Helpers ──────────────────────────────────────────────────────────────────
function findCategory(filename) {
  const base = 'src/assets/images';
  for (const cat of fs.readdirSync(base)) {
    const dir = path.join(base, cat);
    if (!fs.statSync(dir).isDirectory()) continue;
    if (fs.existsSync(path.join(dir, filename))) return cat;
  }
  return null;
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, res => {
      if (res.statusCode !== 200) {
        file.close();
        fs.rmSync(dest, { force: true });
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', err => {
      file.close();
      fs.rmSync(dest, { force: true });
      reject(err);
    });
  });
}

function postJson(webhookUrl, payload) {
  return new Promise((resolve, reject) => {
    const url  = new URL(webhookUrl);
    const body = JSON.stringify(payload);
    const req  = https.request({
      hostname: url.hostname,
      path:     url.pathname,
      port:     url.port || undefined,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function buildCaption(picked) {
  const cats = new Set(picked.map(p => p.category));
  const tags = new Set([
    '#TrackMarc', '#MotorsportPhotography', '#Motorsport', '#RaceCarPhotography', '#Reels',
  ]);
  if (cats.has('endurance')) { tags.add('#LeMans24'); tags.add('#WEC'); tags.add('#EnduranceRacing'); }
  if (cats.has('iccr'))      { tags.add('#ICCR'); tags.add('#MondelloPark'); tags.add('#IrishMotorsport'); tags.add('#IrishRacing'); }
  if (cats.has('car-shows')) { tags.add('#CarShow'); tags.add('#CarCulture'); }
  if (cats.has('formula'))   { tags.add('#F1'); tags.add('#Formula1'); }

  return [
    'Seven days, seven frames. A week of racing through the TrackMarc lens.',
    'Follow @trackmarcdotcom for daily trackside photography.',
    Array.from(tags).slice(0, 30).join(' '),
  ].join('\n\n');
}

// ── Build phase ──────────────────────────────────────────────────────────────
async function build() {
  const queue = JSON.parse(fs.readFileSync('post-queue.json', 'utf8'));
  const recent = queue.posted.slice(-PHOTO_COUNT * 2); // extra in case some fail to resolve

  const picked = [];
  for (const filename of recent.reverse()) { // newest first
    const category = findCategory(filename);
    if (!category) continue;
    picked.push({ filename, category });
    if (picked.length === PHOTO_COUNT) break;
  }
  picked.reverse(); // back to chronological order

  if (picked.length < 3) {
    console.log(`Only ${picked.length} usable photos — not enough for a reel, skipping.`);
    process.exit(0);
  }

  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'reel-'));
  const inputs = [];
  for (const p of picked) {
    const igName = p.filename.replace(/\.[^.]+$/, '.jpg');
    const url    = `${SITE}/ig/${p.category}/${igName}`;
    const dest   = path.join(tmp, `${inputs.length}.jpg`);
    console.log(`Fetching ${url}`);
    await download(url, dest);
    inputs.push(dest);
  }

  // ffmpeg filter graph: per slide — blurred cover background + centred photo,
  // fade in/out; then concat all slides.
  const n = inputs.length;
  const args = [];
  for (const f of inputs) args.push('-loop', '1', '-t', String(SLIDE_SECS), '-i', f);

  const parts = [];
  const labels = [];
  for (let i = 0; i < n; i++) {
    parts.push(
      `[${i}:v]split[s${i}a][s${i}b];` +
      `[s${i}a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=luma_radius=25:luma_power=2[bg${i}];` +
      `[s${i}b]scale=1080:-2[fg${i}];` +
      `[bg${i}][fg${i}]overlay=(W-w)/2:(H-h)/2,setsar=1,` +
      `fade=t=in:st=0:d=${FADE_SECS},fade=t=out:st=${(SLIDE_SECS - FADE_SECS).toFixed(2)}:d=${FADE_SECS}[v${i}]`
    );
    labels.push(`[v${i}]`);
  }
  parts.push(`${labels.join('')}concat=n=${n}:v=1:a=0[outv]`);

  fs.mkdirSync(REEL_DIR, { recursive: true });
  execFileSync('ffmpeg', [
    '-y',
    ...args,
    '-filter_complex', parts.join(';'),
    '-map', '[outv]',
    '-r', '30',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-crf', '26',
    '-movflags', '+faststart',
    VIDEO_PATH,
  ], { stdio: 'inherit' });

  const meta = {
    built_at: new Date().toISOString(),
    photos: picked,
    video_url: `${SITE}/reels/weekly.mp4`,
    caption: buildCaption(picked),
  };
  fs.writeFileSync(META_PATH, JSON.stringify(meta, null, 2));
  console.log(`Built ${VIDEO_PATH} from ${n} photos (${(fs.statSync(VIDEO_PATH).size / 1e6).toFixed(1)} MB).`);
}

// ── Send phase ───────────────────────────────────────────────────────────────
async function send() {
  const webhook = process.env.MAKE_REEL_WEBHOOK_URL;
  if (!webhook) {
    console.error('MAKE_REEL_WEBHOOK_URL is not set.');
    process.exit(1);
  }
  const meta = JSON.parse(fs.readFileSync(META_PATH, 'utf8'));

  // Sanity check: make sure the video is actually live before telling Instagram to fetch it
  const head = await new Promise((resolve, reject) => {
    https.request(meta.video_url, { method: 'HEAD' }, res => resolve(res.statusCode))
      .on('error', reject).end();
  });
  if (head !== 200) {
    console.error(`Video not yet live (HTTP ${head}) — aborting send.`);
    process.exit(1);
  }

  console.log(`Sending reel: ${meta.video_url}`);
  const result = await postJson(webhook, { video_url: meta.video_url, caption: meta.caption });
  console.log(`Response: ${result.status} — ${result.body}`);
  if (result.body.trim() !== 'Accepted' && result.status !== 200) {
    console.error('Webhook did not accept the reel.');
    process.exit(1);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
const phase = process.argv[2];
const run = phase === 'build' ? build : phase === 'send' ? send : null;
if (!run) {
  console.error('Usage: node scripts/instagram-reel.cjs <build|send>');
  process.exit(1);
}
run().catch(err => { console.error(err); process.exit(1); });
