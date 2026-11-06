// A failure is a value the caller must handle, never an exception it might miss.
//
// A fallible function returns Result<T, E>: Ok with its value, or Err with a named fault. The caller takes it apart
// with match, or with isOk and isErr. map and mapErr change one side and pass the other side on unchanged.
//
// Both classes carry both type parameters, so every method has the same signature on Ok and on Err and can be called on
// the union. They are frozen and their fields are readonly, so a write is a type error and, at run time, a TypeError.

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

export type Result<T, E> = Ok<T, E> | Err<T, E>;
