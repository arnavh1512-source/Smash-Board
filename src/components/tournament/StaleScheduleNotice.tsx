"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Alert } from "@/components/ui";

/**
 * The warning that an order of play has been overtaken by events.
 *
 * A timetable is a plan derived from the draw, not a fact about the day. The
 * moment an entrant withdraws, a walkover resolves, a group decides who goes
 * through, the categories are reordered or the tournament moves to another
 * date, the times still sitting on the matches describe a tournament that no
 * longer exists. The dangerous part is that they keep looking authoritative,
 * so the app says plainly that they are out of date rather than quietly
 * serving an old plan.
 *
 * Nothing is hidden when this shows. An old plan is still the best guess at
 * the shape of the day, and a player standing in a hall would rather read it
 * with a warning attached than read nothing at all.
 */
export function StaleScheduleNotice({
  tournamentId,
  audience,
  className,
}: {
  tournamentId: Id<"tournaments">;
  audience: "organiser" | "public";
  /** Wrapper spacing, applied only when there is something to warn about. */
  className?: string;
}) {
  const status = useQuery(api.schedule.status, { tournamentId });
  if (!status?.stale) return null;

  return (
    <div className={className}>
      <Alert kind="warning">
        <strong>Schedule needs updating.</strong>{" "}
        {audience === "organiser"
          ? "The draw has changed since these times were planned — a withdrawal, a decided group, or a result that filled a later round. Plan the order of play again to bring the times back in line."
          : "The draw has changed since these times were planned, so they may no longer be right. The organiser will publish a new order of play."}
      </Alert>
    </div>
  );
}
