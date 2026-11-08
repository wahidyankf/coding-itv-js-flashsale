// The steps that several web bindings share: the visitor's page actions and checks, the sale they open, and the types
// every binding uses. The bindings at the unit and integration layers say each step's wording, and take its body from
// here, so a body reads the same wherever it is used. Test support only.
import type { StepTest } from "@amiceli/vitest-cucumber";
import { openSale } from "./open-sale";
import type { WebWorld } from "./web-world";

// The sale most scenarios start from: ten items, none sold, open since an hour and closing in an hour.
export const SALE_10 =
	"a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour";
// The same sale once three items are sold.
export const SALE_WITH_3 =
	"a sale with stock 10 and 3 sold that opens 1 hour ago and closes in 1 hour";

// The steps of a scenario, given the scenario it is in. A binding returns one for each scenario its layer names.
export type ScenarioBinder = (steps: StepTest) => void;

// One row of a scenario outline's examples, read by column name.
export type ExampleRow = Record<string, string>;

// The steps of a scenario outline, given the scenario and the row of examples it runs with.
export type OutlineBinder = (steps: StepTest, examples: ExampleRow) => void;

// The body of the SALE_10 step. Every web scenario opens its sale the same way, so the sale's window is set here.
export function openTenSale(world: WebWorld) {
	return async () => openSale(world, 10, 0, "1 hour ago", "in 1 hour");
}

// The body of the SALE_WITH_3 step, with the same window as SALE_10.
export function openSaleWithThree(world: WebWorld) {
	return async () => openSale(world, 10, 3, "1 hour ago", "in 1 hour");
}

// The body of "a visitor has the page open" and "a visitor opens the page": the visitor opens the sale page.
export function visitorOpensPage(world: WebWorld) {
	return async () => world.openPage();
}

// The body of "the page says {string}": the page shows the text the scenario names.
export function pageSays(world: WebWorld) {
	return async (_ctx: unknown, text: string) => world.expectPageSays(text);
}

// The body of "the page shows the Purchase ID of {name}'s purchase": the page shows "Purchase ID: <id>" with the id flash-be
// gave that shopper's purchase. The id is read from the fake, so a page with another id fails.
export function showsPurchaseId(world: WebWorld, name: string) {
	return async () => {
		const id = world.purchaseIdOf(name);
		if (id === undefined) throw new Error(`${name} has no purchase to show`);
		await world.expectPageSays(`Purchase ID: ${id}`);
	};
}

// The body of "{string} is logged in": the browser holds a login for the shopper the scenario names.
export function isLoggedIn(world: WebWorld) {
	return async (_ctx: unknown, name: string) => world.loggedIn(name);
}

// The body of "the {string} button is enabled" and of its "disabled" twin: the button is in the state named.
export function buttonIs(world: WebWorld, state: "enabled" | "disabled") {
	return async (_ctx: unknown, name: string) => world.expectButton(name, state);
}

// The body of "the page has no {string} button": the page does not offer that button.
export function noButton(world: WebWorld) {
	return async (_ctx: unknown, name: string) => world.expectNoButton(name);
}

// The body of "she presses Buy Now": the visitor presses the button and the page settles.
export function pressBuyNow(world: WebWorld) {
	return async () => world.pressBuyNow();
}

// The body of "she confirms the purchase": the visitor presses Confirm purchase once the hold shows it.
export function confirmsPurchase(world: WebWorld) {
	return async () => world.pressConfirm();
}

// The body of "the queue admits shoppers slowly": a shopper stays in line long enough for the scenario to look at the page.
export function admitsSlowly(world: WebWorld) {
	return () => world.slowAdmission();
}

// The seconds in the sentence "Confirm within N seconds.", or NaN when the text does not say it.
export function secondsToConfirmIn(text: string): number {
	const match = /Confirm within (\d+) seconds\./.exec(text);
	return match ? Number(match[1]) : Number.NaN;
}

// The body of the "<failure>" step of the outlines where the shopper cannot reach the sale: the API is cut off, or the
// browser's connection to the web server fails. Any other row is the connection case.
export function cannotReachSale(world: WebWorld, failure: string) {
	return async () => {
		if (failure === "the sale cannot be reached") world.cutOff();
		else world.connectionFails();
	};
}
