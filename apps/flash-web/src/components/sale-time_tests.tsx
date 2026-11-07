// Unit tests for the sale time: the exact instant in the markup, and the text the server writes first.
import { cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { SaleTime } from "./sale-time";

afterEach(cleanup);

const ISO = "2026-06-01T11:05:00Z";

describe("SaleTime", () => {
	it("is first written in UTC, so the server and the browser agree", () => {
		const html = renderToStaticMarkup(<SaleTime iso={ISO} />);
		expect(html).toBe(`<time dateTime="${ISO}">1 Jun 2026, 11:05 UTC</time>`);
	});

	it("keeps the exact instant for tools and shows the viewer's time once it is alive", () => {
		const { container } = render(<SaleTime iso={ISO} />);
		const time = container.querySelector("time");
		expect(time?.getAttribute("datetime")).toBe(ISO);
		expect(time?.textContent).toContain("2026");
		expect(time?.textContent).not.toContain("UTC");
	});
});
