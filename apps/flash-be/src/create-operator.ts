// Entry point: the command that makes an operator. Sign-up can only make shoppers, so the first operator comes from
// here. It reads the options, then asks the auth use case to make the account; the system user is the author.
import { attemptAsync } from "@flash/typekit";
import { parseOperatorArgs } from "./adapters/inbound/cli/operator-args.js";
import { createDb } from "./adapters/outbound/postgres/database.js";
import { actorId } from "./adapters/outbound/postgres/users.js";
import type { RegisterError } from "./application/auth-service.js";
import { postgresAuth } from "./composition.js";
import { config } from "./config.js";
import { SYSTEM_USERNAME } from "./domain/actors.js";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./domain/auth.js";
import { normalizeUser } from "./domain/user.js";

// The words the command prints for each refusal. They are part of the command's contract (the demo script reads the
// "already exists" line), so change them with care.
function refusal(error: RegisterError, username: string | undefined): string {
	switch (error) {
		case "invalid_user":
			return "--username is missing or not a valid name";
		case "invalid_password":
			return `--password must have ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters`;
		case "username_taken":
			return `the user ${normalizeUser(username)} already exists`;
	}
}

// Usage: node dist/create-operator.js --username ana --password "a long phrase" (or --username=ana --password=...)
const created = await attemptAsync(async () => {
	const args = parseOperatorArgs(process.argv.slice(2));
	const db = createDb(config.databaseUrl);
	try {
		const made = await postgresAuth(db).createOperator(
			args.username,
			args.password,
			await actorId(db, SYSTEM_USERNAME),
		);
		if (made.isErr()) throw new Error(refusal(made.error, args.username));
		console.log(`created operator ${made.value.username}`);
	} finally {
		await db.destroy();
	}
}, Error);
if (created.isErr()) {
	console.error(created.error.message);
	process.exitCode = 1;
}
