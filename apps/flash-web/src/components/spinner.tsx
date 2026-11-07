// A small ring that turns while something is loading. It says nothing to a screen reader: the words next to it (or the
// busy state of the region) carry the message. With reduced motion it stands still.
export function Spinner() {
	return (
		<span
			aria-hidden="true"
			className="inline-block size-4 shrink-0 rounded-full border-2 border-current border-r-transparent motion-safe:animate-spin"
		/>
	);
}
