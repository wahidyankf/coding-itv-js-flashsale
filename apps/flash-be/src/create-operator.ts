// Entry point (the outermost layer, with main, migrate and seed-sale): the command that makes an operator. Sign-up can
// only make shoppers, so the first operator comes from here. It checks the options before it opens the database, so a
// bad option is reported as a usage error even when the database is down. Then it asks the auth use case to make the
// account, with the system user as its author.
import { attemptAsync } from "@flash/typekit";
import { failureMessage } from "./adapters/inbound/cli/failure-message.js";
import {
	operatorInputOf,
	parseOperatorArgs,
	refusalMessage,
} from "./adapters/inbound/cli/operator-args.js";
import { createDb } from "./adapters/outbound/postgres/database.js";
import { actorId } from "./adapters/outbound/postgres/users.js";
import { postgresAuth } from "./composition.js";
import { config } from "./config.js";
import { SYSTEM_USERNAME } from "./domain/actors.js";

// Usage: node dist/create-operator.js --username ana --password "a long phrase" (or --username=ana --password=...)
const created = await attemptAsync(async () => {
	const args = parseOperatorArgs(process.argv.slice(2));
	const input = operatorInputOf(args);
	if (input.isErr()) {
		throw new Error(refusalMessage(input.error, undefined));
	}
	const db = createDb(config.databaseUrl);
	try {
		const made = await postgresAuth(db).createOperator(
			input.value.username,
			input.value.password,
			await actorId(db, SYSTEM_USERNAME),
		);
		if (made.isErr()) {
			throw new Error(refusalMessage(made.error, input.value.username));
		}
		console.log(`created operator ${made.value.username}`);
	} finally {
		await db.destroy();
	}
}, Error);
if (created.isErr()) {
	console.error(failureMessage(created.error));
	process.exitCode = 1;
}
