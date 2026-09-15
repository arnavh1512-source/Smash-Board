import { expect, test } from "@playwright/test";
import { createTournament, waitForHydration } from "./helpers";

/**
 * The front door: what a player or an organiser sees before anything exists.
 * These are the checks that catch a broken layout, a missing meta tag or a
 * WhatsApp link pointing at the wrong number — all of which ship silently.
 */

test.describe("home page", () => {
  test("states what the app is and offers the create form", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveTitle(/SmashBoard/);
    await expect(
      page.getByRole("heading", {
        name: /Run your badminton tournament and let everyone watch the scores live\./,
      }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Create a tournament" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create and get my link" })).toBeVisible();
  });

  test("refuses to be framed and sends the baseline security headers", async ({ page }) => {
    const response = await page.goto("/");
    const headers = response?.headers() ?? {};

    // Without these another site could load the console in an invisible frame
    // and trick an organiser into typing their PIN or deleting a category.
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });

  test("carries the SEO and AEO metadata a share needs", async ({ page }) => {
    await page.goto("/");

    const description = page.locator('head meta[name="description"]');
    await expect(description).toHaveAttribute("content", /badminton/i);
    await expect(page.locator('head meta[property="og:title"]')).toHaveCount(1);
    await expect(page.locator('head meta[property="og:description"]')).toHaveCount(1);
    // The answer-engine block: without it an assistant asked "how do I run a
    // badminton tournament" has nothing structured to quote. It sits in the
    // body rather than the head, which search engines and assistants both read.
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(1);
    const jsonLd = await page.locator('script[type="application/ld+json"]').textContent();
    expect(JSON.parse(jsonLd ?? "{}")["@type"]).toBe("FAQPage");
  });

  test("offers WhatsApp contact on the organiser's own number", async ({ page }) => {
    await page.goto("/");

    const float = page.getByRole("link", { name: "Chat on WhatsApp" });
    await expect(float).toBeVisible();
    await expect(float).toHaveAttribute("href", /wa\.me\/918140081461/);
    await expect(float).toHaveAttribute("target", "_blank");
    // An external target without noopener hands the opened tab a window.opener
    // handle back into this one.
    await expect(float).toHaveAttribute("rel", /noopener/);
  });

  test("remembers the reader's choice of ground", async ({ page }) => {
    await page.goto("/");
    await waitForHydration(page);
    const html = page.locator("html");
    await expect(html).not.toHaveClass(/sb-dark/);

    await page.getByRole("button", { name: "Dark" }).click();
    await expect(html).toHaveClass(/sb-dark/);

    // The choice has to survive a reload without a flash of the light ground,
    // which is what the inline head script is for.
    await page.reload();
    await waitForHydration(page);
    await expect(html).toHaveClass(/sb-dark/);
    await expect(page.getByRole("button", { name: "Light" })).toBeVisible();

    await page.getByRole("button", { name: "Light" }).click();
    await expect(html).not.toHaveClass(/sb-dark/);
  });

  test("keeps the wordmark at its design size", async ({ page }) => {
    await page.goto("/");
    // `.nav a` once outranked `.nav-brand` at equal specificity and quietly
    // shrank the wordmark to link size. Nothing about the page looked broken,
    // which is exactly why it needs a test.
    const brand = page.locator(".nav-brand");
    await expect(brand).toHaveCSS("font-size", "18px");
    await expect(brand).toHaveCSS("font-weight", "800");
  });

  test("never scrolls sideways on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("/");

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("lists a public tournament and hides an unlisted one", async ({ page }) => {
    const unlisted = await createTournament(page, { isPublic: false });
    const listed = await createTournament(page, { isPublic: true });

    await page.goto("/");
    await expect(page.getByRole("link", { name: listed.name })).toBeVisible();
    await expect(page.getByRole("link", { name: unlisted.name })).toHaveCount(0);

    // Unlisted means unlisted, not private: the link still works.
    await page.goto(`/t/${unlisted.slug}`);
    await expect(page.getByRole("heading", { name: unlisted.name })).toBeVisible();
  });
});
