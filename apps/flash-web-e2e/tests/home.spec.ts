import { expect, test } from "@playwright/test";

test("home page shows the heading and the backend status", async ({ page }) => {
	await page.goto("/");

	await expect(page.locator("h1")).toHaveText("Flash Sale");
	await expect(page.getByText("Backend:")).toContainText("ok");
});
