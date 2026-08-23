const fs    = require('fs');
const path  = require('path');
const https = require('https');

// ── Load website captions ─────────────────────────────────────────────────────
// Plain JSON now — this used to strip captions.ts down to a bare object
// literal and eval() it via new Function(), which worked but was needlessly
// fragile (and now duplicated real parsing logic across three scripts, each
// slightly differently). See scripts/caption-batch.mjs for the bug that
// mixed-parsing approach caused.
function loadCaptions() {
  return JSON.parse(fs.readFileSync('src/data/captions.json', 'utf8'));
}

// ── Load Instagram-specific captions ─────────────────────────────────────────
function loadInstagramCaptions() {
  const igPath = 'scripts/instagram-captions.json';
  if (!fs.existsSync(igPath)) return {};
  return JSON.parse(fs.readFileSync(igPath, 'utf8'));
}

// ── Collect all images from asset folders ────────────────────────────────────
function collectImages() {
  const base = 'src/assets/images';
  // Category lists from the single source of truth — src/data/categories.json.
  // Website categories post to both site + Instagram rotation; instagram-only
  // images are posted to Instagram from their own folder.
  const categoriesFile = require('../src/data/categories.json');
  const categories     = [...categoriesFile.website, ...categoriesFile.instagramOnly];
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
  if (category === 'iccr') {
    tags.add('#ICCR'); tags.add('#IrishMotorsport'); tags.add('#MondelloPark'); tags.add('#IrishRacing');
  }
  if (category === 'formula' || category === 'instagram-only') {
    if (text.includes('f1') || text.includes('formula') || text.includes('grand prix')) {
      tags.add('#F1'); tags.add('#Formula1'); tags.add('#FormulaOne');
    }
  }
  if (text.includes('zandvoort') || text.includes('dutch grand prix')) {
    tags.add('#DutchGP'); tags.add('#Zandvoort');
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
    'red bull':     ['#RedBullRacing', '#RedBull'],
    'bmw':          ['#BMW', '#BMWMotorsport'],
    'cadillac':     ['#Cadillac', '#CadillacRacing'],
    'pagani':       ['#Pagani', '#PaganiAutomobili'],
    'bentley':      ['#Bentley', '#BentleyMotorsport'],
    'lamborghini':  ['#Lamborghini', '#LamborghiniRacing'],
    'lexus':        ['#Lexus', '#LexusRacing'],
    'ford':         ['#Ford', '#FordRacing'],
    'ligier':       ['#Ligier', '#LMP3'],
    'oreca':        ['#Oreca', '#LMP2'],
    'alfa romeo':   ['#AlfaRomeo', '#Alfa'],
    'nissan':       ['#Nissan', '#NissanMotorsport'],
    'lotus':        ['#Lotus', '#LotusMotorsport'],
    'audi':         ['#Audi', '#AudiSport'],
    'jaguar':       ['#Jaguar', '#JaguarRacing'],
    'maserati':     ['#Maserati'],
    'acura':        ['#Acura', '#AcuraMotorsport'],
    'glickenhaus':  ['#Glickenhaus', '#SCG'],
    'isotta':       ['#IsottaFraschini'],
    'proton':       ['#ProtonCompetition'],
    'jota':         ['#JotaSport'],
  };

  for (const [keyword, htags] of Object.entries(manufacturerMap)) {
    if (text.includes(keyword)) htags.forEach(t => tags.add(t));
  }

  // Model-specific hashtags
  const modelMap = {
    'gt-r':         ['#NissanGTR', '#GTR', '#Godzilla'],
    'gtr':          ['#NissanGTR', '#GTR'],
    'emira':        ['#LotusEmira', '#Emira'],
    '911':          ['#Porsche911'],
    '963':          ['#Porsche963'],
    '718':          ['#Porsche718'],
    'cayman':       ['#PorscheCayman'],
    '296':          ['#Ferrari296', '#Ferrari296GT3'],
    '488':          ['#Ferrari488'],
    '499p':         ['#Ferrari499P'],
    'f40':          ['#FerrariF40'],
    'f50':          ['#FerrariF50'],
    'laferrari':    ['#LaFerrari'],
    'gr010':        ['#ToyotaGR010', '#GR010'],
    '9x8':          ['#Peugeot9X8', '#9X8'],
    'a424':         ['#AlpineA424', '#A424'],
    'v-series':     ['#CadillacVSeriesR', '#VSeriesR'],
    'valkyrie':     ['#AstonMartinValkyrie', '#Valkyrie'],
    'vantage':      ['#AstonMartinVantage'],
    'zonda':        ['#PaganiZonda', '#Zonda'],
    'huayra':       ['#PaganiHuayra', '#Huayra'],
    'senna':        ['#McLarenSenna'],
    'p1':           ['#McLarenP1'],
    'artura':       ['#McLarenArtura'],
    'huracan':      ['#LamborghiniHuracan'],
    'aventador':    ['#LamborghiniAventador'],
    'urus':         ['#LamborghiniUrus'],
    'continental':  ['#BentleyContinental'],
    'gt3 rs':       ['#Porsche911GT3RS'],
    'gt3':          ['#GT3'],
  };

  for (const [keyword, htags] of Object.entries(modelMap)) {
    if (text.includes(keyword)) htags.forEach(t => tags.add(t));
  }

  if (text.includes('mondello'))     { tags.add('#MondelloPark'); tags.add('#IrishMotorsport'); }
  if (text.includes('formula vee'))  tags.add('#FormulaVee');
  if (text.includes('formula sheane')) tags.add('#FormulaSheane');
  if (text.includes('fiesta zetec')) tags.add('#FiestaZetec');
  if (text.includes('fiesta st'))    tags.add('#FiestaST');
  if (text.includes('sports 2000'))  tags.add('#Sports2000');
  if (text.includes('mini challenge')) tags.add('#MiniChallenge');
  if (text.includes('le mans'))    { tags.add('#LeMans24'); tags.add('#24hLeMans'); tags.add('#CircuitDeLaSarthe'); tags.add('#LeMans2026'); }
  if (text.includes('hypercar'))   { tags.add('#HypercarClass'); tags.add('#LMH'); }
  if (text.includes('lmgt3'))      { tags.add('#LMGT3'); tags.add('#GTRacing'); }
  if (text.includes('lmp2'))       tags.add('#LMP2');
  if (text.includes('lmp3'))       tags.add('#LMP3');
  if (text.includes('wec'))        { tags.add('#WEC'); tags.add('#WorldEnduranceChampionship'); }
  if (text.includes('pit lane') || text.includes('pit stop')) tags.add('#PitLane');
  if (text.includes('night'))      tags.add('#NightRacing');
  if (text.includes('gulf'))       tags.add('#GulfRacing');
  if (text.includes('goodyear'))   tags.add('#Goodyear');
  if (text.includes('michelin'))   tags.add('#Michelin');
  if (text.includes('safety car')) tags.add('#SafetyCar');
  if (text.includes('track day'))  { tags.add('#TrackDay'); tags.add('#TrackLife'); }

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
    'red bull':         '@redbullracing',
    'bmw':              '@bmw',
    'cadillac':         '@cadillac',
    'pagani':           '@paganiautomobili',
    'bentley':          '@bentleymotors',
    'alfa romeo':       '@alfaromeo',
    'nissan':           '@nissan',
    'lotus':            '@lotuscars',
    'lamborghini':      '@lamborghini',
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
    'mondello':         '@mondellopark',
  };

  for (const [keyword, handle] of Object.entries(mentionMap)) {
    if (text.includes(keyword)) mentions.add(handle);
  }

  const hashtagStr = Array.from(tags).slice(0, 30).join(' ');
  const mentionStr = Array.from(mentions).join(' ');

  return mentionStr ? `${mentionStr}\n${hashtagStr}` : hashtagStr;
}

// ── Categories currently getting a recency boost ──────────────────────────────
// Plain category-rotation buries a fresh event under whatever backlog
// happens to sort first (endurance/Le Mans, ~170 photos) — stale content gets
// equal footing with a just-shot event while its audience is still paying
// attention. List categories here: while any listed category still has
// pending photos, EVERY pick goes to the first one in this list that has
// photos left — so the freshest event (bimmerfest) dominates the feed until
// its backlog clears, then falls through to the next category, then to the
// normal rotation once all are worked through. Keep the newest/most
// time-sensitive event first. Update this after each new event — add the
// new category, and drop old ones once their backlogs have cleared.
const PRIORITY_CATEGORIES = ['bimmerfest', 'iccr'];

// ── Pick next image ────────────────────────────────────────────────────────
function pickNext(images, posted) {
  const postedSet = new Set(posted);
  const pending   = images.filter(img => !postedSet.has(img.filename));
  if (pending.length === 0) return null;

  // A priority category wins EVERY pick as long as it still has pending
  // photos, so a just-shot event keeps dominating the feed until its backlog
  // clears instead of flipping back and forth with the general rotation
  // (which boost/other posts can skew). Normal category-alternating rotation
  // only kicks in once every priority category is worked through.
  if (PRIORITY_CATEGORIES.some(c => pending.some(p => p.category === c))) {
    // Order matters: earlier entries win first, so the freshest event
    // (bimmerfest) keeps taking the slot while it has pending photos; a
    // secondary priority category only gets a pick when that's exhausted.
    for (const cat of PRIORITY_CATEGORIES) {
      const match = pending.find(p => p.category === cat);
      if (match) return match;
    }
  }

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
      port:     url.port || undefined,
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

// ── Follow prompt, rotated so it doesn't read as the same bolted-on line every time ──
const FOLLOW_CTAS = [
  'Follow @trackmarcdotcom for more shots like this.',
  'Follow along, new shots go up daily.',
  'Follow @trackmarcdotcom to keep up with the season.',
  'More from the paddock daily, give us a follow.',
  'Follow @trackmarcdotcom for daily trackside photography.',
];

function pickFollowCta(postedCount) {
  return FOLLOW_CTAS[postedCount % FOLLOW_CTAS.length];
}

// ── Main ─────────────────────────────────────────────────────────────────────
// Optional CLI arg: a category name restricts posting to just that category,
// bypassing the normal rotation entirely — used by the temporary "boost"
// workflow to guarantee a fresh event actually gets extra posts today rather
// than only nudging its odds within the general rotation.
async function main() {
  const categoryOverride = process.argv[2] || null;

  const queuePath = 'post-queue.json';
  const queue     = fs.existsSync(queuePath)
    ? JSON.parse(fs.readFileSync(queuePath, 'utf8'))
    : { posted: [] };

  const captions   = loadCaptions();
  const igCaptions = loadInstagramCaptions();
  let images       = collectImages();
  if (categoryOverride) {
    images = images.filter(i => i.category === categoryOverride);
    if (!images.length) {
      console.log(`No images found in category "${categoryOverride}".`);
      return;
    }
  }
  const next = categoryOverride
    ? images.find(i => !queue.posted.includes(i.filename)) ?? null
    : pickNext(images, queue.posted);

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
  if (!captionText.trim()) {
    // auto-captions creates placeholder entries with an empty caption. Don't
    // post a shell (follow-CTA + hashtags alone); skip so the photo is picked
    // up later once a real caption is written. Not marked as posted.
    console.log(`No caption yet for ${next.filename} — skipping (will retry once captioned).`);
    return;
  }
  const followCta       = pickFollowCta(queue.posted.length);
  const tagsAndMentions = generateTagsAndMentions(cap.title, cap.caption, next.category);
  const igCaption       = `${captionText}\n\n${followCta}\n\n${tagsAndMentions}`;
  const igFilename      = next.filename.replace(/\.[^.]+$/, '.jpg');
  const imageUrl        = `https://trackmarc.com/ig/${next.category}/${igFilename}`;

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
