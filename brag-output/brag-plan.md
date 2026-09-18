# Brag Plan: SmashBoard

## Planning rubric

1. **What it is:** SmashBoard runs a badminton tournament end to end — categories, draws, courts, referees and live scores — and everyone follows it from one public link.
2. **Strongest claim (verbatim):** "Run your badminton tournament and let everyone watch the scores live."
3. **Visual hook:** the app's own Swiss-modernist look — Archivo 800, 2px structural rules, zero radius, off-white `#f3f2f2`, and one red (`#ec3013`) reserved for the primary action and live state.
4. **UI to show:** the create form with organiser PIN, the scoring presets (incl. 11-point golden point), the Google Form import with auto-detected columns, the knockout bracket, the league table (round robin, groups feeding the knockout), the order-of-play timetable with 12-hour times, the referee court picker, the score dialog, the public "On court now" board and player sheet, and the WhatsApp share.
5. **Length:** 52s. **Deliberate override of the 15–25s law** — the user asked for a video that "covers all the features". Eleven features at a readable pace cannot fit 25s; 52s is 26 bars at 120 BPM, every scene sits on a bar line, and no scene is longer than 6s, so it still moves.
6. **Tone:** `app-store` (smooth, feature-card clean). Creative direction: *a Swiss tournament program sheet that comes alive* — every scene is a numbered page of the organiser's day.
7. **Audio:** `happy-beats-business-moves-vol-1` (120.19 BPM) as a bright bed; card sounds for cards, clicks for taps, keypresses for typed text, a bell on the logo.
8. **Share line:** "SmashBoard runs your badminton tournament from one link — draws, courts, referees and live scores."
9. **User flow:** create + PIN → categories & scoring → import entrants → draw → league table → order of play → referee picks a court → score → public live board → tap a name → share on WhatsApp.

## Angle

The organiser's whole tournament day, told as a printed program sheet flipping through its numbered sections: 01 Create, 02 Rules, 03 Entrants, 04 Draw, 05 League, 06 Order of play, 07 Referees, 08 Scoring, 09 Live, 10 Safety rails, 11 Share. The chrome (wordmark, section counter, red progress rule, faint court lines) stays put while the page content changes — it feels like one product, not a slideshow.

## Storyboard (52s, landscape 1920×1080)

| # | Time | Scene | On screen (verbatim copy where possible) | Motion | SFX |
|---|---|---|---|---|---|
| 1 | 0.0–4.0 | Hook | Tag "Free to run · No sign-up for players". H1 "Run your badminton tournament" → "and let everyone watch the scores live." LIVE red dot. | Lines wipe up line-by-line; red dot pulses with the music | drop on first line |
| 2 | 4.0–8.0 | 01 Create | "Create it. Lock it with a PIN." Form: "01 — The tournament" name typed "Ahmedabad Open 2026"; "03 — Your key" PIN dots; "Unlisted · link only" → `/t/k7Qm2xPa` | Card slides in, text types, dots fill | keypresses, switch |
| 3 | 8.0–12.0 | 02 Rules | "Your rules, not ours." Categories: Men's Singles, Women's Doubles, Mixed Doubles, U-15 Boys. Presets: "21 · Best of 3 · Deuce, cap 30", "15 · Best of 3", "11 · Best of 3 · Golden point" (highlighted) | Chips on beat grid, presets stack | card-slide per preset |
| 4 | 12.0–16.0 | 03 Entrants | "Import your Google Form." Sheet columns auto-tag Name ✓ Partner ✓ Club ✓ Phone ✓; rows land; seeds 1, 2 | Header tags tick, rows cascade | card-place per row |
| 5 | 16.0–20.0 | 04 Draw | "Draws in one tap." Button "Generate the draw" → knockout bracket with a BYE; formats "Knockout · Round robin · Groups → knockout" | Button press **beat-locked 17.02s**; bracket lines draw | click, card-fan feel |
| 6 | 20.0–24.0 | 05 League | "Leagues, then knockouts." "Everyone plays everyone. The table ranks itself." Card "Open Singles · Group A · Round robin": standings # / Player / P / W / L / Sets / Points for Asha Iyer, Bina Rao, Charu Sen, Diya Kapoor; "Top two go through"; "Semi-final 1" slot "1st in Group A" → "Asha Iyer" | Rows cascade, red qualifier bars grow on the top two, semi slot flips on the beat (22.49s) | card-slide, card-place |
| 7 | 24.0–30.0 | 06 Order of play | Fields "First match at 9:00 AM", "Last match ends by 6:00 PM", "Courts 4", "Minutes per match 20", "Rest between matches 15 min", "Categories at once 2" → "Plan the order of play" → 4-court timetable, 12-hour times; readout "Last match ends 5:40 PM" | Fields fill, button **beat-locked 25.0s**, grid cells cascade | click, card-slide |
| 8 | 30.0–34.0 | 07 Referees | "Referee sign-in" PIN → "Pick the court you are umpiring." Court 2 selected → "Next on Court 2 · Arjun Mehta vs Kabir Shah" | PIN dots, court tiles, selection flash | keypress, click |
| 9 | 34.0–38.0 | 08 Scoring | "Enter the score" dialog, 19–19 → 20–19 → 21–19, "Save score" → "Winners advance automatically." | Numerals roll on taps | click per point |
| 10 | 38.0–42.0 | 09 Live | "Everyone follows along." Public board "On court now" + LIVE; tap "Kabir Shah" → sheet "Next match · Court 2 · 11:40 AM", "Played on Court 1" | Cursor tap, sheet slides up | click, card-slide |
| 11 | 42.0–46.0 | 10 Safety rails | "Fix anything, any time." 6 tiles: "Corrections ripple forward", "Walkovers", "BWF tiebreaks", "Seeds locked after the draw", "Phone number stays private", "PINs rate-limited" | Tiles every beat for 6 beats, then hold 1s | card-place (soft) |
| 12 | 46.0–48.0 | 11 Share | "Share the public link on WhatsApp — everyone follows it live." "Copy link" → "Link copied" | Button flips | click |
| 13 | 48.0–52.0 | Outro | "SmashBoard" wordmark, tagline, `smash-board.vercel.app`, "Free to run" | Wordmark slams, rule draws; music fades from 50.5s | bell at 48.0 |

Scene durations sum to 52s (override documented in rubric #5).

## Readability

- Every headline holds ≥1.5s settled. Labels ≥0.8s.
- Sequential text (chips, tiles, rows) reveals quickly then holds the full set; no line leaves before it could be read.
- Minimum type size on screen: 24px.

## Audio direction

- **Role:** bright rhythmic bed, sparse product accents.
- **Arc:** music from 0s at ~0.55, fades out 50.5→52s; bell rings over the fade.
- **Audio-reactive:** subtle — LIVE dot glow and the faint court-line layer breathe with RMS; no pulsing text.

## Music cue guidance

- Source: bundled preset `assets/music/cues/happy-beats-business-moves-vol-1…json` (covers 0–25s) + extrapolated grid at 120.19 BPM (period 0.4992s, phase 0.025s) for 25–52s.
- Bar lines ≈ 0.03, 2.02, 4.02 … 48.0 — scene cuts sit on them.
- Strong cues to lock: 17.02 (draw button), 22.49 (league semi slot fills), 25.0 (plan button). Outro bell on the 48.0 bar line.
- Cues are guidance; readability wins every conflict.

## Poster

- `brag.jpg` is the settled order-of-play frame at 28.0s: timetable, "Last match ends 5:40 PM" and the red plan button all in view. It is baked in as frame 0 of `brag.mp4`.
