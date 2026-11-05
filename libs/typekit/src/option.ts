// Absence is undefined, presence is Some, and a value that may be absent is an Option.
//
// Option<T> is Some<T> | undefined. Absence is the native undefined, so a consumer narrows with `=== undefined` and
// strict TypeScript refuses to read through the value until it has. Option has no methods, because undefined cannot have
// any; it chains through pipe with the curried map, flatMap, tap, okOr and match of this module, each of which acts on a
// Some and passes undefined through.
//
// Some exists, rather than Option<T> = T | undefined, so that nested absence stays expressible: Some(undefined) is
// present and holds undefined, while undefined is absent. A Some is frozen like Ok.
//
// null is a value, not absence: fromOptional(null) is Some(null).

import { Err, Ok, type Result } from "./result.js";

export class Some<out T> {
	readonly _tag = "some" as const;
	readonly value: T;

	constructor(value: T) {
		this.value = value;
		Object.freeze(this);
	}
}

export type Option<T> = Some<T> | undefined;

// undefined stays absent; any other value, a falsy one included, becomes present as Some(value).
export function fromOptional<T>(value: T | undefined): Option<T> {
	return value === undefined ? undefined : new Some(value);
}

export function map<T, U>(
	transform: (value: T) => U,
): (option: Option<T>) => Option<U> {
	return (option) =>
		option === undefined ? undefined : new Some(transform(option.value));
}

export function flatMap<T, U>(
	step: (value: T) => Option<U>,
): (option: Option<T>) => Option<U> {
	return (option) => (option === undefined ? undefined : step(option.value));
}

export function tap<T>(
	action: (value: T) => unknown,
): (option: Option<T>) => Option<T> {
	return (option) => {
		if (option !== undefined) action(option.value);
		return option;
	};
}

export function okOr<T, E>(error: E): (option: Option<T>) => Result<T, E> {
	return (option) =>
		option === undefined ? new Err(error) : new Ok(option.value);
}

export function match<T, R>(handlers: {
	some: (value: T) => R;
	none: () => R;
}): (option: Option<T>) => R {
	return (option) =>
		option === undefined ? handlers.none() : handlers.some(option.value);
}
