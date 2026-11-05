import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { expect, vi } from "vitest";
import { getRouter } from "../router";
import { specFile } from "./support/paths";

// Server functions need the Start runtime, which unit tests do not run. This mock makes a server
// function call its handler directly. Only the transport is replaced; the router and the loader are real.
vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => ({ handler: (fn: () => unknown) => fn }),
}));

describeFeature(
	await loadFeature(specFile("flash/web/behaviours/home/app-router.feature")),
	({ Scenario, AfterEachScenario }) => {
		// Each step runs as its own test, so the page and stubs are cleared only when the whole scenario ends.
		AfterEachScenario(() => {
			cleanup();
			vi.unstubAllGlobals();
			vi.unstubAllEnvs();
		});

		Scenario(
			"The app router serves the home page",
			({ Given, When, Then, And }) => {
				Given('flash-be reports status "ok"', () => {
					vi.stubEnv("FLASH_BE_URL", "http://flash-be.test");
					vi.stubGlobal("fetch", async () => Response.json({ status: "ok" }));
				});

				When("a visitor opens the home page", () => {
					render(<RouterProvider router={getRouter()} />);
				});

				Then('the page heading is "Flash Sale"', async () => {
					expect(
						await screen.findByRole("heading", { name: "Flash Sale" }),
					).toBeTruthy();
				});

				And('the page says "Backend: ok"', async () => {
					expect((await screen.findByText(/Backend:/)).textContent).toBe(
						"Backend: ok",
					);
				});
			},
		);
	},
);
