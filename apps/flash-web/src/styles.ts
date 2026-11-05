// The page styles, inlined by the root route. Colors are tokens, so light and dark change in one place.
export const PAGE_CSS = `
:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --text: #1a1a1a;
  --muted: #555555;
  --border: #c8c8c8;
  --accent: #0b5cad;
  --accent-text: #ffffff;
  --disabled: #8a8a8a;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d1117;
    --text: #e6edf3;
    --muted: #9da7b3;
    --border: #3d444d;
    --accent: #4493f8;
    --accent-text: #0d1117;
    --disabled: #6e7681;
  }
}
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 16px/1.5 system-ui, sans-serif;
}
main {
  max-width: 32rem;
  margin: 0 auto;
  padding: 1rem;
}
input, button {
  font: inherit;
  color: inherit;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.4rem 0.8rem;
}
form { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
label { display: flex; gap: 0.5rem; align-items: center; }
button { cursor: pointer; }
button[type="submit"], button:not([disabled]):hover { border-color: var(--accent); }
button[type="submit"]:not([disabled]) {
  background: var(--accent);
  color: var(--accent-text);
}
button:disabled { color: var(--disabled); cursor: not-allowed; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
[role="status"] { min-height: 1.5em; color: var(--muted); }
`;
