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
- **Hosting:** Cloudflare **Worker** (Wrangler deploy), NOT Cloudflare Pages.
  `wrangler.json` defines a Worker named `website` serving `./dist` as static assets
  (`ASSETS` binding) with a `VISITS` KV namespace. Deployment is **NOT automatic from
  GitHub** — see `.github/workflows/deploy.yml` below.
- **Images:** Git LFS (large files). **Important:** if `git-lfs` isn't installed locally,
  new images get committed as raw files instead of LFS pointers (the `.gitattributes`
  clean filter silently no-ops). This is fine for builds (the bytes are in the repo) but
  old pointer-based images still need LFS to download. Mixed repos work either way.
- **Image processing:** Sharp (watermarking + resizing)
- **Instagram automation:** GitHub Actions → Make.com webhook → Instagram

## Deployment — CRITICAL

**The site is a Cloudflare Worker deployed via Wrangler, NOT Cloudflare Pages.**
Pushing to GitHub does nothing on its own. History: Cloudflare "Deployments" show
"Wrangler" as the source — every deploy was a manual `npm run deploy`
(`node scripts/watermark.mjs && astro build && wrangler deploy`) from a machine with
Node + a logged-in Cloudflare CLI. A push to `main` only goes live if:
  1. `.github/workflows/deploy.yml` runs `wrangler deploy` (needs the `CLOUDFLARE_API_TOKEN`
     secret — set on the repo), **and** the token has permission for the Worker + the
     `VISITS` KV namespace + the zone. If deploy fails, check the token's account/scopes
     first — the "Edit Cloudflare Workers" template usually works.
  2. Someone manually deploys.

**`deploy.yml` caches the watermark outputs** (`src/assets/watermarked/` + `public/ig/`)
via `actions/cache`. Without the cache, `watermark.mjs` re-stamps ALL ~470 images every
build (~15 min on CI) because those dirs are git-ignored and start empty. With the cache,
the mtime check in `watermark.mjs` skips unchanged images and only processes new/edited
ones. Do not remove the cache step.

## Repository

- GitHub: `marcevo190/website`
- Local working copy in this environment: `/tmp/website-fresh`
- Push over HTTPS with a GitHub token. If a push is rejected, run
  `git pull --rebase` then push again (Cloudflare/Actions may have pushed queue updates).

## Captioning pipeline (batteries included) — USE THIS, NOT manual Claude vision

**`scripts/caption-batch.mjs` is the real, committed script — use it for every new batch.**
Reading and writing a caption for each photo directly (Claude looking at every image in one
session) is what burned a week's Claude token allowance in early August 2026 — this script
offloads that per-photo vision work to **Gemini's** free tier instead, which has its own
separate quota, not Claude's.

```
GEMINI_API_KEY=... node scripts/caption-batch.mjs <category> <imageDir>
```

- `<category>` is a key from `src/data/categories.json`. `<imageDir>` should be the
  *downscaled* review copies (`resize-for-review.ps1`), not full-res originals.
- It skips filenames that already have a non-empty caption, is resumable (writes progress
  to `scripts/.caption-batch-progress.json` after every photo), rotates through
  `gemini-3.5-flash` → `gemini-3.1-flash-lite` on a 429 (free-tier daily quotas are small,
  ~20 requests/day on some models — this is why more than one model is tried), and writes
  both `src/data/captions.ts` and `scripts/instagram-captions.json` in one pass (website
  caption vs. Instagram caption are different styles — hook + question for Instagram, plain
  1-2 sentences for the site — the script asks Gemini for both explicitly).
- The API key lives in this Mac's keychain (`security find-generic-password -s
  trackmarc-gemini-api-key -a marcevo190 -w`) and as the `GEMINI_API_KEY` GitHub repo secret.

**Still spot-check identifications before pushing.** Gemini is looking at actual pixels, not
filenames, but it's not infallible — see the CRITICAL RULE below, which applies here just as
much as it did to manual captioning.

## Key files

### Images
- `src/assets/images/<category>/` — originals (Git LFS), grouped per event
- `src/data/categories.json` — **single source of truth for category wiring.** Lists
  `website` (folders that appear on the site + in the Instagram rotation) and
  `instagramOnly` (posted to Instagram only), plus human `labels`. Every script
  (`scripts/watermark.mjs`, `scripts/auto-captions.cjs`, `scripts/instagram-post.cjs`)
  and every page glob reads from here, so a new category needs ONLY this file (plus an
  `events.ts` entry and a priority decision). `.github/workflows/validate.yml` fails the
  build if a photo folder or event references a category missing from this file.
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
- `.github/workflows/instagram-post-boost.yml` — temporary 5x/day posting for a fresh
  category (currently `bimmerfest`), on top of the normal 2x/day rotation, self-expiring
  after the backlog clears or the expiry date passes. **Was deleted 2026-08-09, then
  restored the same day** — the deletion was based on "all photos committed to the repo",
  which was wrongly read as "all photos posted"; only 11 of 127 bimmerfest photos had
  actually posted. Check `post-queue.json` against the category's source folder before
  ever deleting this again — don't infer posted-count from commit messages.
- `.github/workflows/deploy.yml` — **added 2026-08-09** to deploy the Worker on every push
  to `main` (build + `wrangler deploy`). Needs the `CLOUDFLARE_API_TOKEN` repo secret. See
  "Deployment — CRITICAL" above. Without this workflow (or a manual `npm run deploy`),
  pushes to GitHub never go live.

### Events & photo pages
- `src/data/events.ts` — event definitions; each event page at `/events/<slug>` pulls photos
  by category. New event = new entry here.
- `src/pages/photo/[slug].astro` — one page per photo (slug = filename, lowercased,
  non-alphanumerics → `-`). Carries ImageObject JSON-LD (license + acquireLicensePage) for
  Google Images' "Licensable" badge. **The JSON-LD includes `keywords` derived from the
  caption title + caption body + event name + category** (added 2026-08-09), so Google
  Images can match queries like "Corvette GT3 Le Mans" to the right photo page. Keep
  this keyword block if you edit the page. `watermark.mjs` also embeds EXIF
  Copyright/Artist into every served image.

### SEO
- `src/pages/index.astro` hero carousel renders `alt` from each slide's caption title
  (added 2026-08-09), not a generic "Motorsport photography by TrackMarc". This helps
  Google Images index the homepage slides. The hero shuffles to a 10-photo subset each
  build; the `alt` lookup uses `getCaption(filename)`.

### Weekly Instagram Reel
- `scripts/instagram-reel.cjs` — `build` phase makes a 9:16 slideshow (ffmpeg) from the last
  7 posted photos (fetched from trackmarc.com/ig/, no LFS needed) → `public/reels/weekly.mp4`;
  `send` phase fires the `MAKE_REEL_WEBHOOK_URL` webhook with `{ video_url, caption }`.
- `.github/workflows/instagram-reel.yml` — Sundays 5:30pm UTC. Commits the video (no
  `[skip ci]` — Cloudflare must build to serve it), waits ~8 min, then sends. Scheduled runs
  no-op until the `MAKE_REEL_WEBHOOK_URL` repo secret exists; manual dispatch builds anyway
  for testing. Requires a separate Make.com scenario with an "Instagram — Create a Reel"
  module (the daily photo scenario cannot post video).
- `weekly.mp4` is **Git LFS-tracked** (`*.mp4` in `.gitattributes`) so the ~20MB video never
  accumulates in git history — the workflow runs `git lfs install --local` before committing
  so the LFS blob uploads on push, and Cloudflare fetches it at build like the photos.

### Auto-captioning
- `scripts/auto-captions.cjs` — scans for images with no caption entry, adds placeholders to `captions.ts`.
- `.github/workflows/auto-captions.yml` — triggers on push to `src/assets/images/**`.

### Category wiring validation
- `scripts/validate.cjs` + `.github/workflows/validate.yml` — runs on every push to `src/**`
  or `scripts/**` (no commits, no LFS). Fails the check if a photo folder or an event
  references a category missing from `src/data/categories.json`; warns about photos with no
  or empty captions (placeholders won't post to Instagram). `instagram-post.cjs` skips images
  whose caption is still empty rather than posting a shell post.

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
  **Note:** deploys only happen via `.github/workflows/deploy.yml` (push to `main`) or a
  manual `npm run deploy`. Check the Actions tab, not the site, for build status.
- Hashtags/@mentions are auto-generated in `generateTagsAndMentions()` from the title/caption
  text — includes manufacturer tags AND model-specific tags (GT-R, Emira, 911, 963, GR010,
  V-Series.R, Valkyrie, Zonda, etc.).

**Do NOT** use the Meta Graph API directly — it failed repeatedly with OAuth errors.
Make.com handles auth cleanly. Keep the Meta app in Development mode.

## Common workflows

### New photos pushed by Marc
1. `git pull` (make sure LFS pulls the actual image files, not just pointers)
2. Find filenames missing from `captions.ts` (the auto-captions Action adds placeholders)
3. **Downscale before captioning** — run
   `powershell -ExecutionPolicy Bypass -File scripts/resize-for-review.ps1 -SrcDir <source> -OutDir <scratch-dir>`
   (uses .NET System.Drawing, no npm install needed). The site never serves anything above
   1920px anyway, so full-res is wasted effort for identification purposes. Cuts a typical
   40-photo batch from ~270MB to ~15MB. Delete the scratch dir when done.
4. **Caption via `scripts/caption-batch.mjs`, not by reading each photo directly** — see
   "Captioning pipeline" above. This is the step that burned a week's Claude token budget
   before the script existed; don't fall back to reading every image by hand unless the
   script is broken and there's no time to fix it.
5. **Spot-check the generated captions** against the actual photos before pushing — open a
   handful (especially unusual cars) and confirm Gemini got them right; fix any it didn't.
6. Commit and push
7. **New event/category?** (not just adding to an existing one) — add the category to
   `src/data/categories.json` (the single source of truth: `website` list + a `labels`
   entry; use `instagramOnly` for Instagram-only folders), plus a new entry in
   `src/data/events.ts`. Everything else picks the new category up automatically:
   `scripts/watermark.mjs`, `scripts/auto-captions.cjs`, `scripts/instagram-post.cjs` and
   every page glob all read the same JSON, so there are no per-page lists to edit.
   Consider adding the fresh category to `PRIORITY_CATEGORIES` in `scripts/instagram-post.cjs`
   while the event is fresh. `.github/workflows/validate.yml` fails CI if a photo folder or
   an event references a category that isn't in `categories.json`. See the `iccr`/`bimmerfest`
   additions in git history for the pattern.

**Cost note (2026-08-05, still applies):** prefer starting a **fresh chat session** for a new
photo batch rather than continuing a long-running one — a fresh session only needs this file,
not hundreds of prior tool calls/images. With captioning now offloaded to
`scripts/caption-batch.mjs` (see above), a session doing a photo batch mainly needs to run the
script, spot-check a sample of results, commit, and push — not read every photo itself.

### Manually trigger an Instagram post
`gh workflow run instagram-post.yml --repo marcevo190/website`
Remove a filename from `post-queue.json` to re-post it.

## Posting strategy

Currently posting daily to grow a new account. Once the account has ~50 posts and a follower
base, consider dropping to 4–5/week. Bigger reach levers than frequency: Reels, Stories,
tagging teams/brands in-post, and engaging with big motorsport accounts.
