// Entry point (the outermost layer, with main, migrate and seed-sale): the command that makes an operator. Sign-up can
// only make shoppers, so the first operator comes from here. It checks the options before it opens the database, so a
// bad option is reported as a usage error even when the database is down. Then it asks the auth use case to make the
// account, with the system user as its author.
import { attemptAsync, Err, Ok, type Result } from "@flash/typekit";
import { failureMessage } from "./adapters/inbound/cli/failure-message.js";
import {
	operatorInputOf,
	parseOperatorArgs,
	refusalMessage,
} from "./adapters/inbound/cli/operator-args.js";
import { actorId } from "./adapters/outbound/postgres/users.js";
import { postgresAuth } from "./composition.js";
import { config } from "./config.js";
import { SYSTEM_USERNAME } from "./domain/actors.js";
import { withDb } from "./with-db.js";

// Makes the operator and says what happened in one line. A bad option, a refused name and a database failure are all
// values here, so the command decides how each one is printed.
async function createOperator(argv: string[]): Promise<Result<string, string>> {
	const args = parseOperatorArgs(argv);
	if (args.isErr()) return new Err(args.error);
	const input = operatorInputOf(args.value);
	if (input.isErr()) return new Err(refusalMessage(input.error, undefined));
	const { username, password } = input.value;
	const made = await attemptAsync(
		() =>
			withDb(config.databaseUrl, async (db) =>
				postgresAuth(db).createOperator(
					username,
					password,
					await actorId(db, SYSTEM_USERNAME),
				),
			),
		Error,
	);
	if (made.isErr()) return new Err(failureMessage(made.error));
	if (made.value.isErr()) {
		return new Err(refusalMessage(made.value.error, username));
	}
	return new Ok(`created operator ${made.value.value.username}`);
}

// Usage: node dist/create-operator.js --username ana --password "a long phrase" (or --username=ana --password=...)
const outcome = await createOperator(process.argv.slice(2));
if (outcome.isErr()) {
	console.error(outcome.error);
	process.exitCode = 1;
} else {
	console.log(outcome.value);
}
