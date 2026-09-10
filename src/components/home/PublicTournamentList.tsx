"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Spinner } from "@/components/ui";

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
      <p className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
        No public tournaments yet. Create the first one — it takes a minute.
      </p>
    );
  }

  return (
    <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {tournaments.map((tournament) => {
        const start = formatDate(tournament.startDate);
        const end = formatDate(tournament.endDate);
        return (
          <li key={tournament._id}>
            <Link
              href={`/t/${tournament.slug}`}
              className="block h-full rounded-xl border border-slate-200 bg-white p-4 transition hover:border-emerald-400 hover:shadow-md"
            >
              <p className="font-semibold text-slate-900">{tournament.name}</p>
              {tournament.venue ? (
                <p className="mt-1 text-sm text-slate-600">{tournament.venue}</p>
              ) : null}
              {start ? (
                <p className="mt-2 text-xs text-slate-500">
                  {start}
                  {end && end !== start ? ` – ${end}` : ""}
                </p>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
