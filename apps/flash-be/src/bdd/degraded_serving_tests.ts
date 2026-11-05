import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { specFile } from "./support/paths.js";
import { queueWorld, type Response } from "./support/queue-world.js";
import { relativeTime } from "./support/time.js";

const NOW = new Date("2026-06-01T12:00:00Z");

// A scenario body runs once when the tests are collected, and each step then runs as its own test.
// Steps that repeat a pattern are bound by their exact text, so each one finds its own line.
function newWorld() {
	return queueWorld(NOW);
}

type World = ReturnType<typeof newWorld>;

function response(world: World): Response {
	if (!world.response) throw new Error("no request was sent");
	return world.response;
}

async function openSale(world: World, stock: number) {
	await world.addSale({
		stock,
		startsAt: relativeTime("1 hour ago", NOW),
		endsAt: relativeTime("in 1 hour", NOW),
	});
}

const SALE_10 =
	"a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour";
const SALE_2 =
	"a sale with stock 2 and 0 sold that opens 1 hour ago and closes in 1 hour";

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/degraded/serving.feature")),
	({ Scenario }) => {
		Scenario(
			"A shopper joining the queue gets a ticket and is admitted at once",
			({ Given, And, When, Then }) => {
				const world = newWorld();

				Given(SALE_10, async () => openSale(world, 10));

				And("Redis is down", async () => {
					await world.breakRedis();
				});

				When('"ana" joins the queue', async () => {
					await world.join("ana");
				});

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response(world).statusCode).toBe(status);
				});

				And("a ticket is issued", () => {
					expect(response(world).json().ticket).toBeTruthy();
				});

				And('"ana" is admitted', async () => {
					const reply = await world.check("ana", world.tickets.get("ana"));
					expect(reply.json().state).toBe("admitted");
				});
			},
		);

		Scenario("A shopper reserves an item", ({ Given, And, When, Then }) => {
			const world = newWorld();

			Given(SALE_10, async () => openSale(world, 10));

			And("Redis is down", async () => {
				await world.breakRedis();
			});

			And('"ana" has joined the queue', async () => {
				await world.join("ana");
			});

			When('"ana" reserves an item', async () => {
				await world.reserve("ana");
			});

			Then("the response status is {int}", (_ctx, status: number) => {
				expect(response(world).statusCode).toBe(status);
			});

			And("a reservation id is issued", () => {
				expect(response(world).json().reservationId).toMatch(/^[0-9a-f-]{36}$/);
			});

			And("the hold ends in {int} seconds", (_ctx, seconds: number) => {
				const ends = new Date(response(world).json().expiresAt).getTime();
				expect(ends).toBe(NOW.getTime() + seconds * 1000);
			});
		});

		Scenario(
			"Reserving again without Redis returns the same hold",
			({ Given, And, When, Then }) => {
				const world = newWorld();

				Given(SALE_10, async () => openSale(world, 10));

				And("Redis is down", async () => {
					await world.breakRedis();
				});

				And('"ana" has joined the queue', async () => {
					await world.join("ana");
				});

				And('"ana" has reserved an item', async () => {
					await world.reserve("ana");
				});

				When('"ana" reserves an item', async () => {
					await world.reserve("ana");
				});

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response(world).statusCode).toBe(status);
				});

				And(
					"the reservation is the one {string} had before",
					(_ctx, user: string) => {
						expect(response(world).json()).toEqual(world.holds.get(user));
					},
				);
			},
		);

		Scenario(
			"Many shoppers reserving at once without Redis never hold more than the stock",
			({ Given, And, When, Then }) => {
				const world = newWorld();
				const users = Array.from({ length: 30 }, (_, i) => `shopper${i}`);
				let replies: Response[] = [];

				Given(SALE_10, async () => openSale(world, 10));

				And("Redis is down", async () => {
					await world.breakRedis();
				});

				And(
					"{int} shoppers have been admitted",
					async (_ctx, count: number) => {
						await world.admitMany(users.slice(0, count));
					},
				);

				When(
					"all {int} shoppers reserve an item at the same time",
					async () => {
						replies = await world.reserveAll(users);
					},
				);

				Then("{int} reservations are granted", (_ctx, count: number) => {
					expect(replies.filter((r) => r.statusCode === 201)).toHaveLength(
						count,
					);
				});

				And(
					"{int} shoppers are told the item is sold out",
					(_ctx, count: number) => {
						const soldOut = replies.filter(
							(r) => r.statusCode === 409 && r.json().error === "sold_out",
						);
						expect(soldOut).toHaveLength(count);
					},
				);
			},
		);

		Scenario(
			"A shopper pays for a hold taken before Redis went down",
			({ Given, And, When, Then }) => {
				const world = newWorld();

				Given(SALE_10, async () => openSale(world, 10));

				And('"ana" has been admitted', async () => {
					await world.admitted("ana");
				});

				And('"ana" has reserved an item', async () => {
					await world.reserve("ana");
				});

				And("Redis is down", async () => {
					await world.breakRedis();
				});

				When('"ana" confirms the purchase', async () => {
					await world.confirm("ana");
				});

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response(world).statusCode).toBe(status);
				});

				And("a purchase id is issued", () => {
					expect(response(world).json().purchaseId).toMatch(/^[0-9a-f-]{36}$/);
				});

				And("{int} items remain", async (_ctx, remaining: number) => {
					expect((await world.saleView()).remaining).toBe(remaining);
				});
			},
		);

		Scenario(
			"Paying while Redis is down is not slowed down",
			({ Given, And, When, Then }) => {
				const world = newWorld();
				const times: number[] = [];

				// Each confirmation is timed, because a dependency that is down must not make a shopper wait.
				const timed = async (user: string) => {
					const started = performance.now();
					await world.confirm(user);
					times.push(performance.now() - started);
				};

				Given(SALE_10, async () => openSale(world, 10));

				And('"ana" has been admitted', async () => {
					await world.admitted("ana");
				});

				And('"ben" has been admitted', async () => {
					await world.admitted("ben");
				});

				And('"cai" has been admitted', async () => {
					await world.admitted("cai");
				});

				And('"ana" has reserved an item', async () => {
					await world.reserve("ana");
				});

				And('"ben" has reserved an item', async () => {
					await world.reserve("ben");
				});

				And('"cai" has reserved an item', async () => {
					await world.reserve("cai");
				});

				And("Redis is down", async () => {
					await world.breakRedis();
				});

				And("{int} seconds pass", async (_ctx, seconds: number) => {
					await world.advance(seconds);
				});

				When('"ana" confirms the purchase', async () => timed("ana"));

				And('"ben" confirms the purchase', async () => timed("ben"));

				And('"cai" confirms the purchase', async () => timed("cai"));

				Then(
					"every confirmation answered in less than {int} milliseconds",
					(_ctx, limit: number) => {
						expect(times).toHaveLength(3);
						expect(Math.max(...times)).toBeLessThan(limit);
					},
				);
			},
		);

		Scenario("Requests are still limited", ({ Given, And, When, Then }) => {
			const world = newWorld();

			Given(SALE_10, async () => openSale(world, 10));

			And(
				"the limit is {int} requests per user in each {int} seconds",
				async (_ctx, requests: number, seconds: number) => {
					await world.setUserLimit(requests, seconds);
				},
			);

			And("Redis is down", async () => {
				await world.breakRedis();
			});

			When('"ana" tries to join the queue 4 times', async () => {
				await world.repeat("join the queue", "ana", 4);
			});

			Then(
				"the first {int} requests are not limited",
				(_ctx, count: number) => {
					const first = world.replies.slice(0, count);
					expect(first.map((reply) => reply.statusCode)).not.toContain(429);
				},
			);

			And("the response status is {int}", (_ctx, status: number) => {
				expect(response(world).statusCode).toBe(status);
			});
		});

		Scenario(
			"A hold taken while Redis was down is counted when it comes back with its old data",
			({ Given, And, When, Then }) => {
				const world = newWorld();

				Given(SALE_2, async () => openSale(world, 2));

				And('"ana" has been admitted', async () => {
					await world.admitted("ana");
				});

				And('"ben" has been admitted', async () => {
					await world.admitted("ben");
				});

				And('"cai" has been admitted', async () => {
					await world.admitted("cai");
				});

				And('"ana" has reserved an item', async () => {
					await world.reserve("ana");
				});

				And("Redis is down", async () => {
					await world.breakRedis();
				});

				And('"ben" has reserved an item', async () => {
					await world.reserve("ben");
				});

				And("Redis is back with the data it had", async () => {
					await world.fixRedis();
				});

				When('"cai" reserves an item', async () => {
					await world.reserve("cai");
				});

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response(world).statusCode).toBe(status);
				});

				And("the error is {string}", (_ctx, error: string) => {
					expect(response(world).json().error).toBe(error);
				});
			},
		);

		Scenario(
			"A hold taken while Redis was down survives when it comes back with no data",
			({ Given, And, When, Then }) => {
				const world = newWorld();

				Given(SALE_2, async () => openSale(world, 2));

				And('"ana" has been admitted', async () => {
					await world.admitted("ana");
				});

				And('"ana" has reserved an item', async () => {
					await world.reserve("ana");
				});

				And("Redis is down", async () => {
					await world.breakRedis();
				});

				And('"ben" has joined the queue', async () => {
					await world.join("ben");
				});

				And('"ben" has reserved an item', async () => {
					await world.reserve("ben");
				});

				And("Redis is back with no data", async () => {
					await world.fixRedis();
					await world.loseQueue();
					await world.loseReservationState();
				});

				And('"cai" has been admitted', async () => {
					await world.admitted("cai");
				});

				When('"cai" reserves an item', async () => {
					await world.reserve("cai");
				});

				Then("the response status is {int}", (_ctx, status: number) => {
					expect(response(world).statusCode).toBe(status);
				});

				And("the error is {string}", (_ctx, error: string) => {
					expect(response(world).json().error).toBe(error);
				});
			},
		);
	},
);
