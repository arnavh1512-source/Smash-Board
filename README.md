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
  with a guaranteed rest between a player's matches and another category filling the court while
  they take it. Readable in time order or court by court, by organiser and public alike.

## Layout

```
convex/            backend: schema, auth, tournaments, events, entries, draws, matches
convex/lib/        organiser PIN checks and draw progression
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
npm test              # 123 unit tests over scoring, draws, standings, scheduling and formatting
npm run test:coverage # same run with a v8 coverage report (80% floor, enforced)
npm run test:integration  # runs against a live Convex deployment; see the note below
```

The integration suites talk to the deployment in `.env.local` and create their own throwaway
tournaments, so run them against a development deployment, never production.

| Suite | Covers |
| --- | --- |
| `tests/scoring.test.ts` | set and match evaluation, deuce, golden point, caps, tap-in scoring, undo |
| `tests/draw.test.ts` | bracket sizing, seeding, byes, round names, round robin, group snaking |
| `tests/standings.test.ts` | the BWF tiebreak chain, walkovers, scores that no longer parse |
| `tests/display.test.ts` | entrant names, scoring summaries, match ordering |
| `tests/schedule.test.ts` | court packing, rest between matches, the court-count cap, clock maths |
| `tests/integration/backend.test.ts` | the tournament lifecycle against a real deployment |
| `tests/integration/referee.test.ts` | what the referee PIN opens, what it refuses, the lockout |

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
