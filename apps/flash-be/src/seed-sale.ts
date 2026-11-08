// Entry point: the seed command. It stores one sale for the demo and the tests, through the seed use case, and it does
// not check for overlap: that check belongs to an operator's create.
import { attemptAsync, Err, Ok, type Result } from "@flash/typekit";
import { failureMessage } from "./adapters/inbound/cli/failure-message.js";
import { parseSeedArgs } from "./adapters/inbound/cli/seed-args.js";
import { createSaleSeeder } from "./adapters/outbound/postgres/sale-seeder.js";
import { actorId } from "./adapters/outbound/postgres/users.js";
import { createSaleSeedService } from "./application/sale-seed-service.js";
import { config } from "./config.js";
import { SYSTEM_USERNAME } from "./domain/actors.js";
import { withDb } from "./with-db.js";

// Stores the sale and says which one it was. A bad option and a database failure are both values here.
async function seed(argv: string[]): Promise<Result<string, string>> {
	const input = parseSeedArgs(argv, new Date());
	if (input.isErr()) return new Err(input.error);
	const sale = await attemptAsync(
		() =>
			withDb(config.databaseUrl, async (db) =>
				// The seed command has no operator, so the system user is the author.
				createSaleSeedService(createSaleSeeder(db)).seed(
					input.value,
					await actorId(db, SYSTEM_USERNAME),
				),
			),
		Error,
	);
	if (sale.isErr()) return new Err(failureMessage(sale.error));
	return new Ok(`seeded sale ${sale.value.id}`);
}

// Usage: node dist/seed-sale.js --stock 100 [--name ...] [--starts-in-minutes 0] [--duration-minutes 60]
//        [--hold-seconds 120] [--admit-per-second 50]
const outcome = await seed(process.argv.slice(2));
if (outcome.isErr()) {
	console.error(outcome.error);
	process.exitCode = 1;
} else {
	console.log(outcome.value);
}
