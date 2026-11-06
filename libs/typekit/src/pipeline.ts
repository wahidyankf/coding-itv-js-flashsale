// pipe(value, f1, f2) is f2(f1(value)) written in the order it runs. It takes one to nine functions, each typed from
// the one before, so a mismatched stage is a type error at the stage. A longer chain nests:
// pipe(pipe(value, f1, ..., f9), f10) loses no type. The curried combinators of result are the stages that make pipe
// chain a Result.

export function pipe<A, B>(value: A, f1: (input: A) => B): B;
export function pipe<A, B, C>(
	value: A,
	f1: (input: A) => B,
	f2: (input: B) => C,
): C;
export function pipe<A, B, C, D>(
	value: A,
	f1: (input: A) => B,
	f2: (input: B) => C,
	f3: (input: C) => D,
): D;
export function pipe<A, B, C, D, E>(
	value: A,
	f1: (input: A) => B,
	f2: (input: B) => C,
	f3: (input: C) => D,
	f4: (input: D) => E,
): E;
export function pipe<A, B, C, D, E, F>(
	value: A,
	f1: (input: A) => B,
	f2: (input: B) => C,
	f3: (input: C) => D,
	f4: (input: D) => E,
	f5: (input: E) => F,
): F;
export function pipe<A, B, C, D, E, F, G>(
	value: A,
	f1: (input: A) => B,
	f2: (input: B) => C,
	f3: (input: C) => D,
	f4: (input: D) => E,
	f5: (input: E) => F,
	f6: (input: F) => G,
): G;
export function pipe<A, B, C, D, E, F, G, H>(
	value: A,
	f1: (input: A) => B,
	f2: (input: B) => C,
	f3: (input: C) => D,
	f4: (input: D) => E,
	f5: (input: E) => F,
	f6: (input: F) => G,
	f7: (input: G) => H,
): H;
export function pipe<A, B, C, D, E, F, G, H, I>(
	value: A,
	f1: (input: A) => B,
	f2: (input: B) => C,
	f3: (input: C) => D,
	f4: (input: D) => E,
	f5: (input: E) => F,
	f6: (input: F) => G,
	f7: (input: G) => H,
	f8: (input: H) => I,
): I;
export function pipe<A, B, C, D, E, F, G, H, I, J>(
	value: A,
	f1: (input: A) => B,
	f2: (input: B) => C,
	f3: (input: C) => D,
	f4: (input: D) => E,
	f5: (input: E) => F,
	f6: (input: F) => G,
	f7: (input: G) => H,
	f8: (input: H) => I,
	f9: (input: I) => J,
): J;
export function pipe(
	value: unknown,
	...functions: ((input: never) => unknown)[]
): unknown {
	let current = value;
	for (const next of functions)
		current = (next as (input: unknown) => unknown)(current);
	return current;
}
