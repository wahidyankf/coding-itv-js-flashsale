// Steps for the account page: a visitor logs in or signs up in the form, logs out, and the browser's cookies are the proof
// of a login (a login ends when its cookies go). Binds account/login.feature.

import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { Given, When, Then } = createBdd();

// Fills in the form as a person would, so the step checks the real page.
When(
	/^the visitor (logs in|signs up) as "([^"]*)" with the password "([^"]*)"$/,
	async ({ page }, action: string, user: string, password: string) => {
		const signingUp = action === "signs up";
		await page
			.getByRole("button", {
				name: signingUp ? "I am new" : "I have an account",
			})
			.click();
		await page.getByLabel("Username").fill(user);
		await page.getByLabel("Password").fill(password);
		await page
			.getByRole("button", {
				name: signingUp ? "Sign up" : "Log in",
				exact: true,
			})
			.click();
	},
);

When("the visitor logs out", async ({ page }) => {
	await page.getByRole("button", { name: "Log out" }).click();
});

Then(/^the page has no "([^"]+)" button$/, async ({ page }, name: string) => {
	await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
});

// A browser forgets a cookie when its time is up, and then sends nothing. So the end of a login is the cookie going.
Then("the browser holds no login", async ({ context }) => {
	const names = (await context.cookies()).map((cookie) => cookie.name);
	expect(names).not.toContain("access_token");
	expect(names).not.toContain("refresh_token");
});

Given("the short token of every login has ended", async ({ context }) => {
	// The access cookie lives 15 minutes. After that the browser no longer sends it, and the refresh cookie is all that is left.
	await context.clearCookies({ name: "access_token" });
});

// The access cookie runs out while the page is open. The page still holds its streams, and the refresh cookie is all that is left.
When("the access cookie runs out", async ({ context }) => {
	await context.clearCookies({ name: "access_token" });
});

// The refresh cookie lives 7 days. After that the browser sends neither cookie.
Given("every login has ended", async ({ context }) => {
	await context.clearCookies({ name: "access_token" });
	await context.clearCookies({ name: "refresh_token" });
});
