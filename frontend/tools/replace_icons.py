#!/usr/bin/env python3
"""Rewrite FontAwesome class-name icons to the shared <Icon> component.

Mechanical, and idempotent. Handles the three shapes actually present in the
tree:

  1. <i className="fas fa-search" />            -> <Icon name="search" />
  2. <i className="fas fa-chevron-left me-1"    -> <Icon name="chevron-left" className="me-1" />
     style={{...}} />                              (utility classes and style pass through)
  3. <i className={`fas fa-eye${cond ? "-slash" : ""}`} />  (the password
     visibility toggle, which needs a real conditional rather than a name)

The `fa-2x` / `fa-3x` size modifiers become a `size` prop.
"""
import os
import re
import sys

SRC = os.path.join(os.path.dirname(__file__), "..", "src")

NAME_MAP = {
    "archive": "archive", "book": "book", "check": "check",
    "check-circle": "check-circle", "chevron-left": "chevron-left",
    "chevron-right": "chevron-right", "clock": "clock", "copy": "copy",
    "exclamation-circle": "exclamation-circle",
    "exclamation-triangle": "exclamation-triangle", "eye": "eye",
    "eye-slash": "eye-slash", "flag": "flag", "folder": "folder",
    "folder-open": "folder-open", "info-circle": "info-circle", "key": "key",
    "plus": "plus", "plus-circle": "plus-circle",
    "question-circle": "question-circle", "search": "search",
    "shield-alt": "shield-alt", "sign-out-alt": "sign-out-alt", "star": "star",
    "th-large": "th-large", "user-cog": "user-cog", "user-minus": "user-minus",
    "user-plus": "user-plus", "users": "users",
    "angle-double-left": "angle-double-left",
    "angle-double-right": "angle-double-right",
}
SIZES = {"2x", "3x"}

# className="fas fa-name [sizecode] [utility classes]"
PAT_PLAIN = re.compile(
    r'<i\s+className="(?P<classes>[^"]*)"(?P<rest>[^>]*?)/?>'
)
# className={`fas fa-eye${...}`}
PAT_EYE = re.compile(
    r'<i\s+className=\{`fas fa-eye\$\{\s*(?P<cond>[^?}]+?)\?\s*"-slash"\s*:\s*""\s*\}`\}'
    r'(?P<rest>[^>]*?)/?>'
)

# A self-closing `<i ... />` leaves the original closing tag behind.
PAT_STRAY = re.compile(r"(</Icon>)(\s*)(</i>)")


def split_classes(classes):
    """-> (icon_name, size or None, [remaining utility classes])"""
    name = None
    size = None
    rest = []
    for cls in classes.split():
        if cls in ("fas", "far", "fab", "fa"):
            continue
        if cls.startswith("fa-"):
            key = cls[3:]
            if key in SIZES:
                size = key
            elif key in NAME_MAP:
                name = NAME_MAP[key]
            else:
                rest.append(cls)  # unknown, keep the class verbatim
        else:
            rest.append(cls)
    return name, size, rest


def build(name, size, rest, props):
    parts = [f'name="{name}"']
    if size:
        parts.append(f'size="{size}"')
    cls = " ".join(rest)
    style = ""
    m = re.search(r'style=\{\{([^}]*)\}\}', props)
    if m:
        style = m.group(1).strip().rstrip(",")
        props = props.replace(m.group(0), "").strip()
    if cls:
        parts.append(f'className="{cls}"')
    if style:
        # The old style was a font-size for a glyph; the component takes a
        # size prop, so convert rather than carrying a style object over.
        sm = re.search(r"fontSize:\s*[\"']([\d.]+)(px|rem)[\"']", style)
        if sm:
            if not size:
                value = float(sm.group(1))
                if sm.group(2) == "rem":
                    # the glyph sizing the old rule was trying to express;
                    # the component takes px
                    value = value * 16
                parts.append(f"size={{{value:g}}}")
        else:
            parts.append(f"style={{{{{style}}}}}")
    if props:
        parts.append(props)
    return "<Icon " + " ".join(parts) + " />"


def add_import(text, path):
    if "components/Icon" in text:
        return text
    rel = os.path.relpath(
        os.path.join(SRC, "components", "Icon"), os.path.dirname(path)
    )
    if not rel.startswith("."):
        rel = "./" + rel
    lines = text.split("\n")
    # Find the end of the *last complete* import statement. A multi-line
    # `import {\n  a,\n} from "x";` starts with "import" but does not end
    # there, so track brace depth and only accept a line ending in `;`.
    depth = 0
    insert_at = 0
    for i, line in enumerate(lines):
        stripped = line.strip()
        if depth == 0 and stripped.startswith("import "):
            depth = line.count("{") - line.count("}")
            if depth == 0 and stripped.endswith(";"):
                insert_at = i
                continue
        elif depth > 0:
            depth += line.count("{") - line.count("}")
            if depth <= 0:
                insert_at = i
    lines.insert(insert_at + 1, f'import Icon from "{rel}";')
    return "\n".join(lines)


def main():
    changed = []
    for root, _dirs, files in os.walk(SRC):
        for fn in files:
            if not fn.endswith(".js"):
                continue
            path = os.path.join(root, fn)
            with open(path) as fh:
                text = fh.read()
            if "fa-" not in text or fn == "Icon.js":
                continue
            orig = text

            def sub_eye(m):
                cond = m.group("cond").strip()
                rest = m.group("rest") or ""
                cls = ""
                sm = re.search(r'style=\{\{([^}]*)\}\}', rest)
                if sm:
                    rest = rest.replace(sm.group(0), "").strip()
                return (
                    f'<Icon name={{{cond} ? "eye-slash" : "eye"}}'
                    + (f" className=\"{cls}\"" if cls else "")
                    + " />"
                )

            text = PAT_EYE.sub(sub_eye, text)

            def sub_plain(m):
                name, size, rest = split_classes(m.group("classes"))
                if name is None:
                    return m.group(0)
                props = (m.group("rest") or "").strip()
                if "aria-hidden" in props:
                    props = re.sub(r'aria-hidden="[^"]*"\s*', "", props)
                return build(name, size, rest, props)

            text = PAT_PLAIN.sub(sub_plain, text)
            text = PAT_STRAY.sub(r"\1\2", text)

            if text != orig:
                text = add_import(text, path)
                with open(path, "w") as fh:
                    fh.write(text)
                changed.append(os.path.relpath(path))
    for c in changed:
        print("rewrote", c)
    print(f"{len(changed)} file(s) changed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
