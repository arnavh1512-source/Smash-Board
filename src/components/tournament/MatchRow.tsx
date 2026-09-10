"use client";

import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { Badge, cx } from "@/components/ui";
import { sideName, STATUS_LABELS } from "@/lib/display";

export type EntryLookup = Map<Id<"entries">, Doc<"entries">>;

function setColumns(sets: Doc<"matches">["sets"], side: "a" | "b") {
  return sets.map((set, index) => (
    <span
      key={index}
      className={cx(
        "w-7 text-center tabular-nums",
        (side === "a" ? set.a > set.b : set.b > set.a) ? "font-bold text-slate-900" : "text-slate-500",
      )}
    >
      {side === "a" ? set.a : set.b}
    </span>
  ));
}

function Side({
  name,
  isWinner,
  sets,
  side,
  seed,
}: {
  name: string;
  isWinner: boolean;
  sets: Doc<"matches">["sets"];
  side: "a" | "b";
  seed: number | null;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <p className={cx("truncate text-sm", isWinner ? "font-semibold text-slate-900" : "text-slate-700")}>
        {seed ? <span className="mr-1 text-xs text-slate-400">[{seed}]</span> : null}
        {name}
      </p>
      <div className="flex shrink-0 items-center gap-1 text-sm">{setColumns(sets, side)}</div>
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
  const live = match.status === "live";

  return (
    <article
      className={cx(
        "rounded-xl border bg-white p-3",
        live ? "border-emerald-400 ring-2 ring-emerald-100" : "border-slate-200",
      )}
    >
      <header className="mb-1 flex items-center justify-between gap-2">
        <p className="truncate text-xs font-medium uppercase tracking-wide text-slate-500">
          {title ?? ""}
          {match.court ? ` · Court ${match.court}` : ""}
          {match.scheduledAt ? ` · ${match.scheduledAt}` : ""}
        </p>
        {live ? (
          <Badge tone="green">On court</Badge>
        ) : match.status === "walkover" ? (
          <Badge tone="amber">Walkover</Badge>
        ) : match.status === "completed" ? (
          <Badge tone="slate">Finished</Badge>
        ) : (
          <Badge tone="slate">{STATUS_LABELS[match.status] ?? match.status}</Badge>
        )}
      </header>

      <Side
        name={sideName(a, match.aLabel)}
        isWinner={match.winnerId !== null && match.winnerId === match.aId}
        sets={match.sets}
        side="a"
        seed={a?.seed && a.seed > 0 ? a.seed : null}
      />
      <Side
        name={sideName(b, match.bLabel)}
        isWinner={match.winnerId !== null && match.winnerId === match.bId}
        sets={match.sets}
        side="b"
        seed={b?.seed && b.seed > 0 ? b.seed : null}
      />

      {action ? <div className="mt-2 border-t border-slate-100 pt-2">{action}</div> : null}
    </article>
  );
}
