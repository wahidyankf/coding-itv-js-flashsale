// Runs the home scenarios (`flash/web/behaviours/home/backend-status.feature`) in the unit world.
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { cleanup, render, screen } from "@testing-library/react";
import { expect, vi } from "vitest";
import { type BackendStatus, loadBackendStatus } from "../backend";
import { HomePage } from "../routes/index";
import { specFile } from "./support/paths";

// Answers the home page's request to flash-be with the given reply.
function backendAnswers(reply: () => Response | Promise<Response>): void {
	vi.stubEnv("FLASH_BE_URL", "http://flash-be.test");
	vi.stubGlobal("fetch", async () => reply());
}

async function openHomePage(): Promise<void> {
	const status: BackendStatus = await loadBackendStatus(process.env);
	render(<HomePage status={status} />);
}

describeFeature(
	await loadFeature(
		specFile("flash/web/behaviours/home/backend-status.feature"),
	),
	({ Scenario, AfterEachScenario }) => {
		// Each step runs as its own test, so the page is cleared only when the whole scenario ends.
		AfterEachScenario(() => {
			cleanup();
			vi.unstubAllGlobals();
			vi.unstubAllEnvs();
		});

		Scenario(
			"Home shows the backend as ok when flash-be is live",
			({ Given, When, Then, And }) => {
				Given('flash-be reports status "ok"', () => {
					backendAnswers(() => Response.json({ status: "ok" }));
				});

				When("a visitor opens the home page", openHomePage);

				Then('the page heading is "Flash Sale"', () => {
					expect(
						screen.getByRole("heading", { name: "Flash Sale" }),
					).toBeTruthy();
				});

				And('the page says "Backend: ok"', () => {
					expect(screen.getByText("ok")).toBeTruthy();
					expect(screen.getByText(/Backend:/).textContent).toBe("Backend: ok");
				});
			},
		);

		Scenario(
			"Home shows the backend as down when flash-be is unreachable",
			({ Given, When, Then }) => {
				Given("flash-be cannot be reached", () => {
					backendAnswers(() => {
						throw new TypeError("fetch failed");
					});
				});

				When("a visitor opens the home page", openHomePage);

				Then('the page says "Backend: down"', () => {
					expect(screen.getByText(/Backend:/).textContent).toBe(
						"Backend: down",
					);
				});
			},
		);

		Scenario(
			"Home shows the backend as down when flash-be answers with an error",
			({ Given, When, Then }) => {
				Given("flash-be answers /health with status 500", () => {
					backendAnswers(() => new Response("nope", { status: 500 }));
				});

				When("a visitor opens the home page", openHomePage);

				Then('the page says "Backend: down"', () => {
					expect(screen.getByText(/Backend:/).textContent).toBe(
						"Backend: down",
					);
				});
			},
		);

		Scenario(
			"Home shows the backend as down when flash-be reports another status",
			({ Given, When, Then }) => {
				Given('flash-be reports status "starting"', () => {
					backendAnswers(() => Response.json({ status: "starting" }));
				});

				When("a visitor opens the home page", openHomePage);

				Then('the page says "Backend: down"', () => {
					expect(screen.getByText(/Backend:/).textContent).toBe(
						"Backend: down",
					);
				});
			},
		);
	},
);
