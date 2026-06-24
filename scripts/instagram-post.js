const fs    = require('fs');
const path  = require('path');
const https = require('https');

// ── Load captions from captions.ts ───────────────────────────────────────────
function loadCaptions() {
  const src = fs.readFileSync('src/data/captions.ts', 'utf8');
  const js  = src
    .replace(/export type CaptionEntry[\s\S]+?};/, '')
    .replace(/export const captions\s*:\s*Record<[^>]+>\s*=\s*/, 'return ')
    .replace(/export function[\s\S]+$/, '');
  return new Function(js)();
}

// ── Collect all images from asset folders ────────────────────────────────────
function collectImages() {
  const base       = 'src/assets/images';
  const categories = ['endurance', 'car-shows', 'formula', 'rally', 'gt'];
  const images     = [];
  for (const cat of categories) {
    const dir = path.join(base, cat);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).sort()) {
      if (/\.(jpg|jpeg|png|webp)$/i.test(file)) {
        images.push({ filename: file, category: cat });
      }
    }
  }
  return images;
}

// ── Generate hashtags from caption content ───────────────────────────────────
function generateHashtags(title, caption, category) {
  const text = (title + ' ' + caption).toLowerCase();
  const tags = new Set([
    '#TrackMarc', '#MotorsportPhotography', '#Motorsport', '#RaceCarPhotography',
  ]);

  if (category === 'endurance') tags.add('#EnduranceRacing');
  if (category === 'car-shows') {
    tags.add('#CarShow'); tags.add('#ClassicCars'); tags.add('#CarCulture');
  }

  const manufacturerMap = {
    'ferrari':      ['#Ferrari', '#FerrariRacing', '#ScuderiaFerrari'],
    'porsche':      ['#Porsche', '#PorscheRacing', '#PorscheMoment'],
    'mclaren':      ['#McLaren', '#McLarenRacing'],
    'aston martin': ['#AstonMartin', '#AstonMartinRacing'],
    'toyota':       ['#Toyota', '#ToyotaGazooRacing'],
    'alpine':       ['#Alpine', '#AlpineMotorsport'],
    'peugeot':      ['#Peugeot', '#PeugeotSport'],
    'mercedes':     ['#Mercedes', '#MercedesAMG'],
    'bmw':          ['#BMW', '#BMWMotorsport'],
    'cadillac':     ['#Cadillac', '#CadillacRacing'],
    'pagani':       ['#Pagani', '#PaganiZonda'],
    'bentley':      ['#Bentley'],
    'lamborghini':  ['#Lamborghini'],
    'lexus':        ['#Lexus', '#LexusRacing'],
    'ford':         ['#Ford', '#FordRacing'],
    'ligier':       ['#Ligier', '#LMP3'],
    'oreca':        ['#Oreca', '#LMP2'],
    'alfa romeo':   ['#AlfaRomeo', '#Alfa'],
  };

  for (const [keyword, htags] of Object.entries(manufacturerMap)) {
    if (text.includes(keyword)) htags.forEach(t => tags.add(t));
  }

  if (text.includes('le mans'))   { tags.add('#LeMans24'); tags.add('#24hLeMans'); tags.add('#CircuitDeLaSarthe'); tags.add('#LeMans2025'); }
  if (text.includes('hypercar'))  { tags.add('#HypercarClass'); tags.add('#LMH'); }
  if (text.includes('lmgt3'))     { tags.add('#LMGT3'); tags.add('#GTRacing'); }
  if (text.includes('gt3'))       tags.add('#GT3');
  if (text.includes('lmp2'))      tags.add('#LMP2');
  if (text.includes('lmp3'))      tags.add('#LMP3');
  if (text.includes('pit lane') || text.includes('pit stop')) tags.add('#PitLane');
  if (text.includes('night'))     tags.add('#NightRacing');
  if (text.includes('gulf'))      tags.add('#GulfRacing');
  if (text.includes('valkyrie'))  tags.add('#AstonMartinValkyrie');
  if (text.includes('zonda'))     tags.add('#PaganiZonda');
  if (text.includes('f40'))       tags.add('#FerrariF40');
  if (text.includes('senna'))     tags.add('#AyrtonSenna');
  if (text.includes('goodyear'))  tags.add('#Goodyear');
  if (text.includes('michelin'))  tags.add('#Michelin');
  if (text.includes('safety car')) tags.add('#SafetyCar');

  return Array.from(tags).slice(0, 30).join(' ');
}

// ── Pick next group of 3, alternating categories ─────────────────────────────
function pickNextGroup(images, posted) {
  // posted is an array of arrays (each entry is a group of filenames)
  const postedFilenames = new Set(posted.flat());
  const pending = images.filter(img => !postedFilenames.has(img.filename));
  if (pending.length === 0) return null;

  // Determine last posted category
  const lastGroup    = posted[posted.length - 1] || [];
  const lastFilename = lastGroup[lastGroup.length - 1];
  const lastCat      = images.find(i => i.filename === lastFilename)?.category;

  // Group pending by category
  const byCategory = {};
  for (const img of pending) {
    if (!byCategory[img.category]) byCategory[img.category] = [];
    byCategory[img.category].push(img);
  }

  // Prefer a different category from the last post
  const candidates = Object.entries(byCategory)
    .filter(([cat]) => cat !== lastCat && byCategory[cat].length >= 3);

  const [, chosen] = candidates.length > 0
    ? candidates[0]
    : Object.entries(byCategory).find(([, imgs]) => imgs.length > 0) || [null, null];

  if (!chosen) return null;
  return chosen.slice(0, 3);
}

// ── Fire Make.com webhook ────────────────────────────────────────────────────
function fireWebhook(payload) {
  return new Promise((resolve, reject) => {
    const url  = new URL(process.env.MAKE_WEBHOOK_URL);
    const body = JSON.stringify(payload);
    const req  = https.request({
      hostname: url.hostname,
      path:     url.pathname,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const queuePath = 'post-queue.json';
  const queue     = fs.existsSync(queuePath)
    ? JSON.parse(fs.readFileSync(queuePath, 'utf8'))
    : { posted: [] };

  const captions = loadCaptions();
  const images   = collectImages();
  const group    = pickNextGroup(images, queue.posted);

  if (!group) {
    console.log('All images have been posted — queue complete.');
    return;
  }

  // Use the first image's caption as the main caption, add swipe prompt
  const primary    = group[0];
  const primaryCap = captions[primary.filename];

  if (!primaryCap) {
    console.log(`No caption for ${primary.filename} — skipping group.`);
    queue.posted.push(group.map(i => i.filename));
    fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2));
    return;
  }

  const hashtags  = generateHashtags(primaryCap.title, primaryCap.caption, primary.category);
  const igCaption = `${primaryCap.caption}\n\nSwipe → for more.\n\n${hashtags}`;

  const toUrl = img =>
    `https://github.com/marcevo190/website/raw/main/src/assets/images/${img.category}/${img.filename}`;

  const payload = {
    image_url_1: toUrl(group[0]),
    image_url_2: toUrl(group[1]),
    image_url_3: toUrl(group[2]),
    caption:     igCaption,
  };

  console.log('Posting carousel:');
  group.forEach((img, i) => console.log(`  ${i + 1}. ${img.filename} (${img.category})`));
  console.log(`Caption: ${primaryCap.title}`);

  const result = await fireWebhook(payload);
  console.log(`Response: ${result.status} — ${result.body}`);

  if (result.body.trim() === 'Accepted' || result.status === 200) {
    queue.posted.push(group.map(i => i.filename));
    fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2));
    console.log('Queue updated successfully.');
  } else {
    console.error('Webhook did not return Accepted — not marking as posted.');
    process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
