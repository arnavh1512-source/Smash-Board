import { expect, test } from "@playwright/test";
import {
  addCategory,
  addEntrant,
  createTournament,
  formAlert,
  generateDraw,
  openTab,
} from "./helpers";

/**
 * Umpires scoring their own matches. The organiser hands out a second PIN and
 * a second link; what that link opens must be a scoring page and nothing more,
 * because the person holding it is a volunteer at courtside, not the organiser.
 */

const REFEREE_PIN = "umpire-9034";

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
    await expect(page.getByText(/must be different/i)).toBeVisible();
    await expect(page.getByText("No referee PIN yet. Only you can enter scores.")).toBeVisible();
  });
});
