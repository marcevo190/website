// Checks every caption against the style rules in CLAUDE.md — pure text
// scanning, no API calls, free and instant. Report-only: flags issues for
// a human to fix, never edits captions.json itself.
//
// Usage:
//   node scripts/check-caption-style.mjs [category ...]
// With no category, checks every caption in scope.

import fs from 'node:fs';
import path from 'node:path';

const CAPTIONS_JSON_PATH = 'src/data/captions.json';
const IG_CAPTIONS_PATH = 'scripts/instagram-captions.json';
const IMAGES_BASE = 'src/assets/images';

const categoriesFile = JSON.parse(fs.readFileSync('src/data/categories.json', 'utf8'));
const allCategories = [...categoriesFile.website, ...categoriesFile.instagramOnly];
const requested = process.argv.slice(2);
for (const c of requested) {
  if (!allCategories.includes(c)) {
    console.error(`Unknown category "${c}". Known: ${allCategories.join(', ')}`);
    process.exit(1);
  }
}
const scopeCategories = requested.length ? requested : allCategories;

const captions = JSON.parse(fs.readFileSync(CAPTIONS_JSON_PATH, 'utf8'));
const igCaptions = JSON.parse(fs.readFileSync(IG_CAPTIONS_PATH, 'utf8'));

// Which filenames are actually in scope, based on the requested categories.
const inScope = new Set();
for (const category of scopeCategories) {
  const dir = path.join(IMAGES_BASE, category);
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir)) inScope.add(file);
}

const AI_WORDS = [
  'breathtaking', 'stunning', 'incredible', 'delve', 'tapestry', 'realm',
  'showcase', 'epitome', 'testament', 'captivating', 'remarkable',
  'fascinating', 'meticulous', 'intricate', 'elevate', 'resonate',
  'nestled', 'vibrant', 'game-changer', 'transformative',
];
const AI_WORDS_RE = new RegExp(`\\b(${AI_WORDS.join('|')})\\b`, 'i');

// Only the Americanisms CLAUDE.md explicitly calls out, plus a few other
// common ones in the same spirit — not an exhaustive dictionary.
const AMERICANISMS = {
  color: 'colour', colors: 'colours', colored: 'coloured', coloring: 'colouring',
  tire: 'tyre', tires: 'tyres',
  favor: 'favour', favors: 'favours', favorite: 'favourite',
  organize: 'organise', organized: 'organised', organizing: 'organising',
  realize: 'realise', realized: 'realised',
  analyze: 'analyse', analyzed: 'analysed',
  center: 'centre', centered: 'centred',
  defense: 'defence',
  gray: 'grey',
  aluminum: 'aluminium',
};
const AMERICANISM_RE = new RegExp(`\\b(${Object.keys(AMERICANISMS).join('|')})\\b`, 'i');

function checkText(text, { checkExclamation = false } = {}) {
  const issues = [];
  if (text.includes('—')) issues.push('em dash');
  const aiMatch = text.match(AI_WORDS_RE);
  if (aiMatch) issues.push(`AI-sounding word: "${aiMatch[0]}"`);
  const usMatch = text.match(AMERICANISM_RE);
  if (usMatch) {
    const word = usMatch[0].toLowerCase();
    const suggestion = AMERICANISMS[word];
    if (suggestion) issues.push(`American spelling: "${usMatch[0]}" → "${suggestion}"`);
  }
  if (checkExclamation && text.includes('!')) issues.push('exclamation mark in IG caption');
  return issues;
}

let filesWithIssues = 0;
let totalIssues = 0;
let checked = 0;

for (const [filename, entry] of Object.entries(captions)) {
  if (!inScope.has(filename)) continue;
  if (!entry.caption?.trim()) continue;
  checked++;

  const issues = [
    ...checkText(entry.title || '').map(i => `title: ${i}`),
    ...checkText(entry.caption || '').map(i => `caption: ${i}`),
  ];

  const igText = igCaptions[filename];
  if (igText) {
    const igIssues = checkText(igText, { checkExclamation: true }).map(i => `ig: ${i}`);
    issues.push(...igIssues);

    // Hook check: the caption is stored as one continuous paragraph (no
    // literal newline separating hook from body), so "first line" means
    // first sentence — up to the first ./!/? — not a text line.
    const firstSentence = (igText.match(/^[^.!?]*[.!?]/)?.[0] ?? igText).trim();
    const wordCount = firstSentence.split(/\s+/).filter(Boolean).length;
    if (wordCount > 12) issues.push(`ig: hook sentence is ${wordCount} words (should be ~12 max) — "${firstSentence}"`);

    // Should end with a question to invite comments.
    if (!igText.trim().endsWith('?')) issues.push('ig: does not end with a question');
  }

  if (issues.length > 0) {
    filesWithIssues++;
    totalIssues += issues.length;
    console.log(`\n${filename}`);
    for (const issue of issues) console.log(`  - ${issue}`);
  }
}

console.log(`\n[check-caption-style] Checked ${checked} caption(s) across ${scopeCategories.length} categor${scopeCategories.length === 1 ? 'y' : 'ies'}.`);
console.log(`[check-caption-style] ${filesWithIssues} file(s) with ${totalIssues} total issue(s) flagged.`);
console.log('[check-caption-style] Report-only — nothing was changed. Fix flagged captions by hand.');
