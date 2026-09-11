import { expect, test } from "@playwright/test";
import {
  addCategory,
  addEntrant,
  createTournament,
  generateDraw,
  openTab,
  planOrderOfPlay,
  scoreFirstMatch,
} from "./helpers";

/**
 * The scoreboard everyone else sees. No PIN, no account, no app — a link in a
 * WhatsApp group and a phone held sideways in a sports hall.
 *
 * One heavy setup serves the whole file: building a timetabled tournament
 * costs several round trips, and every assertion here reads the same one.
 */

/** Today, as the date input wants it, so the timetable lands on a real day. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

test.describe("public scoreboard", () => {
  test("shows the draw three ways once the order of play is planned", async ({ page }) => {
    const tournament = await createTournament(page, {
      startDate: today(),
      venue: "Ahmedabad Hall 3",
    });

    await addCategory(page, { name: "Mens Singles", pointsPerSet: 21, sets: "Single set" });
    await openTab(page, "Entrants");
    for (const player of ["Rohan Mehta", "Dev Patel", "Kabir Shah", "Vivek Nair"]) {
      await addEntrant(page, player);
    }
    await openTab(page, "Draw");
    await generateDraw(page);
    await planOrderOfPlay(page, 2);

    await openTab(page, "Scores");
    await scoreFirstMatch(page, 21, 17);

    await page.goto(`/t/${tournament.slug}`);

    // Three ways of reading the same day, because three different people are
    // reading it: a player, a parent waiting, and the desk running the courts.
    const byCategory = page.getByRole("button", { name: "By category" });
    const byTime = page.getByRole("button", { name: "Order of play" });
    const byCourt = page.getByRole("button", { name: "By court" });
    await expect(byCategory).toBeVisible();
    await expect(byCategory).toHaveAttribute("aria-pressed", "true");

    await byTime.click();
    await expect(byTime).toHaveAttribute("aria-pressed", "true");
    await expect(byCategory).toHaveAttribute("aria-pressed", "false");
    // A timetable has to show times, or it is only a list.
    await expect(page.getByText(/\d{1,2}:\d{2}/).first()).toBeVisible();

    await byCourt.click();
    await expect(byCourt).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(/Court 1/).first()).toBeVisible();
    await expect(page.getByText(/Court 2/).first()).toBeVisible();

    await byCategory.click();
    await expect(page.getByText("Finished").first()).toBeVisible();
    await expect(page.getByText("Scheduled").first()).toBeVisible();
  });

  test("hides the view switcher until there is a timetable to switch to", async ({ page }) => {
    const tournament = await createTournament(page);
    await addCategory(page, { name: "Mens Singles" });
    await openTab(page, "Entrants");
    await addEntrant(page, "Rohan Mehta");
    await addEntrant(page, "Dev Patel");
    await openTab(page, "Draw");
    await generateDraw(page);

    await page.goto(`/t/${tournament.slug}`);
    // Nothing has a time yet, so "Order of play" and "By court" would both be
    // empty pages pretending to be views.
    await expect(page.getByRole("button", { name: "Order of play" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "By court" })).toHaveCount(0);
    await expect(page.getByText("Rohan Mehta")).toBeVisible();
  });

  test("hands out a link a group chat can use", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const tournament = await createTournament(page);
    await page.goto(`/t/${tournament.slug}`);

    const whatsapp = page.getByRole("link", { name: "Share on WhatsApp" });
    await expect(whatsapp).toHaveAttribute("href", new RegExp(`t%2F${tournament.slug}`));
    await expect(whatsapp).toHaveAttribute("rel", /noopener/);

    await page.getByRole("button", { name: "Copy link" }).click();
    await expect(page.getByRole("button", { name: "Link copied" })).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain(`/t/${tournament.slug}`);
  });

  test("says so plainly when a link points at nothing", async ({ page }) => {
    const response = await page.goto("/t/no-such-tournament-anywhere");
    expect(response?.status()).toBe(404);
    await expect(page.getByText(/not found|does not exist/i).first()).toBeVisible();
  });

  test("reads on a phone without a sideways scroll", async ({ page }) => {
    const tournament = await createTournament(page);
    await addCategory(page, { name: "Mens Doubles", teamSize: 2 });
    await openTab(page, "Entrants");
    await addEntrant(page, "Anita Rao", "Priya Shah");
    await addEntrant(page, "Rohan Mehta", "Dev Patel");
    await openTab(page, "Draw");
    await generateDraw(page);

    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto(`/t/${tournament.slug}`);
    await expect(page.getByText("Anita Rao / Priya Shah")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
