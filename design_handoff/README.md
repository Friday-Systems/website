# Handoff: Friday Systems — Marketing Site (Full Build)

## Overview
Complete design for the Friday Systems marketing site: a single scroll-driven page (desktop + a separately tuned mobile experience) telling one story — *mixed palletizing, solved* — through an interactive 3D pallet hero, a scroll-scrubbed explosion transition, a value-prop belt, a proof film, three technology pillar cards, and a contact riser, all sitting on a WebGL grain-fluid background whose accent palette the visitor can re-solve by clicking anywhere. Plus Legal and Privacy pages (to be authored in Build — see below).

## About the design files
The `.dc.html` files in this bundle are **design references created in HTML** — open them in a browser (with `support.js` alongside) to see and feel the exact intended behavior. They are prototypes, not the production codebase. The task is to **recreate this design in the production repo** (`friday-systems/website`) — see "Recommended stack" for how.

**However, most of the logic in these files is production-grade and should be ported, not reinterpreted.** The scroll pipeline, scene choreography, and the two hero components were engineered and device-tested during the design phase. Refactor freely (module structure, TypeScript, naming, build tooling, deduping the mobile forks) — but **the design and behavior are final**: timings, easings, thresholds, physics constants, and interaction grammar must survive the port unchanged. When in doubt, diff against the prototype running side-by-side.

## Fidelity
**High-fidelity.** Colors, typography, spacing, copy, motion timing, and interactions are final. Recreate pixel- and frame-perfectly.

## Recommended stack
**Vite + vanilla TypeScript, static output.** Reasons:
- The site is one hand-rolled rAF pipeline plus two framework-free web components (`<pallet-hero>`, `<spray-current>`). There is no component tree, no client state to reconcile, no routing beyond three static pages. React/Vue would add weight and an abstraction the scroll engine would immediately fight (it writes styles imperatively every frame, on purpose).
- The prototype's page logic is one plain class; it ports 1:1 into a `main.ts`.
- Legal/Privacy are plain static pages.
- Vite gives TS, minification, hashed assets, and easy `three`/`cannon-es` bundling (replace the CDN-injected three.js r128 + cannon.js 0.6.2 in `pallet-hero.js` with pinned npm deps — keep versions/behavior equivalent).

Astro would also work if you prefer; do NOT introduce React/Next.

## Pages
1. `index.html` — the experience (this handoff).
2. `legal.html`, `privacy.html` — **to be written in Build phase.** Simple static pages: navy background (`--navy`), Switzer body text at comfortable measure (~65ch, 16px/1.7), Big Shoulders Display for the page title, fixed header with logo linking home, same footer. No scroll hijack, no WebGL. Content: final copy is in `copy-legal.md` and `copy-privacy.md` in this bundle (LSSI-CE legal notice; GDPR/LOPDGDD privacy + cookies policy). Note the build notes at the end of `copy-privacy.md`: a cookie consent banner is required before analytics cookies load, plus a footer "Cookie settings" link; a few [bracketed] items need the analytics provider confirmed. The banner design is final: `Cookie Banner.dc.html` in this bundle (bottom-left card, equal-weight Accept/Reject outline pills, post-decision "Cookie settings" reopen chip — its policy link targets `/privacy#cookies`, so give the Cookies Policy heading in privacy.html `id="cookies"`). Footer links currently point to `#top`; wire them to these pages.

## Structure of the experience (desktop)
One 1100vh "tunnel" (`#top`) with a sticky 100vh stage. Four scenes stacked absolutely inside the stage; scroll position scrubs every transition directly (no time-based section animations — boundaries are the only rest states). Scroll units: 1 unit = 100vh; boundary array `[0, 2, 3, 4, 5, 6, 7, 8, 9, 10]`:

| Segment | What scrubs |
|---|---|
| 0→2 (double-length) | Headline converge ("MIXED PALLETIZING," + "SOLVED." meet in center, first 28%) then explosion scrub video (blend-mode screen) carries into the Proof film |
| 2→5 | Value-prop belt: 3 messages wheel right-to-left over the film ("Any box in / any order", "Installed / in days.", "Payback under / two years."), outline↔fill crossfade at the lock position |
| 5→6 | Belt exit left |
| 6→7 | Deployments: knockout text scales in ("Running full shifts / at leading logistics."), film dissolves to navy, spray current surfaces behind, accent-gradient version lands |
| 7→8 | Fly to Technology (scene scales up from 0.45, frame border-radius eases from 5.5vh to 0) |
| 8→9 | Fly to About statement |
| 9→10 | Contact riser: giant "TELL US ABOUT / YOUR PALLETS" + email surfaces from below; each rising letter injects a jet into the spray field |
| past 10 | Native footer |

Fixed chrome: header (logo, 120px), bottom index (Solution / Technology / Contact + progress line with tumbling box marker + glyph-scramble on section change), hero hint ("Hover and click on the pallet", hides after yu > 0.15), entrance loader (tetris pieces drop → lock into square → dolly-expand → fade, ~3.9s, skipped to a 0.5s fade under reduced motion).

## Scroll engine (port verbatim)
- Wheel + touch fully hijacked; keyboard/scrollbar stay native (adopted ungated as escape hatch).
- Lerp 0.09/frame toward target; velocity cap 2.4vh/frame; wheel deltas normalized, clamped ±220px/event.
- **One gesture = one transition**: `_gestureRange` clamps each gesture to its transition's [lo, hi]; a new gesture (quiet-gap >300ms, direction flip, or delta rising above decaying envelope) is required to enter the next.
- Commit rule on input end (140ms quiet): complete forward in travel direction; gestures whose peak velocity never exceeded 700px/s rest where they are (deliberate scrub); within 2% of a boundary snaps.
- Anchor links fly via the same lerp (`_flyTo`, 500–1500ms eased).
- Single page-wide rAF ticker (`window.__fsTicker`) shared by page + both heroes; idle gate skips all scene work once a settled scroll state has painted.
- Reduced motion: hijack disabled entirely, scenes snap to resolved states (`seg()` returns 0/1), videos hold poster, heroes render static.

## Hero components (port as-is)
`heroes/pallet-hero.js` — `<pallet-hero>`: three.js r128 + cannon.js physics pallet of mixed boxes. Click = blast, click-hold = attract/gather; stack always rebuilds box-by-box; hover stirs. API: `style-index="0..3"` attribute (repaints box accent quota), `paused` property.
`heroes/spray-current.js` — `<spray-current>`: GPU grain-fluid background. API: `style-index` attribute, `press(x,y)`/`release()` (accent-cycle burst + hold-pour), `nudge(x,y,fx,fy,r)` external force, `emit(...)`, `setObstacles(rects)` (tech cards are solid obstacles, rects measured per frame with translation+growth velocity), `reset()`, `paused`.
`-mobile.js` forks: identical grammar with touch input and reduced budgets (particles 320², sim 96, pressure iters 14, DPR 1.5). **Build task: replace forks with device-tier detection inside the shared components** (see mobile-notes.md).

## Accent system
4 palettes; random seed per visit; **pointerdown anywhere** (not on links/buttons/cards) cycles to the next — must fire at press start so the spray burst carries the new color:
| # | --acc | --acc2 | scrub video |
|---|---|---|---|
| 0 | `#35D0DB` | `#4D5FE0` | explosion-scrub-cyan.mp4 |
| 1 | `oklch(71% 0.19 25)` | `oklch(60% 0.22 350)` | explosion-scrub-coral.mp4 |
| 2 | `oklch(80% 0.15 135)` | `oklch(70% 0.14 180)` | explosion-scrub-lime.mp4 |
| 3 | `oklch(69% 0.24 330)` | `oklch(55% 0.22 290)` | explosion-scrub-fuchsia.mp4 |

On cycle: CSS `@property` transition on `--acc/--acc2` (0.6s), gradient-wipe across all `[data-gw]` words (0.6s, new gradient sweeps in from left), index-label glyph scramble, pallet + spray adopt via `style-index`, scrub video src swaps **only while the explosion transition is parked at either end** (never mid-scrub). Scrubs are fetched into blob URLs, current accent first, rest prefetched after 4s idle.

## Design tokens
Colors: ink `#F0F3F7`, navy `#0D1024`, navy-deep `#090B1A`, panel `#141A3D`, body-dim `#D5DBE8`, mut `#AEB6CB`, mut2 `#6E7690`; line `rgba(240,243,247,0.28)`; grad `linear-gradient(100deg, var(--acc2) 5%, var(--acc) 95%)`; selection = acc on navy.
Type: display **Big Shoulders Display** 700/800 (bunny.net), body **Switzer** 400/500/600 (Fontshare). Scale (desktop): `--fs-hl clamp(168px,24vw,420px)`, `--fs-belt clamp(60px,9.6vw,168px)`, `--fs-ko clamp(70px,9.8vw,180px)`, `--fs-card clamp(26px,2.6vw,52px)`, `--fs-copy clamp(14px,1.05vw,17px)`. Mobile overrides in mobile-notes.md. About/contact lines use JS fit-to-width (`_fitAbout`, batched measure).
Motion: `--ease: cubic-bezier(0.22,1,0.36,1)`; card width transition 0.9s; text-shadow `0 2px 12px rgba(9,11,26,0.7)`; film filter `saturate(0.78) contrast(1.08)` + brightness 0.92 featured / 0.5 collapsed.
Cards: radius 20px, shadow `0 40px 120px rgba(0,0,0,0.55)`, widths `--card-wide 52.4vw` / `--card-narrow 18.4vw`, hover translateY(-8px).

## Tech cards (scene 2)
Three cards, one featured (wide, plays video, body copy expanded), click to feature; "Explore +" pill on collapsed cards. Copy is final (see file). Cards are live spray obstacles while scene 2 is on screen; on exit, a 4-jet pinwheel + grain emit refills the field. Mobile: vertical accordion (44svh featured / 9.5svh collapsed).

## Mobile
`Friday Systems - Mobile.dc.html` (390×844 target) + **mobile-notes.md** — the authoritative per-section decision log and build notes (input layer, stir wiring, svh viewport rules, video encodes, rotate-lock, tablet guidance). Read it in full. Key: don't UA-sniff into two sites — fork on input capability (hover+wheel vs coarse pointer), and serve ~720p mobile video variants + shorter scrubs.

## Assets
- Logo: `assets/logo-friday-white.svg` (header).
- Videos (already in the repo, referenced by the prototypes at `https://friday-systems.github.io/website/assets/videos/`): `Tech-01/02/03.mp4`, `Proof.mp4`; scrubs at `assets/scrubs/explosion-scrub-{cyan,coral,lime,fuchsia}.mp4`. In Build, reference them relatively.
- Fonts: linked from bunny.net + Fontshare; consider self-hosting in Build.

## Accessibility (already designed — keep)
`prefers-reduced-motion` path throughout (native scroll, resolved states, static heroes, paused video); pallet has a `role="img"` aria-label describing the interaction; keyboard scrolling stays native; hit targets ≥44px on mobile.

## Files in this bundle
- `Friday Systems - Full Site (Main).dc.html` — desktop reference (open in browser)
- `Friday Systems - Mobile.dc.html` — mobile reference
- `Cookie Banner.dc.html` — cookie consent banner reference (final design; has a style-index tweak for the 4 accent palettes)
- `heroes/` — the four web components (2 desktop + 2 mobile forks)
- `assets/` — logo SVGs
- `mobile-notes.md` — mobile decision log + build notes
- `support.js` — prototype runtime only (makes the .dc.html files openable); **not part of the build**

## Build checklist
1. Scaffold Vite + TS in `friday-systems/website`; port page logic from the main `.dc.html` `<script data-dc-script>` class into `main.ts`; convert the template markup to plain HTML (inline styles can move to a stylesheet — output must match).
2. Port heroes; swap CDN three/cannon for npm (`three@0.128`-equivalent behavior, `cannon-es`); merge mobile forks via device-tier detection.
3. Build mobile from the mobile DC + notes; fork on input capability.
4. Author Legal + Privacy pages from copy-legal.md / copy-privacy.md; implement the cookie banner per Cookie Banner.dc.html (consent stored, analytics only after Accept, footer "Cookie settings" reopen); wire footer links.
5. Encode ~720p mobile video variants + shorter scrubs.
6. QA side-by-side against the prototypes: scroll feel, one-gesture-one-transition, accent cycle, reduced motion, iOS Safari touch.
