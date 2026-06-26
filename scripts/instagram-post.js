const fs    = require('fs');
const path  = require('path');
const https = require('https');

// ── Load website captions from captions.ts ───────────────────────────────────
function loadCaptions() {
  const src = fs.readFileSync('src/data/captions.ts', 'utf8');
  const js  = src
    .replace(/export type CaptionEntry[\s\S]+?};/, '')
    .replace(/export const captions\s*:\s*Record<[^>]+>\s*=\s*/, 'return ')
    .replace(/export function[\s\S]+$/, '');
  return new Function(js)();
}

// ── Load Instagram-specific captions ─────────────────────────────────────────
function loadInstagramCaptions() {
  const igPath = 'scripts/instagram-captions.json';
  if (!fs.existsSync(igPath)) return {};
  return JSON.parse(fs.readFileSync(igPath, 'utf8'));
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

// ── Generate hashtags + @mentions from caption content ───────────────────────
function generateTagsAndMentions(title, caption, category) {
  const text = (title + ' ' + caption).toLowerCase();
  const tags = new Set([
    '#TrackMarc', '#MotorsportPhotography', '#Motorsport', '#RaceCarPhotography',
  ]);

  if (category === 'endurance') tags.add('#EnduranceRacing');
  if (category === 'car-shows') {
    tags.add('#CarShow'); tags.add('#ClassicCars'); tags.add('#CarCulture');
  }

  // Hashtags by manufacturer
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

  if (text.includes('le mans'))    { tags.add('#LeMans24'); tags.add('#24hLeMans'); tags.add('#CircuitDeLaSarthe'); tags.add('#LeMans2025'); }
  if (text.includes('hypercar'))   { tags.add('#HypercarClass'); tags.add('#LMH'); }
  if (text.includes('lmgt3'))      { tags.add('#LMGT3'); tags.add('#GTRacing'); }
  if (text.includes('gt3'))        tags.add('#GT3');
  if (text.includes('lmp2'))       tags.add('#LMP2');
  if (text.includes('lmp3'))       tags.add('#LMP3');
  if (text.includes('pit lane') || text.includes('pit stop')) tags.add('#PitLane');
  if (text.includes('night'))      tags.add('#NightRacing');
  if (text.includes('gulf'))       tags.add('#GulfRacing');
  if (text.includes('valkyrie'))   tags.add('#AstonMartinValkyrie');
  if (text.includes('zonda'))      tags.add('#PaganiZonda');
  if (text.includes('f40'))        tags.add('#FerrariF40');
  if (text.includes('senna'))      tags.add('#AyrtonSenna');
  if (text.includes('goodyear'))   tags.add('#Goodyear');
  if (text.includes('michelin'))   tags.add('#Michelin');
  if (text.includes('safety car')) tags.add('#SafetyCar');

  // @mentions — brands and teams (verify these handles are correct)
  const mentions = new Set();
  const mentionMap = {
    'ferrari':          '@ferrari',
    'porsche':          '@porsche',
    'mclaren':          '@mclaren',
    'aston martin':     '@astonmartin',
    'toyota':           '@toyotagazooracing',
    'alpine':           '@alpinecars',
    'peugeot':          '@peugeot',
    'mercedes':         '@mercedesamg',
    'bmw':              '@bmw',
    'cadillac':         '@cadillac',
    'pagani':           '@paganiautomobili',
    'bentley':          '@bentleymotors',
    'alfa romeo':       '@alfaromeo',
    'heart of racing':  '@heartofracingteam',
    'united autosports':'@unitedautosports',
    'manthey':          '@manthey.racing',
    'kessel':           '@kesselracing',
    'gulf':             '@gulfracinguk',
    'rolex':            '@rolex',
    'hertz':            '@hertz',
    'goodyear':         '@goodyear',
    'michelin':         '@michelin',
    'motul':            '@motul',
  };

  for (const [keyword, handle] of Object.entries(mentionMap)) {
    if (text.includes(keyword)) mentions.add(handle);
  }

  const hashtagStr = Array.from(tags).slice(0, 30).join(' ');
  const mentionStr = Array.from(mentions).join(' ');

  return mentionStr ? `${mentionStr}\n${hashtagStr}` : hashtagStr;
}

// ── Pick next image, alternating categories ──────────────────────────────────
function pickNext(images, posted) {
  const postedSet = new Set(posted);
  const pending   = images.filter(img => !postedSet.has(img.filename));
  if (pending.length === 0) return null;

  const lastCat = images.find(i => i.filename === posted[posted.length - 1])?.category;
  const different = pending.filter(i => i.category !== lastCat);
  return different.length > 0 ? different[0] : pending[0];
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

  const captions   = loadCaptions();
  const igCaptions = loadInstagramCaptions();
  const images     = collectImages();
  const next       = pickNext(images, queue.posted);

  if (!next) {
    console.log('All images have been posted — queue complete.');
    return;
  }

  const cap = captions[next.filename];
  if (!cap) {
    console.log(`No caption for ${next.filename} — skipping.`);
    queue.posted.push(next.filename);
    fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2));
    return;
  }

  // Use Instagram-specific caption if available, fall back to website caption
  const captionText     = igCaptions[next.filename] || cap.caption;
  const tagsAndMentions = generateTagsAndMentions(cap.title, cap.caption, next.category);
  const igCaption       = `${captionText}\n\n${tagsAndMentions}`;
  const imageUrl        = `https://media.githubusercontent.com/media/marcevo190/website/main/src/assets/images/${next.category}/${next.filename}`;

  console.log(`Posting:  ${next.filename} (${next.category})`);
  console.log(`Title:    ${cap.title}`);

  const result = await fireWebhook({ image_url: imageUrl, caption: igCaption });
  console.log(`Response: ${result.status} — ${result.body}`);

  if (result.body.trim() === 'Accepted' || result.status === 200) {
    queue.posted.push(next.filename);
    fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2));
    console.log('Queue updated successfully.');
  } else {
    console.error('Webhook did not return Accepted — not marking as posted.');
    process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
