// Reads the options of the create-operator command. It only reads the text; the name and the password are checked by
// the auth use case, so the rule is in one place.
import { parseArgs } from "node:util";

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
