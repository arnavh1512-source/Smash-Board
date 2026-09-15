import { expect, test } from "@playwright/test";
import {
  addCategory,
  addEntrant,
  createTournament,
  formAlert,
  generateDraw,
  openTab,
  planOrderOfPlay,
  scoreFirstMatch,
} from "./helpers";

/**
 * Umpires scoring their own matches. The organiser hands out a second PIN and
 * a second link; what that link opens must be a scoring page and nothing more,
 * because the person holding it is a volunteer at courtside, not the organiser.
 */

const REFEREE_PIN = "umpire-9034";

/** Today, as the date input wants it, so the order of play lands on a real day. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

test.describe("referee", () => {
  test("scores a match from the umpire's own link", async ({ page, context }) => {
    const tournament = await createTournament(page);
    await addCategory(page, { name: "Mens Singles", pointsPerSet: 21, sets: "Single set" });

    await openTab(page, "Entrants");
    await addEntrant(page, "Rohan Mehta");
    await addEntrant(page, "Dev Patel");
    await openTab(page, "Draw");
    await generateDraw(page);

    await openTab(page, "Setup");
    await expect(page.getByText("No referee PIN yet. Only you can enter scores.")).toBeVisible();
    await page.getByLabel("Referee PIN", { exact: false }).fill(REFEREE_PIN);
    await page.getByRole("button", { name: "Set referee PIN" }).click();
    await expect(
      page.getByText("Referee PIN saved. Share it with your umpires along with the scoring link."),
    ).toBeVisible();
    await expect(page.getByText("A referee PIN is set. Give your umpires this link:")).toBeVisible();

    // The umpire is a different person on a different phone, which a separate
    // browser context is exactly what models.
    const umpire = await context.browser()!.newContext();
    const umpirePage = await umpire.newPage();
    await umpirePage.goto(`/t/${tournament.slug}/score`);

    await umpirePage.getByLabel("Referee PIN").fill("wrong-pin");
    await umpirePage.getByRole("button", { name: "Start scoring" }).click();
    await expect(formAlert(umpirePage)).toHaveText("That PIN was not recognised.");

    await umpirePage.getByLabel("Referee PIN").fill(REFEREE_PIN);
    await umpirePage.getByRole("button", { name: "Start scoring" }).click();
    await expect(umpirePage.getByText("Referee console")).toBeVisible();

    // Scoring only. No tab strip at all, because there is nowhere else to go.
    for (const forbidden of ["Entrants", "Draw", "Order", "Events", "Setup"]) {
      await expect(
        umpirePage.getByRole("button", { name: forbidden, exact: true }),
      ).toHaveCount(0);
    }

    await umpirePage.getByRole("button", { name: "Score this match" }).first().click();
    const dialog = umpirePage.getByRole("dialog", { name: "Enter the score" });
    await dialog.getByRole("button", { name: "Add a point for Rohan Mehta" }).click({
      clickCount: 21,
    });
    await dialog.getByRole("button", { name: "Add a point for Dev Patel" }).click({
      clickCount: 18,
    });
    await dialog.getByRole("button", { name: "Save score" }).click();
    await expect(dialog).toBeHidden();
    await expect(umpirePage.getByText("Finished").first()).toBeVisible();

    // What the umpire typed is what the public sees — no organiser step between.
    await page.goto(`/t/${tournament.slug}`);
    await expect(page.getByText("Finished").first()).toBeVisible();
    await expect(page.getByText("21").first()).toBeVisible();

    await umpire.close();
  });

  test("scores court by court from a link that names the court", async ({ page, context }) => {
    const tournament = await createTournament(page, { startDate: today() });
    await addCategory(page, { name: "Mens Singles", pointsPerSet: 21, sets: "Single set" });
    await openTab(page, "Entrants");
    for (const player of ["Rohan Mehta", "Dev Patel", "Kabir Shah", "Vivek Nair"]) {
      await addEntrant(page, player);
    }
    await openTab(page, "Draw");
    await generateDraw(page);
    // One court, so both semi-finals queue on it one after the other.
    await planOrderOfPlay(page, 1);

    await openTab(page, "Setup");
    await page.getByLabel("Referee PIN", { exact: false }).fill(REFEREE_PIN);
    await page.getByRole("button", { name: "Set referee PIN" }).click();
    await expect(page.getByText("A referee PIN is set. Give your umpires this link:")).toBeVisible();

    const umpire = await context.browser()!.newContext();
    const umpirePage = await umpire.newPage();
    await umpirePage.goto(`/t/${tournament.slug}/score?court=${encodeURIComponent("Court 1")}`);
    await umpirePage.getByLabel("Referee PIN").fill(REFEREE_PIN);
    await umpirePage.getByRole("button", { name: "Start scoring" }).click();
    await expect(umpirePage.getByText("Referee console")).toBeVisible();

    // The link opened straight onto the court, on the 12-hour clock.
    await expect(umpirePage.getByRole("button", { name: "By court" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(umpirePage.getByRole("heading", { name: "Next on Court 1" })).toBeVisible();
    await expect(umpirePage.getByText(/Court 1 · 9:00 AM/).first()).toBeVisible();
    await expect(umpirePage.getByRole("heading", { name: "Then on Court 1" })).toBeVisible();

    await scoreFirstMatch(umpirePage, 21, 15);

    // The next semi-final moves up to the top of the court, and the one just
    // played waits underneath in case the score needs correcting.
    await expect(umpirePage.getByText(/Court 1 · 9:00 AM/)).toHaveCount(1);
    await expect(umpirePage.getByText("Played on Court 1 (1)")).toBeVisible();
    await umpirePage.getByText("Played on Court 1 (1)").click();
    await expect(umpirePage.getByRole("button", { name: "Correct the score" })).toBeVisible();

    // Back to categories drops the court from the link; the umpire can still
    // score a category the old way.
    await umpirePage.getByRole("button", { name: "By category" }).click();
    await expect(umpirePage).not.toHaveURL(/[?&]court=/);
    await expect(umpirePage.getByRole("button", { name: "Score this match" }).first()).toBeVisible();

    await umpire.close();
  });

  test("cuts the umpires off when the PIN is removed", async ({ page, context }) => {
    const tournament = await createTournament(page);
    await addCategory(page, { name: "Mens Singles" });

    await openTab(page, "Setup");
    await page.getByLabel("Referee PIN", { exact: false }).fill(REFEREE_PIN);
    await page.getByRole("button", { name: "Set referee PIN" }).click();
    await expect(page.getByText("A referee PIN is set. Give your umpires this link:")).toBeVisible();

    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(page.getByText("No referee PIN yet. Only you can enter scores.")).toBeVisible();

    const umpire = await context.browser()!.newContext();
    const umpirePage = await umpire.newPage();
    await umpirePage.goto(`/t/${tournament.slug}/score`);
    await umpirePage.getByLabel("Referee PIN").fill(REFEREE_PIN);
    await umpirePage.getByRole("button", { name: "Start scoring" }).click();
    await expect(formAlert(umpirePage)).toHaveText("That PIN was not recognised.");
    await umpire.close();
  });

  test("refuses a referee PIN that is the organiser PIN", async ({ page }) => {
    const tournament = await createTournament(page);
    await openTab(page, "Setup");

    // Handing out a referee PIN that also opens the console is not a referee
    // PIN, it is the organiser PIN with extra steps.
    await page.getByLabel("Referee PIN", { exact: false }).fill(tournament.pin);
    await page.getByRole("button", { name: "Set referee PIN" }).click();
    // Scoped to the alert: the field's help text also says the PIN "must be
    // different", so a bare text match is ambiguous.
    await expect(page.getByRole("alert").filter({ hasText: /must be different/i })).toBeVisible();
    await expect(page.getByText("No referee PIN yet. Only you can enter scores.")).toBeVisible();
  });
});
