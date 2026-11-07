// The words a command prints for a failure it could not finish. Inbound CLI adapter: it turns an error into text for the
// terminal and changes nothing else.
//
// A database connection failure can arrive as an AggregateError with an empty message (pg raises it when no address of
// the database answers), so the operator would see an empty line. The reasons inside it are printed instead.

// The text for a failure. A failure with a message keeps it; an aggregate with none names its reasons, or says the
// database cannot be reached when it has none.
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
