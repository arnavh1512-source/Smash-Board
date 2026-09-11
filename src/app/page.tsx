import Link from "next/link";
import { CreateTournamentForm } from "@/components/home/CreateTournamentForm";
import { PublicTournamentList } from "@/components/home/PublicTournamentList";
import { SITE, whatsappLink } from "@/lib/site";

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

const STEPS = [
  "Create the tournament and pick an organiser PIN.",
  "Add categories with the scoring you want, then the entrants.",
  "Generate the draw and enter scores as games finish.",
  "Share the public link on WhatsApp — everyone follows it live.",
];

export default function HomePage() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <section className="rule-b2 px-4 pb-5 pt-6">
        <span className="tag tag-accent">Free to run · No sign-up for players</span>
        <h1 className="mt-3 text-[31px]">
          Run your badminton tournament and let everyone watch the scores live.
        </h1>
        <p className="mt-2 mb-4 text-[14px] opacity-80 [text-wrap:pretty]">{SITE.description}</p>
        <Link href="/#create" className="btn btn-primary btn-block min-h-12 text-[15px]">
          Create a tournament
        </Link>
      </section>

      {/* The 2px gaps are the divider showing through, which is how the design draws its grid. */}
      <dl className="rule-b2 grid grid-cols-2 gap-0.5 bg-[var(--color-divider)]">
        {FEATURES.map((feature) => (
          <div key={feature.title} className="bg-[var(--color-bg)] px-4 py-3.5">
            <dt className="text-[14px] font-extrabold leading-tight">{feature.title}</dt>
            <dd className="mt-1.5 text-[12px] leading-relaxed opacity-75">{feature.body}</dd>
          </div>
        ))}
      </dl>

      <section className="rule-b2 px-4 py-5">
        <h6>How it works</h6>
        <ol className="mt-3 flex list-none flex-col gap-2.5 p-0">
          {STEPS.map((step, index) => (
            <li key={step} className="flex gap-3">
              <span className="num w-4 shrink-0 text-[13px] font-extrabold text-[var(--color-accent-ink)]">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="text-[13px] opacity-85">{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <div id="create" className="scroll-mt-16">
        <CreateTournamentForm />
      </div>

      <section className="rule-b2 px-4 py-5">
        <div className="flex items-baseline justify-between gap-3">
          <h4 className="m-0">Live and recent</h4>
          <Link href="/#create" className="text-[13px]">
            Start your own
          </Link>
        </div>
        <PublicTournamentList />
      </section>

      <section className="bg-[var(--color-accent)] px-4 py-[22px] text-[#f3f2f2]">
        <p className="m-0 text-[24px] font-extrabold leading-[1.1]">
          One link. Everyone watching.
        </p>
        <p className="mb-4 mt-2 text-[13px] opacity-90">
          Send the scoreboard to the club group and stop answering “what’s the score?”.
        </p>
        <a
          href={whatsappLink(`Hi, I want to run a tournament on ${SITE.name}.`)}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-block min-h-[46px] bg-[#f3f2f2] text-[#201e1d] hover:bg-white hover:text-[#201e1d]"
        >
          Ask us anything on WhatsApp
        </a>
      </section>
    </div>
  );
}
