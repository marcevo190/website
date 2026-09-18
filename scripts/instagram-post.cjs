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
//
// Kept in sync with instagram-post-boost.yml's priority list (2026-09-07):
// 86 Fest is the freshest event (only 20 photos in so far, more coming
// later today) so it goes first, ahead of retrostock (51 pending) and
// drift-games (351 pending, untouched). Otherwise this list silently
// outranks the boost's priority — that's exactly how iccr quietly started
// winning every non-boost post back on 2026-08-26, when this list still said
// ['bimmerfest', 'iccr'] after bimmerfest had already run out.
const PRIORITY_CATEGORIES = ['86fest', 'retrostock', 'drift-games'];

// Explicit filename overrides — jump the queue ahead of EVERYTHING else
// (even PRIORITY_CATEGORIES), checked first regardless of whether the
// script was invoked with a category priority list or with none at all.
// For re-edited photos that should go out again despite already having
// been posted once, remove the filename from post-queue.json's "posted"
// array first — this list only pulls from already-pending photos, it
// doesn't override posted-status by itself. Clear this list out once
// everything in it has posted.
const PRIORITY_FILENAMES = [
  'DSC_6961-Enhanced-NR.jpg', 'DSC_6977-Enhanced-NR.jpg', 'DSC_6992-Enhanced-NR.jpg',
  'DSC_7121-Enhanced-NR.jpg', 'DSC_7163-Enhanced-NR.jpg', 'DSC_7170-Enhanced-NR.jpg',
  'DSC_7280-Enhanced-NR.jpg', 'DSC_7286-Enhanced-NR.jpg', 'DSC_7322-Enhanced-NR.jpg',
  'DSC_7326-Enhanced-NR-2.jpg', 'DSC_7331-Enhanced-NR.jpg', 'DSC_7333-Enhanced-NR.jpg',
  'DSC_7334-Enhanced-NR.jpg', 'DSC_7338-Enhanced-NR.jpg', 'DSC_7368-Enhanced-NR.jpg',
  'DSC_7380-Enhanced-NR.jpg', 'DSC_7382-Enhanced-NR.jpg', 'DSC_7395-Enhanced-NR.jpg',
  'DSC_7407-Enhanced-NR.jpg', 'DSC_7420-Enhanced-NR.jpg', 'DSC_7426-Enhanced-NR.jpg',
  'DSC_7660-Enhanced-NR.jpg', 'DSC_7668-Enhanced-NR.jpg', 'DSC_7671-Enhanced-NR.jpg',
  'DSC_7673-Enhanced-NR.jpg', 'DSC_7678-Enhanced-NR.jpg', 'DSC_7686-Enhanced-NR.jpg',
  'DSC_7690-Enhanced-NR.jpg', 'DSC_7693-Enhanced-NR.jpg', 'DSC_7696-Enhanced-NR.jpg',
  'DSC_7698-Enhanced-NR.jpg', 'DSC_7699-Enhanced-NR.jpg', 'DSC_7708-Enhanced-NR.jpg',
  'DSC_7710-Enhanced-NR.jpg', 'DSC_7711-Enhanced-NR.jpg', 'DSC_7713-Enhanced-NR.jpg',
  'DSC_7714-Enhanced-NR.jpg', 'DSC_7715-Enhanced-NR.jpg', 'DSC_7716-Enhanced-NR.jpg',
  'DSC_7717-Enhanced-NR.jpg', 'DSC_7718-Enhanced-NR.jpg', 'DSC_7719-Enhanced-NR.jpg',
  'DSC_7720-Enhanced-NR.jpg', 'DSC_7721-Enhanced-NR.jpg', 'DSC_7727-Enhanced-NR.jpg',
  'DSC_7730-Enhanced-NR.jpg', 'DSC_7731-Enhanced-NR.jpg', 'DSC_7738-Enhanced-NR.jpg',
  'DSC_7741-Enhanced-NR.jpg', 'DSC_7742-Enhanced-NR.jpg',
  // Second rework batch (2026-09-14)
  'DSC_6952-Enhanced-NR.jpg', 'DSC_7047-Enhanced-NR.jpg', 'DSC_7117-Enhanced-NR.jpg',
  'DSC_7147-Enhanced-NR.jpg', 'DSC_7253-Enhanced-NR.jpg', 'DSC_7269-Enhanced-NR.jpg',
  'DSC_7271-Enhanced-NR.jpg', 'DSC_7379-Enhanced-NR.jpg', 'DSC_7386-Enhanced-NR.jpg',
  'DSC_7461-Enhanced-NR.jpg', 'DSC_7473-Enhanced-NR.jpg', 'DSC_7475-Enhanced-NR.jpg',
  'DSC_7491-Enhanced-NR.jpg', 'DSC_7493-Enhanced-NR.jpg', 'DSC_7499-Enhanced-NR.jpg',
  'DSC_7504-Enhanced-NR.jpg', 'DSC_7546-Enhanced-NR.jpg', 'DSC_7562-Enhanced-NR.jpg',
  'DSC_7582-Enhanced-NR.jpg', 'DSC_7589-Enhanced-NR.jpg', 'DSC_7591-Enhanced-NR.jpg',
  'DSC_7594-Enhanced-NR.jpg', 'DSC_7599-Enhanced-NR.jpg', 'DSC_7600-Enhanced-NR.jpg',
  'DSC_7609-Enhanced-NR.jpg', 'DSC_7611-Enhanced-NR.jpg', 'DSC_7613-Enhanced-NR.jpg',
  'DSC_7615-Enhanced-NR.jpg', 'DSC_7616-Enhanced-NR.jpg', 'DSC_7623-Enhanced-NR.jpg',
  'DSC_7644-Enhanced-NR.jpg',
  // Third rework batch (2026-09-14)
  'DSC_7320-Enhanced-NR.jpg', 'DSC_7469-Enhanced-NR.jpg', 'DSC_7470-Enhanced-NR.jpg',
  'DSC_8228-Enhanced-NR-2.jpg', 'DSC_8229-Enhanced-NR-2.jpg', 'DSC_8233-Enhanced-NR-2.jpg',
  'DSC_8251-Enhanced-NR-3.jpg', 'DSC_8254-Enhanced-NR-3.jpg', 'DSC_8260-Enhanced-NR-3.jpg',
  'DSC_8276-Enhanced-NR-3.jpg', 'DSC_8283-Enhanced-NR-3.jpg', 'DSC_8309-Enhanced-NR-3.jpg',
  'DSC_8311-Enhanced-NR-3.jpg', 'DSC_8314-Enhanced-NR-3.jpg', 'DSC_8345-Enhanced-NR-2.jpg',
  'DSC_8373-Enhanced-NR-2.jpg', 'DSC_8378-Enhanced-NR-2.jpg', 'DSC_8393-Enhanced-NR-2.jpg',
  'DSC_8467-Enhanced-NR-3.jpg', 'DSC_8478-Enhanced-NR-3.jpg', 'DSC_8503-Enhanced-NR-3.jpg',
  'DSC_8508-Enhanced-NR-3.jpg', 'DSC_8579-Enhanced-NR-2.jpg', 'DSC_8586-Enhanced-NR-2.jpg',
  'DSC_8596-Enhanced-NR-2.jpg', 'DSC_8597-Enhanced-NR-2.jpg', 'DSC_8598-Enhanced-NR-2.jpg',
];

// Categories where the next pick is random among that category's pending
// photos, instead of the default "lowest filename number first". Posting
// strictly in DSC-number order reads as an obvious bot pattern once anyone
// notices; picking randomly within the category (still respecting the
// priority order above — this category still has to be exhausted before
// falling through to the next one) fixes that. Scoped to 86fest only, per
// Marc's request (2026-09-07) — leave this empty once 86fest's backlog
// clears rather than leaving it applying to whatever category is next.
const RANDOM_PICK_CATEGORIES = ['86fest'];

// Reg plate is the only reliable "same physical car" signal we have (title/
// caption text isn't — two different cars can share a colour + model name).
// Empty/missing plates never match each other, so this only helps when the
// plate was actually legible in both photos.
function getPlate(filename, captions) {
  if (!filename) return '';
  return (captions[filename]?.plate || '').trim();
}

// Filters out candidates that are the same car as the just-posted photo, so
// the same physical car never appears twice in a row on the feed (Marc's
// request, 2026-09-18) — but never returns an empty list if that would mean
// skipping the pick entirely; if every remaining candidate is the same car
// (e.g. near the tail end of that car's backlog), post it anyway rather than
// stall.
function avoidSameCarAsLast(candidates, lastPlate, captions) {
  if (!lastPlate) return candidates;
  const filtered = candidates.filter(c => getPlate(c.filename, captions) !== lastPlate);
  return filtered.length > 0 ? filtered : candidates;
}

// Picks one photo from a category's already-unposted candidates: random if
// the category is in RANDOM_PICK_CATEGORIES, otherwise the first by
// filename (the long-standing default, still used everywhere else).
function pickFromCategory(candidates, category) {
  if (!candidates.length) return null;
  if (RANDOM_PICK_CATEGORIES.includes(category)) {
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
  return candidates[0];
}

// ── Pick next image ────────────────────────────────────────────────────────
function pickNext(images, posted, captions) {
  const postedSet = new Set(posted);
  const pending   = images.filter(img => !postedSet.has(img.filename));
  if (pending.length === 0) return null;

  const lastPlate = getPlate(posted[posted.length - 1], captions);

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
      const catCandidates = avoidSameCarAsLast(pending.filter(p => p.category === cat), lastPlate, captions);
      const match = pickFromCategory(catCandidates, cat);
      if (match) return match;
    }
  }

  const lastCat = images.find(i => i.filename === posted[posted.length - 1])?.category;
  const different = avoidSameCarAsLast(pending.filter(i => i.category !== lastCat), lastPlate, captions);
  return different.length > 0 ? different[0] : avoidSameCarAsLast(pending, lastPlate, captions)[0];
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

// Only added when this specific photo has a legible plate on record — the
// CTA needs to be concretely true of what's pictured, not a generic bolt-on.
// Rotated the same way as FOLLOW_CTAS so it doesn't read as the same line
// every time. Built per Marc's 2026-09-10 analytics review: 651 profile
// visits but only 38 external link taps that month — the plate search is a
// real differentiator (most trackday photographers don't have one) worth
// surfacing directly in captions rather than only living on the site.
const REG_CTAS = [
  'See your reg in this shot? Search it at trackmarc.com/plate for every photo of your car.',
  "Spot your plate? Find every photo of this car at trackmarc.com/plate — it's free.",
  'Every photo of this car, searchable by reg, at trackmarc.com/plate.',
];

function pickRegCta(postedCount) {
  return REG_CTAS[postedCount % REG_CTAS.length];
}

// ── Main ─────────────────────────────────────────────────────────────────────
// Optional CLI arg: a category name restricts posting to just that category,
// bypassing the normal rotation entirely — used by the temporary "boost"
// workflow to guarantee a fresh event actually gets extra posts today rather
// than only nudging its odds within the general rotation.
async function main() {
  // Accepts one or more categories, in priority order (e.g. "retrostock
  // drift-games") — used by "boost" workflows to fast-track a fresh event's
  // backlog, then automatically fall through to the next category once the
  // first is exhausted, rather than silently posting nothing (what happened
  // with bimmerfest before someone noticed and swapped the category by
  // hand). With no args, falls back to the normal full-rotation pickNext().
  const categoryPriority = process.argv.slice(2);

  const queuePath = 'post-queue.json';
  const queue     = fs.existsSync(queuePath)
    ? JSON.parse(fs.readFileSync(queuePath, 'utf8'))
    : { posted: [] };

  const captions   = loadCaptions();
  const igCaptions = loadInstagramCaptions();
  const allImages  = collectImages();

  const lastPlate = getPlate(queue.posted[queue.posted.length - 1], captions);

  let next = null;
  if (PRIORITY_FILENAMES.length) {
    const priorityCandidates = allImages.filter(i => PRIORITY_FILENAMES.includes(i.filename) && !queue.posted.includes(i.filename));
    next = avoidSameCarAsLast(priorityCandidates, lastPlate, captions)[0] || null;
  }

  if (next) {
    console.log(`Priority filename override: ${next.filename}`);
  } else if (categoryPriority.length) {
    for (const category of categoryPriority) {
      const inCategory = allImages.filter(i => i.category === category);
      if (!inCategory.length) {
        console.log(`No images found in category "${category}" — skipping to next in priority list.`);
        continue;
      }
      const candidates = avoidSameCarAsLast(inCategory.filter(i => !queue.posted.includes(i.filename)), lastPlate, captions);
      next = pickFromCategory(candidates, category);
      if (next) break;
      console.log(`Category "${category}" exhausted — falling through to next in priority list.`);
    }
  } else {
    next = pickNext(allImages, queue.posted, captions);
  }

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
  const regCta          = cap.plate ? pickRegCta(queue.posted.length) : null;
  const tagsAndMentions = generateTagsAndMentions(cap.title, cap.caption, next.category);
  const igCaption       = [captionText, regCta, followCta, tagsAndMentions].filter(Boolean).join('\n\n');
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
