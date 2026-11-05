import { buildApp, dependenciesFrom } from "../../app.js";
import { config } from "../../config.js";
import { createDb } from "../../db.js";
import { createRedis } from "../../redis.js";
import { type QueueScenario, queueRequests } from "./queue-world.js";
import { insertSale } from "./seed.js";

// The real app over the run's Postgres database and the test Redis index. Scenarios share the connections but each
// one has its own sale, so their queues never meet.
export async function openQueueIntegration() {
	const db = createDb(config.databaseUrl);
	const redis = await createRedis(config.redisUrl);
	const deps = dependenciesFrom(db, redis, config);
	const app = buildApp(deps);

	return {
		db,
		scenario(): QueueScenario {
			const scenario: QueueScenario = {
				saleId: "",
				response: undefined,
				tickets: new Map(),
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
				join: async () => {
					throw new Error("replaced below");
				},
				check: async () => {
					throw new Error("replaced below");
				},
				async admit(saleId = scenario.saleId) {
					await deps.queue.admitTick(saleId);
				},
				async loseQueue() {
					await redis.flushDb();
				},
			};
			return Object.assign(scenario, queueRequests(app, scenario));
		},
		async close() {
			await app.close();
			await redis.close();
			await db.destroy();
		},
	};
}
