// Plain Vitest tests for the timer helper. Fake timers stand in for the clock, so a test shows when a wait ends without
// real time passing. The helper is the only part of the library that starts a timer.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sleep } from "./timers.js";

describe("sleep", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("resolves once the given milliseconds have passed, and not before", async () => {
		const done = vi.fn();
		void sleep(100).then(done);
		await vi.advanceTimersByTimeAsync(99);
		expect(done).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(done).toHaveBeenCalledOnce();
	});

	it("resolves at once when the signal aborts, and clears its timer", async () => {
		const controller = new AbortController();
		const done = vi.fn();
		const pending = sleep(1000, controller.signal).then(done);
		expect(vi.getTimerCount()).toBe(1);
		controller.abort();
		await pending;
		expect(done).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("resolves at once for a signal that is already aborted, and starts no timer", async () => {
		const controller = new AbortController();
		controller.abort();
		await sleep(1000, controller.signal);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("waits the full time when the signal never aborts", async () => {
		const controller = new AbortController();
		const done = vi.fn();
		void sleep(100, controller.signal).then(done);
		await vi.advanceTimersByTimeAsync(100);
		expect(done).toHaveBeenCalledOnce();
	});
});
