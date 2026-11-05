// The one place typekit catches an exception, so product code writes no catch of its own.
//
// attempt and attemptAsync turn a call that may throw into a Result. The failures to catch are named at the call site as
// guards: an error class (matched with instanceof) or a predicate wrapped by satisfying. Only a thrown value that a
// guard accepts becomes Err, and the fault is that value itself. Anything else is thrown on unchanged. There is no
// default guard and no catch-all, so naming none is a type error and, at run time, a TypeError.

import { Err, Ok, type Result } from "./result.js";

type ErrorClass<E> = abstract new (...args: never[]) => E;

export type Predicate<E> = {
	readonly test: (thrown: unknown) => thrown is E;
};

export type Guard<E> = ErrorClass<E> | Predicate<E>;

type Guards = readonly [Guard<unknown>, ...Guard<unknown>[]];

// The union of what a list of guards accepts.
export type Caught<G> =
	G extends ErrorClass<infer E> ? E : G extends Predicate<infer E> ? E : never;

// Guards a thrown value that is not an instance of a class, such as a string.
export function satisfying<E>(
	test: (thrown: unknown) => thrown is E,
): Predicate<E> {
	return { test };
}

// The fault is the thrown value itself; the guard that accepted it is what makes it a Caught<G>.
function caughtBy<G extends Guard<unknown>>(
	thrown: unknown,
	guards: readonly G[],
): { fault: Caught<G> } | undefined {
	const accepted = guards.some((guard) =>
		typeof guard === "function" ? thrown instanceof guard : guard.test(thrown),
	);
	return accepted ? { fault: thrown as Caught<G> } : undefined;
}

function requireGuard(guards: readonly unknown[]): void {
	if (guards.length === 0) {
		throw new TypeError(
			"attempt needs at least one guard for the failure it expects",
		);
	}
}

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
