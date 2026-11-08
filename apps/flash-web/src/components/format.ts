// Browser and server. How a time of the sale is written. The server and the browser must write the same text for the first render, or React
// reports a mismatch, so the first text is fixed (English, UTC). The browser then swaps in the viewer's own time zone
// and language.
const UTC = new Intl.DateTimeFormat("en-GB", {
	dateStyle: "medium",
	timeStyle: "short",
	timeZone: "UTC",
});

const isDate = (date: Date) => !Number.isNaN(date.getTime());

// The first text of a sale time. Server and browser write the same UTC text, so React sees no mismatch.
export function formatUtc(iso: string): string {
	const date = new Date(iso);
	return isDate(date) ? `${UTC.format(date)} UTC` : iso;
}

// A sale time in the viewer's own zone and language.
export function formatLocal(iso: string): string {
	const date = new Date(iso);
	return isDate(date)
		? new Intl.DateTimeFormat(undefined, {
				dateStyle: "medium",
				timeStyle: "short",
			}).format(date)
		: iso;
}
