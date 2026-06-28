#!/usr/bin/env python3
"""
Generate individual atom reference pages from atoms/schema.yaml.
Outputs to public/atoms/{type}/index.html — served at a2uicatalog.ai/atoms/{type}

Run:
  python3 scripts/generate_atom_pages.py
"""
import json
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("pip install pyyaml", file=sys.stderr)
    sys.exit(1)

ROOT       = Path(__file__).parent.parent
SCHEMA     = ROOT / "atoms" / "schema.yaml"
OUTPUT_DIR = ROOT / "public" / "atoms"
DOMAIN     = "a2uicatalog.ai"

PAGE_CSS = """
<style>
:root{--bg:#0c1117;--card:#161b22;--border:#30363d;--text:#e6edf3;--muted:#8b949e;--cyan:#00f2ff;--green:#3fb950}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:16px;line-height:1.6}
body{max-width:860px;margin:0 auto;padding:48px 24px 96px}
nav{font-size:13px;color:var(--muted);margin-bottom:32px}
nav a{color:var(--cyan);text-decoration:none}
nav a:hover{text-decoration:underline}
h1{font-size:2.4rem;font-weight:800;letter-spacing:-1px;margin-bottom:8px}
.desc{font-size:1.15rem;color:var(--muted);margin-bottom:32px;line-height:1.7}
.label{font-size:11px;font-weight:800;letter-spacing:.15em;text-transform:uppercase;color:var(--cyan);margin-bottom:12px}
.section{margin-bottom:40px}
.badge{display:inline-block;font-size:11px;font-weight:600;padding:3px 10px;border-radius:100px;margin:2px}
.bs{background:rgba(0,242,255,.08);border:1px solid rgba(0,242,255,.25);color:var(--cyan)}
.bd{background:rgba(255,196,0,.08);border:1px solid rgba(255,196,0,.25);color:#ffc400}
pre{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:20px;overflow-x:auto;margin:12px 0 24px}
pre code{color:var(--text);font-size:13px;font-family:monospace}
table{width:100%;border-collapse:collapse;margin:12px 0 24px;font-size:14px}
th{text-align:left;padding:10px 14px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--border)}
td{padding:10px 14px;border-bottom:1px solid var(--border);color:var(--muted);vertical-align:top}
td:first-child{color:var(--text);font-weight:600;font-family:monospace}
.back{display:inline-block;margin-top:32px;font-size:13px;color:var(--muted);border:1px solid var(--border);border-radius:6px;padding:8px 14px;text-decoration:none}
.back:hover{border-color:var(--cyan);color:var(--cyan)}
footer{margin-top:64px;padding-top:24px;border-top:1px solid var(--border);font-size:12px;color:var(--muted);display:flex;justify-content:space-between}
footer a{color:var(--cyan);text-decoration:none}
</style>
"""


def surface_badges(atom):
    surfaces = atom.get("surfaces", {})
    works_on = surfaces.get("works_on", [])
    degraded  = {d["surface"] for d in (surfaces.get("degraded_on") or [])}
    badges = []
    for s in works_on:
        cls = "bd" if s in degraded else "bs"
        suffix = " ⚠" if s in degraded else ""
        badges.append(f'<span class="badge {cls}">{s}{suffix}</span>')
    return "".join(badges) or "<span style='color:var(--muted)'>—</span>"


def fields_table(atom):
    fields = atom.get("fields", {})
    if not fields:
        return "<p style='color:var(--muted)'>No configurable fields.</p>"
    rows = ""
    for name, ftype in fields.items():
        optional = "optional" in str(ftype).lower()
        type_clean = str(ftype).replace(" (optional)", "").replace(" (Optional)", "")
        req = "optional" if optional else "required"
        rows += f"<tr><td>{name}</td><td>{type_clean}</td><td>{req}</td></tr>"
    return f"<table><thead><tr><th>Field</th><th>Type</th><th></th></tr></thead><tbody>{rows}</tbody></table>"


def example_payload(atom):
    fields = atom.get("fields", {})
    example = {"type": atom.get("type", "")}
    for name, ftype in fields.items():
        if "optional" in str(ftype).lower():
            continue
        ft = str(ftype).lower()
        if "bool" in ft:
            example[name] = True
        elif "int" in ft or "number" in ft:
            example[name] = 0
        elif "list" in ft or "array" in ft:
            example[name] = []
        elif "url" in ft:
            example[name] = "https://example.com"
        else:
            example[name] = f"Your {name.replace('_', ' ')}"
    return json.dumps(example, indent=2)


def ard_entry(atom):
    atom_type = atom.get("type", "")
    surfaces  = atom.get("surfaces", {}).get("works_on", [])
    compact   = atom.get("compact_description", "")
    desc      = atom.get("description", "")
    queries   = []
    if compact:
        queries.append(f"show a {compact.rstrip('.')}")
    if desc and desc.lower() != compact.lower():
        queries.append(desc[:100].rstrip().lower())
    queries.append(f"render a {atom_type.replace('_', ' ')}")
    queries = list(dict.fromkeys(queries))[:3]
    entry = {
        "identifier": f"urn:air:{DOMAIN}:atom:{atom_type}",
        "displayName": atom_type.replace("_", " ").title(),
        "type": "application/vnd.a2ui.atom+json",
        "url": f"https://{DOMAIN}/atoms/{atom_type}",
        "capabilities": surfaces,
        "description": desc,
        "representativeQueries": queries,
    }
    return json.dumps(entry, indent=2)


def degraded_notes(atom):
    notes = atom.get("surfaces", {}).get("degraded_on", [])
    if not notes:
        return ""
    items = "".join(
        f"<tr><td>{d['surface']}</td><td>{d.get('note', '')}</td></tr>"
        for d in notes
    )
    return f"""
<div class="section">
  <div class="label">Degraded on</div>
  <table><thead><tr><th>Surface</th><th>Note</th></tr></thead><tbody>{items}</tbody></table>
</div>"""


def render_page(atom):
    atom_type    = atom.get("type", "")
    desc         = atom.get("description", "")
    compact      = atom.get("compact_description", "")
    display_name = atom_type.replace("_", " ").title()

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>{display_name} — A2UI Atom Reference</title>
  <meta name="description" content="{desc or compact}">
  {PAGE_CSS}
</head>
<body>
  <nav>
    <a href="https://{DOMAIN}">A2UI Catalog</a> /
    <a href="https://{DOMAIN}/.well-known/ai-catalog.json">ARD Catalog</a> /
    atoms / {atom_type}
  </nav>

  <h1>{display_name}</h1>
  <p class="desc">{desc or compact}</p>

  <div class="section">
    <div class="label">Surfaces</div>
    {surface_badges(atom)}
  </div>

  {degraded_notes(atom)}

  <div class="section">
    <div class="label">Fields</div>
    {fields_table(atom)}
  </div>

  <div class="section">
    <div class="label">Example payload</div>
    <pre><code>{example_payload(atom)}</code></pre>
  </div>

  <div class="section">
    <div class="label">ARD catalog entry</div>
    <pre><code>{ard_entry(atom)}</code></pre>
  </div>

  <a class="back" href="https://{DOMAIN}/.well-known/ai-catalog.json">← Full ARD catalog</a>

  <footer>
    <span>A2UI Atom Catalog · <a href="https://github.com/a2uicatalog/a2ui">github.com/a2uicatalog/a2ui</a></span>
    <span>MIT License</span>
  </footer>
</body>
</html>"""


def main():
    with open(SCHEMA) as f:
        raw = yaml.safe_load(f)

    blocks = raw.get("blocks", [])

    # Deduplicate by type
    seen, unique = set(), []
    for block in blocks:
        t = block.get("type")
        if t and t not in seen:
            seen.add(t)
            unique.append(block)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    count = 0
    for atom in unique:
        atom_type = atom.get("type", "")
        if not atom_type:
            continue
        page_dir = OUTPUT_DIR / atom_type
        page_dir.mkdir(parents=True, exist_ok=True)
        (page_dir / "index.html").write_text(render_page(atom))
        count += 1

    print(f"✓ {count} atom pages → {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
