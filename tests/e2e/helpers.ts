import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Shared steps for the end-to-end suite.
 *
 * Everything here drives the real UI rather than reaching into Convex, so a
 * helper breaking is itself a signal: if an organiser can no longer create a
 * tournament through the form, every spec that depends on one should fail.
 */

/** A tournament a spec owns outright, so specs never tread on each other. */
export interface TestTournament {
  readonly name: string;
  readonly slug: string;
  readonly pin: string;
}

/**
 * Wait until React has hydrated, so a click actually reaches a handler.
 *
 * Server-rendered markup is clickable long before it is interactive, and in
 * development a first-visit Turbopack compile widens that window to seconds.
 * When React attaches, it stamps a `__reactContainer$...` property on the
 * document it took over - the one honest signal that the page is live.
 *
 * Two traps: the property is non-enumerable, so `Object.keys` never sees it,
 * and it is a main-world expando, so `page.waitForFunction` - which polls in
 * Playwright's isolated utility world - cannot see it either. Polling through
 * `page.evaluate` runs in the main world, where it is visible.
 */
export async function waitForHydration(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          Object.getOwnPropertyNames(document).some((key) => key.startsWith("__reactContainer")),
        ),
      { message: "React never hydrated the page" },
    )
    .toBe(true);
}

/**
 * The page's own alert.
 *
 * Next renders an always-present, always-empty `role="alert"` route announcer
 * on every page, so a bare `getByRole("alert")` is two elements and fails
 * strict mode. Everything the app announces sits inside a form.
 */
export function formAlert(page: Page): Locator {
  return page.locator("form").getByRole("alert");
}

/**
 * Set a checkbox by clicking its visible label.
 *
 * The design hides the real input and draws its own dot, so Playwright's
 * `check()` has nothing on screen to click.
 */
export async function setCheckbox(page: Page, label: string, on: boolean): Promise<void> {
  const input = page.getByLabel(label);
  if ((await input.isChecked()) === on) return;
  await page.getByText(label, { exact: true }).click();
  await expect(input).toBeChecked({ checked: on });
}

/** Suffix that keeps names unique across parallel workers and repeat runs. */
function unique(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export interface CreateOptions {
  /** Listed on the home page. Off by default so parallel specs do not crowd it. */
  readonly isPublic?: boolean;
  /** Needed before the order of play can be planned. */
  readonly startDate?: string;
  readonly venue?: string;
}

/**
 * Create a tournament through the public form and land in the console.
 *
 * `create` signs the organiser in, so this returns with the console already
 * open — no PIN gate in between. That is itself the fix for the lockout bug,
 * and `organiser.spec.ts` asserts it explicitly.
 */
export async function createTournament(
  page: Page,
  options: CreateOptions = {},
): Promise<TestTournament> {
  const name = `E2E Cup ${unique()}`;
  const pin = "e2e-pin-4821";

  await page.goto("/");
  await waitForHydration(page);
  await page.getByLabel("Tournament name").fill(name);
  if (options.venue) await page.getByLabel("Venue").fill(options.venue);
  if (options.startDate) await page.getByLabel("Starts").fill(options.startDate);
  await page.getByLabel("Organiser PIN").fill(pin);
  await page.getByLabel("Confirm PIN").fill(pin);

  await setCheckbox(page, "Listed publicly on the home page", options.isPublic === true);

  await page.getByRole("button", { name: "Create and get my link" }).click();

  await page.waitForURL(/\/t\/[^/]+\/manage$/);
  const slug = new URL(page.url()).pathname.split("/")[2];
  await expect(page.getByRole("heading", { name })).toBeVisible();

  return { name, slug, pin };
}

export interface CategoryOptions {
  readonly name: string;
  /** 2 makes it a doubles category, which captures both partners. */
  readonly teamSize?: 1 | 2;
  readonly format?: "Knockout" | "Round robin (everyone plays everyone)" | "Groups, then knockout";
  readonly pointsPerSet?: number;
  readonly sets?: "Single set" | "Best of 3" | "Best of 5" | "Best of 7";
  readonly ending?: "deuce" | "golden";
}

/** Add a category from the console. Assumes the console is already open. */
export async function addCategory(page: Page, options: CategoryOptions): Promise<void> {
  const events = page.getByRole("button", { name: "Add a category" });
  // The first category is offered inline on an empty console; later ones live
  // behind the Events tab.
  if (await events.isVisible().catch(() => false)) {
    await events.click();
  } else if (await page.getByRole("button", { name: "Events", exact: true }).isVisible()) {
    await page.getByRole("button", { name: "Events", exact: true }).click();
    const add = page.getByRole("button", { name: "Add a category" });
    if (await add.isVisible().catch(() => false)) await add.click();
  }

  await page.getByLabel("Category name").fill(options.name);
  await page
    .getByLabel("Singles or doubles")
    .selectOption(options.teamSize === 2 ? "2" : "1");
  if (options.format) {
    await page.getByLabel("Draw format").selectOption({ label: options.format });
  }
  if (options.pointsPerSet !== undefined || options.sets || options.ending) {
    await page.getByLabel("Scoring preset").selectOption("custom");
  }
  if (options.pointsPerSet !== undefined) {
    await page.getByLabel("Points per set").fill(String(options.pointsPerSet));
  }
  if (options.sets) {
    await page.getByLabel("Sets", { exact: false }).selectOption({ label: options.sets });
  }
  if (options.ending) {
    await page.getByLabel("End of a set").selectOption(options.ending);
  }

  await page.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByRole("button", { name: "Add category" })).toBeHidden();
}

/** Open a console tab by its label. */
export async function openTab(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: label, exact: true }).click();
}

/**
 * Add one entrant. Pass two names for a doubles category — the form asks for
 * both, and a pair with one name is what the "Partner missing" badge is for.
 */
export async function addEntrant(page: Page, one: string, two?: string): Promise<void> {
  // The Entrants tab opens on the form import, which is where a real entry
  // list comes from. Typing one name is the other tab.
  await page.getByRole("button", { name: "One at a time" }).click();
  await page.getByLabel(two ? "Player one" : /Player (one|name)/).first().fill(one);
  if (two) await page.getByLabel("Player two").first().fill(two);
  await page.getByRole("button", { name: "Add entrant" }).click();
  await expect(page.getByText(one, { exact: false }).first()).toBeVisible();
}

/**
 * Enter a finished score for the first match offered on the Scores tab.
 *
 * Takes the per-set inputs rather than the point buttons: a spec that cares
 * about the plus and minus buttons should press them itself.
 */
export async function scoreFirstMatch(page: Page, a: number, b: number): Promise<void> {
  await page.getByRole("button", { name: "Score this match" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Enter the score" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("spinbutton").nth(0).fill(String(a));
  await dialog.getByRole("spinbutton").nth(1).fill(String(b));
  await dialog.getByRole("button", { name: "Save score" }).click();
  await expect(dialog).toBeHidden();
}

/** Plan the order of play from the Order tab. Needs a start date and a draw. */
export async function planOrderOfPlay(page: Page, courts = 2): Promise<void> {
  await openTab(page, "Order");
  await page.getByLabel("Courts").fill(String(courts));
  await page.getByRole("button", { name: /Plan the order of play|Plan again/ }).click();
  await expect(page.getByText(/\d+ matches timetabled\./)).toBeVisible();
}

/** Generate the draw for the active category, accepting the confirm dialog. */
export async function generateDraw(page: Page): Promise<void> {
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: /Generate draw|Generate again/ }).click();
  await expect(page.getByText(/Draw made: \d+ matches\./)).toBeVisible();
}
