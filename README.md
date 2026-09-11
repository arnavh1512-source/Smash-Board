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
  feeding a knockout.
- **Entrants** — add one at a time or paste a whole list. Edit, seed, withdraw or remove; removing
  an entrant scrubs them from the draw so no match points at a deleted row.
- **Results** — enter a score as each game finishes. Winners advance automatically, corrections
  ripple forward, and group tables re-sort in the BWF tiebreak order.
- **Referees** — a second, scoring-only PIN opens `/t/<slug>/score`. Referees enter results and
  nothing else: they cannot touch the draw, the entrants, the settings or the tournament itself.
- **Order of play** — every category laid out on one timetable across the courts the hall has,
  planned to keep a rest between a player's matches and let another category fill the court while
  they take it. Readable in time order or court by court, by organiser and public alike. The plan
  is a snapshot of the draw as it stood when it was made: a withdrawal, a reordered category, a
  moved start date or a knockout slot that only just learned who is playing it all mark it stale,
  and the console says so until it is regenerated.

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

The pure engines are covered by Vitest. There is no database or browser in the loop, so the
suite runs in under a second.

```bash
npm run lint          # ESLint, zero warnings tolerated
npx tsc --noEmit      # type check
npm test              # 206 unit tests over scoring, draws, standings, scheduling and formatting
npm run test:coverage # same run with a v8 coverage report (80% floor, enforced)
npm run test:integration  # runs against a live Convex deployment; see the note below
npm run test:e2e      # Playwright, drives the real UI against a dev server it starts itself
npm run test:e2e:ui   # the same suite in Playwright's watch UI
```

The integration suites talk to the deployment in `.env.local` and create their own throwaway
tournaments, so run them against a development deployment, never production.

| Suite | Covers |
| --- | --- |
| `tests/scoring.test.ts` | set and match evaluation, deuce, golden point, caps, tap-in scoring, undo |
| `tests/draw.test.ts` | bracket sizing, seeding, byes, round names, round robin, group snaking |
| `tests/standings.test.ts` | the BWF tiebreak chain, walkovers, scores that no longer parse |
| `tests/display.test.ts` | entrant names, scoring summaries, match ordering |
| `tests/identity.test.ts` | folding a name typed several ways into one person, so rest and duplicate checks key on the human rather than the spelling |
| `tests/schedule.test.ts` | court packing, rest between matches, the court-count cap, clock maths |
| `tests/scheduleStress.test.ts` | a whole day: three categories, two courts, byes, a group stage, a third-place match, players in two draws |
| `tests/scheduleBasis.test.ts` | the fingerprint that tells a fresh order of play from a stale one — dates, withdrawals, reordered categories, a knockout slot that only just learned who's in it |
| `tests/roundScoring.test.ts` | the semi-final and final scoring overrides |
| `tests/integration/backend.test.ts` | the tournament lifecycle against a real deployment |
| `tests/integration/referee.test.ts` | the sign-in door, token forgery, what a referee may and may not do, the per-source and per-tournament lockouts |
| `tests/integration/scenarios.test.ts` | a 20-entrant knockout and a 16-entrant group stage played end to end, plus the guards above |
| `tests/integration/withdrawal.test.ts` | a player who wins two group matches and then pulls out, and the knockout that has to fill without them, from every finishing position in the group |
| `tests/integration/schedule.test.ts` | the order of play going stale after a withdrawal, a reordered category or a moved start date, and a knockout slot whose court booking is only trustworthy once the group stage feeding it is settled |
| `tests/e2e/home.spec.ts` | the landing page, its metadata and structured data, the theme memory, the phone layout |
| `tests/e2e/auth.spec.ts` | the PIN gate, the five-try per-device lockout, a session that survives a reload, what a stranger may read, the referee's own door |
| `tests/e2e/organiser.spec.ts` | a category run from empty to a published result, doubles pairs, bulk entry |
| `tests/e2e/referee.spec.ts` | an umpire scoring from their own link, and the door closing when the PIN is removed |
| `tests/e2e/public.spec.ts` | the three public views, the shareable link, a link that points at nothing |

The end-to-end suite starts its own Next dev server and drives the real browser: nothing is
mocked, and every spec creates the tournament it needs, so the whole suite runs in parallel.
Install the browsers once with `npx playwright install`.

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
