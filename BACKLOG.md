# TrackMarc Backlog

Defects and enhancement ideas noticed while working on something else — not
urgent enough to interrupt the task at hand, but worth tracking instead of
letting them get lost. Check this file at the start of a session; add to it
rather than dropping something you noticed but didn't act on.

When an item is resolved, remove it (or check it off with a short note on how)
rather than leaving it marked done forever — this file should only ever show
what's still outstanding plus a short recent-history tail.

## Defects

- [ ] **qc-captions.mjs report has ~34 unreviewed flags** (found 2026-09-24):
  Ran `scripts/qc-captions.mjs` against the 142 130-showdown captions that
  name a driver/team/sponsor -- full results in `scripts/qc-report.json`
  (40 originally flagged). Already handled, don't re-check:
  - Fixed: `DSC_4315` (was James Deane's S15, actually Luke Tally's GT86),
    `DSC_4395` (named Conor Shanahan on no real evidence, softened to
    unattributed). Both committed.
  - Rejected as false positives (originals were correct, leave alone):
    `DSC_4494`, `DSC_4405` -- QC misread "Trinity, The Shanahans" team
    branding as proof of Conor Shanahan specifically (see the caution now
    in driver-tags.json for both his and Shchurenko's entries). Also
    `DSC_4878`, `DSC_5557`, `DSC_5814`, `DSC_7310`, `Trackmarc-DSC_5560`,
    `Trackmarc-DSC_5703` -- QC claimed these purple/orange Thermotech cars
    were actually #926 not #720, but all 4 checked directly clearly show
    "720" -- QC was pattern-matching on the #926 caution text rather than
    re-reading each image.
  - **Needs a human look, not resolved:**
    - `DSC_4991` -- captioned as Conor Falvey, but shows a blue/pink/white
      S14 with "CALOR" branding that doesn't obviously match either the
      Thermotech car or Falvey's known blue/white #412 look. Genuinely
      unclear, didn't want to guess.
    - `DSC_6767-Enhanced-NR-2.jpg` -- **conflicts with Marc's own earlier
      correction.** Marc confirmed this as Chelsea DeNofa earlier in the
      session; QC now says it's actually James Deane (Falken car, not
      RTR/Pennzoil). Needs Marc's direct input, not a guess either way.
    - Unreviewed "Monster Energy GT86" pattern -- ~9 flags (`DSC_5773`,
      `DSC_6675`, `DSC_7101`, `Trackmarc-DSC_7627`, `Trackmarc-DSC_7684`,
      `Trackmarc-DSC_7900`, `Trackmarc-DSC_7901`, `Trackmarc-DSC_7902`, and
      possibly `Trackmarc-DSC_7690`/`Trackmarc-DSC_7743` re: GT86 vs GR86)
      all claim a Monster Energy-liveried GT86 is being confused with
      Shchurenko's (#16) and/or Shanahan's (#79) Trinity Racing cars --
      could be a real third car nobody's caught, or another QC artifact
      like the 926 cluster. Needs a fresh look at 2-3 of these images
      before trusting or rejecting the pattern.
    - Remaining ungrouped flags, not yet checked: `DSC_4516`, `DSC_4552`,
      `DSC_4904`, `DSC_5551` (new name "Ben Rogers" appears -- unconfirmed),
      `DSC_5735`, `DSC_5783`, `DSC_6352-Enhanced-NR-130sd`, `DSC_6625`,
      `DSC_6702-Enhanced-NR-130sd`, `DSC_7069`, `DSC_7143` (may actually
      *confirm* James Deane driving in this one specific shot -- check
      which car before assuming the earlier "soften to ownership-only" fix
      still applies here), `DSC_7374-Enhanced-NR-2`, `Trackmarc-DSC_5715`,
      `Trackmarc-DSC_7743`, `Trackmarc-DSC_7747` (reject -- already
      confirmed this is the reflection misread, not real "JAMES DEANE"
      text), `Trackmarc-DSC_7776`, `Trackmarc-DSC_8019`.
      **Correction (2026-09-25): `Trackmarc-DSC_7783` was NOT a false
      positive** -- Marc confirmed directly it isn't James Deane, despite
      the QC's oddly-phrased "facial recognition and team roster
      confirmation" reasoning looking hallucinated. Fixed (softened to an
      unattributed driver portrait). Lesson: a QC flag's stated reasoning
      being weak/unverifiable doesn't mean the underlying flag is wrong --
      still needs a real check, not a dismissal on vibes.
  - The other ~180 130-showdown captions that don't name anyone weren't
    checked at all (out of scope for this pass -- misattribution risk is
    low without a named driver/team/sponsor to get wrong).

## Enhancements

- [ ] **~10 older #261 AE86 photos don't credit the driver** (noted 2026-09-23):
  Diarmuid O'Connell's purple Toyota AE86 #261 (O'Connell Automotive branding)
  appears across many 86 Fest and 130 Showdown photos captioned before his
  handle was confirmed -- titles just say "Toyota AE86 #261" with no name.
  Now that `driver-tags.json` has his entry, worth a pass to retrofit
  `@diarmuidoconnell13b` onto the older ones (search captions.json for "#261"
  combined with "AE86" or "purple").
- [x] **130 Showdown Instagram backlog is large** (noted 2026-09-23, superseded
  2026-09-24): automated posting is now paused entirely in favour of manual
  driver/team-focused posts with Collab invites -- see "Posting strategy" in
  CLAUDE.md. The backlog of unposted photos is no longer being drawn down
  automatically; that's now an intentional choice, not a problem to fix.
