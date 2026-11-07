import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HomePending } from "./index";

afterEach(cleanup);

describe("HomePending", () => {
	it("keeps the heading and tells a screen reader that the sale is loading", () => {
		render(<HomePending />);
		expect(screen.getByRole("heading", { name: "Flash Sale" })).toBeTruthy();
		const status = screen.getByRole("status");
		expect(status.textContent).toBe("Loading the sale…");
		expect(status.getAttribute("aria-busy")).toBe("true");
	});
});
