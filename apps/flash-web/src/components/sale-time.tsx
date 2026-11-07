// Shows a time of the sale. The exact instant stays in the markup, so tools can read it.
import { useEffect, useState } from "react";
import { formatLocal, formatUtc } from "./format";

// A time of the sale. It is a <time> element with the exact instant, so tools can read it. The text starts in UTC (the
// same on the server and in the browser) and turns into the viewer's local time once the page is alive.
export function SaleTime({ iso }: { iso: string }) {
	const [text, setText] = useState(() => formatUtc(iso));
	useEffect(() => setText(formatLocal(iso)), [iso]);
	return <time dateTime={iso}>{text}</time>;
}
