// Wraps an object so that every method fails while `isDown()` is true, the way a Redis that is unreachable does.
// The failure is a rejected promise that is already handled, so a caller that never awaits it does not crash the run.
export function switchable<T extends object>(
	target: T,
	isDown: () => boolean,
): T {
	return new Proxy(target, {
		get(object, property) {
			const value = Reflect.get(object, property);
			if (typeof value !== "function") return value;
			return (...args: unknown[]) => {
				if (isDown()) {
					const failure = Promise.reject(new Error("redis is down"));
					failure.catch(() => {});
					return failure;
				}
				return value.apply(object, args);
			};
		},
	});
}
