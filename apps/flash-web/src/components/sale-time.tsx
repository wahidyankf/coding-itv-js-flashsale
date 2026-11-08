// Shared UI piece, used by the sale status card. Shows a time of the sale. The exact instant stays in the markup, so tools can read it.
import { useEffect, useState } from "react";
import { formatLocal, formatUtc } from "./format";

// The first text is UTC, so server and browser render the same text. It switches to the viewer's time after the first
// render in the browser.
export function SaleTime({ iso }: { iso: string }) {
	const [text, setText] = useState(() => formatUtc(iso));
	useEffect(() => setText(formatLocal(iso)), [iso]);
	return <time dateTime={iso}>{text}</time>;
}
