// The one place typekit catches an exception, so product code writes no catch of its own.
//
// attempt and attemptAsync turn a call that may throw into a Result. The failures to catch are named at the call site as
// error classes. Only a thrown value that is an instance of one of them becomes Err, and the fault is that value itself.
// Anything else is thrown on unchanged. There is no default guard and no catch-all, so naming none is a type error and,
// at run time, a TypeError. It sits between the callers and the Result type in result.ts.

import { Err, Ok, type Result } from "./result.js";

type ErrorClass<E> = abstract new (...args: never[]) => E;

type Guards = readonly [ErrorClass<unknown>, ...ErrorClass<unknown>[]];

// The union of the error classes that a list of guards names.
type Caught<G> = G extends ErrorClass<infer E> ? E : never;

// The fault is the thrown value itself; the class that accepted it is what makes it a Caught<G>.
function caughtBy<G extends ErrorClass<unknown>>(
	thrown: unknown,
	guards: readonly G[],
): { fault: Caught<G> } | undefined {
	const accepted = guards.some((guard) => thrown instanceof guard);
	return accepted ? { fault: thrown as Caught<G> } : undefined;
}

function requireGuard(guards: readonly unknown[]): void {
	if (guards.length === 0) {
		throw new TypeError(
			"attempt needs at least one guard for the failure it expects",
		);
	}
}

// Runs a call that may throw and returns its outcome as a Result. Only the error classes the caller names become Err;
// any other exception is rethrown, so a bug is never hidden as a failure. At least one class must be named.
export function attempt<T, const G extends Guards>(
	call: () => T,
	...guards: G
): Result<T, Caught<G[number]>> {
	requireGuard(guards);
	try {
		return new Ok(call());
	} catch (thrown) {
		const caught = caughtBy<G[number]>(thrown, guards);
		if (caught) return new Err(caught.fault);
		throw thrown;
	}
}

// The async form of attempt, for a call that returns a promise. The same rule holds: only the named classes become Err,
// and any other rejection is rethrown.
export async function attemptAsync<T, const G extends Guards>(
	call: () => PromiseLike<T>,
	...guards: G
): Promise<Result<T, Caught<G[number]>>> {
	requireGuard(guards);
	try {
		return new Ok(await call());
	} catch (thrown) {
		const caught = caughtBy<G[number]>(thrown, guards);
		if (caught) return new Err(caught.fault);
		throw thrown;
	}
}
