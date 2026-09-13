"use client";

import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { cx } from "@/components/ui";
import { STATUS_LABELS } from "@/lib/display";
import { clockOf } from "@/lib/schedule";
import { SideNames } from "./PlayerPick";

export type EntryLookup = Map<Id<"entries">, Doc<"entries">>;

/** The status word sits where the design puts it: same size as the label, coloured only when live. */
function statusClass(status: string): string {
  if (status === "live") return "text-[var(--color-accent-ink)]";
  if (status === "walkover") return "text-[var(--color-accent-ink)] opacity-80";
  return "opacity-50";
}

function Side({
  entry,
  label,
  isWinner,
  sets,
  side,
  seed,
}: {
  entry: Doc<"entries"> | undefined;
  label: string | null;
  isWinner: boolean;
  sets: Doc<"matches">["sets"];
  side: "a" | "b";
  seed: number | null;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[15px] leading-[1.3]">
      <span className={cx("truncate", isWinner ? "font-extrabold" : "opacity-70")}>
        {seed ? <span className="mr-1 text-[11px] opacity-50">[{seed}]</span> : null}
        <SideNames entry={entry} label={label} />
      </span>
      <span className="num shrink-0 space-x-1.5">
        {sets.map((set, index) => (
          <span
            key={index}
            className={
              (side === "a" ? set.a > set.b : set.b > set.a) ? "font-extrabold" : "opacity-55"
            }
          >
            {side === "a" ? set.a : set.b}
          </span>
        ))}
      </span>
    </div>
  );
}

export function MatchRow({
  match,
  entries,
  title,
  action,
}: {
  match: Doc<"matches">;
  entries: EntryLookup;
  title?: string;
  action?: React.ReactNode;
}) {
  const a = match.aId ? entries.get(match.aId) : undefined;
  const b = match.bId ? entries.get(match.bId) : undefined;

  return (
    <article className="rule-b flex flex-col gap-[7px] px-4 py-3">
      <header className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-[0.08em]">
        <span className="truncate opacity-50">
          {title ?? ""}
          {match.court ? ` · ${match.court}` : ""}
          {match.scheduledAt ? ` · ${clockOf(match.scheduledAt)}` : ""}
        </span>
        <span className={cx("shrink-0", statusClass(match.status))}>
          {STATUS_LABELS[match.status] ?? match.status}
        </span>
      </header>

      <Side
        entry={a}
        label={match.aLabel}
        isWinner={match.winnerId !== null && match.winnerId === match.aId}
        sets={match.sets}
        side="a"
        seed={a?.seed && a.seed > 0 ? a.seed : null}
      />
      <Side
        entry={b}
        label={match.bLabel}
        isWinner={match.winnerId !== null && match.winnerId === match.bId}
        sets={match.sets}
        side="b"
        seed={b?.seed && b.seed > 0 ? b.seed : null}
      />

      {action ? <div className="rule-t pt-2">{action}</div> : null}
    </article>
  );
}
