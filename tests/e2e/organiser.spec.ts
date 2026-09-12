import { expect, test } from "@playwright/test";
import { addCategory, addEntrant, createTournament, generateDraw, openTab } from "./helpers";

/**
 * The organiser's whole job, start to finish: create a tournament, set up a
 * category with the scoring the club actually plays, enter the players, make
 * the draw, record a result, and see it reach the public scoreboard.
 *
 * This is the flow the app exists for. If only one spec may run, run this one.
 */

test.describe("organiser", () => {
  test("runs a category from empty to a published result", async ({ page }) => {
    const tournament = await createTournament(page, { venue: "Ahmedabad Hall 3" });

    // Creating signs the organiser in, so no PIN gate stands between the form
    // and the console. It used to, and the second sign-in could lock them out.
    await expect(page.getByRole("heading", { name: "Organiser sign-in" })).toHaveCount(0);
    await expect(page.getByText("Organiser console", { exact: true })).toBeVisible();

    await addCategory(page, {
      name: "Mens Singles",
      teamSize: 1,
      format: "Knockout",
      pointsPerSet: 21,
      sets: "Single set",
      ending: "deuce",
    });

    await openTab(page, "Entrants");
    for (const player of ["Rohan Mehta", "Dev Patel", "Kabir Shah", "Vivek Nair"]) {
      await addEntrant(page, player);
    }

    await openTab(page, "Draw");
    await generateDraw(page);

    await openTab(page, "Scores");
    await page.getByRole("button", { name: "Score this match" }).first().click();

    const dialog = page.getByRole("dialog", { name: "Enter the score" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("spinbutton").nth(0).fill("21");
    await dialog.getByRole("spinbutton").nth(1).fill("15");
    await dialog.getByRole("button", { name: "Save score" }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByText("Finished").first()).toBeVisible();

    // The point of the whole app: a player who was handed the link sees the
    // result without a PIN, an account or a refresh.
    await page.goto(`/t/${tournament.slug}`);
    await expect(page.getByRole("heading", { name: tournament.name })).toBeVisible();
    await expect(page.getByText("Ahmedabad Hall 3")).toBeVisible();
    await expect(page.getByText("Finished").first()).toBeVisible();
    await expect(page.getByText("21").first()).toBeVisible();
  });

  test("captures both partners in a doubles category", async ({ page }) => {
    await createTournament(page);
    await addCategory(page, { name: "Mens Doubles", teamSize: 2 });

    await openTab(page, "Entrants");
    await expect(page.getByLabel("Player one").first()).toBeVisible();
    await expect(page.getByLabel("Player two").first()).toBeVisible();

    await addEntrant(page, "Anita Rao", "Priya Shah");
    // A pair reads as a pair everywhere it is shown, not as two loose people.
    await expect(page.getByText("Anita Rao / Priya Shah", { exact: true })).toBeVisible();
  });

  test("refuses a half-filled pair and says which line it skipped", async ({ page }) => {
    await createTournament(page);
    await addCategory(page, { name: "Womens Doubles", teamSize: 2 });
    await openTab(page, "Entrants");

    // Both fields are required, so a lone name cannot be submitted at all.
    await page.getByLabel("Player one").first().fill("Solo Tester");
    await page.getByRole("button", { name: "Add entrant" }).click();
    const partner = page.getByLabel("Player two").first();
    await expect(partner).toHaveJSProperty("validity.valueMissing", true);

    // Bulk paste is the other door in, and it has to close the same way: a
    // single-name line silently becoming a "doubles" entrant of one was the
    // bug this whole feature came from. A line with three names is the same
    // bug from the other side - a missed newline quietly losing a player.
    await page.getByRole("button", { name: "Paste a list" }).click();
    await page
      .getByLabel("Paste a list")
      .fill(
        [
          "Anita Rao / Priya Shah",
          "Lonely Player",
          "Tara Bose / Ila Kaur / Meera Iyer",
          "Rohan Mehta / Dev Patel",
        ].join("\n"),
      );
    await page.getByRole("button", { name: "Add all" }).click();

    await expect(page.getByText(/Skipped 2:/)).toBeVisible();
    await expect(
      page.getByText(/Lonely Player \(needs exactly two players\)/),
    ).toBeVisible();
    await expect(
      page.getByText(/Tara Bose \/ Ila Kaur \/ Meera Iyer \(needs exactly two players\)/),
    ).toBeVisible();
    await expect(page.getByText("Anita Rao / Priya Shah", { exact: true })).toBeVisible();
    await expect(page.getByText("Rohan Mehta / Dev Patel", { exact: true })).toBeVisible();
    await expect(page.getByText("Lonely Player", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Tara Bose / Ila Kaur", { exact: true })).toHaveCount(0);
  });

  test("warns when a doubles-sounding category is set to singles", async ({ page }) => {
    await createTournament(page);
    // An empty console offers the category form inline, already open.
    await page.getByLabel("Category name").fill("Mixed Doubles");
    await page.getByLabel("Singles or doubles").selectOption("1");
    await expect(page.getByText(/named like a doubles event but is set to Singles/)).toBeVisible();

    // The warning has to clear again, or an organiser who fixes it is left
    // staring at a complaint about something they already put right.
    await page.getByLabel("Singles or doubles").selectOption("2");
    await expect(page.getByText(/named like a doubles event but is set to Singles/)).toHaveCount(0);
  });

  test("keeps the scoring rules the organiser chose", async ({ page }) => {
    await createTournament(page);
    await addCategory(page, {
      name: "U-13 Singles",
      teamSize: 1,
      pointsPerSet: 11,
      sets: "Best of 3",
      ending: "golden",
    });

    await openTab(page, "Events");
    // Every configurable rule the brief asked for, read back from the list.
    await expect(page.getByText(/Singles · .*11.*/)).toBeVisible();
    await expect(page.getByText(/golden/i).first()).toBeVisible();
  });

  test("locks the console and asks for the PIN again", async ({ page }) => {
    const tournament = await createTournament(page);

    await page.getByRole("button", { name: "Lock" }).click();
    await expect(page.getByRole("heading", { name: "Organiser sign-in" })).toBeVisible();

    await page.getByLabel("Organiser PIN").fill(tournament.pin);
    await page.getByRole("button", { name: "Unlock the console" }).click();
    await expect(page.getByText("Organiser console", { exact: true })).toBeVisible();
  });
});
