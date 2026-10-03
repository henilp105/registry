# The fpm registry theme

Everything visual in this app reads from one generated set of CSS custom
properties. Components do not choose colours; they read tokens. This document
explains what the tokens are, why they are what they are, and how to change
them without breaking the dark theme or the contrast guarantees.

## The short version

```css
/* Never this */
background: #5b53c0;

/* This */
background: var(--color-brand-solid);
```

If you cannot find a token that expresses what you want, the answer is to add
one to `tools/palette.py` and regenerate, not to write a hex value. A hex in a
component is a bug: it will not respond to the theme toggle.

## Files

| Path | What it is |
| --- | --- |
| `tools/palette.py` | The palette. OKLCH-authored, contrast-verified. **Edit this.** |
| `tools/build_tokens.py` | Renders `palette.py` into `src/theme/tokens.css` |
| `src/theme/tokens.css` | **Generated.** Colour, type, space, radius, elevation, motion, and the Bootstrap bridge. Do not hand-edit. |
| `src/theme/base.css` | Element defaults, focus rings, the Bootstrap 5 re-point. Hand-written. |
| `src/theme/theme.js` | Theme resolution (localStorage → OS preference → light) |
| `src/theme/ThemeToggle.js` | The light/dark control in the navbar |
| `docs/theme-contrast.md` | **Generated.** Every measured contrast ratio. |

Regenerate after any palette change:

```sh
cd frontend
python3 tools/build_tokens.py        # writes tokens.css and the contrast doc
python3 tools/build_tokens.py --check  # verify only; non-zero exit on failure
```

`build_tokens.py` refuses to write `tokens.css` if any contrast check fails,
and only writes `docs/theme-contrast.md` once everything passes. A
contrast regression cannot reach the token file silently.

## Why the colours are what they are

**The brand is "Fortran indigo", OKLCH hue 282.** That is the measured hue of
the official fpm mark itself (`#483ca8`, taken from the vendored logo in
`public/brand/`). It sits in the indigo/violet-blue band between the gfortran
/ GNU Fortran front end and the dark-mode canvas already declared as
`background_color` in `public/manifest.json` (`#0d0e13`). The blue bias is
deliberate: at 306 the brand reads as marketing, at 220 it reads as a
hyperlink, and 282 reads as a compiler. `theme_color` in the manifest is the
brand itself (`#5b53c0`, hue 282), matching `--color-brand-solid`.

**The accent is IBM Blue 70 (`#1F70C1`, hue 252.7)**, from the IBM Design
Language — the colour of the IBM XL Fortran toolchain. It is reserved for
informational accents (`--color-link-info`) and never competes with the brand.

**Ramps are authored in OKLCH and converted to sRGB.** Lightness is
perceptually even, so step 600 is visibly the same "distance" from 500
everywhere in the ramp. This is why the dark theme is a genuine inversion
rather than a second hand-picked palette: the dark ramp holds the same hue and
roughly the same chroma and inverts the lightness, so a colour that passes
contrast in light mode passes in dark mode too. Everything in the contrast
table is verified in both themes, so that claim is checked rather than
asserted.

**Neutrals carry a small tint of the brand hue.** A pure grey next to an
indigo looks dirty. `--gray-*` is authored at hue 282 with very low chroma, so
the greys sit next to the brand without vibrating, and read as paper rather
than as a tint of something.

## Semantic tokens

Raw ramps (`--primary-600`, `--gray-200`) exist for building ramps. Components
should almost never reference them. Use the semantic layer:

### Surface

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--color-surface-canvas` | `#f9fafd` | `#0d0e13` | The page background |
| `--color-surface` | `#ffffff` | `#16161e` | Cards, dialogs, dropdowns, table bodies |
| `--color-surface-sunken` | `#f3f3f9` | `#08090e` | Wells, table heads, code blocks, inset panels |
| `--color-surface-inset` | `#e1e2ec` | `#21222b` | Hover fills, skeleton tracks, track backgrounds |

### Text

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--color-text` | `#0e0f15` | `#f3f3f7` | Body text, headings |
| `--color-text-muted` | `#4b4c5a` | `#b9bac2` | Secondary text, descriptions |
| `--color-text-subtle` | `#626374` | `#9797a1` | Metadata, timestamps, labels |
| `--color-text-disabled` | `#7d7f90` | `#676872` | Disabled controls. 3:1 floor, not 4.5 — it is non-text UI |
| `--color-text-inverse` | `#ffffff` | `#08090e` | Text on a saturated fill |

### Brand

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--color-brand-solid` | `#5b53c0` | `#8e8fef` | Filled primary buttons, active tabs, accents |
| `--color-brand-solid-hover` | `#48419d` | `#7471d9` | Hover state of the above |
| `--color-on-brand-solid` | `#ffffff` | `#060613` | Label on a brand fill |
| `--color-brand-soft` | `#e9ebff` | `#26205d` | Tinted backgrounds, selected rows |
| `--color-on-brand-soft` | `#363079` | `#daddff` | Text on a brand tint |
| `--color-brand-outline` | `#5b53c0` | `#8e8fef` | Outline button borders |
| `--color-focus` | `#5b53c0` | `#7471d9` | Focus rings. 3:1 against every surface |

### Status

Each status has three slots plus a label colour for text on the solid fill.

| Token | Light | Dark |
| --- | --- | --- |
| `--color-success-soft` | `#cef3d6` | `#04381a` |
| `--color-success-solid` | `#22864a` | `#48c072` |
| `--color-success-text` | `#0a6231` | `#84e19f` |
| `--color-warning-soft` | `#ffeaca` | `#452e00` |
| `--color-warning-solid` | `#e5a323` | `#efb146` |
| `--color-warning-text` | `#674600` | `#ffd79a` |
| `--color-danger-soft` | `#ffe6e4` | `#531b19` |
| `--color-danger-solid` | `#cd4845` | `#ef6661` |
| `--color-danger-text` | `#9e2225` | `#ffa39b` |
| `--color-info-soft` | `#d8f2ff` | `#003346` |
| `--color-info-solid` | `#007fa9` | `#32b3e6` |
| `--color-info-text` | `#005e7d` | `#7ed6ff` |

`--color-{status}-soft` is an alert background, `--color-{status}-solid` is a
filled button or badge, and `--color-{status}-text` is text on a surface or on
its own soft tint.

### Labels on solid fills

`--color-on-success-solid`, `--color-on-danger-solid`,
`--color-on-info-solid`, `--color-on-warning-solid`.

These exist because the dark theme inverts every solid fill to a *light*
colour, so a hard-coded white button label fails there: white on the dark
theme's success green measures 2.32:1. The light theme uses white for
success/danger/info and ink for warning; the dark theme uses ink for all four.

**If you add a filled button in a new colour, add an `on-*-solid` token for it
and a contrast check.** A hard-coded `#fff` label is a bug even though it
looks right in the light theme.

### Borders and links

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--color-border-subtle` | `#e1e2ec` | `#2a2a34` | Dividers, card edges, skeleton cards |
| `--color-border` | `#cdcedd` | `#3e3f4a` | Default control borders |
| `--color-border-strong` | `#7d7f90` | `#787989` | Input borders. 3:1 floor |
| `--color-link` | `#363079` | `#9293ed` | Links |
| `--color-link-hover` | `#27235b` | `#b3b6fd` | Link hover |
| `--color-link-info` | `#00559e` | `#8ebff6` | Informational links (IBM blue) |

## Non-colour tokens

Also in `tokens.css`, all generated from the same `STATIC` block in
`build_tokens.py`.

**Type.** Two stacks, no webfonts: `--font-sans` for prose, `--font-mono` for
anything machine-shaped (identifiers, versions, tokens, code). The mono stack
is the "technical instrument" cue, which is appropriate for a package
registry. A minor-third modular scale (ratio 1.2) on a 15px body:
`--font-size-2xs` (11px, overlines) through `--font-size-3xl` (34px, display).
Restrained on purpose — a registry is a table, not a poster. Four weights:
`--font-weight-regular|medium|semibold|bold`.

**Space.** A 4px base, `--space-1` (4px) through `--space-20` (80px). Plus
`--content-width` (72rem), `--content-width-narrow` (44rem),
`--content-width-readme` (46rem) and `--header-height`.

**Radius.** Four steps and a pill, replacing five arbitrary values (4, 5, 10,
25, 50px) that the old stylesheets had accumulated: `--radius-sm` (inputs,
chips), `--radius-md` (buttons, cards), `--radius-lg` (dialogs, feature
cards), `--radius-full` (pills).

**Elevation.** `--shadow-xs` through `--shadow-lg`, plus `--shadow-focus` for
the two-tone focus ring. These are composited from `--color-shadow` at low
alpha, so they re-theme automatically.

**Motion.** `--duration-instant|fast|base|slow` and
`--ease-standard|decelerate|accelerate`.

## The Bootstrap 5 bridge

`react-bootstrap` is kept deliberately. Its `Modal` is the accessible,
focus-trapping, `aria-modal`, escape-closing dialog this app relies on, and
rebuilding that would be a regression rather than an upgrade.

Bootstrap 5.3 is driven largely by CSS custom properties, so `tokens.css`
re-points them at our tokens in one block (`--bs-body-bg`, `--bs-btn-*`,
`--bs-border-radius`, …). The parts Bootstrap hard-codes as hex — `.btn-*`,
`.text-*`, `.alert-*`, `.badge.bg-*` — are re-pointed once in `base.css`.
That is the only place Bootstrap is restyled; no component styles a Bootstrap
class directly.

Bootstrap is imported **exactly once**, in `src/index.js`, in this order:

```
tokens.css  ->  bootstrap.min.css  ->  base.css  ->  index.css  ->  page CSS
```

The order matters. `base.css` exists to override Bootstrap's hard-coded hex, so
the vendor sheet has to load *before* it. Page stylesheets are pulled in by
`App.js` and therefore land last, which is what lets a page opt out of the
base layer.

## Focus

`base.css` draws a two-tone ring: an inner surface-coloured line and an outer
brand line. The pair keeps ≥3:1 against every surface it can land on,
including on top of a filled button — a single-colour ring cannot do that.

`:focus-visible` keeps the ring off mouse clicks, with `:focus` retained as a
fallback. Never remove an outline without replacing it with something at
least as visible.

There is a skip link as the first tab stop on every page, targeting
`#main-content`. Client-side navigation moves focus to that element and resets
scroll, so Tab continues from the new page rather than from the navbar, and
screen readers announce the route change.

## Icons

`src/components/Icon.js` is the only icon surface. It maps 44 names to
`react-bootstrap-icons` components, drawn as inline SVG.

The app previously used FontAwesome class names (`<i className="fas
fa-search" />`) at 74 call sites, and the FontAwesome stylesheet was never
loaded — so every one of those rendered as an empty element. Icons are SVG
rather than a webfont glyph so they inherit `currentColor` (a muted icon is
muted for free), add no font request, and are tree-shakeable.

Every icon is `aria-hidden` by default, because in every call site it sits
next to a text label. Pass a `title` when an icon is the only content of a
control.

## Adding a token

1. Add it to the relevant `LIGHT` / `DARK` dict in `tools/palette.py`.
2. Add a contrast check to `CHECKS` if it is a foreground/background pair, with
   the right floor: 4.5 for body text, 3.0 for large text, focus rings and
   control borders, 1.2 for decorative.
3. Run `python3 tools/build_tokens.py`.
4. Commit `tokens.css`, `docs/theme-contrast.md` and `palette.py` together.

If a check fails, the generator will not write `tokens.css` and will exit
non-zero. That is the point: it is easier to fix the colour than to argue with
the contrast math.

## Checking your work

```sh
cd frontend
CI=true npm run build            # ESLint warnings are errors
node tools/route-smoke.cjs       # all 17 routes render, one <main> each
node tools/modal-a11y.cjs        # dialogs are named, trap focus, close on Escape
python3 tools/build_tokens.py --check
```
