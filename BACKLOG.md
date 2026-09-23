# TrackMarc Backlog

Defects and enhancement ideas noticed while working on something else — not
urgent enough to interrupt the task at hand, but worth tracking instead of
letting them get lost. Check this file at the start of a session; add to it
rather than dropping something you noticed but didn't act on.

When an item is resolved, remove it (or check it off with a short note on how)
rather than leaving it marked done forever — this file should only ever show
what's still outstanding plus a short recent-history tail.

## Defects

- [ ] **10 of 11 new 130-showdown photos still uncaptioned** (found 2026-09-23):
  `caption-batch.mjs` hit a sustained Gemini outage -- gemini-3.1-flash-lite
  returning 503 "high demand" on every attempt, gemini-3.5-flash quota
  exhausted from earlier batches today. Files still needing a caption run:
  Trackmarc-DSC_7939, 8601, 8602, 8609, 8610, 9669, 9729, 9734, 9739,
  9740-Enhanced-NR.jpg (all already uploaded to R2, just need
  `node scripts/caption-batch.mjs 130-showdown <review-dir>` re-run once
  Gemini's free tier is behaving again -- try later today or tomorrow).

## Enhancements

- [ ] **130 Showdown Instagram backlog is large** (noted 2026-09-23): 23 of
  322 captioned photos have posted so far, 299 still queued. At the current
  `instagram-post-boost.yml` cadence (5x/day) that's on the order of months
  to clear. Ask Marc if he wants the boost frequency increased while the
  event is still fresh, or if the slow drip is fine.
