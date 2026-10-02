# Contrast table

Every foreground/background pair the UI uses, with its measured WCAG 2.2 contrast ratio in both themes.

**These numbers are measured, not estimated.** They are computed from the sRGB hex values in `frontend/tools/palette.py` by the same run that generates `src/theme/tokens.css`. The generator refuses to rewrite `tokens.css` if any pair falls below its floor, so a regression cannot reach the token file unnoticed. If you change a colour in the palette, re-run the generator and commit this document alongside `tokens.css`.

## Body text (WCAG 2.2 AA, SC 1.4.3)

| Pair | Light | Dark | Required | Used for |
| --- | --- | --- | --- | --- |
| `--color-text` on `--color-surface-canvas` | 18.33:1 | 17.42:1 | 4.5:1 | body text on the page |
| `--color-text` on `--color-surface` | 19.13:1 | 16.25:1 | 4.5:1 | body text in cards, dialogs, dropdowns |
| `--color-text` on `--color-surface-sunken` | 17.31:1 | 17.97:1 | 4.5:1 | body text in wells, table heads, code blocks |
| `--color-text` on `--color-surface-inset` | 14.84:1 | 14.28:1 | 4.5:1 | body text in hover fills |
| `--color-text-muted` on `--color-surface-canvas` | 8.11:1 | 9.97:1 | 4.5:1 | secondary text on the page |
| `--color-text-muted` on `--color-surface` | 8.47:1 | 9.31:1 | 4.5:1 | secondary text in cards |
| `--color-text-muted` on `--color-surface-sunken` | 7.66:1 | 10.29:1 | 4.5:1 | secondary text in wells |
| `--color-text-subtle` on `--color-surface-canvas` | 5.66:1 | 6.66:1 | 4.5:1 | metadata / timestamps on the page |
| `--color-text-subtle` on `--color-surface` | 5.91:1 | 6.22:1 | 4.5:1 | metadata in cards |
| `--color-text-subtle` on `--color-surface-sunken` | 5.34:1 | 6.87:1 | 4.5:1 | metadata in wells |
| `--color-on-brand-solid` on `--color-brand-solid` | 6.10:1 | 7.02:1 | 4.5:1 | primary button label |
| `--color-on-brand-solid` on `--color-brand-solid-hover` | 8.34:1 | 4.90:1 | 4.5:1 | primary button label, hover |
| `--color-on-brand-soft` on `--color-brand-soft` | 9.59:1 | 10.90:1 | 4.5:1 | primary badge label |
| `--color-link` on `--color-surface-canvas` | 10.84:1 | 6.99:1 | 4.5:1 | link on the page |
| `--color-link` on `--color-surface` | 11.32:1 | 6.52:1 | 4.5:1 | link in cards |
| `--color-link` on `--color-surface-sunken` | 10.24:1 | 7.22:1 | 4.5:1 | link in wells |
| `--color-link` on `--color-surface-inset` | 8.78:1 | 5.74:1 | 4.5:1 | link on a hover fill |
| `--color-link-hover` on `--color-surface-canvas` | 13.62:1 | 10.12:1 | 4.5:1 | link, hover, on the page |
| `--color-link-info` on `--color-surface-canvas` | 7.20:1 | 10.04:1 | 4.5:1 | IBM-blue informational link |
| `--color-link-info` on `--color-surface` | 7.52:1 | 9.36:1 | 4.5:1 | IBM-blue link in cards |
| `--color-link-info` on `--color-surface-sunken` | 6.80:1 | 10.36:1 | 4.5:1 | IBM-blue link in wells |
| `--color-success-text` on `--color-surface-canvas` | 7.17:1 | 12.17:1 | 4.5:1 | success text |
| `--color-success-text` on `--color-surface` | 7.49:1 | 11.35:1 | 4.5:1 | success text in cards |
| `--color-success-text` on `--color-success-soft` | 6.21:1 | 8.36:1 | 4.5:1 | success alert text on its tint |
| `--color-warning-text` on `--color-surface-canvas` | 8.20:1 | 14.17:1 | 4.5:1 | warning text |
| `--color-warning-text` on `--color-surface` | 8.56:1 | 13.22:1 | 4.5:1 | warning text in cards |
| `--color-warning-text` on `--color-warning-soft` | 7.29:1 | 9.39:1 | 4.5:1 | warning alert text on its tint |
| `--color-danger-text` on `--color-surface-canvas` | 7.43:1 | 10.07:1 | 4.5:1 | danger / error text |
| `--color-danger-text` on `--color-surface` | 7.75:1 | 9.39:1 | 4.5:1 | danger text in cards |
| `--color-danger-text` on `--color-surface-sunken` | 7.01:1 | 10.39:1 | 4.5:1 | danger text in wells |
| `--color-danger-text` on `--color-danger-soft` | 6.53:1 | 7.13:1 | 4.5:1 | danger alert text on its tint |
| `--color-info-text` on `--color-surface-canvas` | 6.94:1 | 11.89:1 | 4.5:1 | info text |
| `--color-info-text` on `--color-surface` | 7.25:1 | 11.09:1 | 4.5:1 | info text in cards |
| `--color-info-text` on `--color-info-soft` | 6.24:1 | 8.29:1 | 4.5:1 | info alert text on its tint |
| `--color-on-success-solid` on `--color-success-solid` | 4.59:1 | 8.46:1 | 4.5:1 | label on a success fill |
| `--color-on-danger-solid` on `--color-danger-solid` | 4.56:1 | 6.30:1 | 4.5:1 | label on a danger fill |
| `--color-on-info-solid` on `--color-info-solid` | 4.56:1 | 8.15:1 | 4.5:1 | label on an info fill |
| `--color-on-warning-solid` on `--color-warning-solid` | 8.96:1 | 10.32:1 | 4.5:1 | label on a warning fill |
| `--color-text-inverse` on `--color-brand-solid` | not checked | 6.94:1 | 4.5:1 | inverse text on a primary fill |

## Large text, focus rings and control borders (SC 1.4.11 / 1.4.6)

| Pair | Light | Dark | Required | Used for |
| --- | --- | --- | --- | --- |
| `--color-text-disabled` on `--color-surface` | 3.95:1 | 3.25:1 | 3.0:1 | disabled control label (non-text UI) |
| `--color-focus` on `--color-surface-canvas` | 5.84:1 | 4.69:1 | 3.0:1 | focus ring vs page |
| `--color-focus` on `--color-surface` | 6.10:1 | 4.37:1 | 3.0:1 | focus ring vs card |
| `--color-focus` on `--color-surface-sunken` | 5.52:1 | 4.84:1 | 3.0:1 | focus ring vs well |
| `--color-border-strong` on `--color-surface-canvas` | 3.79:1 | 4.49:1 | 3.0:1 | input / control border on the page |
| `--color-border-strong` on `--color-surface` | 3.95:1 | 4.19:1 | 3.0:1 | input border in cards |
| `--color-border-strong` on `--color-surface-sunken` | 3.58:1 | 4.64:1 | 3.0:1 | input border in wells |
| `--color-brand-outline` on `--color-surface-canvas` | 5.84:1 | 6.72:1 | 3.0:1 | outline button border on the page |
| `--color-brand-outline` on `--color-surface` | 6.10:1 | 6.27:1 | 3.0:1 | outline button border in cards |
| `--color-danger-solid` on `--color-surface` | 4.56:1 | 5.78:1 | 3.0:1 | danger button fill vs card |
| `--color-success-solid` on `--color-surface` | 4.59:1 | 7.76:1 | 3.0:1 | success button fill vs card |
| `--color-success-solid` on `--color-surface-canvas` | 4.40:1 | 8.32:1 | 3.0:1 | success button fill vs page |
| `--color-info-solid` on `--color-surface` | 4.56:1 | 7.47:1 | 3.0:1 | info button fill vs card |

## Decorative only - no AA floor applies

| Pair | Light | Dark | Required | Used for |
| --- | --- | --- | --- | --- |
| `--color-border` on `--color-surface` | 1.56:1 | 1.73:1 | 1.2:1 | decorative divider (no AA floor applies) |

## Summary

53 pairs checked, all at or above their floor: 52 in both themes, and 1 in the dark theme only (marked *not checked* above).

The dark theme is not a separate palette: the same OKLCH hue and roughly the same chroma with the lightness inverted, so a pair that passes on the page in light mode passes on the page in dark mode. The label colours on solid fills are the one place the two themes differ deliberately - see `--color-on-*-solid`.

## How to reproduce

```sh
cd frontend
python3 tools/build_tokens.py
```

Add `--check` to verify without rewriting `tokens.css`, which is what CI should do:

```sh
python3 tools/build_tokens.py --check
```

The script prints every pair and its measured ratio, and exits non-zero without writing anything if any check fails. Requires only the Python standard library.
