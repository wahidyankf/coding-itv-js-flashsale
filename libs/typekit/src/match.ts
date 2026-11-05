// Exhaustive matching. TypeScript has no match statement, so a union is closed with assertNever in the default branch:
// when a case is missing, the value there is not `never` and the call is a type error. The match methods of Result and
// Option do the same for their two sides, because a handler for each side is required.

export function assertNever(value: never): never {
	throw new Error(`Unexpected value: ${String(value)}`);
}
