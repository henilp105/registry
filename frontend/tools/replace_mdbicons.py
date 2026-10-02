#!/usr/bin/env python3
"""Rewrite `<MDBIcon fas icon="x" ... />` to the shared `<Icon>` component.

Same dead-glyph problem as the FontAwesome class names: mdb-react-ui-kit's
CSS was never imported, so MDBIcon's <i class="fas fa-..."> rendered empty
too. Idempotent.
"""
import os
import re
import sys

SRC = os.path.join(os.path.dirname(__file__), "..", "src")

# MDB's `size` prop takes bootstrap-ish size names; map to our px sizes.
SIZE_MAP = {
    '"sm"': "14",
    '""': None,
    '"lg"': "20",
    '"2x"': "32",
    '"3x"': "48",
    '"4x"': "64",
    '"5x"': "80",
    '"6x"': "96",
}

PAT = re.compile(
    r'<MDBIcon\s+fa[bsr]?\s+icon=(?:"(?P<name>[a-z0-9-]+)"|\{(?P<expr>[^}]+)\})'
    r'(?P<rest>[^>]*?)/?>'
)


def main():
    changed = []
    for root, _dirs, files in os.walk(SRC):
        for fn in files:
            if not fn.endswith(".js") or fn == "Icon.js":
                continue
            path = os.path.join(root, fn)
            with open(path) as fh:
                text = fh.read()
            if "MDBIcon" not in text:
                continue
            orig = text

            def sub(m):
                name = m.group("name")
                expr = m.group("expr")
                if expr:
                    # icon={cond ? "a" : "b"} - the names pass through verbatim
                    name = "{" + expr + "}"
                rest = (m.group("rest") or "").strip()
                cls = ""
                sm = re.search(r'size="([^"]*)"', rest)
                if sm:
                    rest = rest.replace(sm.group(0), "").strip()
                    px = SIZE_MAP.get(sm.group(1))
                    if px:
                        size = px
                    else:
                        size = None
                else:
                    size = None
                cm = re.search(r'className="([^"]*)"', rest)
                if cm:
                    cls = cm.group(1)
                    rest = rest.replace(cm.group(0), "").strip()
                if name.startswith("{"):
                    parts = ["name=" + name]
                else:
                    parts = [f'name="{name}"']
                if size:
                    parts.append(f'size={{{size}}}')
                if cls:
                    parts.append(f'className="{cls}"')
                if rest:
                    parts.append(rest)
                return "<Icon " + " ".join(parts) + " />"

            text = PAT.sub(sub, text)
            if text == orig:
                continue
            if "components/Icon" not in text:
                rel = os.path.relpath(
                    os.path.join(SRC, "components", "Icon"),
                    os.path.dirname(path),
                )
                if not rel.startswith("."):
                    rel = "./" + rel
                lines = text.split("\n")
                depth = 0
                insert_at = 0
                for i, line in enumerate(lines):
                    s = line.strip()
                    if depth == 0 and s.startswith("import "):
                        depth = line.count("{") - line.count("}")
                        if depth == 0 and s.endswith(";"):
                            insert_at = i
                            continue
                    elif depth > 0:
                        depth += line.count("{") - line.count("}")
                        if depth <= 0:
                            insert_at = i
                lines.insert(insert_at + 1, f'import Icon from "{rel}";')
                text = "\n".join(lines)
            with open(path, "w") as fh:
                fh.write(text)
            changed.append(os.path.relpath(path))
    for c in changed:
        print("rewrote", c)
    print(f"{len(changed)} file(s) changed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
