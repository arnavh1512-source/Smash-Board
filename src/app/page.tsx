import Link from "next/link";
import { CreateTournamentForm } from "@/components/home/CreateTournamentForm";
import { PublicTournamentList } from "@/components/home/PublicTournamentList";
import { SITE } from "@/lib/site";

const FEATURES = [
  {
    title: "Your rules, not ours",
    body: "Games to 11, 15, 21 or any target you like. One game or best of three, five or seven. Finish on deuce with a cap, or on a golden point.",
  },
  {
    title: "Draws in one tap",
    body: "Knockout with proper seeding and byes, round robin, or groups feeding a knockout. Seeded players are kept apart automatically.",
  },
  {
    title: "Everyone follows along",
    body: "Share one link. Players, parents and clubs see the draw, the scores and the standings update as each game finishes — no login needed.",
  },
  {
    title: "Fix anything, any time",
    body: "Add or remove entrants, correct a score, redo a draw. Later rounds update themselves so the bracket is never left wrong.",
  },
];

export default function HomePage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:py-14">
      <section className="grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:items-start">
        <div>
          <p className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-800">
            Free to run · No sign-up for players
          </p>
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            Run your badminton tournament and let everyone watch the scores live.
          </h1>
          <p className="mt-4 text-lg text-slate-600">{SITE.description}</p>

          <dl className="mt-8 grid gap-4 sm:grid-cols-2">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="rounded-xl border border-slate-200 bg-white p-4">
                <dt className="font-semibold text-slate-900">{feature.title}</dt>
                <dd className="mt-1 text-sm text-slate-600">{feature.body}</dd>
              </div>
            ))}
          </dl>

          <ol className="mt-8 space-y-2 text-sm text-slate-600">
            <li>
              <strong className="text-slate-900">1.</strong> Create the tournament and pick an organiser PIN.
            </li>
            <li>
              <strong className="text-slate-900">2.</strong> Add categories with the scoring you want, then the entrants.
            </li>
            <li>
              <strong className="text-slate-900">3.</strong> Generate the draw and enter scores as games finish.
            </li>
            <li>
              <strong className="text-slate-900">4.</strong> Share the public link on WhatsApp — everyone follows it live.
            </li>
          </ol>
        </div>

        <div id="create" className="scroll-mt-24">
          <CreateTournamentForm />
        </div>
      </section>

      <section className="mt-14">
        <div className="flex items-baseline justify-between">
          <h2 className="text-2xl font-bold tracking-tight">Live and recent tournaments</h2>
          <Link href="/#create" className="text-sm font-medium text-emerald-700 hover:underline">
            Start your own
          </Link>
        </div>
        <PublicTournamentList />
      </section>
    </div>
  );
}
