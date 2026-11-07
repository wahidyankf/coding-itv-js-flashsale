// The create-operator command as the CLI sees it: it reads the options, checks them with the same rules the use case
// uses, and words each refusal for the terminal. It is an inbound adapter, so it knows the command line and nothing of
// the database.
import { parseArgs } from "node:util";
import type { RegisterError } from "../../../application/auth-service.js";
import {
	PASSWORD_MAX_LENGTH,
	PASSWORD_MIN_LENGTH,
	usablePassword,
} from "../../../domain/auth.js";
import { normalizeUser } from "../../../domain/user.js";

// The two options as typed. A flag that was not given is undefined.
export type OperatorArgs = {
	username: string | undefined;
	password: string | undefined;
};

// Reads `--username` and `--password`, each as `--flag value` or `--flag=value`. Anything else is a usage error.
export function parseOperatorArgs(argv: string[]): OperatorArgs {
	const { values } = parseArgs({
		args: argv,
		options: {
			username: { type: "string" },
			password: { type: "string" },
		},
		strict: true,
	});
	return { username: values.username, password: values.password };
}

// Why these options cannot make an operator, or nothing when they can. It runs before the database is touched, so a bad
// option is never reported as a database failure. The use case checks the same rules again on the way in.
export function operatorArgsRefusal(
	args: OperatorArgs,
): RegisterError | undefined {
	if (normalizeUser(args.username) === undefined) return "invalid_user";
	if (usablePassword(args.password) === undefined) return "invalid_password";
	return undefined;
}

// The words the command prints for each refusal. They are part of the command's contract (the demo script reads the
// "already exists" line), so change them with care.
export function refusalMessage(
	error: RegisterError,
	username: string | undefined,
): string {
	switch (error) {
		case "invalid_user":
			return "--username is missing or not a valid name";
		case "invalid_password":
			return `--password must have ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters`;
		case "username_taken":
			return `the user ${normalizeUser(username)} already exists`;
	}
}
