// The steps of specs/apps/flash/be/behaviours/health/shutdown.feature, as both layers bind them. What a step does to the
// server is the layer's StoppingWorld: in memory with waits the scenario releases at the unit layer, over the run's
// Postgres and Redis with real time at the integration layer.
import { MS_PER_SECOND } from "@flash/flash-commons";
import { expect } from "vitest";
import type { ScenarioBinder } from "./steps.js";
import type { StoppingReply } from "./stopping-server.js";

// The actions of the shutdown scenarios, whatever the layer.
export type StoppingWorld = {
	// Given: the API keeps answering for this long after it is asked to stop.
	keepAnsweringFor: (seconds: number) => void;
	// Given: the API is running.
	start: () => Promise<void>;
	addSale: (sale: { stock: number; sold: number }) => Promise<void>;
	setPaymentSeconds: (seconds: number) => void;
	admit: (user: string) => Promise<void>;
	reserve: (user: string) => Promise<void>;
	// Sends the confirmation and returns once it is in flight, without waiting for its answer.
	startConfirm: (user: string) => Promise<void>;
	// Waits for the confirmation. The unit layer first lets the drain window end and checks that the server waits.
	finishConfirm: () => Promise<StoppingReply>;
	// Opens the sale's event stream and reads its first event.
	watchSale: () => Promise<void>;
	// When: the API is asked to stop, as SIGTERM asks it.
	askToStop: () => Promise<void>;
	ready: () => Promise<StoppingReply>;
	// Whether the open stream was ended by the server within the time given.
	streamEnded: (withinMs: number) => Promise<boolean>;
	// The exit code, or undefined when the shutdown has not finished within the time given.
	exitCode: (withinMs: number) => Promise<number | undefined>;
	// Ends whatever the scenario left running.
	close: () => Promise<void>;
};

// A stream that is ended must end within the drain window and a moment, in milliseconds.
const STREAM_END_MS = 5000;

// A holder for the last reply of a scenario.
type Last = { reply: StoppingReply | undefined };

function replyOf(last: Last): StoppingReply {
	if (!last.reply) throw new Error("no request was sent");
	return last.reply;
}

function readinessStops(newWorld: () => StoppingWorld): ScenarioBinder {
	return ({ Given, When, And, Then }) => {
		const world = newWorld();
		const last: Last = { reply: undefined };

		Given(
			"the API keeps answering for {int} second after it is asked to stop",
			(_ctx, seconds: number) => world.keepAnsweringFor(seconds),
		);
		When("the API is asked to stop", () => world.askToStop());
		And("a client sends GET /ready", async () => {
			last.reply = await world.ready();
		});
		Then("the response status is {int}", (_ctx, status: number) => {
			expect(replyOf(last).status).toBe(status);
		});
		And("the readiness status is {string}", (_ctx, status: string) => {
			expect(replyOf(last).body.status).toBe(status);
		});
		And(
			"the readiness checks report database {string} and redis {string}",
			async (_ctx, database: string, redis: string) => {
				expect(replyOf(last).body.checks).toEqual({ database, redis });
				await world.close();
			},
		);
	};
}

function requestInFlight(newWorld: () => StoppingWorld): ScenarioBinder {
	return ({ Given, When, And, Then }) => {
		const world = newWorld();
		const last: Last = { reply: undefined };

		Given(
			"a sale with stock {int} and {int} sold that opens 1 hour ago and closes in 1 hour",
			(_ctx, stock: number, sold: number) => world.addSale({ stock, sold }),
		);
		And(
			"the API keeps answering for {int} second after it is asked to stop",
			(_ctx, seconds: number) => world.keepAnsweringFor(seconds),
		);
		And("the payment provider takes {int} seconds", (_ctx, seconds: number) =>
			world.setPaymentSeconds(seconds),
		);
		And("{string} has been admitted", (_ctx, user: string) =>
			world.admit(user),
		);
		And("{string} has reserved an item", (_ctx, user: string) =>
			world.reserve(user),
		);
		When("{string} starts to confirm the purchase", (_ctx, user: string) =>
			world.startConfirm(user),
		);
		And("the API is asked to stop", () => world.askToStop());
		And("the confirmation finishes", async () => {
			last.reply = await world.finishConfirm();
		});
		Then("the response status is {int}", (_ctx, status: number) => {
			expect(replyOf(last).status).toBe(status);
		});
		And("a purchase id is issued", async () => {
			expect(replyOf(last).body.purchaseId).toMatch(/^[0-9a-f-]{36}$/);
			await world.close();
		});
	};
}

function streamsEnded(newWorld: () => StoppingWorld): ScenarioBinder {
	return ({ Given, When, And, Then }) => {
		const world = newWorld();

		Given(
			"a sale with stock {int} and {int} sold that opens 1 hour ago and closes in 1 hour",
			(_ctx, stock: number, sold: number) => world.addSale({ stock, sold }),
		);
		And(
			"the API keeps answering for {int} second after it is asked to stop",
			(_ctx, seconds: number) => world.keepAnsweringFor(seconds),
		);
		And("a client is watching the sale", () => world.watchSale());
		When("the API is asked to stop", () => world.askToStop());
		Then("the event stream ends", async () => {
			expect(await world.streamEnded(STREAM_END_MS)).toBe(true);
			await world.close();
		});
	};
}

function exitsWhenDone(newWorld: () => StoppingWorld): ScenarioBinder {
	return ({ Given, When, Then }) => {
		const world = newWorld();

		Given("the API is running", () => world.start());
		When("the API is asked to stop", () => world.askToStop());
		Then(
			"the API exits with code {int} within {int} seconds",
			async (_ctx, code: number, seconds: number) => {
				expect(await world.exitCode(seconds * MS_PER_SECOND)).toBe(code);
				await world.close();
			},
		);
	};
}

// The steps of each shutdown scenario, by the scenario's name in the feature's own words.
export function bindHealthShutdown(newWorld: () => StoppingWorld) {
	return {
		readinessStops: readinessStops(newWorld),
		requestInFlight: requestInFlight(newWorld),
		streamsEnded: streamsEnded(newWorld),
		exitsWhenDone: exitsWhenDone(newWorld),
	};
}
