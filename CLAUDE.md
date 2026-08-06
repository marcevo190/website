# TrackMarc — Project Guide for Claude Code

This file is read automatically by Claude Code when the project opens. It contains
everything needed to continue work on the TrackMarc motorsport photography site.

## What this project is

TrackMarc (trackmarc.com) is Marc Ronan's motorsport photography portfolio. Marc is a
motorsport photographer based in Ireland whose goal is media accreditation, so the site
and its Instagram must look professional and authentic. Marc is non-technical — explain
things plainly and do the technical work for him.

## Stack

- **Framework:** Astro (static site generator)
- **Hosting:** Cloudflare Pages (auto-builds and deploys on push to `main`)
- **Images:** Git LFS (large files)
- **Image processing:** Sharp (watermarking + resizing)
- **Instagram automation:** GitHub Actions → Make.com webhook → Instagram

## Repository

- GitHub: `marcevo190/website`
- Local working copy in this environment: `/tmp/website-fresh`
- Push over HTTPS with a GitHub token. If a push is rejected, run
  `git pull --rebase` then push again (Cloudflare/Actions may have pushed queue updates).

## Key files

### Images
- `src/assets/images/{formula,endurance,rally,gt,car-shows}/` — originals (Git LFS)
- `src/assets/watermarked/` — watermarked copies, generated at build, git-ignored
- `public/ig/{category}/` — clean (no watermark) 1080px Instagram versions, git-ignored

### Captions
- `src/data/captions.ts` — website captions: `'DSC_1234.jpg': { title: '...', caption: '...' }`
- `scripts/instagram-captions.json` — Instagram-specific captions keyed by filename

### Pages / styling
- `src/pages/gallery.astro` — gallery; **must glob from `src/assets/watermarked/`** (NOT `images/`).
  If the gallery goes blank, check this first.

### Watermarking
- `scripts/watermark.mjs` — runs before `astro build` (see `package.json`).
  Stamps `© MARC RONAN / TRACKMARC` bottom-right via a Sharp SVG composite.
  Writes watermarked versions to `src/assets/watermarked/` (website) AND clean 1080px
  Instagram versions to `public/ig/` (built from the ORIGINAL source, not the watermarked file).

### Instagram automation
- `scripts/instagram-post.cjs` — picks the next unposted photo, loads its Instagram caption,
  generates hashtags/@mentions, fires the Make.com webhook. `PRIORITY_CATEGORIES` (near
  `pickNext`) gives one category a recency boost (every other post, if it has pending
  photos) so a just-shot event doesn't get buried under older backlog — **update this list
  whenever a new event's photos are added**, and drop old ones once their backlog clears.
- `post-queue.json` — tracks posted filenames (committed to repo, updated by the Action).
- `.github/workflows/instagram-post.yml` — runs **twice daily, 8am and 5pm UTC** (enough photo backlog now to support two posts a day).
- `instagram-post.cjs` accepts an optional category name as a CLI arg (e.g.
  `node scripts/instagram-post.cjs bimmerfest`) to post from just that category, bypassing
  the normal rotation — used for temporary "boost" workflows below.
- `.github/workflows/instagram-post-boost.yml` — **TEMPORARY, added 2026-08-06, self-expires
  2026-08-20.** Posts Bimmerfest photos specifically 3x/day on top of the normal schedule, so
  a fresh event gets real traction instead of trickling out over the ~2-month general
  rotation. Delete this file once the bimmerfest category is exhausted or the expiry date
  passes (it no-ops past expiry rather than erroring, but clean it up rather than leaving a
  dead workflow around). This is the pattern to reuse for any future "just happened, needs a
  push" event — copy the file, swap the category and expiry date.

### Events & photo pages
- `src/data/events.ts` — event definitions; each event page at `/events/<slug>` pulls photos
  by category. New event = new entry here.
- `src/pages/photo/[slug].astro` — one page per photo (slug = filename, lowercased,
  non-alphanumerics → `-`). Carries ImageObject JSON-LD (license + acquireLicensePage) for
  Google Images' "Licensable" badge. `watermark.mjs` also embeds EXIF Copyright/Artist into
  every served image.

### Weekly Instagram Reel
- `scripts/instagram-reel.cjs` — `build` phase makes a 9:16 slideshow (ffmpeg) from the last
  7 posted photos (fetched from trackmarc.com/ig/, no LFS needed) → `public/reels/weekly.mp4`;
  `send` phase fires the `MAKE_REEL_WEBHOOK_URL` webhook with `{ video_url, caption }`.
- `.github/workflows/instagram-reel.yml` — Sundays 5:30pm UTC. Commits the video (no
  `[skip ci]` — Cloudflare must build to serve it), waits ~8 min, then sends. Scheduled runs
  no-op until the `MAKE_REEL_WEBHOOK_URL` repo secret exists; manual dispatch builds anyway
  for testing. Requires a separate Make.com scenario with an "Instagram — Create a Reel"
  module (the daily photo scenario cannot post video).

### Auto-captioning
- `scripts/auto-captions.cjs` — scans for images with no caption entry, adds placeholders to `captions.ts`.
- `.github/workflows/auto-captions.yml` — triggers on push to `src/assets/images/**`.

> Note: scripts use the `.cjs` extension because `package.json` has `"type": "module"`.
> CommonJS `require()` scripts must be `.cjs`, not `.js`.

## CRITICAL RULE — identifying cars

**Never identify a car from its filename.** Filenames like `DSC_4870` tell you nothing.
Captions were once generated from filenames alone and produced wrong identifications
(e.g. the Keating #33 Corvette Z06 GT3.R was labelled a Ferrari 296 LMGT3 — embarrassing
for a pro portfolio). Always open the actual image with the Read tool and identify make,
model and number from what is visibly in the frame. Make your best visual attempt — but
never invent details.

## Caption style rules (website AND Instagram)

Write like a real person, not a press release or AI.

**Must avoid:**
- Em dashes (—). Use a comma or full stop.
- AI-sounding words: breathtaking, stunning, incredible, delve, tapestry, realm, showcase,
  epitome, testament, captivating, remarkable, fascinating, meticulous, intricate, elevate,
  resonate, nestled, vibrant, game-changer, transformative
- Exclamation marks in Instagram captions
- Guesses — only state what is clearly visible or 100% confirmed

**Must do:**
- British/Irish English: colour, tyre, favour, organise
- Contractions are fine: it's, that's, you'd
- Instagram: hook in the first line (max 12 words), end with a question to drive comments
- Interesting facts only if 100% certain

**Le Mans year:** All Le Mans / WEC photos in the repo are from **2026**. Always use 2026, never 2025.

## Instagram automation details

- Webhook URL is stored as the GitHub secret `MAKE_WEBHOOK_URL`.
- Make.com scenario receives `{ image_url, caption }` and posts to Instagram for Business.
- Image URLs use the clean Cloudflare-served versions:
  `https://trackmarc.com/ig/{category}/{filename-as-jpg}`
- **Build timing matters:** after pushing image/watermark changes, wait for the Cloudflare
  build (~3–5 min) before triggering a post, or Make.com fetches a stale/404 image.
- Hashtags/@mentions are auto-generated in `generateTagsAndMentions()` from the title/caption
  text — includes manufacturer tags AND model-specific tags (GT-R, Emira, 911, 963, GR010,
  V-Series.R, Valkyrie, Zonda, etc.).

**Do NOT** use the Meta Graph API directly — it failed repeatedly with OAuth errors.
Make.com handles auth cleanly. Keep the Meta app in Development mode.

## Common workflows

### New photos pushed by Marc
1. `git pull` (make sure LFS pulls the actual image files, not just pointers)
2. Find filenames missing from `captions.ts` (the auto-captions Action adds placeholders)
3. **Downscale before reading** — run
   `powershell -ExecutionPolicy Bypass -File scripts/resize-for-review.ps1 -SrcDir <source> -OutDir <scratch-dir>`
   (uses .NET System.Drawing, no npm install needed) and read the ~1800px copies from
   `<scratch-dir>` instead of the full-res originals. The site never serves anything above
   1920px anyway, so full-res is wasted vision tokens for identification purposes. Cuts a
   typical 40-photo batch from ~270MB to ~15MB. Delete the scratch dir when done.
4. **Read each (downscaled) image** and identify the car visually
5. Add entries to `captions.ts` under the correct section, and to `instagram-captions.json`
6. Commit and push
7. **New event/category?** (not just adding to an existing one) — also wire the category name
   into all these spots: `scripts/watermark.mjs` (`CATEGORIES`), `scripts/auto-captions.cjs`
   (`CATEGORIES`), `scripts/instagram-post.cjs` (`categories` array, and consider adding to
   `PRIORITY_CATEGORIES` while the event is fresh), `src/pages/gallery.astro` (glob +
   `categories` + `categoryLabels`), `src/pages/index.astro` (glob), `src/pages/events/
   index.astro` (glob), `src/pages/events/[slug].astro` (glob), `src/pages/photo/[slug].astro`
   (glob), plus a new entry in `src/data/events.ts`. See the `iccr`/`bimmerfest` additions in
   git history for the exact pattern.

**Cost note (2026-08-05):** for a brand new photo batch, prefer starting a **fresh chat
session** over continuing a long-running one — a fresh session only needs this file, not
hundreds of prior tool calls/images. See `feedback_photo_batch_cost` in Claude's memory.

### Manually trigger an Instagram post
`gh workflow run instagram-post.yml --repo marcevo190/website`
Remove a filename from `post-queue.json` to re-post it.

## Posting strategy

Currently posting daily to grow a new account. Once the account has ~50 posts and a follower
base, consider dropping to 4–5/week. Bigger reach levers than frequency: Reels, Stories,
tagging teams/brands in-post, and engaging with big motorsport accounts.
