import { expect, test } from "@playwright/test";
import { createTournament, formAlert } from "./helpers";

/**
 * The door. Every one of these is a regression test for a bug that shipped:
 * the lockout that never fired because the mutation that counted the attempt
 * threw, rolling back the very counter it had just written.
 *
 * These run serially within the file — the attempt counter is per tournament,
 * and each test still owns its own tournament, so serial is about keeping the
 * timing assertions honest rather than about isolation.
 */

test.describe("sign-in", () => {
  test("turns away a wrong PIN without letting it through", async ({ page }) => {
    const tournament = await createTournament(page);
    await page.getByRole("button", { name: "Lock" }).click();

    await page.getByLabel("Organiser PIN").fill("not-the-pin");
    await page.getByRole("button", { name: "Unlock the console" }).click();

    await expect(formAlert(page)).toHaveText("Wrong organiser PIN.");
    await expect(page.getByText("Organiser console", { exact: true })).toHaveCount(0);

    // And the right PIN still works afterwards: a wrong guess must not spoil
    // the session for the organiser who simply mistyped.
    await page.getByLabel("Organiser PIN").fill(tournament.pin);
    await page.getByRole("button", { name: "Unlock the console" }).click();
    await expect(page.getByText("Organiser console", { exact: true })).toBeVisible();
  });

  test("locks the tournament after eight wrong tries", async ({ page }) => {
    const tournament = await createTournament(page);
    await page.getByRole("button", { name: "Lock" }).click();

    const field = page.getByLabel("Organiser PIN");
    const submit = page.getByRole("button", { name: "Unlock the console" });

    // Seven wrong guesses: refused, but the door is still open.
    for (let attempt = 1; attempt <= 7; attempt += 1) {
      await field.fill(`wrong-${attempt}`);
      await submit.click();
      await expect(formAlert(page)).toHaveText("Wrong organiser PIN.");
    }

    // The eighth trips the lock, and says so rather than repeating "wrong PIN"
    // at an organiser who would otherwise keep trying.
    await field.fill("wrong-8");
    await submit.click();
    await expect(formAlert(page)).toHaveText(
      /Too many wrong PINs\. Try again in \d+ minutes?\./,
    );

    // The heart of C1: the counter is written by a mutation that must not throw,
    // or the transaction rolls back and the lockout is permanently unreachable.
    // With the lock set, even the correct PIN is refused until it expires.
    await field.fill(tournament.pin);
    await submit.click();
    await expect(formAlert(page)).toHaveText(
      /Too many wrong PINs\. Try again in \d+ minutes?\./,
    );
    await expect(page.getByText("Organiser console", { exact: true })).toHaveCount(0);
  });

  test("keeps a signed-in organiser signed in across a reload", async ({ page }) => {
    const tournament = await createTournament(page);

    await page.reload();
    await expect(page.getByText("Organiser console", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: tournament.name })).toBeVisible();
  });

  test("never lets a scoreboard reader reach the console", async ({ page, context }) => {
    const tournament = await createTournament(page);

    // A second browser context is a different device with no session token.
    const stranger = await context.browser()!.newContext();
    const strangerPage = await stranger.newPage();
    await strangerPage.goto(`/t/${tournament.slug}/manage`);
    await expect(strangerPage.getByRole("heading", { name: "Organiser sign-in" })).toBeVisible();

    // The scoreboard itself stays open to them, which is the whole point.
    await strangerPage.goto(`/t/${tournament.slug}`);
    await expect(strangerPage.getByRole("heading", { name: tournament.name })).toBeVisible();
    await stranger.close();
  });

  test("guards the scoring page with its own door", async ({ page }) => {
    const tournament = await createTournament(page);

    await page.goto(`/t/${tournament.slug}/score`);
    await expect(page.getByRole("heading", { name: "Referee sign-in" })).toBeVisible();

    await page.getByLabel("Referee PIN").fill("nobody-knows-this");
    await page.getByRole("button", { name: "Start scoring" }).click();
    await expect(formAlert(page)).toHaveText("That PIN was not recognised.");

    // The organiser's own PIN opens the scoring page too — they umpire their
    // own matches — but it opens the *scoring* page, not the console: the page
    // decides what is on offer, not the PIN that got in.
    await page.getByLabel("Referee PIN").fill(tournament.pin);
    await page.getByRole("button", { name: "Start scoring" }).click();
    await expect(page.getByText("Referee console")).toBeVisible();
    await expect(page.getByRole("button", { name: "Setup", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Entrants", exact: true })).toHaveCount(0);
  });
});
