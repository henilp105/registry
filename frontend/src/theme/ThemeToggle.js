import { useCallback, useEffect, useState } from "react";
import { applyTheme, resolveTheme, storeTheme } from "./theme";

/**
 * Light / dark toggle.
 *
 * Rendered inside Navbar next to the account menu. `aria-pressed` communicates
 * state, the label says which theme you will get, and the icon is marked
 * aria-hidden because the label already carries the meaning.
 */
const ThemeToggle = () => {
  const [theme, setTheme] = useState(() => resolveTheme());

  // Keep <html> honest if the OS preference changes while nobody has made an
  // explicit choice yet. Once the user picks, their choice sticks.
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event) => {
      let stored = null;
      try {
        stored = window.localStorage.getItem("fpm-theme");
      } catch {
        stored = null;
      }
      if (stored === "light" || stored === "dark") return;
      const next = event.matches ? "dark" : "light";
      setTheme(next);
      applyTheme(next);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      storeTheme(next);
      return next;
    });
  }, []);

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-pressed={isDark}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
    >
      <span className="theme-toggle-track" aria-hidden="true">
        {/* A sun/moon pair rather than a single icon: the glyph shown is the
            theme you are in, so the control reads at a glance. */}
        <svg
          className="theme-toggle-glyph theme-toggle-glyph-sun"
          viewBox="0 0 16 16"
          width="13"
          height="13"
          focusable="false"
          aria-hidden="true"
        >
          <circle cx="8" cy="8" r="3.1" />
          <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3.05 3.05l1.13 1.13M11.82 11.82l1.13 1.13M12.95 3.05l-1.13 1.13M4.18 11.82l-1.13 1.13" />
          </g>
        </svg>
        <svg
          className="theme-toggle-glyph theme-toggle-glyph-moon"
          viewBox="0 0 16 16"
          width="13"
          height="13"
          focusable="false"
          aria-hidden="true"
        >
          <path d="M13.4 9.6A5.6 5.6 0 0 1 6.4 2.6a5.9 5.9 0 1 0 7 7Z" />
        </svg>
      </span>
      <span className="visually-hidden">
        {isDark ? "Dark theme, switch to light" : "Light theme, switch to dark"}
      </span>
    </button>
  );
};

export default ThemeToggle;
