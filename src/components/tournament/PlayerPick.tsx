"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";
import { useSearchParam } from "@/lib/useSearchParam";
import type { Doc } from "../../../convex/_generated/dataModel";

/**
 * Names that open a player's own matches.
 *
 * The public scoreboard wraps itself in this provider, and every place that
 * prints a player's name — the draw, the tables, the order of play, the court
 * view — renders it through `PlayerName`. Outside the provider, as on the
 * organiser console, the same components print plain text, so the console is
 * not suddenly full of buttons that compete with scoring a match.
 */
const PlayerPickContext = createContext<((name: string) => void) | null>(null);

export function PlayerPickProvider({
  onPick,
  children,
}: {
  onPick: (name: string) => void;
  children: ReactNode;
}) {
  return <PlayerPickContext.Provider value={onPick}>{children}</PlayerPickContext.Provider>;
}

export function PlayerName({ name }: { name: string }) {
  const pick = useContext(PlayerPickContext);
  if (!pick) return <>{name}</>;
  return (
    <button
      type="button"
      onClick={() => pick(name)}
      title={`See ${name}'s matches and courts`}
      className="cursor-pointer appearance-none border-0 bg-transparent p-0 text-left [color:inherit] [font:inherit] underline decoration-dotted decoration-1 underline-offset-[3px] hover:decoration-solid"
    >
      {name}
    </button>
  );
}

/** One side of a match: each half of a doubles pair opens on its own. */
export function SideNames({
  entry,
  label,
}: {
  entry: Pick<Doc<"entries">, "playerOne" | "playerTwo"> | undefined;
  label: string | null;
}) {
  if (!entry) return <>{label ?? "To be decided"}</>;
  if (!entry.playerTwo) return <PlayerName name={entry.playerOne} />;
  return (
    <>
      <PlayerName name={entry.playerOne} /> / <PlayerName name={entry.playerTwo} />
    </>
  );
}

const PARAM = "player";

/**
 * The player whose matches are open, kept in the address bar as `?player=`.
 *
 * That makes the view a link: an organiser can send "your matches" to one
 * player in WhatsApp, and the phone's back button closes the sheet instead of
 * leaving the tournament. Opening from nothing adds a history entry; switching
 * to another player or closing replaces it, so back never walks through every
 * name somebody tapped.
 */
export function usePlayerParam(): [string | null, (name: string | null) => void] {
  const [player, write] = useSearchParam(PARAM);
  const setPlayer = useCallback(
    (name: string | null) => write(name, name !== null && player === null ? "push" : "replace"),
    [write, player],
  );
  return [player, setPlayer];
}
