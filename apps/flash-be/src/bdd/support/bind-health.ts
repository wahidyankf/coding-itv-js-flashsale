// The steps of specs/apps/flash/be/behaviours/health/readiness.feature, as both layers bind them. What a scenario does to
// the app (Postgres or Redis stops answering, Redis drops the connection) is the layer's HealthWorld. Liveness stays in
// each layer's test file, because at the unit layer its dependencies are down and no other scenario is.
import { expect } from "vitest";
import { type ReplyBox, type Response, responseOf } from "./response.js";
import { type ScenarioBinder, statusIs } from "./steps.js";

// The actions the readiness and recovery scenarios take on the app, whatever the layer.
export type HealthWorld = {
	// Given: Postgres does not answer the app.
	breakDatabase: () => Promise<void>;
	// Given: Redis does not answer the app.
	breakRedis: () => Promise<void>;
	// Given: the API is running and Redis answers.
	startApi: () => Promise<void>;
	// When: Redis drops the API's connection.
	dropRedisConnection: () => Promise<void>;
	// And: Redis reconnects.
	redisReconnects: () => Promise<void>;
	// A request to the app as the scenario has left it.
	get: (url: string) => Promise<Response>;
};

// The checks the readiness reply reports, for the database and for Redis.
function checksAre(holder: ReplyBox, database: string, redis: string) {
	return () => {
		expect(responseOf(holder).json().checks).toEqual({ database, redis });
	};
}

function readyOk(newWorld: () => HealthWorld): ScenarioBinder {
	return ({ When, Then, And }) => {
		const world = newWorld();
		const last: ReplyBox = { response: undefined };

		When("a client sends GET /ready", async () => {
			last.response = await world.get("/ready");
		});
		Then("the response status is {int}", statusIs(last));
		And(
			'the readiness checks report database "ok" and redis "ok"',
			checksAre(last, "ok", "ok"),
		);
	};
}

function postgresFails(newWorld: () => HealthWorld): ScenarioBinder {
	return ({ Given, When, Then, And }) => {
		const world = newWorld();
		const last: ReplyBox = { response: undefined };

		Given("Postgres does not answer", () => world.breakDatabase());
		When("a client sends GET /ready", async () => {
			last.response = await world.get("/ready");
		});
		Then("the response status is {int}", statusIs(last));
		And(
			'the readiness checks report database "error" and redis "ok"',
			checksAre(last, "error", "ok"),
		);
	};
}

function redisFails(newWorld: () => HealthWorld): ScenarioBinder {
	return ({ Given, When, Then, And }) => {
		const world = newWorld();
		const last: ReplyBox = { response: undefined };

		Given("Redis does not answer", () => world.breakRedis());
		When("a client sends GET /ready", async () => {
			last.response = await world.get("/ready");
		});
		Then("the response status is {int}", statusIs(last));
		And(
			'the readiness checks report database "ok" and redis "error"',
			checksAre(last, "ok", "error"),
		);
	};
}

function recoversAfterDrop(newWorld: () => HealthWorld): ScenarioBinder {
	return ({ Given, When, And, Then }) => {
		const world = newWorld();
		const last: ReplyBox = { response: undefined };

		Given("the API is running and Redis answers", () => world.startApi());
		When("Redis drops the API's connection", () => world.dropRedisConnection());
		And("Redis reconnects", () => world.redisReconnects());
		And("a client sends GET /ready", async () => {
			last.response = await world.get("/ready");
		});
		Then("the response status is {int}", statusIs(last));
		And(
			'the readiness checks report database "ok" and redis "ok"',
			checksAre(last, "ok", "ok"),
		);
	};
}

// The steps of each readiness scenario, by the scenario's name in the feature's own words.
export function bindHealthReadiness(newWorld: () => HealthWorld) {
	return {
		readyOk: readyOk(newWorld),
		postgresFails: postgresFails(newWorld),
		redisFails: redisFails(newWorld),
		recoversAfterDrop: recoversAfterDrop(newWorld),
	};
}
