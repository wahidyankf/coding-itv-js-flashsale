// Where a payload from flash-be did not decode: the reply or the stream event it came in, the field, and what that field
// should have been. The page drops or refuses such a payload, so the shopper sees no sign of it; this report is for the
// developer, and it goes to the console by default. It never carries the value, because a value may hold a user name,
// a token or a whole body.
// Decision: docs/explanation/decisions/018-decode-payloads-at-the-edge.md (why a payload is checked where it arrives).

// One failed decode. `source` is the URL of a reply, or the URL of a stream and the event name of its frame.
export type DecodeFailure = { source: string; path: string; expected: string };

// Takes one report. A reporter must not throw, because a report must never change what the shopper sees.
export type Reporter = (failure: DecodeFailure) => void;

// The default reporter: one warning line in the browser console, or in the server log.
export const reportDecodeFailure: Reporter = ({ source, path, expected }) => {
	const where = path === "" ? "the top level" : `field "${path}"`;
	console.warn(
		`flash-web: ${source} sent a value that did not decode at ${where}, expected ${expected}.`,
	);
};
