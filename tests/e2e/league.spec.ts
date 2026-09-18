import { expect, type Page, test } from "@playwright/test";
import { addCategory, addEntrant, createTournament, generateDraw, openTab } from "./helpers";

/**
 * League play, the two formats that are not a straight knockout: a round robin
 * where everyone meets everyone, and groups that feed a knockout.
 *
 * Results are entered without knowing who was drawn against whom, so the
 * checks are about the shape of the table rather than a particular order: every
 * row played the right number of matches, the wins add up, and the table is
 * sorted by them.
 */

/** Score the first unplayed match on the Scores tab, `count` times over. */
async function scoreOpenMatches(page: Page, count: number): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "Enter the score" });
  for (let played = 0; played < count; played++) {
    await page.getByRole("button", { name: "Score this match" }).first().click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("spinbutton").nth(0).fill("21");
    await dialog.getByRole("spinbutton").nth(1).fill(String(10 + (played % 9)));
    await dialog.getByRole("button", { name: "Save score" }).click();
    await expect(dialog).toBeHidden();
  }
}

/** Played and won for every row of the first standings table on the page. */
async function readTable(page: Page, index = 0): Promise<{ played: number; won: number }[]> {
  const rows = page.locator("table").nth(index).locator("tbody tr");
  const count = await rows.count();
  const out: { played: number; won: number }[] = [];
  for (let i = 0; i < count; i++) {
    const cells = rows.nth(i).locator("td");
    const texts = await cells.allInnerTexts();
    // The last five cells are always P, W, L, Sets, Points.
    const [played, won] = texts.slice(-5, -3).map((t) => Number(t.trim()));
    out.push({ played, won });
  }
  return out;
}

test.describe("league", () => {
  test("a round robin plays everyone once and ranks by wins", async ({ page }) => {
    const tournament = await createTournament(page);
    await addCategory(page, {
      name: "Club League",
      teamSize: 1,
      format: "Round robin (everyone plays everyone)",
      pointsPerSet: 21,
      sets: "Single set",
    });

    await openTab(page, "Entrants");
    for (const player of ["Asha Iyer", "Bina Rao", "Charu Sen", "Diya Kapoor"]) {
      await addEntrant(page, player);
    }

    await openTab(page, "Draw");
    // Four players, each meets the other three: six matches.
    await generateDraw(page);
    await expect(page.getByText("Draw made: 6 matches.")).toBeVisible();

    await openTab(page, "Scores");
    await expect(page.getByRole("heading", { name: "Standings" })).toBeVisible();
    // A singles table lists players, not pairs.
    await expect(page.getByRole("columnheader", { name: "Player" })).toBeVisible();

    await scoreOpenMatches(page, 6);
    await expect(page.getByRole("button", { name: "Score this match" })).toHaveCount(0);
    // Played matches offer a correction instead of a fresh score.
    await expect(page.getByRole("button", { name: "Correct the score" })).toHaveCount(6);

    const table = await readTable(page);
    expect(table).toHaveLength(4);
    expect(table.every((row) => row.played === 3)).toBe(true);
    expect(table.reduce((sum, row) => sum + row.won, 0)).toBe(6);
    const wins = table.map((row) => row.won);
    expect(wins).toEqual([...wins].sort((a, b) => b - a));

    // The same table reaches the public page, without a PIN.
    await page.goto(`/t/${tournament.slug}`);
    await expect(page.getByRole("heading", { name: "Standings" })).toBeVisible();
    await expect(page.getByText("Round robin · 4 entrants", { exact: false })).toBeVisible();
    expect(await readTable(page)).toEqual(table);
  });

  test("an odd field sits one out each round, home and away", async ({ page }) => {
    await createTournament(page);
    await addCategory(page, {
      name: "Doubles League",
      teamSize: 2,
      format: "Round robin (everyone plays everyone)",
      doubleRound: true,
    });

    await openTab(page, "Entrants");
    const pairs: [string, string][] = [
      ["Anil Rao", "Bala Nair"],
      ["Chetan Shah", "Dinesh Iyer"],
      ["Ekta Jain", "Falguni Mehta"],
      ["Gita Pillai", "Hema Das"],
      ["Isha Bose", "Jaya Sen"],
    ];
    for (const [one, two] of pairs) await addEntrant(page, one, two);

    await openTab(page, "Draw");
    // Five pairs meet each of the other four twice: twenty matches, and the
    // fifth pair rests each round rather than playing a phantom.
    await generateDraw(page);
    await expect(page.getByText("Draw made: 20 matches.")).toBeVisible();

    await openTab(page, "Scores");
    await expect(page.getByRole("columnheader", { name: "Pair" })).toBeVisible();
    await expect(page.getByText("BYE")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Score this match" })).toHaveCount(20);
  });

  test("groups feed the knockout once every group match is played", async ({ page }) => {
    const tournament = await createTournament(page);
    // The form defaults to two groups with two through from each.
    await addCategory(page, {
      name: "Open Singles",
      teamSize: 1,
      format: "Groups, then knockout",
      pointsPerSet: 21,
      sets: "Single set",
    });

    await openTab(page, "Entrants");
    const players = [
      "Arjun Das",
      "Bhavin Joshi",
      "Chirag Modi",
      "Dhruv Trivedi",
      "Eshan Pandya",
      "Farhan Qureshi",
      "Gaurav Desai",
      "Harsh Vyas",
    ];
    for (const player of players) await addEntrant(page, player);

    await openTab(page, "Draw");
    // Two groups of four play six each; four qualifiers need two semis and a final.
    await generateDraw(page);
    await expect(page.getByText("Draw made: 15 matches.")).toBeVisible();

    await openTab(page, "Scores");
    await expect(page.getByRole("heading", { name: "Group A" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Group B" })).toBeVisible();
    // Until the groups finish, the knockout shows where each place comes from
    // and offers nothing to score.
    await expect(page.getByText("1st in Group A").first()).toBeVisible();

    // Only the twelve group matches can be scored; the knockout is still empty.
    await expect(page.getByRole("button", { name: "Score this match" })).toHaveCount(12);
    await scoreOpenMatches(page, 12);

    for (const index of [0, 1]) {
      const group = await readTable(page, index);
      expect(group).toHaveLength(4);
      expect(group.every((row) => row.played === 3)).toBe(true);
    }

    // The groups are settled, so the semi-finals now name real players.
    await expect(page.getByText(/(1st|2nd) in Group [AB]/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Score this match" })).toHaveCount(2);
    await scoreOpenMatches(page, 2);
    // Both semi-finals won, so the final has its two players.
    await expect(page.getByRole("button", { name: "Score this match" })).toHaveCount(1);
    await scoreOpenMatches(page, 1);
    await expect(page.getByRole("button", { name: "Correct the score" })).toHaveCount(15);

    await page.goto(`/t/${tournament.slug}`);
    await expect(page.getByRole("heading", { name: "Group A" })).toBeVisible();
    await expect(page.getByText(/(1st|2nd) in Group [AB]/)).toHaveCount(0);
  });
});
