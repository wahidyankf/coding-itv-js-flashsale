import { buildApp, dependenciesFrom } from "../../app.js";
import { systemClock } from "../../clock.js";
import { config } from "../../config.js";
import { createDb } from "../../db.js";
import { createRedisQueueStore } from "../../queue/redis-queue-store.js";
import { createRedis } from "../../redis.js";
import { createRedisHoldGate } from "../../reservations/redis-hold-gate.js";
import { createReservationRepository } from "../../reservations/reservation-repository.js";
import { createReservationService } from "../../reservations/reservation-service.js";
import {
	queueRequests,
	reserveRequests,
	type ShopScenario,
} from "./queue-world.js";
import { insertSale } from "./seed.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The real app over the run's Postgres database and the test Redis index. Scenarios share the connections but each
// one has its own sale, so their queues and holds never meet.
export async function openQueueIntegration() {
	const db = createDb(config.databaseUrl);
	const redis = await createRedis(config.redisUrl);
	const base = dependenciesFrom(db, redis, config);

	// A second database handle that points at a port nobody listens on. Saving through it fails the way an
	// unreachable Postgres does, while the rest of the app keeps its working connection.
	const unreachable = new URL(config.databaseUrl);
	unreachable.port = "1";
	const closedDb = createDb(unreachable.toString());
	const working = createReservationRepository(db);
	const failing = createReservationRepository(closedDb);
	let broken = false;
	const reservations = createReservationService(
		createRedisHoldGate(redis),
		{
			save: (row) => (broken ? failing : working).save(row),
			rebuild: (saleId, now, restore) => working.rebuild(saleId, now, restore),
		},
		base.sales,
		base.queue,
		systemClock,
	);
	const app = buildApp({ ...base, reservations });
	const queueStore = createRedisQueueStore(redis);

	return {
		db,
		scenario(): ShopScenario {
			const scenario: ShopScenario = {
				saleId: "",
				response: undefined,
				tickets: new Map(),
				holds: new Map(),
				async addSale(overrides) {
					const now = new Date();
					scenario.saleId = await insertSale(db, {
						stock: overrides.stock,
						sold: overrides.sold,
						startsAt: overrides.startsAt ?? new Date(now.getTime() - 3_600_000),
						endsAt: overrides.endsAt ?? new Date(now.getTime() + 3_600_000),
					});
					return scenario.saleId;
				},
				async setAdmitRate(perSecond) {
					await db
						.updateTable("sales")
						.set({ admit_per_second: perSecond })
						.where("id", "=", scenario.saleId)
						.execute();
				},
				async setHoldSeconds(seconds) {
					await db
						.updateTable("sales")
						.set({ reservation_ttl_seconds: seconds })
						.where("id", "=", scenario.saleId)
						.execute();
				},
				join: notWired,
				check: notWired,
				reserve: notWired,
				reserveAll: notWired,
				async admit(saleId = scenario.saleId) {
					await base.queue.admitTick(saleId);
				},
				async admitted(user) {
					await scenario.join(user);
					await queueStore.admit(scenario.saleId, 1000, new Date(), 600);
				},
				async admitMany(users) {
					for (const user of users) await scenario.join(user);
					await queueStore.admit(scenario.saleId, 1000, new Date(), 600);
				},
				async advance(seconds) {
					await sleep(seconds * 1000);
				},
				async loseQueue() {
					await redis.flushDb();
				},
				async loseReservationState() {
					const names = ["ready", "buyers", "holds", "ids", "rebuild-lock"];
					await redis.del(
						names.map((name) => `sale:${scenario.saleId}:${name}`),
					);
				},
				async breakWrites() {
					broken = true;
				},
				async fixWrites() {
					broken = false;
				},
			};
			return Object.assign(
				scenario,
				queueRequests(app, scenario),
				reserveRequests(app, scenario),
			);
		},
		async close() {
			await app.close();
			await redis.close();
			await db.destroy();
			await closedDb.destroy();
		},
	};
}

function notWired(): never {
	throw new Error("replaced when the scenario is built");
}
