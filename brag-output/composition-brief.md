# Hyperframes Composition Brief: SmashBoard

## Objective
A 48-second launch video that walks through every SmashBoard feature in the order an organiser meets them on tournament day, ending on the product name and live URL.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape — 1920x1080
- Duration: 48 seconds (deliberate override of the 15–25s law; the user asked for full feature coverage — see `brag-plan.md` rubric #5)

## Source Material
- Project root: `C:\Users\Lenovo\smashboard`
- Primary files read: `app/page.tsx`, `app/create/*`, `app/t/[slug]/*`, `components/*` (draw, schedule, score dialog, player sheet, referee flow), `convex/*` (scoring presets, scheduler, standings), `app/globals.css`, README
- Product name: SmashBoard
- Tagline / strongest claim: "Run your badminton tournament and let everyone watch the scores live."
- Key UI to recreate: the order-of-play timetable (Court 1–4 columns, 12-hour times) and the referee score dialog
- Copy that must appear verbatim:
  - "Run your badminton tournament and let everyone watch the scores live."
  - "Plan the order of play"
  - "Generate the draw"
  - "Pick the court you are umpiring."
  - "On court now"
  - "11 · Best of 3 · Golden point"

## Creative Direction
- Tone preset: app-store
- Creative direction: a Swiss tournament program sheet that comes alive
- Interpretation: smooth card entrances, one idea per scene, numbered sections, no gimmicks; the product's own grid-and-rule language carries every frame
- Angle: the organiser's whole day as a printed program flipping through ten numbered sections, with persistent chrome (wordmark, section counter, red progress rule, faint court lines)
- Hook: "Run your badminton tournament" / "and let everyone watch the scores live." with a live red dot
- Outro / punchline: SmashBoard wordmark + tagline + smash-board.vercel.app
- Avoid: generic SaaS phrases, gradients, rounded corners, drop shadows, stock photos, EQ bars, flashing text

## Visual Identity
- Background: `#f3f2f2`; surface `#eae9e9`
- Text: `#201e1d`
- Accent: `#ec3013` (primary action + live state only); accent ink `#ae1800` for red text on light
- Display font: Archivo 800, letter-spacing -0.015em
- Body font: Archivo 400
- Visual references: uppercase tracked labels, zero radius, 2px structural rules, grids with 2px gaps

## Storyboard
See `brag-plan.md` → Storyboard (12 scenes, 0–48s, cuts on bar lines).

## Audio
- Audio role: bright rhythmic bed with sparse product accents
- Audio arc: bed at 0.35 from 0s, fade to 0 from 46.5s → 48s; bell rings over the fade
- Music: `assets/music/bed.mp3` (happy-beats-business-moves-vol-1, 120.19 BPM)
- Music treatment: steady, no ducking; fade under the final logo
- Music cue guidance: bundled preset for 0–25s, extrapolated 0.4992s grid afterwards; strong locks at 16.02 and 20.02; outro on the 43.96 bar
- Audio-reactive treatment: subtle — LIVE dot glow and court-line opacity follow RMS
- Audio-coupled moments: draw button 16.02, plan button 20.02, outro bell 44.0
- SFX selection guidance: card-slide/place for cards, click for taps, keypress for typing, switch for toggles, drop for section entrances, bell for outro; 0.55–0.75 volume
- Audio files: already copied into `composition/assets/`

## Hyperframes Instructions
- Standalone root, one paused GSAP timeline at `window.__timelines["main"]`.
- Show real SmashBoard UI copy in every feature scene.
- Keep text ≥24px and readable; fast-in, then hold.
- Pass `npx hyperframes check` with zero errors before render.
