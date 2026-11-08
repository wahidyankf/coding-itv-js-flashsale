// Turns a failure into the text a command prints. It is an inbound CLI adapter, so it only formats and changes nothing.
//
// pg raises an AggregateError with an empty message when no database address answers. Printed as is, that would be a
// blank line for the operator, so the reasons inside it are printed instead.

// Returns the text to print for a failure. An empty message would be a blank line, so an aggregate with none names its
// reasons.
export function failureMessage(error: Error): string {
	if (error.message !== "" || !(error instanceof AggregateError)) {
		return error.message;
	}
	const reasons = error.errors
		.map((reason: unknown) =>
			reason instanceof Error ? reason.message : String(reason),
		)
		.filter((reason) => reason !== "");
	return reasons.length > 0
		? `cannot reach the database: ${reasons.join("; ")}`
		: "cannot reach the database";
}
