import { config } from "./config.js";
import { createDb } from "./db.js";
import { parseSeedArgs, seedSale } from "./sales/seed.js";

// Usage: node dist/seed-sale.js --stock 100 [--name ...] [--starts-in-minutes 0] [--duration-minutes 60]
//        [--hold-seconds 120] [--admit-per-second 50]
try {
	const input = parseSeedArgs(process.argv.slice(2), new Date());
	const db = createDb(config.databaseUrl);
	try {
		console.log(`seeded sale ${await seedSale(db, input)}`);
	} finally {
		await db.destroy();
	}
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
}
