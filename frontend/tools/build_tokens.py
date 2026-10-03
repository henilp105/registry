#!/usr/bin/env python3
"""Render `src/theme/tokens.css` from the verified palette in `palette.py`.

Every hex value in the token layer comes from here, so the stylesheet and the
contrast audit can never drift apart. Change a ramp in palette.py, re-run this,
and both move together.

    python3 frontend/tools/build_tokens.py          # rewrite tokens.css
    python3 frontend/tools/build_tokens.py --check  # verify contrast only
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import palette  # noqa: E402

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOKENS = os.path.join(FRONTEND, "src", "theme", "tokens.css")

# --------------------------------------------------------------------------
# The parts of the token layer that do not change between themes: typography,
# spacing, radius, elevation, motion. Colour is injected from palette.py.
# --------------------------------------------------------------------------

HEADER = '''/* ==========================================================================
   fpm registry - design tokens
   --------------------------------------------------------------------------
   ONE SOURCE OF TRUTH for colour, type, space, radius, elevation and motion.
   Components must never hard-code a hex value; they read these.

   GENERATED FILE - run `python3 frontend/tools/build_tokens.py` after editing
   `frontend/tools/palette.py`. Do not hand-edit the colour blocks below.

   Colour rationale (fuller version in frontend/THEME.md):
     * The brand ramp is "Fortran indigo" at OKLCH hue 282. That is the hue of
       the official fpm mark itself (#483ca8, measured from the vendored logo),
       which sits in the indigo/violet-blue band between the gfortran / GNU
       Fortran front end and the theme_color now declared in public/manifest.json (#5b53c0 = hue 282). The blue bias matters: at 306
       the brand reads as marketing, at 220 it reads as a hyperlink.
     * The accent ramp is IBM Blue 70 (#1F70C1, hue 252.7) from the IBM Design
       Language - the colour of the IBM XL Fortran toolchain. Reserved for
       informational accents so it never competes with the brand.
     * Neutrals carry a small tint of the brand hue so they sit next to it
       without vibrating, and read as paper rather than as a tint of anything.
     * Ramps are authored in OKLCH and converted to sRGB, so lightness is
       perceptually even and the dark theme is the *same hue with the lightness
       inverted*, not a different colour after sunset.
     * Every foreground/background pair the UI uses is verified against WCAG 2.2
       AA (4.5:1 body text, 3:1 large text, focus rings, control borders). The
       full table of measured ratios is in frontend/docs/theme-contrast.md.
   ========================================================================== */
'''

STATIC = '''
  /* ---------------------------------------------------------------------
     Typography
     Two stacks only, no webfonts: a neutral grotesque for prose, a monospace
     for anything machine-shaped (identifiers, versions, tokens, code). The
     mono stack is the "technical instrument" cue.
     --------------------------------------------------------------------- */
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
    "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji",
    "Segoe UI Emoji";
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
    "Liberation Mono", "DejaVu Sans Mono", monospace;

  /* Modular scale, ratio 1.2 (minor third), anchored on a 15px body.
     Restrained on purpose: a registry is a table, not a poster. */
  --font-size-2xs: 0.6875rem; /* 11px - overlines, badges */
  --font-size-xs: 0.75rem; /* 12px - metadata */
  --font-size-sm: 0.8125rem; /* 13px - dense tables, chips */
  --font-size-base: 0.9375rem; /* 15px - body */
  --font-size-md: 1rem; /* 16px - inputs, lead */
  --font-size-lg: 1.125rem; /* 18px - card titles */
  --font-size-xl: 1.375rem; /* 22px - section headings */
  --font-size-2xl: 1.75rem; /* 28px - page titles */
  --font-size-3xl: 2.125rem; /* 34px - display (404, wordmark) */

  --line-height-tight: 1.2;
  --line-height-snug: 1.35;
  --line-height-normal: 1.55;
  --line-height-relaxed: 1.7;

  --tracking-tight: -0.011em;
  --tracking-normal: 0;
  --tracking-wide: 0.02em;
  --tracking-widest: 0.07em; /* overlines / small caps */

  /* Four weights. A registry does not need seven. */
  --font-weight-regular: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;

  /* ---------------------------------------------------------------------
     Space - 4px base
     --------------------------------------------------------------------- */
  --space-0: 0;
  --space-1: 0.25rem; /*  4px */
  --space-2: 0.5rem; /*  8px */
  --space-3: 0.75rem; /* 12px */
  --space-4: 1rem; /* 16px */
  --space-5: 1.25rem; /* 20px */
  --space-6: 1.5rem; /* 24px */
  --space-8: 2rem; /* 32px */
  --space-10: 2.5rem; /* 40px */
  --space-12: 3rem; /* 48px */
  --space-16: 4rem; /* 64px */
  --space-20: 5rem; /* 80px */

  --content-width: 72rem;
  --content-width-narrow: 44rem;
  --content-width-readme: 46rem;
  --header-height: 3.5rem;

  /* ---------------------------------------------------------------------
     Radius - four steps and a pill. The previous stylesheet had five
     arbitrary values (4, 5, 10, 25, 50px).
     --------------------------------------------------------------------- */
  --radius-sm: 4px; /* inputs, chips, badges */
  --radius-md: 8px; /* buttons, cards */
  --radius-lg: 12px; /* dialogs, feature cards */
  --radius-full: 999px; /* pills */

  /* ---------------------------------------------------------------------
     Motion
     --------------------------------------------------------------------- */
  --duration-instant: 80ms;
  --duration-fast: 140ms;
  --duration-base: 200ms;
  --duration-slow: 320ms;
  --ease-standard: cubic-bezier(0.2, 0, 0.2, 1);
  --ease-decelerate: cubic-bezier(0, 0, 0, 1);
  --ease-accelerate: cubic-bezier(0.4, 0, 1, 1);
'''

DARK_TAIL = '''
  --color-shadow: #000000;
  --color-overlay: rgb(3 6 13 / 62%);

  --shadow-xs: 0 1px 2px rgb(0 0 0 / 40%);
  --shadow-sm: 0 1px 3px rgb(0 0 0 / 45%), 0 1px 2px rgb(0 0 0 / 30%);
  --shadow-md: 0 4px 12px rgb(0 0 0 / 50%), 0 2px 4px rgb(0 0 0 / 30%);
  --shadow-lg: 0 12px 32px rgb(0 0 0 / 60%), 0 4px 8px rgb(0 0 0 / 35%);
  --shadow-focus: 0 0 0 3px var(--color-surface),
    0 0 0 5px var(--color-focus);
}

'''

FOOTER = '''/* ==========================================================================
   Reduced motion
   --------------------------------------------------------------------------
   Collapse every duration to ~0 rather than "turn off the animations", so
   anything that still transitions does so instantly. base.css additionally
   neutralises `animation-iteration-count` and `scroll-behavior`.
   ========================================================================== */
@media (prefers-reduced-motion: reduce) {
  :root {
    --duration-instant: 0.01ms;
    --duration-fast: 0.01ms;
    --duration-base: 0.01ms;
    --duration-slow: 0.01ms;
  }
}

/* D84: the Bootstrap bridge block used to live here, where it lost the
   cascade against Bootstrap's own :root declarations (tokens.css is imported
   before vendor bootstrap, so bootstrap's equal-specificity rules won). It
   now lives at the end of theme/base.css, which loads after Bootstrap. */
'''

LIGHT_TAIL = '''
  --color-shadow: #0b1020;
  --color-overlay: rgb(13 15 21 / 45%);

  --shadow-xs: 0 1px 2px rgb(11 16 32 / 6%);
  --shadow-sm: 0 1px 3px rgb(11 16 32 / 8%), 0 1px 2px rgb(11 16 32 / 4%);
  --shadow-md: 0 4px 12px rgb(11 16 32 / 8%), 0 2px 4px rgb(11 16 32 / 4%);
  --shadow-lg: 0 12px 32px rgb(11 16 32 / 12%), 0 4px 8px rgb(11 16 32 / 6%);
  --shadow-focus: 0 0 0 3px var(--color-surface),
    0 0 0 5px var(--color-focus);
'''


def color_body(pal, ramps):
    out = []
    for name, values, comment in ramps:
        out.append("")
        out.append(f"  /* {comment} */")
        for k, v in values.items():
            out.append(f"  --{name}-{k}: {v};")
    out.append("")
    out.append("  /* Semantic colour - the only layer components should reference. */")
    for k, v in pal.items():
        if k in ("shadow-color", "overlay"):
            continue  # emitted with the shadow set below
        out.append(f"  --color-{k}: {v};")
    return out


def build():
    parts = [HEADER, "\n:root {\n  color-scheme: light;\n"]
    parts.append(
        "\n".join(
            color_body(
                palette.LIGHT,
                [
                    ("primary", palette.PRIMARY_LIGHT,
                     "Fortran indigo, OKLCH hue 282 - the official fpm mark's hue"),
                    ("gray", palette.GRAY_LIGHT, "cool neutral with a hint of the brand hue"),
                    ("accent", palette.ACCENT_LIGHT,
                     "IBM Blue 70 (#1F70C1) - informational accents only"),
                ],
            )
        )
    )
    parts.append(STATIC)
    parts.append(LIGHT_TAIL)
    parts.append("}\n\n")
    parts.append("/* ==========================================================================\n"
                 "   Dark theme\n"
                 "   --------------------------------------------------------------------------\n"
                 "   Applied by an inline <script> in public/index.html before first paint, so\n"
                 "   a dark-mode user never sees a white flash. There is deliberately no\n"
                 "   `prefers-color-scheme` block here: <html> always carries a concrete\n"
                 "   `data-theme`, so one override block is enough and the two themes\n"
                 "   cannot drift apart.\n"
                 "   ========================================================================== */\n")
    parts.append('[data-theme="dark"] {\n  color-scheme: dark;\n')
    parts.append(
        "\n".join(
            color_body(
                palette.DARK,
                [
                    ("primary", palette.PRIMARY_DARK, "Brand ramp, lightness inverted"),
                    ("gray", palette.GRAY_DARK, "Neutral ramp, lightness inverted"),
                    ("accent", palette.ACCENT_DARK, "Accent ramp, lightness inverted"),
                ],
            )
        )
    )
    parts.append(DARK_TAIL)
    parts.append(FOOTER)
    return "".join(parts)


def main():
    if palette.verify():
        print("contrast checks failed; tokens.css not rewritten", file=sys.stderr)
        return 1
    if "--check" in sys.argv:
        return 0
    with open(TOKENS, "w") as fh:
        fh.write(build())
    print(f"wrote {os.path.relpath(TOKENS, os.getcwd())}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
