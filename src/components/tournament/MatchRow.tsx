"use client";

import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { Badge, cx } from "@/components/ui";
import { STATUS_LABELS } from "@/lib/display";
import { isBye } from "@/lib/results";
import { clockOf } from "@/lib/schedule";
import { SideNames } from "./PlayerPick";

export type EntryLookup = Map<Id<"entries">, Doc<"entries">>;

/**
 * The status in the row header. Waiting states (scheduled, bye) stay plain
 * grey text; a match that is over gets a chip so a result, a walkover and a
 * match that never happened can be told apart at a glance.
 */
function StatusMark({ match }: { match: Doc<"matches"> }) {
  // A bye is not news, so it reads like a scheduled match, not a withdrawal.
  if (isBye(match)) return <span className="shrink-0 text-muted">Bye</span>;
  const label = STATUS_LABELS[match.status] ?? match.status;
  if (match.status === "live") {
    return <span className="shrink-0 text-[var(--color-accent-ink)]">{label}</span>;
  }
  if (match.status === "walkover") return <Badge tone="outline">{label}</Badge>;
  if (match.status === "completed" || match.status === "cancelled") {
    return <Badge tone="neutral">{label}</Badge>;
  }
  return <span className="shrink-0 text-muted">{label}</span>;
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
      <span className={cx("min-w-0 break-words", isWinner ? "font-extrabold" : "text-muted")}>
        {seed ? <span className="mr-1 text-[11px] text-muted">[{seed}]</span> : null}
        <SideNames entry={entry} label={label} />
      </span>
      <span className="num shrink-0 space-x-1.5">
        {sets.map((set, index) => (
          <span
            key={index}
            className={
              (side === "a" ? set.a > set.b : set.b > set.a) ? "font-extrabold" : "text-muted"
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
        <span className="truncate text-muted">
          {title ?? ""}
          {match.court ? ` · ${match.court}` : ""}
          {match.scheduledAt ? ` · ${clockOf(match.scheduledAt)}` : ""}
        </span>
        <StatusMark match={match} />
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
