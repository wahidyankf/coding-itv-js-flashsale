import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BackendStatusView } from "./backend-status";

// Vitest globals are off, so cleanup must run after each test.
afterEach(() => {
	cleanup();
});

describe("BackendStatusView", () => {
	it("shows the backend status", () => {
		render(<BackendStatusView status="ok" />);

		expect(screen.getByText("ok")).toBeTruthy();
		expect(screen.getByText(/Backend:/)).toBeTruthy();
	});

	it("shows down when the backend is unreachable", () => {
		render(<BackendStatusView status="down" />);

		expect(screen.getByText("down")).toBeTruthy();
	});
});
