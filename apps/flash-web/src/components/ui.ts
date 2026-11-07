// The look of the cards, buttons, fields and messages, shared by the sale and the login so they match. Each value is a
// list of Tailwind classes; the components only name the look they want. Class names are written out in full here,
// so Tailwind can find them.

// A card with a border, and a size that works from a phone to a desktop.
export const CARD =
	"rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 dark:border-slate-800 dark:bg-slate-900";
// The outline a focused control shows, so keyboard users can see where they are.
export const FOCUS =
	"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 dark:focus-visible:outline-sky-400";
// The base of every button: size, shape, text, and the focus outline.
export const BUTTON = `inline-flex h-11 items-center justify-center gap-2 rounded-lg px-4 text-base font-medium motion-safe:transition-colors disabled:cursor-not-allowed ${FOCUS}`;
// The main action: a filled button. Disabled looks grey, and the words still say what it is.
export const PRIMARY = `${BUTTON} bg-sky-700 text-white hover:bg-sky-800 disabled:bg-slate-200 disabled:text-slate-500 disabled:hover:bg-slate-200 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 dark:disabled:bg-slate-800 dark:disabled:text-slate-500 dark:disabled:hover:bg-slate-800`;
// The outline colours of a secondary control, without the button's size, so a tab can keep its own size.
export const OUTLINE =
	"border border-slate-300 text-slate-800 hover:bg-slate-100 disabled:text-slate-500 disabled:hover:bg-transparent dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800 dark:disabled:text-slate-500 dark:disabled:hover:bg-transparent";
// A secondary action: an outline button.
export const SECONDARY_BUTTON = `${BUTTON} ${OUTLINE}`;
// The purchase step: an outline until it can be pressed, then a filled green button, so the one step that pays stands out.
export const CONFIRM = `${SECONDARY_BUTTON} enabled:border-transparent enabled:bg-emerald-700 enabled:text-white enabled:hover:bg-emerald-800 dark:enabled:bg-emerald-500 dark:enabled:text-slate-950 dark:enabled:hover:bg-emerald-400`;
// A text field, sized to match the buttons.
export const FIELD = `h-11 rounded-lg border border-slate-300 bg-white px-3 text-base font-normal text-slate-900 placeholder:text-slate-400 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 ${FOCUS}`;

// Secondary text: labels, hints and the words around a value.
export const MUTED_TEXT = "text-slate-600 dark:text-slate-400";
// A value the shopper reads at a glance.
export const STRONG_TEXT = "text-slate-900 dark:text-slate-100";
// The box of a sentence that answers the shopper: a notice, an error, or the line under the buttons. Add a TONE to colour it.
export const MESSAGE_BOX = "rounded-lg px-3 py-2.5 text-sm leading-6";

// Colour pairs for badges and messages, light and dark. The words beside them always say the same, so colour is never
// the only signal.
export const TONE = {
	amber: "bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-200",
	emerald:
		"bg-emerald-100 text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-200",
	rose: "bg-rose-100 text-rose-900 dark:bg-rose-400/15 dark:text-rose-200",
	slate: "bg-slate-200 text-slate-800 dark:bg-slate-700/60 dark:text-slate-200",
};
