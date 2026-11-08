// A failure is a value the caller must handle, never an exception it might miss.
//
// Both classes carry both type parameters, so every method has one signature on Ok and Err and works on the union.
// They are frozen, so a write fails at run time. boundary.ts is the one place a throw becomes an Err.

// The success side of a Result. The value is reachable only after isOk or match narrows the union, so a caller cannot skip the check.
export class Ok<out T, out E = never> {
	readonly value: T;

	constructor(value: T) {
		this.value = value;
		Object.freeze(this);
	}

	isOk(): this is Ok<T, E> {
		return true;
	}

	isErr(): this is Err<T, E> {
		return false;
	}

	map<U>(transform: (value: T) => U): Result<U, E> {
		return new Ok(transform(this.value));
	}

	mapErr<F>(_transform: (error: E) => F): Result<T, F> {
		return new Ok(this.value);
	}

	match<R>(handlers: { ok: (value: T) => R; err: (error: E) => R }): R {
		return handlers.ok(this.value);
	}
}

// The failure side of a Result. It holds a named fault, not an exception, so the failure is in the type and no caller can miss it.
export class Err<out T = never, out E = never> {
	readonly error: E;

	constructor(error: E) {
		this.error = error;
		Object.freeze(this);
	}

	isOk(): this is Ok<T, E> {
		return false;
	}

	isErr(): this is Err<T, E> {
		return true;
	}

	map<U>(_transform: (value: T) => U): Result<U, E> {
		return new Err(this.error);
	}

	mapErr<F>(transform: (error: E) => F): Result<T, F> {
		return new Err(transform(this.error));
	}

	match<R>(handlers: { ok: (value: T) => R; err: (error: E) => R }): R {
		return handlers.err(this.error);
	}
}

// A fallible call's answer: Ok with the value, or Err with the fault. The fault type E is part of the signature, so every
// failure a caller must handle is visible in the type.
export type Result<T, E> = Ok<T, E> | Err<T, E>;
