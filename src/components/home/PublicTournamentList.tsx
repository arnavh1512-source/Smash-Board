"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { LiveDot, Spinner } from "@/components/ui";

function formatDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function PublicTournamentList() {
  const tournaments = useQuery(api.tournaments.listPublic, { limit: 24 });

  if (tournaments === undefined) return <Spinner label="Loading tournaments" />;

  if (tournaments.length === 0) {
    return (
      <p className="note mt-4">No public tournaments yet. Create the first one — it takes a minute.</p>
    );
  }

  return (
    <ul className="mt-3 flex list-none flex-col gap-0.5 bg-[var(--color-divider)] p-0 sm:grid sm:grid-cols-2">
      {tournaments.map((tournament) => {
        const start = formatDate(tournament.startDate);
        const end = formatDate(tournament.endDate);
        return (
          <li key={tournament._id} className="bg-[var(--color-bg)]">
            <Link href={`/t/${tournament.slug}`} className="card h-full text-[var(--color-text)]">
              <span className="card-kicker flex items-center gap-1.5">
                <LiveDot size={7} />
                Scoreboard
              </span>
              <span className="card-title">{tournament.name}</span>
              <span className="card-meta">
                {tournament.venue ? <span>{tournament.venue}</span> : null}
                {tournament.venue && start ? <span aria-hidden="true">·</span> : null}
                {start ? (
                  <span>
                    {start}
                    {end && end !== start ? ` – ${end}` : ""}
                  </span>
                ) : null}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
