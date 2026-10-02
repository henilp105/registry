/**
 * Theme resolution.
 *
 * Three states, resolved in this order:
 *   1. an explicit user choice in localStorage ("light" or "dark")
 *   2. the operating system's `prefers-color-scheme`
 *   3. light
 *
 * The same three lines run again as an inline <script> in public/index.html so
 * `data-theme` is on <html> before the first paint - otherwise a dark-mode user
 * gets a white flash on every navigation. Keep the two in sync; the inline copy
 * is deliberately dependency-free.
 */

export const THEME_STORAGE_KEY = "fpm-theme";

/**
 * @returns {"light"|"dark"} The theme that should be active
 */
export const resolveTheme = () => {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") {
      return stored;
    }
  } catch {
    // localStorage can be blocked; fall through to the media query.
  }
  if (typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return "light";
};

/**
 * Write the theme onto <html> as `data-theme`.
 * @param {"light"|"dark"} theme
 */
export const applyTheme = (theme) => {
  document.documentElement.setAttribute("data-theme", theme);
  // Mirror onto `data-bs-theme`, which is the attribute Bootstrap 5.3 gates its
  // entire dark palette on.
  //
  // Without this, Bootstrap stays in light mode inside our dark theme, and the
  // damage is not subtle: `.navbar` declares `--bs-navbar-color: rgba(0,0,0,.65)`
  // as its *light* default, so in a dark theme the nav links rendered
  // black-on-near-black at 1.11:1 — invisible, and failing WCAG AA for large
  // text and UI components as well as normal text.
  //
  // Found by rendering the site and measuring computed contrast, not by reading
  // the token file: every token was correct. The bug lived in the layer Bootstrap
  // controls, which is precisely what a token audit cannot see.
  //
  // Mirroring rather than replacing `data-theme` keeps one source of truth. The
  // tokens continue to be driven by `data-theme`, so nothing about the palette
  // depends on Bootstrap's attribute being present.
  document.documentElement.setAttribute("data-bs-theme", theme);
  // Keep the browser UI (address bar, form controls) in step.
  document.documentElement.style.colorScheme = theme;
};

/**
 * Persist an explicit choice and apply it.
 * @param {"light"|"dark"} theme
 */
export const storeTheme = (theme) => {
  applyTheme(theme);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // A blocked localStorage only costs us persistence, not the theme itself.
  }
};
