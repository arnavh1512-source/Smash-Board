# SmashBoard

Badminton tournament management with live scores everyone can follow from one link.

Built with Next.js (App Router), Convex and Tailwind CSS. Convex queries are reactive, so
a score entered by the organiser appears on every open scoreboard without a refresh.

## What it does

- **Tournaments** — create one in a minute, protected by an organiser PIN. Public or unlisted.
- **Categories** — singles or doubles, each with its own scoring rules and draw format.
- **Scoring rules** — games to 11, 15, 21 or any custom target; single game or best of 3, 5 or 7;
  ending on deuce (win by two, with an optional cap) or on a golden point.
- **Draw formats** — knockout with seeding and byes, round robin (single or double), or groups
  feeding a knockout. Up to 32 groups, named the way a spreadsheet names columns: A to Z, then
  AA to AF.
- **Entrants** — import the response sheet from the Google Form that collected the entries, paste
  a typed list, or add one player at a time. Edit, seed, withdraw or remove; removing an entrant
  scrubs them from the draw so no match points at a deleted row. Once the draw is made the field
  is closed: from then on an entrant withdraws rather than disappearing, and a late entry means
  clearing the draw and making it again.
- **Form imports** — paste or upload the sheet, and SmashBoard works out which column is the name,
  the partner, the club and the phone number, then shows every row and what will happen to it
  before anything is written. Commas and quotes inside an answer survive, a form filled in twice
  imports the player once, and one form that collects the whole tournament can be filtered to the
  category being imported.
- **Results** — enter a score as each game finishes. Winners advance automatically, corrections
  ripple forward, and group tables re-sort in the BWF tiebreak order.
- **Referees** — a second, scoring-only PIN opens `/t/<slug>/score`. Referees enter results and
  nothing else: they cannot touch the draw, the entrants, the settings or the tournament itself.
  Once the order of play is planned they can score **by court**: the match on court now, what
  comes on after it, and what has been played there for correcting. The court rides in the link,
  so `/t/<slug>/score?court=Court%202` opens straight onto Court 2 for the umpire sitting at it.
- **Order of play** — every category laid out on one timetable across the courts the hall has,
  planned to keep a rest between a player's matches and let another category fill the court while
  they take it. Readable in time order or court by court, by organiser and public alike.
  The organiser sets when the first match starts **and when the last one has to finish**; nothing
  is booked to run past the finish, a match that would goes to the first slot of the next morning,
  and the form shows how many matches a day those hours hold. Times read on the 12-hour clock
  (9:30 AM) and are stored as 24-hour local timestamps, which sort as text.
- **A hall that stays walkable** — courts limit how many people are *playing*; "categories at once"
  limits how many are *in the building*. A category's whole field turns up when its first match is
  called and drifts home after its last, so six categories running together put six fields in one
  hall. Set the limit to what the seats and the door can take and the rest of the categories wait
  their turn — a calmer hall, at the price of a longer day. The planner reports the peak head count
  after every run so the number can be checked against the room. Set it at or above the number of
  categories to lift the limit entirely. The plan
  is a snapshot of the draw as it stood when it was made: a withdrawal, a reordered category, a
  moved start date or a knockout slot that only just learned who is playing it all mark it stale,
  and the console says so until it is regenerated. Regenerating once play has begun plans only the
  matches still to be played: a finished match keeps its result but gives up its court, and its
  players are not held back for a rest they have already had. Nothing records the minute a match
  actually ended, so the new plan does not pretend to know it.
- **Tap a name, see your day** — every player's name on the public scoreboard, in the draw, the
  group tables, the order of play and the court view, opens that player's own matches: the one to
  get ready for (or the one on court now) picked out at the top with its court and time, then every
  match across singles and doubles with partner, opponent, court, time and score. Each half of a
  doubles pair opens on its own. The sheet lives in the address bar as `?player=`, so an organiser
  can send one player a link to their own day, and the phone's back button closes it.

## What the draw refuses to let you undo by accident

A tournament day is a live record, so the console draws a line between changing something that
has not happened yet and throwing away something that has.

- **Seeds are fixed once the draw is made.** The bracket was built from the seeds as they stood
  and does not rearrange itself, so a seed changed afterwards would print a number the draw never
  used. Name, club, phone and withdrawal stay editable; to reseed, generate the draw again.
- **A category holding played matches is not deleted on the first ask.** Deleting an empty
  category is ordinary housekeeping and goes through. One with results in it is refused, and the
  organiser has to confirm a second time knowing exactly what is about to be lost.
- **A played result is never overwritten by a walkover.** Correcting a result is a two-step move
  everywhere in the console: reset the match, then enter the right thing. Going straight from a
  score to "did not play" would erase it with one tap.
- **A walkover counts as a played match** — a win for one side, a loss for the other — but brings
  no sets and no points with it, so it never moves the set-difference or point-difference columns
  of a group table. That rule is printed under every standings table.
- **A withdrawn entrant keeps their results but loses their place.** Somebody who plays two
  group matches and then pulls out keeps those matches, so the players who beat them keep their
  wins and the table still shows how the group actually went. Their remaining matches become
  walkovers, and they drop below every entrant who is still in the tournament, so a qualifying
  place always goes to somebody who can turn up and play it.
- **An order of play may not run past the tournament's end date.** A late match rolls onto the
  next date on the timetable, because a match called at 23:40 has to print with tomorrow's date on
  it — but that is the clock, not permission for a one-day tournament to become a two-day one. A
  plan that does not fit inside the dates the hall was booked for is refused before a single match
  is given a time, and the message names the overrun and the levers that close it: another court, a
  shorter match, an earlier start, more categories at once, or a later end date. The same dates
  bound a time typed into a single match by hand - nothing before the first day or after the last -
  and moving either date marks an existing order of play as out of date.
- **The organiser's phone number is private unless it is published.** A tick box on the
  tournament form decides whether the number travels with the public page; without it the number
  stays on the server and only the console can read it back, behind the PIN.

## How access works

A tournament is guarded by a PIN chosen when it is created. An organiser may also set a second,
optional referee PIN that unlocks score entry and nothing else, so an umpire can be handed a phone
without also being handed the power to redraw the event or delete it. Neither PIN is stored: only a
SHA-256 hash of `salt + pin` is kept, and the salt is generated per tournament.

A PIN is accepted at exactly one endpoint, `tournaments.signIn`, which trades it for a short-lived
signed session token. Every other mutation takes the token and never sees the PIN. That is not
tidiness, it is correctness: a Convex mutation is a transaction, so a guard that recorded a wrong
guess and then threw would have that write rolled back by its own throw, and the failure counter
could never climb. `signIn` returns `{ ok: false, error }` for a wrong PIN instead of throwing, so
the counter reliably commits and the lockouts below actually fire.

Wrong guesses are throttled in two layers:

- **Per source.** The console keeps a random id for itself in the browser and sends it with every
  attempt. Five wrong guesses from the same source lock that source out for fifteen minutes — but
  it proves nothing and can be rotated, so this layer is weak by design; a caller that sends no id
  shares one crowded bucket with everyone else who didn't.
- **Per tournament.** Underneath that, a single source may only spend three of the tournament's
  eight tolerated wrong guesses — past that, its guesses still count against the source but stop
  counting against the tournament. Eight failures — across both PINs, sharing one counter, spent by
  a crowd rather than one person — lock the whole tournament out for ten minutes. That is what
  actually stops one bored person with a browser tab shutting a hall full of players out of their
  own scores.

A lockout that runs out clears itself, and so does a long enough quiet spell, so a mistyped PIN
from months ago never counts against anyone today.

The token is stateless: an HMAC over the tournament, the role, the expiry and that role's PIN hash,
keyed by the tournament's own salt. Nothing is stored server-side, tokens last twelve hours, and
changing a PIN silently invalidates every token issued for that role while leaving the other role's
tokens alone. On the client the token lives in `sessionStorage` and dies with the tab.

## Layout

```
convex/            backend: schema, auth, tournaments, events, entries, draws, matches
convex/lib/        sign-in, session tokens and draw progression
src/lib/           pure logic shared by backend and UI: scoring, draw generation, standings,
                   order-of-play planning
src/app/           routes: landing, /t/[slug] public view, /t/[slug]/manage organiser console,
                   /t/[slug]/score referee console
src/components/    UI
```

The scoring engine (`src/lib/scoring.ts`), draw generator (`src/lib/draw.ts`), standings
calculator (`src/lib/standings.ts`) and order-of-play planner (`src/lib/schedule.ts`) are pure and
dependency-free, so the same code validates a score on the server and previews a draw in the
browser.

## Running it

```bash
npm install
npx convex dev      # provisions the deployment and writes CONVEX_DEPLOYMENT
npm run dev
```

`.env.local` needs:

```
NEXT_PUBLIC_CONVEX_URL=https://<your-deployment>.convex.cloud
```

## Tests

Three layers, each with its own command. The unit suites cover the pure engines — no database
and no browser, so they run in about a second. The integration suites run every mutation against a
real Convex deployment. The end-to-end suites drive the real UI in a real browser.

```bash
npm run lint          # ESLint, zero warnings tolerated
npx tsc --noEmit      # type check
npm test              # unit tests: scoring, draws, standings, scheduling, capacity, CSV parsing, formatting
npm run test:coverage # same run with a v8 coverage report (80% floor, enforced)
npm run test:integration  # runs against a live Convex deployment; see the note below
npm run test:e2e      # Playwright, drives the real UI against a dev server it starts itself
npm run test:e2e:ui   # the same suite in Playwright's watch UI
```

The integration suites talk to the deployment named in `.env.local` and create their own
throwaway tournaments, which they delete afterwards — so run them against a development deployment,
never production. Push the functions first, or they will test the previous version of the backend:

```bash
npx convex dev --once      # push the current functions to the dev deployment
npm run test:integration
```

The end-to-end suites need the browsers installed once:

```bash
npx playwright install
```

| Suite | Covers |
| --- | --- |
| `tests/scoring.test.ts` | set and match evaluation, deuce, golden point, caps, tap-in scoring, undo |
| `tests/draw.test.ts` | bracket sizing, seeding, byes, round names, round robin, group snaking |
| `tests/standings.test.ts` | the BWF tiebreak chain, walkovers, scores that no longer parse |
| `tests/display.test.ts` | entrant names, scoring summaries, match ordering |
| `tests/csv.test.ts` | reading a Google Forms sheet: quoted commas, tabs, a byte order mark, column guessing, duplicate submissions, category filtering |
| `tests/identity.test.ts` | folding a name typed several ways into one person, so rest and duplicate checks key on the human rather than the spelling |
| `tests/schedule.test.ts` | court packing, rest between matches, the court-count cap, the day's finish time rolling play to the next morning, day capacity, 12-hour clock maths |
| `tests/courtQueue.test.ts` | one court read the umpire's way: the live match ahead of the one due, the planner's order, hand-typed times, played matches for correcting |
| `tests/hallCrowding.test.ts` | the hall limit: categories run in blocks, rest survives a block boundary, feeders stay in front, and the peak head count falls as the limit tightens |
| `tests/scheduleStress.test.ts` | a whole day: three categories, two courts, byes, a group stage, a third-place match, players in two draws |
| `tests/scheduleBasis.test.ts` | the fingerprint that tells a fresh order of play from a stale one — start and end dates, withdrawals, reordered categories, a knockout slot that only just learned who's in it |
| `tests/capacity.test.ts` | how large a category may get in each format, checked against what the generators actually produce, and what the organiser is told when a field is too big for its format |
| `tests/playerMatches.test.ts` | one player's day pulled out of the whole tournament: singles and doubles together, played matches first then timetable order, the match to get ready for, round names across mixed categories |
| `tests/random.test.ts` | the draw's unbiased random integers: the rejection sampling that keeps every seat in the shuffle equally likely |
| `tests/roundScoring.test.ts` | the semi-final and final scoring overrides |
| `tests/integration/backend.test.ts` | the tournament lifecycle against a real deployment |
| `tests/integration/referee.test.ts` | the sign-in door, token forgery, what a referee may and may not do, the per-source and per-tournament lockouts |
| `tests/integration/scenarios.test.ts` | a 20-entrant knockout and a 16-entrant group stage played end to end, plus the guards above |
| `tests/integration/withdrawal.test.ts` | a player who wins two group matches and then pulls out, and the knockout that has to fill without them, from every finishing position in the group |
| `tests/integration/schedule.test.ts` | the order of play going stale after a withdrawal, a reordered category or a moved start or end date, a hand-typed match time outside the tournament's dates, and a finish time that keeps every match inside the hall's hours, a knockout slot whose court booking is only trustworthy once the group stage feeding it is settled, and a plan remade after a result that gives the played match no court |
| `tests/e2e/home.spec.ts` | the landing page, its metadata and structured data, the theme memory, the phone layout |
| `tests/e2e/auth.spec.ts` | the PIN gate, the five-try per-device lockout, a session that survives a reload, what a stranger may read, the referee's own door |
| `tests/e2e/organiser.spec.ts` | a category run from empty to a published result, doubles pairs, bulk entry |
| `tests/e2e/referee.spec.ts` | an umpire scoring from their own link, scoring court by court from a `?court=` link, and the door closing when the PIN is removed |
| `tests/e2e/public.spec.ts` | the day's finish time and capacity on the planning form, the three public views, tapping a player's name for their matches and courts, the shareable link, a link that points at nothing |

The end-to-end suite starts its own Next dev server and drives the real browser: nothing is
mocked, and every spec creates the tournament it needs, so the whole suite runs in parallel against
the deployment in `.env.local`.

## Deploying

The frontend and the backend ship together. Vercel's build command (in `vercel.json`) pushes the
Convex functions first and only then builds the site, so a release can never leave the browser
calling a function the deployment does not have:

```
npx convex deploy --cmd 'npm run build'
```

That needs one secret. In the Convex dashboard, under Settings → Deploy Keys, generate a
**production deploy key**, then add it to the Vercel project as `CONVEX_DEPLOY_KEY` for the
Production environment. `convex deploy` sets `NEXT_PUBLIC_CONVEX_URL` for the build itself, so it
does not need to be configured separately in production.

Preview deployments need their own `NEXT_PUBLIC_SITE_URL`; without it, share links in a preview
point at production.

## Scoring rules in one place

Every rule lives in a single `ScoringConfig`:

```ts
{
  pointsPerSet: 21,      // 11, 15, 21 or a custom target
  bestOf: 3,             // 1, 3, 5 or 7
  endMode: "deuce",      // "deuce" (win by two) or "golden" (sudden death)
  cap: 30                // ceiling for deuce sets; null for no cap
}
```

Nothing else in the codebase hardcodes a points total or a set count.
