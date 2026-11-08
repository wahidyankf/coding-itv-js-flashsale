# Tailwind CSS crash course

Tailwind CSS is a set of small utility classes, such as `rounded-lg` or `sm:p-6`, that you write on the elements
themselves. At build time it reads the source files and writes a stylesheet with only the classes they use. `flash-web`
uses Tailwind 4 through the Vite plugin `@tailwindcss/vite`.

## Why this repo uses it

**The problem.** The page has a few cards, buttons and messages, and the rules in [AGENTS.md](../../../AGENTS.md) ask a lot
of them: readable from a phone to a desktop, in light and in dark mode, and colour is never the only signal. With
utility classes, the size and both colour schemes of an element sit on that element, so a reviewer sees all three in one
place, and there is no stylesheet that can drift away from the components.

**What we did not pick.** No decision record compares styling tools. The repository rules forbid inline style blocks and
a second CSS library, and keep `src/styles.css` to the Tailwind import and one `color-scheme` rule.

**What it costs.** Class lists get long, and every colour is written twice (`dark:`).

## The ideas this repo uses

### One import, no theme file

[`src/styles.css`](../../../apps/flash-web/src/styles.css) imports Tailwind and sets `color-scheme`, so form controls
and scrollbars follow the system theme. There is no `tailwind.config` file: Tailwind 4 needs none.
[`vite.config.ts`](../../../apps/flash-web/vite.config.ts) adds `tailwindcss()` to the plugins.

```css
@import "tailwindcss";

/* Form controls and scrollbars follow the system theme; the classes in the components handle the rest. */
@layer base {
	:root {
		color-scheme: light dark;
	}
}
```

### Utility classes on the element

The root document loads the stylesheet and sets the page colours on `<body>`
([`__root.tsx`](../../../apps/flash-web/src/routes/__root.tsx)):

```tsx
<body className="min-h-screen bg-stone-50 font-sans text-slate-800 antialiased dark:bg-slate-950 dark:text-slate-200">
```

### Named class lists for a shared look

[`components/ui.ts`](../../../apps/flash-web/src/components/ui.ts) keeps the look of cards, buttons, fields and messages
as constant strings, so the sale and the login match. A component names the look it wants, such as `CARD` or `PRIMARY`:

```ts
export const CARD =
	"rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 dark:border-slate-800 dark:bg-slate-900";
```

### From a phone to a desktop

A class without a prefix is the phone layout. `sm:`, `md:` and `lg:` add rules from a minimum width up. The home page
grows its padding and its title ([`routes/index.tsx`](../../../apps/flash-web/src/routes/index.tsx)), and the sale page
puts its two cards side by side from `md:` ([`sale-page.tsx`](../../../apps/flash-web/src/sale-page.tsx)):

```tsx
<main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-12 lg:py-16">
<section aria-labelledby="sale-name" className="grid gap-5 md:grid-cols-2 md:items-start md:gap-6">
```

### Dark mode

A `dark:` class applies when the system asks for a dark theme (`prefers-color-scheme`). The page has no theme switch,
and `styles.css` does not change the `dark` variant. The colour pairs in `TONE` give each tone a light and a dark form.

### Colour is never the only signal

The status badge has a colour per status, but the word is always on screen
([`sale-status-card.tsx`](../../../apps/flash-web/src/sale/sale-status-card.tsx)). The backend dot is hidden from
screen readers, and the word next to it says the same
([`backend-status.tsx`](../../../apps/flash-web/src/components/backend-status.tsx)):

```tsx
export function BackendStatusView({ status }: { status: BackendStatus }) {
	return (
		<p className={`mt-8 text-sm ${MUTED_TEXT}`}>
			<span
				aria-hidden="true"
				className={`mr-2 inline-block size-2 rounded-full align-middle ${status === "ok" ? "bg-emerald-600 dark:bg-emerald-400" : "bg-rose-600 dark:bg-rose-400"}`}
			/>
			Backend: <strong className="font-medium">{status}</strong>
		</p>
	);
}
```

Motion follows the shopper's setting too: every animation and transition uses `motion-safe:`, such as
`motion-safe:animate-pulse` on the loading cards. State can come from ARIA as well: the login tabs in
[`auth-card.tsx`](../../../apps/flash-web/src/auth/auth-card.tsx) fill in with `aria-pressed:bg-sky-700`, so the look
follows the same attribute a screen reader reads.

## Try it here

Start the page and keep it running. Skip this if `npm run demo:dev` already serves it on port 3000:

```bash
npx nx dev flash-web
```

In a second terminal, ask Vite for the stylesheet it built from the classes in the components:

```bash
curl 'localhost:3000/src/styles.css?direct'
```

The output starts with the version, and each prefix becomes a media query (trimmed):

```text
/*! tailwindcss v4.3.4 | MIT License | https://tailwindcss.com */
  @media (width >= 40rem) {
    .sm\:mb-8 {
      margin-bottom: calc(var(--spacing) * 8);
    }
  @media (prefers-color-scheme: dark) {
    .dark\:border-amber-400\/30 {
```

`sm:` is `40rem`, `md:` is `48rem` and `lg:` is `64rem`. Stop the dev page with Ctrl+C when you are done, if you started it.

## Traps to avoid

- **Class names built from pieces.** Tailwind reads the files as text, so `` `bg-${tone}-100` `` never becomes a class.
  `ui.ts` writes every class out in full, and `sale-status-card.tsx` maps each status to a full class list (`BADGE`).
- **A width from data.** A class is fixed when the build runs, so the stock bar sets one value inline,
  ``style={{ transform: `scaleX(${left})` }}`` in [`stock-meter.tsx`](../../../apps/flash-web/src/sale/stock-meter.tsx).
  It is the only `style=` in the app's source.
- **Native controls that stay light.** `dark:` classes do not reach form controls and scrollbars. `color-scheme: light dark`
  in `styles.css` lets the browser draw those in the system theme.
- **A disabled button that only turns grey.** The `PRIMARY` button in `ui.ts` greys out when disabled, and its words
  still say what it is, so the state is not told by colour alone.

## Read next

- [Tailwind CSS docs](https://tailwindcss.com/docs) (version 4):
  [responsive design](https://tailwindcss.com/docs/responsive-design),
  [dark mode](https://tailwindcss.com/docs/dark-mode),
  [detecting classes in source files](https://tailwindcss.com/docs/detecting-classes-in-source-files).
- [flash-web README](../../../apps/flash-web/README.md) and the
  [React and TanStack Start crash course](react-and-tanstack-start.md).
