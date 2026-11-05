// A failure is a value the caller must handle, never an exception it might miss.
//
// A fallible function returns Result<T, E>: Ok with its value, or Err with a named fault. The caller takes it apart
// with match, or chains it: map and mapErr change one side, flatMap and flatMapErr continue with a step that may itself
// fail, and tap and tapErr look at one side and pass the result on unchanged.
//
// Both classes carry both type parameters, so every method has the same signature on Ok and on Err and can be called on
// the union. They are frozen and their fields are readonly, so a write is a type error and, at run time, a TypeError.
// The curried twins at the bottom (map, mapErr, ...) are the same operations for pipe: `result.map(f)`.

export class Ok<out T, out E = never> {
	readonly _tag = "ok" as const;
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

	flatMap<U, F>(step: (value: T) => Result<U, F>): Result<U, E | F> {
		return step(this.value);
	}

	flatMapErr<U, F>(_step: (error: E) => Result<U, F>): Result<T | U, F> {
		return new Ok(this.value);
	}

	tap(action: (value: T) => unknown): Result<T, E> {
		action(this.value);
		return this;
	}

	tapErr(_action: (error: E) => unknown): Result<T, E> {
		return this;
	}

	match<R>(handlers: { ok: (value: T) => R; err: (error: E) => R }): R {
		return handlers.ok(this.value);
	}
}

export class Err<out T = never, out E = never> {
	readonly _tag = "err" as const;
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

	flatMap<U, F>(_step: (value: T) => Result<U, F>): Result<U, E | F> {
		return new Err(this.error);
	}

	flatMapErr<U, F>(step: (error: E) => Result<U, F>): Result<T | U, F> {
		return step(this.error);
	}

	tap(_action: (value: T) => unknown): Result<T, E> {
		return this;
	}

	tapErr(action: (error: E) => unknown): Result<T, E> {
		action(this.error);
		return this;
	}

	match<R>(handlers: { ok: (value: T) => R; err: (error: E) => R }): R {
		return handlers.err(this.error);
	}
}

export type Result<T, E> = Ok<T, E> | Err<T, E>;

export function map<T, U, E>(
	transform: (value: T) => U,
): (result: Result<T, E>) => Result<U, E> {
	return (result) => result.map(transform);
}

export function mapErr<T, E, F>(
	transform: (error: E) => F,
): (result: Result<T, E>) => Result<T, F> {
	return (result) => result.mapErr(transform);
}

export function flatMap<T, U, E, F>(
	step: (value: T) => Result<U, F>,
): (result: Result<T, E>) => Result<U, E | F> {
	return (result) => result.flatMap(step);
}

export function flatMapErr<T, U, E, F>(
	step: (error: E) => Result<U, F>,
): (result: Result<T, E>) => Result<T | U, F> {
	return (result) => result.flatMapErr(step);
}

export function tap<T, E>(
	action: (value: T) => unknown,
): (result: Result<T, E>) => Result<T, E> {
	return (result) => result.tap(action);
}

export function tapErr<T, E>(
	action: (error: E) => unknown,
): (result: Result<T, E>) => Result<T, E> {
	return (result) => result.tapErr(action);
}

export function match<T, E, R>(handlers: {
	ok: (value: T) => R;
	err: (error: E) => R;
}): (result: Result<T, E>) => R {
	return (result) => result.match(handlers);
}
