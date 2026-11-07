// The look of the cards, buttons and fields, shared by the sale and the login so they match.
export const CARD =
	"rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 dark:border-slate-800 dark:bg-slate-900";
export const FOCUS =
	"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 dark:focus-visible:outline-sky-400";
export const BUTTON = `inline-flex h-11 items-center justify-center gap-2 rounded-lg px-4 text-base font-medium motion-safe:transition-colors disabled:cursor-not-allowed ${FOCUS}`;
export const PRIMARY = `${BUTTON} bg-sky-700 text-white hover:bg-sky-800 disabled:bg-slate-200 disabled:text-slate-500 disabled:hover:bg-slate-200 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 dark:disabled:bg-slate-800 dark:disabled:text-slate-500 dark:disabled:hover:bg-slate-800`;
export const OUTLINE =
	"border border-slate-300 text-slate-800 hover:bg-slate-100 disabled:text-slate-500 disabled:hover:bg-transparent dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800 dark:disabled:text-slate-500 dark:disabled:hover:bg-transparent";
export const FIELD = `h-11 rounded-lg border border-slate-300 bg-white px-3 text-base font-normal text-slate-900 placeholder:text-slate-400 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 ${FOCUS}`;
