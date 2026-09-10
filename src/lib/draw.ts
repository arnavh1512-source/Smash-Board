/**
 * Draw generation: knockout brackets, round robins, and group stages.
 *
 * Pure functions over plain entrant ids so both the Convex mutations and the
 * UI previews can call them. Nothing here touches the database.
 */

export type EntryId = string;

export type Stage = "group" | "knockout";

/** A match slot produced by a draw, before it is written to the database. */
export interface DraftMatch {
  stage: Stage;
  /** Group number for round-robin stages, otherwise null. */
  groupIndex: number | null;
  /** 0-based round. In a knockout, round 0 is the first round played. */
  round: number;
  /** Position of the match inside its round, 0-based. */
  slot: number;
  /** Entrant on side A, or null when the slot is still to be filled. */
  aId: EntryId | null;
  /** Entrant on side B, or null when the slot is still to be filled. */
  bId: EntryId | null;
  /** Label shown when a side is empty, e.g. "Winner of QF1" or "BYE". */
  aLabel: string | null;
  bLabel: string | null;
  /** True for the third-place playoff. */
  isThirdPlace: boolean;
}

export interface KnockoutOptions {
  /** Add a third-place playoff fed by the two semi-final losers. */
  thirdPlace: boolean;
}

/** Round name for a knockout round, counting back from the final. */
export function knockoutRoundName(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - 1 - round;
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Semi-final";
  if (fromEnd === 2) return "Quarter-final";
  return `Round of ${Math.pow(2, fromEnd + 1)}`;
}

/** Smallest power of two greater than or equal to n. Minimum 2. */
export function bracketSize(n: number): number {
  let size = 2;
  while (size < n) size *= 2;
  return size;
}

/**
 * Standard seeding order for a bracket of `size` slots.
 * Returns an array where index = bracket position, value = seed number (1-based).
 * For size 8: [1, 8, 5, 4, 3, 6, 7, 2] — the classic layout that keeps seed 1
 * and seed 2 apart until the final.
 */
export function seedOrder(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const next: number[] = [];
    const rounds = order.length * 2 + 1;
    // Every other pair is mirrored, which is what pushes seed 2 to the far end
    // of the bracket instead of leaving it beside seed 3.
    order.forEach((seed, index) => {
      const partner = rounds - seed;
      if (index % 2 === 0) next.push(seed, partner);
      else next.push(partner, seed);
    });
    order = next;
  }
  return order;
}

/**
 * Build a single-elimination bracket.
 *
 * Entrants are supplied in seeding order (strongest first). Byes are handed to
 * the strongest seeds, and a first-round match with one entrant is emitted as a
 * bye so the winner still advances through the normal feed.
 */
export function generateKnockout(entries: EntryId[], options: KnockoutOptions): DraftMatch[] {
  if (entries.length < 2) return [];

  const size = bracketSize(entries.length);
  const totalRounds = Math.log2(size);
  const order = seedOrder(size);

  // Bracket position -> entrant, using the seed layout. Positions whose seed
  // number exceeds the field size stay empty and become byes.
  const positions: (EntryId | null)[] = order.map((seed) => entries[seed - 1] ?? null);

  const matches: DraftMatch[] = [];

  for (let round = 0; round < totalRounds; round++) {
    const slots = size / Math.pow(2, round + 1);
    for (let slot = 0; slot < slots; slot++) {
      if (round === 0) {
        const a = positions[slot * 2] ?? null;
        const b = positions[slot * 2 + 1] ?? null;
        matches.push({
          stage: "knockout",
          groupIndex: null,
          round,
          slot,
          aId: a,
          bId: b,
          aLabel: a ? null : "BYE",
          bLabel: b ? null : "BYE",
          isThirdPlace: false,
        });
      } else {
        matches.push({
          stage: "knockout",
          groupIndex: null,
          round,
          slot,
          aId: null,
          bId: null,
          aLabel: `Winner of ${knockoutRoundName(round - 1, totalRounds)} ${slot * 2 + 1}`,
          bLabel: `Winner of ${knockoutRoundName(round - 1, totalRounds)} ${slot * 2 + 2}`,
          isThirdPlace: false,
        });
      }
    }
  }

  if (options.thirdPlace && totalRounds >= 2) {
    matches.push({
      stage: "knockout",
      groupIndex: null,
      round: totalRounds - 1,
      slot: 1,
      aId: null,
      bId: null,
      aLabel: "Loser of Semi-final 1",
      bLabel: "Loser of Semi-final 2",
      isThirdPlace: true,
    });
  }

  return matches;
}

/**
 * Where the winner of a knockout match goes next.
 * Returns null for the final and for the third-place playoff.
 */
export function knockoutFeed(
  round: number,
  slot: number,
  totalRounds: number,
): { round: number; slot: number; side: "a" | "b" } | null {
  if (round >= totalRounds - 1) return null;
  return { round: round + 1, slot: Math.floor(slot / 2), side: slot % 2 === 0 ? "a" : "b" };
}

/**
 * Round robin using the circle method. Every entrant meets every other once
 * (twice when `doubleRound` is set). A bye is inserted for odd fields.
 */
export function generateRoundRobin(
  entries: EntryId[],
  groupIndex: number | null,
  doubleRound = false,
): DraftMatch[] {
  const field = [...entries];
  if (field.length < 2) return [];

  const hasBye = field.length % 2 === 1;
  const wheel: (EntryId | null)[] = hasBye ? [...field, null] : [...field];
  const n = wheel.length;
  const rounds = n - 1;
  const matches: DraftMatch[] = [];

  const legs = doubleRound ? 2 : 1;
  for (let leg = 0; leg < legs; leg++) {
    const current = [...wheel];
    for (let r = 0; r < rounds; r++) {
      let slot = 0;
      for (let i = 0; i < n / 2; i++) {
        const home = current[i];
        const away = current[n - 1 - i];
        if (home === null || away === null) continue;
        const [aId, bId] = leg === 0 ? [home, away] : [away, home];
        matches.push({
          stage: groupIndex === null ? "knockout" : "group",
          groupIndex,
          round: leg * rounds + r,
          slot: slot++,
          aId,
          bId,
          aLabel: null,
          bLabel: null,
          isThirdPlace: false,
        });
      }
      // Rotate everything except the first entrant.
      current.splice(1, 0, current.pop() as EntryId | null);
    }
  }

  // A pure round robin is still a "group" of one for standings purposes.
  return matches.map((m) => ({ ...m, stage: "group" as Stage, groupIndex: groupIndex ?? 0 }));
}

/**
 * Snake-seed a field into `groupCount` groups so the strongest entrants spread
 * evenly: group 0 gets seeds 1 and 2n, group 1 gets 2 and 2n-1, and so on.
 */
export function splitIntoGroups(entries: EntryId[], groupCount: number): EntryId[][] {
  const groups: EntryId[][] = Array.from({ length: groupCount }, () => []);
  entries.forEach((entry, index) => {
    const band = Math.floor(index / groupCount);
    const withinBand = index % groupCount;
    const target = band % 2 === 0 ? withinBand : groupCount - 1 - withinBand;
    groups[target].push(entry);
  });
  return groups;
}

export interface GroupsKnockoutOptions {
  groupCount: number;
  advancePerGroup: number;
  doubleRound: boolean;
  thirdPlace: boolean;
}

/**
 * Group stage followed by a knockout. The knockout slots start empty and are
 * filled once each group has finished, using the group standings.
 */
export function generateGroupsKnockout(
  entries: EntryId[],
  options: GroupsKnockoutOptions,
): DraftMatch[] {
  const groups = splitIntoGroups(entries, options.groupCount);
  const matches: DraftMatch[] = [];

  groups.forEach((group, index) => {
    matches.push(...generateRoundRobin(group, index, options.doubleRound));
  });

  const qualifiers = options.groupCount * options.advancePerGroup;
  if (qualifiers < 2) return matches;

  const size = bracketSize(qualifiers);
  const totalRounds = Math.log2(size);
  const order = seedOrder(size);

  // Label each knockout entry slot with the group position that will fill it.
  // Qualifier seeds are laid out so group winners avoid each other early:
  // seed 1 = winner of group A, seed 2 = winner of group B, and so on.
  const qualifierLabel = (seed: number): string | null => {
    if (seed > qualifiers) return null;
    const place = Math.floor((seed - 1) / options.groupCount) + 1;
    const groupIdx = (seed - 1) % options.groupCount;
    const letter = String.fromCharCode(65 + groupIdx);
    const suffix = place === 1 ? "1st" : place === 2 ? "2nd" : place === 3 ? "3rd" : `${place}th`;
    return `${suffix} in Group ${letter}`;
  };

  for (let round = 0; round < totalRounds; round++) {
    const slots = size / Math.pow(2, round + 1);
    for (let slot = 0; slot < slots; slot++) {
      const aSeed = order[slot * 2];
      const bSeed = order[slot * 2 + 1];
      matches.push({
        stage: "knockout",
        groupIndex: null,
        round,
        slot,
        aId: null,
        bId: null,
        aLabel:
          round === 0
            ? (qualifierLabel(aSeed) ?? "BYE")
            : `Winner of ${knockoutRoundName(round - 1, totalRounds)} ${slot * 2 + 1}`,
        bLabel:
          round === 0
            ? (qualifierLabel(bSeed) ?? "BYE")
            : `Winner of ${knockoutRoundName(round - 1, totalRounds)} ${slot * 2 + 2}`,
        isThirdPlace: false,
      });
    }
  }

  if (options.thirdPlace && totalRounds >= 2) {
    matches.push({
      stage: "knockout",
      groupIndex: null,
      round: totalRounds - 1,
      slot: 1,
      aId: null,
      bId: null,
      aLabel: "Loser of Semi-final 1",
      bLabel: "Loser of Semi-final 2",
      isThirdPlace: true,
    });
  }

  return matches;
}
