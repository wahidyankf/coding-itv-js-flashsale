// The steps of specs/apps/flash/be/behaviours/routing/unknown-routes.feature, as both layers bind them. Each request goes to
// the app the layer builds; the titles stay in the layer's test file, where the behaviour checker reads them.
import { expect } from "vitest";
import { type ReplyBox, type Response, responseOf } from "./response.js";
import {
	errorIs,
	type OutlineBinder,
	type ScenarioBinder,
	statusIs,
} from "./steps.js";

// The requests a routing scenario makes. Each layer builds the app it sends them to.
export type RoutingWorld = {
	get: (url: string) => Promise<Response>;
	// A request whose body is sent as JSON, exactly as the text given.
	post: (url: string, body: string) => Promise<Response>;
};

// The reply to GET /nope, which no route answers, kept where the steps read it.
function getNope(world: RoutingWorld, last: ReplyBox) {
	return async () => {
		last.response = await world.get("/nope");
	};
}

function unknownRoute(newWorld: () => RoutingWorld): ScenarioBinder {
	return ({ When, Then, And }) => {
		const world = newWorld();
		const last: ReplyBox = { response: undefined };

		When("a client sends GET /nope", getNope(world, last));
		Then("the response status is {int}", statusIs(last));
		And("the error is {string}", errorIs(last));
	};
}

function errorSentence(newWorld: () => RoutingWorld): ScenarioBinder {
	return ({ When, Then, And }) => {
		const world = newWorld();
		const last: ReplyBox = { response: undefined };

		When("a client sends GET /nope", getNope(world, last));
		Then("the response status is {int}", statusIs(last));
		And("the error message is {string}", (_ctx, message: string) => {
			expect(responseOf(last).json().errorMessage).toBe(message);
		});
	};
}

function notJson(newWorld: () => RoutingWorld): ScenarioBinder {
	return ({ When, Then, And }) => {
		const world = newWorld();
		const last: ReplyBox = { response: undefined };

		When(
			"a client sends POST /sales/00000000-0000-4000-8000-000000000000/queue with a body that is not JSON",
			async () => {
				last.response = await world.post(
					"/sales/00000000-0000-4000-8000-000000000000/queue",
					"{oops",
				);
			},
		);
		Then("the response status is {int}", statusIs(last));
		And("the error is {string}", errorIs(last));
	};
}

function badField(newWorld: () => RoutingWorld): OutlineBinder {
	return ({ When, Then, And }, examples) => {
		const world = newWorld();
		const last: ReplyBox = { response: undefined };

		When("a client sends POST <path> with the body <body>", async () => {
			last.response = await world.post(
				String(examples.path),
				String(examples.body),
			);
		});
		Then("the response status is {int}", statusIs(last));
		And('the error is "<error>"', () => {
			expect(responseOf(last).json().errorCode).toBe(String(examples.error));
		});
	};
}

// The steps of each scenario in the routing feature, by the scenario's name in the feature's own words.
export function bindRouting(newWorld: () => RoutingWorld) {
	return {
		unknownRoute: unknownRoute(newWorld),
		errorSentence: errorSentence(newWorld),
		notJson: notJson(newWorld),
		badField: badField(newWorld),
	};
}
