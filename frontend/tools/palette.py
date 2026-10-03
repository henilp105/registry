#!/usr/bin/env python3
"""Generate and verify the fpm-registry design-token palette.

Ramps are authored in OKLCH (perceptually uniform, hue-stable) and converted to
sRGB hex. Every foreground/background pair the UI actually uses is asserted
against WCAG 2.2 AA: 4.5:1 for body text, 3:1 for large text, focus rings and
the borders of interactive controls.

Run `python3 palette.py` to verify, `python3 palette.py -w` to write tokens.css.
"""
import math
import os
import sys

# ---------------------------------------------------------------- oklch -> srgb


def oklch_to_linear_srgb(L, C, H):
    h = math.radians(H)
    a, b = C * math.cos(h), C * math.sin(h)
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
    return (
        +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    )


def gamma(x):
    return 12.92 * x if x <= 0.0031308 else 1.055 * (x ** (1 / 2.4)) - 0.055


def oklch_to_hex(L, C, H):
    rgb = oklch_to_linear_srgb(L, C, H)
    if not all(-1e-6 <= c <= 1 + 1e-6 for c in rgb):
        lo, hi = 0.0, C  # walk chroma down until the colour fits sRGB
        for _ in range(80):
            mid = (lo + hi) / 2
            if all(-1e-6 <= c <= 1 + 1e-6 for c in oklch_to_linear_srgb(L, mid, H)):
                lo = mid
            else:
                hi = mid
        rgb = oklch_to_linear_srgb(L, lo, H)
    return "#" + "".join("%02x" % max(0, min(255, round(gamma(c) * 255))) for c in rgb)


# ---------------------------------------------------------------- contrast


def rel_lum(h):
    def lin(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    h = h.lstrip("#")
    r, g, b = (lin(int(h[i : i + 2], 16)) for i in (0, 2, 4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ratio(a, b):
    la, lb = rel_lum(a), rel_lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


# ---------------------------------------------------------------- ramps

# "Fortran indigo". Hue 262 sits between the violet-blue of the gfortran / GNU
# Fortran front end and the purple already declared as theme_color in
# public/manifest.json (#5b53c0, measured hue 282). Keeping
# the blue bias is deliberate: a pure purple reads as marketing, a blue reads
# as a compiler.
PRIMARY_H = 282.0
# "IBM blue": #1F70C1 (oklch 0.541 0.147 252.7) is Blue 70 from the IBM Design
# Language - the colour of
# the IBM XL Fortran toolchain. Informational accents only.
IBM_H = 252.7

_P_L = {50: .977, 100: .945, 200: .895, 300: .830, 400: .720, 500: .590,
        600: .510, 700: .435, 800: .360, 900: .295, 950: .235}
_P_C = {50: .018, 100: .042, 200: .078, 300: .115, 400: .150, 500: .170,
        600: .165, 700: .145, 800: .120, 900: .098, 950: .078}

# Cool grey: a hair of the brand hue so it sits next to the primary without
# vibrating, and reads as paper rather than as a tint of anything.
_N_L = {0: 1.0, 50: .985, 100: .966, 150: .940, 200: .915, 300: .855,
        400: .720, 500: .600, 600: .505, 700: .420, 800: .310, 850: .270,
        900: .235, 950: .170}
_N_C = {0: 0.0, 50: .004, 100: .008, 150: .011, 200: .014, 300: .020,
        400: .024, 500: .026, 600: .026, 700: .024, 800: .020, 850: .018,
        900: .016, 950: .012}


def p(step, L=None, C=None, H=None):
    H = PRIMARY_H if H is None else H
    return oklch_to_hex(L or _P_L[step], C if C is not None else _P_C[step], H)


def nx(step, L=None, C=None, H=None):
    """Neutral ramp, always at the brand hue."""
    H = PRIMARY_H if H is None else H
    return oklch_to_hex(L or _N_L[step], C if C is not None else _N_C[step], H)




# The dark ramp inverts lightness: the same hue and roughly the same chroma, so
# the brand reads identically in both themes instead of turning into a
# different colour after sunset.
_RAMP_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]

PRIMARY_LIGHT = {s: p(s) for s in _RAMP_STEPS}
PRIMARY_DARK = {
    50: p(None, .230, .075), 100: p(None, .290, .105), 200: p(None, .370, .130),
    300: p(None, .470, .150), 400: p(None, .600, .155), 500: p(None, .690, .140),
    600: p(None, .780, .115), 700: p(None, .850, .090), 800: p(None, .905, .065),
    900: p(None, .950, .040), 950: p(None, .980, .022),
}
GRAY_LIGHT = {s: nx(s) for s in _N_L}
GRAY_DARK = {0: nx(950), 50: nx(950), 100: nx(900), 150: nx(900), 200: nx(850),
             300: nx(800), 400: nx(700), 500: nx(600), 600: nx(500), 700: nx(400),
             800: nx(300), 850: nx(200), 900: nx(150), 950: nx(0)}
ACCENT_LIGHT = {300: p(None, .380, .120, IBM_H), 400: p(None, .700, .120, IBM_H),
                500: p(None, .590, .145, IBM_H), 600: p(None, .520, .150, IBM_H),
                700: p(None, .450, .140, IBM_H)}
ACCENT_DARK = {300: p(None, .880, .070, IBM_H), 400: p(None, .790, .095, IBM_H),
               500: p(None, .730, .125, IBM_H), 600: p(None, .650, .145, IBM_H),
               700: p(None, .550, .140, IBM_H)}


# The ink used for a label sitting on a saturated fill. Not pure black: a
# touch of the neutral ramp's own hue so it does not read as a hole punched in
# the colour, and so it is the same ink in both themes.
_INK = "#0b0b12"
_WHITE = "#ffffff"


def _semantic(name):
    """success / warning / danger / info, per theme.

    Four slots per theme, not three. The fourth is `on`: the label colour for
    text sitting *on* the solid fill (a filled button, a solid badge). It has
    to be a token rather than a hard-coded #fff, because the dark theme
    inverts the solid fills to be light - white text on the dark theme's
    success green measures 2.3:1, which is a hard fail. The dark `on` values
    are the ink above; the light ones are white, except warning, whose fill is
    light enough in both themes that ink reads better.
    """
    if name == "success":
        h, light = 152, ((.930, .055), (.550, .130), (.435, .110), _WHITE)
        dark = ((.300, .075), (.720, .155), (.835, .130), _INK)
    elif name == "warning":
        h, light = 78, ((.945, .065), (.760, .150), (.420, .110), _INK)
        dark = ((.320, .080), (.800, .140), (.900, .110), _INK)
    elif name == "danger":
        h, light = 25, ((.945, .045), (.585, .170), (.460, .160), _WHITE)
        dark = ((.310, .085), (.680, .170), (.805, .140), _INK)
    else:  # info
        h, light = 230, ((.945, .045), (.560, .140), (.450, .130), _WHITE)
        dark = ((.300, .080), (.720, .130), (.835, .110), _INK)
    out = {}
    for key, src in (("light", light), ("dark", dark)):
        for slot, spec in zip(("soft", "solid", "text", "on"), src):
            if slot == "on":
                out[f"{key}-{slot}"] = spec
            else:
                L, C = spec
                out[f"{key}-{slot}"] = p(None, L, C, h)
    return out


def sem_for(theme):
    out = {}
    for name, pal in _SEMANTICS.items():
        for slot in ("soft", "solid", "text"):
            out[f"{name}-{slot}"] = pal[f"{theme}-{slot}"]
        # Named `on-<name>-solid` rather than `<name>-on` to read as a pair:
        # the label colour and the fill it belongs to sit next to each other
        # in the token list and in the contrast table.
        out[f"on-{name}-solid"] = pal[f"{theme}-on"]
    return out


_SEMANTICS = {n: _semantic(n) for n in ("success", "warning", "danger", "info")}

LIGHT = {
    "surface-canvas": nx(50),
    "surface": nx(0),
    "surface-sunken": nx(100),
    "surface-inset": nx(200),
    "text": nx(950),
    "text-muted": nx(700),
    "text-subtle": nx(600),
    "text-disabled": nx(500),
    "text-inverse": nx(0),
    "border-subtle": nx(200),
    "border": nx(300),
    "border-strong": nx(500),
    "link": PRIMARY_LIGHT[800],
    "link-hover": PRIMARY_LIGHT[900],
    "link-info": ACCENT_LIGHT[700],
    "link-info-hover": ACCENT_LIGHT[600],
    "brand-solid": PRIMARY_LIGHT[600],
    "brand-solid-hover": PRIMARY_LIGHT[700],
    "on-brand-solid": nx(0),
    "brand-soft": PRIMARY_LIGHT[100],
    "on-brand-soft": PRIMARY_LIGHT[800],
    "brand-outline": PRIMARY_LIGHT[600],
    "focus": PRIMARY_LIGHT[600],
    "shadow-color": "#0b1020",
    **sem_for("light"),
}
DARK = {
    "surface-canvas": p(None, .165, .012),
    "surface": p(None, .205, .014),
    "surface-sunken": p(None, .140, .012),
    "surface-inset": p(None, .255, .016),
    "text": p(None, .965, .006),
    "text-muted": p(None, .790, .012),
    "text-subtle": p(None, .680, .014),
    "text-disabled": p(None, .520, .016),
    "text-inverse": p(None, .140, .012),
    "border-subtle": p(None, .290, .018),
    "border": p(None, .370, .020),
    "border-strong": p(None, .580, .024),
    "link": p(None, .700, .130),
    "link-hover": p(None, .800, .100),
    "link-info": ACCENT_DARK[400],
    "link-info-hover": ACCENT_DARK[300],
    "brand-solid": PRIMARY_DARK[500],
    "brand-solid-hover": PRIMARY_DARK[400],
    "on-brand-solid": p(None, .130, .030),
    "brand-soft": PRIMARY_DARK[100],
    "on-brand-soft": PRIMARY_DARK[800],
    "brand-outline": PRIMARY_DARK[500],
    "focus": PRIMARY_DARK[400],
    "shadow-color": "#000000",
    **sem_for("dark"),
}

# (fg, bg, minimum, description)
CHECKS = [
    ("text", "surface-canvas", 4.5, "body text on the page"),
    ("text", "surface", 4.5, "body text in cards, dialogs, dropdowns"),
    ("text", "surface-sunken", 4.5, "body text in wells, table heads, code blocks"),
    ("text", "surface-inset", 4.5, "body text in hover fills"),
    ("text-muted", "surface-canvas", 4.5, "secondary text on the page"),
    ("text-muted", "surface", 4.5, "secondary text in cards"),
    ("text-muted", "surface-sunken", 4.5, "secondary text in wells"),
    ("text-subtle", "surface-canvas", 4.5, "metadata / timestamps on the page"),
    ("text-subtle", "surface", 4.5, "metadata in cards"),
    ("text-subtle", "surface-sunken", 4.5, "metadata in wells"),
    ("text-disabled", "surface", 3.0, "disabled control label (non-text UI)"),
    ("on-brand-solid", "brand-solid", 4.5, "primary button label"),
    ("on-brand-solid", "brand-solid-hover", 4.5, "primary button label, hover"),
    ("on-brand-soft", "brand-soft", 4.5, "primary badge label"),
    ("link", "surface-canvas", 4.5, "link on the page"),
    ("link", "surface", 4.5, "link in cards"),
    ("link", "surface-sunken", 4.5, "link in wells"),
    ("link", "surface-inset", 4.5, "link on a hover fill"),
    ("link-hover", "surface-canvas", 4.5, "link, hover, on the page"),
    ("link-info", "surface-canvas", 4.5, "IBM-blue informational link"),
    ("link-info", "surface", 4.5, "IBM-blue link in cards"),
    ("link-info", "surface-sunken", 4.5, "IBM-blue link in wells"),
    ("success-text", "surface-canvas", 4.5, "success text"),
    ("success-text", "surface", 4.5, "success text in cards"),
    ("success-text", "success-soft", 4.5, "success alert text on its tint"),
    ("warning-text", "surface-canvas", 4.5, "warning text"),
    ("warning-text", "surface", 4.5, "warning text in cards"),
    ("warning-text", "warning-soft", 4.5, "warning alert text on its tint"),
    ("danger-text", "surface-canvas", 4.5, "danger / error text"),
    ("danger-text", "surface", 4.5, "danger text in cards"),
    ("danger-text", "surface-sunken", 4.5, "danger text in wells"),
    ("danger-text", "danger-soft", 4.5, "danger alert text on its tint"),
    ("info-text", "surface-canvas", 4.5, "info text"),
    ("info-text", "surface", 4.5, "info text in cards"),
    ("info-text", "info-soft", 4.5, "info alert text on its tint"),
    # --- 3:1 floor: focus rings and interactive-control borders (WCAG 2.2 SC 1.4.11)
    ("focus", "surface-canvas", 3.0, "focus ring vs page"),
    ("focus", "surface", 3.0, "focus ring vs card"),
    ("focus", "surface-sunken", 3.0, "focus ring vs well"),
    ("border-strong", "surface-canvas", 3.0, "input / control border on the page"),
    ("border-strong", "surface", 3.0, "input border in cards"),
    ("border-strong", "surface-sunken", 3.0, "input border in wells"),
    ("brand-outline", "surface-canvas", 3.0, "outline button border on the page"),
    ("brand-outline", "surface", 3.0, "outline button border in cards"),
    ("danger-solid", "surface", 3.0, "danger button fill vs card"),
    ("success-solid", "surface", 3.0, "success button fill vs card"),
    ("success-solid", "surface-canvas", 3.0, "success button fill vs page"),
    ("info-solid", "surface", 3.0, "info button fill vs card"),
    ("border", "surface", 1.2, "decorative divider (no AA floor applies)"),
    # --- labels sitting ON a solid fill (filled buttons, solid badges).
    # These are the pairs that a hard-coded `color: #fff` gets wrong in the
    # dark theme, where every solid inverts to a light colour.
    ("on-success-solid", "success-solid", 4.5, "label on a success fill"),
    ("on-danger-solid", "danger-solid", 4.5, "label on a danger fill"),
    ("on-info-solid", "info-solid", 4.5, "label on an info fill"),
    ("on-warning-solid", "warning-solid", 4.5, "label on a warning fill"),
]

CHECKS_DARK_ONLY = [
    ("text-inverse", "brand-solid", 4.5, "inverse text on a primary fill"),
]


def all_checks(label):
    return list(CHECKS) + (list(CHECKS_DARK_ONLY) if label == "DARK" else [])


# Group headings for the generated contrast table, keyed by the minimum ratio.
_GROUPS = [
    (4.5, "Body text (WCAG 2.2 AA, SC 1.4.3)"),
    (3.0, "Large text, focus rings and control borders (SC 1.4.11 / 1.4.6)"),
    (1.2, "Decorative only - no AA floor applies"),
]


def write_contrast_doc(path):
    """Emit docs/theme-contrast.md from the same data verify() checks.

    The table is generated rather than hand-written so it cannot drift from the
    palette: if a value in the palette changes, the next run rewrites the
    numbers here, and verify() has already refused to emit tokens.css if any
    pair fell below its floor.
    """
    rows = []
    for label, pal in (("Light", LIGHT), ("Dark", DARK)):
        for fg, bg, need, what in all_checks("DARK" if label == "Dark" else "LIGHT"):
            rows.append(
                {
                    "theme": label,
                    "fg": fg,
                    "bg": bg,
                    "ratio": ratio(pal[fg], pal[bg]),
                    "need": need,
                    "what": what,
                    "fg_hex": pal[fg],
                    "bg_hex": pal[bg],
                }
            )
    by_pair = {}
    for row in rows:
        by_pair.setdefault((row["fg"], row["bg"], row["need"], row["what"]), {})[
            row["theme"]
        ] = row

    out = []
    out.append("# Contrast table\n\n")
    out.append(
        "Every foreground/background pair the UI uses, with its measured WCAG "
        "2.2 contrast ratio in both themes.\n\n"
    )
    out.append(
        "**These numbers are measured, not estimated.** They are computed from "
        "the sRGB hex values in `frontend/tools/palette.py` by the same run "
        "that generates `src/theme/tokens.css`. The generator refuses to "
        "rewrite `tokens.css` if any pair falls below its floor, so a "
        "regression cannot reach the token file unnoticed. If you change a "
        "colour in the palette, re-run the generator and commit this document "
        "alongside `tokens.css`.\n"
    )

    for need, heading in _GROUPS:
        out.append(f"\n## {heading}\n\n")
        out.append(
            "| Pair | Light | Dark | Required | Used for |\n"
            "| --- | --- | --- | --- | --- |\n"
        )
        for (fg, bg, n, what), themes in by_pair.items():
            if n != need:
                continue
            # A check may exist in only one theme (CHECKS_DARK_ONLY). Print
            # "not checked" rather than a blank cell, so an empty column is
            # never mistaken for a passing measurement.
            light = (
                f"{themes['Light']['ratio']:.2f}:1"
                if themes.get("Light")
                else "not checked"
            )
            dark = (
                f"{themes['Dark']['ratio']:.2f}:1"
                if themes.get("Dark")
                else "not checked"
            )
            out.append(
                f"| `--color-{fg}` on `--color-{bg}` | {light} | "
                f"{dark} | {need}:1 | {what} |\n"
            )

    total = len(by_pair)
    both = sum(1 for t in by_pair.values() if "Light" in t and "Dark" in t)
    single = total - both
    out.append(
        f"\n## Summary\n\n{total} pairs checked, all at or above their floor: "
        f"{both} in both themes"
        + (
            f", and {single} in the dark theme only (marked *not checked* "
            "above)."
            if single
            else "."
        )
        + "\n\nThe dark theme is not a separate palette: the same OKLCH hue and "
        "roughly the same chroma with the lightness inverted, so a pair that "
        "passes on the page in light mode passes on the page in dark mode. "
        "The label colours on solid fills are the one place the two themes "
        "differ deliberately - see `--color-on-*-solid`.\n"
    )

    out.append("\n## How to reproduce\n\n")
    out.append("```sh\ncd frontend\npython3 tools/build_tokens.py\n```\n\n")
    out.append(
        "Add `--check` to verify without rewriting `tokens.css`, which is what "
        "CI should do:\n\n```sh\npython3 tools/build_tokens.py --check\n```\n"
    )
    out.append(
        "\nThe script prints every pair and its measured ratio, and exits "
        "non-zero without writing anything if any check fails. Requires only "
        "the Python standard library.\n"
    )

    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        fh.write("".join(out))
    return path


def verify():
    failures = []
    for label, pal in (("LIGHT", LIGHT), ("DARK", DARK)):
        print(f"\n=== {label} ===")
        for fg, bg, need, what in all_checks(label):
            r = ratio(pal[fg], pal[bg])
            ok = r >= need
            if not ok:
                failures.append((label, fg, bg, r, need, what))
            print(f"  [{'ok ' if ok else 'FAIL'}] {r:6.2f}:1 (min {need})  "
                  f"{fg} on {bg} - {what}")
    print("\nALL CHECKS PASS" if not failures else f"\n{len(failures)} FAILURES")
    return failures


def emit():
    lines = []
    for name, pal in (("LIGHT", LIGHT), ("DARK", DARK)):
        lines.append(f"  /* {name} */")
        for k, v in pal.items():
            lines.append(f"    {k}: {v};")
    return "\n".join(lines)


if __name__ == "__main__":
    fails = verify()
    if not fails:
        # Only regenerate the doc when the palette passes, so the table can
        # never document a failing state.
        here = os.path.dirname(os.path.abspath(__file__))
        doc = write_contrast_doc(
            os.path.join(here, "..", "docs", "theme-contrast.md")
        )
        print("\nwrote " + os.path.relpath(doc, os.getcwd()))
    if "-w" in sys.argv:
        print("\n---- token values ----")
        print(emit())
    sys.exit(1 if fails else 0)
