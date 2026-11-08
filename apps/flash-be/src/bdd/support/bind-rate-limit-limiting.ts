// The steps of specs/apps/flash/be/behaviours/rate-limit/limiting.feature, as both layers bind them. Each scenario gets the
// world its layer makes; the titles stay in the layer's test file, where the behaviour checker reads them.
import type { StepTest } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import type { ShopScenario } from "./queue-scenario.js";
import { responseOf } from "./response.js";
import {
	joinUser,
	OPEN_SALE,
	openSale,
	type ShopLayer,
	secondsPass,
	userLimitIs,
} from "./shop-steps.js";
import {
	errorIs,
	type OutlineBinder,
	type ScenarioBinder,
	statusIs,
} from "./steps.js";

// The checks of a burst past its limit: the first requests are not limited, and the one that is limited says so, with how
// long to wait.
function burstChecks(
	{ Then, And }: Pick<StepTest, "Then" | "And">,
	world: ShopScenario,
): void {
	Then("the first {int} requests are not limited", (_ctx, count: number) => {
		const first = world.replies.slice(0, count);
		expect(first.map((reply) => reply.statusCode)).not.toContain(429);
	});

	And("the response status is {int}", statusIs(world));

	And("the error is {string}", errorIs(world));

	And(
		"a Retry-After header of at least {int} second is given",
		(_ctx, seconds: number) => {
			expect(
				Number(responseOf(world).headers["retry-after"]),
			).toBeGreaterThanOrEqual(seconds);
		},
	);
}

function limitsEveryRoute(layer: ShopLayer): OutlineBinder {
	return ({ Given, And, When, Then }, examples) => {
		const world = layer.newWorld();

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
		);

		And(
			"the limit is {int} requests per user in each {int} seconds",
			userLimitIs(world),
		);

		When('"ana" tries to <request> 4 times', async () => {
			await world.repeat(String(examples.request), "ana", 4);
		});

		burstChecks({ Then, And }, world);
	};
}

function otherUserUnaffected(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
		);

		And(
			"the limit is {int} requests per user in each {int} seconds",
			userLimitIs(world),
		);

		And(
			"{string} has tried to join the queue {int} times",
			async (_ctx, user: string, times: number) => {
				await world.repeat("join the queue", user, times);
			},
		);

		When("{string} joins the queue", joinUser(world));

		Then("the response status is {int}", statusIs(world));
	};
}

function addressLimited(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
		);

		And(
			"the limit is {int} requests per address in each {int} seconds",
			async (_ctx, requests: number, seconds: number) => {
				await world.setAddressLimit(requests, seconds);
			},
		);

		When(
			"{int} different shoppers join the queue from one address",
			async (_ctx, count: number) => {
				await world.joinMany(count);
			},
		);

		Then("{int} requests are accepted", (_ctx, count: number) => {
			expect(
				world.replies.filter((reply) => reply.statusCode !== 429),
			).toHaveLength(count);
		});

		And("{int} requests are limited", (_ctx, count: number) => {
			expect(
				world.replies.filter((reply) => reply.statusCode === 429),
			).toHaveLength(count);
		});
	};
}

function countStartsAgain(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(OPEN_SALE, async () =>
			openSale(world, layer.now, { stock: 10, sold: 0 }),
		);

		And(
			"the limit is {int} requests per user in each {int} seconds",
			userLimitIs(world),
		);

		And(
			"{string} has tried to join the queue {int} times",
			async (_ctx, user: string, times: number) => {
				await world.repeat("join the queue", user, times);
			},
		);

		When("{int} seconds pass", secondsPass(world));

		And("{string} joins the queue", joinUser(world));

		Then("the response status is {int}", statusIs(world));
	};
}

// The auth routes count the sign-ups and the logins of one address together, so a burst of either past the limit is refused.
function authBurstLimited(
	layer: ShopLayer,
	verb: "log in" | "sign up",
): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(
			"the limit is {int} logins per address in each {int} seconds",
			async (_ctx, requests: number, seconds: number) => {
				await world.setLoginLimit(requests, seconds);
			},
		);

		When(
			`{string} tries to ${verb} {int} times`,
			async (_ctx, user: string, times: number) => {
				await world.repeat(verb, user, times);
			},
		);

		burstChecks({ Then, And }, world);
	};
}

// The operator routes count by address before the login is read, so a client with no login is limited as well.
function operatorRoutesLimited(layer: ShopLayer): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const world = layer.newWorld();

		Given(
			"the limit is {int} requests per address in each {int} seconds",
			async (_ctx, requests: number, seconds: number) => {
				await world.setAddressLimit(requests, seconds);
			},
		);

		// The operator routes take no login, so the name sent is only a label for the request.
		When(
			"someone who is not logged in tries to list the sales {int} times",
			async (_ctx, times: number) => {
				await world.repeat("list the sales", "visitor", times);
			},
		);

		burstChecks({ Then, And }, world);
	};
}

// The steps of each scenario in the rate limit feature, by the scenario's name in the feature's own words.
export function bindRateLimitLimiting(layer: ShopLayer) {
	return {
		limitsEveryRoute: limitsEveryRoute(layer),
		otherUserUnaffected: otherUserUnaffected(layer),
		addressLimited: addressLimited(layer),
		countStartsAgain: countStartsAgain(layer),
		loginsLimited: authBurstLimited(layer, "log in"),
		signUpsShareLimit: authBurstLimited(layer, "sign up"),
		operatorRoutesLimited: operatorRoutesLimited(layer),
	};
}
