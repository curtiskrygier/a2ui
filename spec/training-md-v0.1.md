# training.md — Domain Spec v0.1

**Status:** Draft v0.1 (2026-07-02)
**Domain selector:** `training`
**Consumers:** deterministic MD→payload parser (GAS add-on) → `training` runbook → A2UI renderer
**Reference output:** the clasp KT runbook app (`clasp-runbook.json`)

This document is the complete output contract for producing a compliant
`*.training.md` file from a source document. It is designed to be handed
to an LLM (Gemini Gem, Claude, etc.) *together with* the source material.
Everything after "Model Instructions" is normative.

---

## Model Instructions

You are transforming a source document (README, tutorial, runbook, tool
documentation) into a compliant `training.md` file.

1. **Omit any section the source document does not support. Do not invent
   content to satisfy the template.** A sparse output is compliant; a
   fabricated one is not. If the source has no troubleshooting content,
   there is no `# Troubleshooting` section in your output.
2. Quote commands, paths, URLs, and identifiers **exactly** as they appear
   in the source. Never normalise, abbreviate, or "improve" them.
3. Preserve the source's terminology in Concepts. Define terms using the
   source's own explanations where they exist.
4. Keep the step sequence faithful to the source's actual workflow order.
   Do not merge, reorder, or pad steps.
5. Output **only** the compliant markdown file. No preamble, no commentary,
   no code fences around the whole document.

---

## File Structure

A compliant file is: YAML frontmatter, then body sections in the order
listed below. `# Steps` is the **only required body section** — a training
document without steps is non-compliant. All other sections are optional
and appear only when the source supports them.

```
---
<frontmatter>
---
# Prerequisites      (optional)
# Concepts           (optional)
# Steps              (REQUIRED)
# Checkpoints        (optional)
# Troubleshooting    (optional)
# References         (optional)
```

---

## Frontmatter

| Key           | Required | Format                                        |
|---------------|----------|-----------------------------------------------|
| `id`          | yes      | kebab-case slug, unique, e.g. `clasp-basics`  |
| `domain`      | yes      | literal `training`                            |
| `name`        | yes      | quoted display title                          |
| `source`      | yes      | provenance of the source document (title/URL/date) |
| `license`     | yes      | licence of the **source material** (e.g. `Apache-2.0`, `Public Domain`, `Proprietary — internal use only`) |
| `subtype`     | no       | one of `tool-kt`, `course`, `onboarding`      |
| `audience`    | no       | one line describing the intended learner      |
| `est_minutes` | no       | integer, estimated completion time            |

`license` is how the IP tier is declared at intake: `Proprietary` content
renders privately and is never published. If the source's licence is not
stated, write `Unknown — verify before publishing`.

No other keys are permitted. **Never** include `render:`, layout, atom
lists, or any presentation metadata — presentation belongs to the runbook,
not the content file.

---

## Section Formats

Headings may carry a pandoc-style attribute block: `{#atom_hint .weight-high}`.
Hints are **defaults, not commands** — the parser validates them against
the atom schema snapshot; an unknown hint is a warning and the runbook's
default atom is used. Weights: `.weight-high`, `.weight-medium`,
`.weight-low` (default: medium).

### `# Prerequisites` `{#prerequisite_checklist}`

A flat bullet list. Each bullet is one setup requirement, phrased so a
learner can verify it themselves.

```markdown
# Prerequisites {#prerequisite_checklist}
- Node 18+ installed
- Google account with Apps Script API enabled
```

### `# Concepts` `{#glossary}`

Bullet list of `- **term** — definition`. One term per bullet. Definitions
come from the source, one to three sentences.

```markdown
# Concepts {#glossary .weight-high}
- **clasp** — CLI that syncs local files with an Apps Script project
- **scriptId** — the project identifier stored in .clasp.json
```

### `# Steps` (REQUIRED)

Each step is a `##` heading: `## <n>. <title> {#command_step}` where `<n>`
is a 1-based integer in sequence. The heading is followed by a key-value
block, one `key: value` per line:

| Key      | Required | Meaning                                              |
|----------|----------|------------------------------------------------------|
| `cmd`    | one of `cmd`/`do` | shell command, quoted exactly               |
| `do`     | one of `cmd`/`do` | manual action when there is no command (e.g. "approve the OAuth consent screen in the browser") |
| `expect` | no       | what the learner should observe on success            |
| `note`   | no       | one caveat or context line                            |
| `verify` | no       | how to confirm the step worked (command or check)     |

Exactly one of `cmd` or `do` per step. No prose paragraphs inside steps —
anything that isn't one of these keys belongs in `note` or doesn't belong.

```markdown
# Steps
## 1. Install clasp {#command_step}
cmd: npm install -g @google/clasp
expect: version number prints
verify: clasp --version

## 2. Authenticate {#command_step}
cmd: clasp login
note: opens a browser for OAuth consent
verify: ~/.clasprc.json exists
```

### `# Checkpoints` `{#quiz}`

`Q:`/`A:` pairs separated by blank lines. Questions test the steps and
concepts actually present in this file — never outside material.

```markdown
# Checkpoints {#quiz}
Q: Where does clasp store the project binding?
A: .clasp.json in the project root
```

### `# Troubleshooting` `{#accordion_item}`

Bullet list of `- symptom :: fix`. The `::` separator is mandatory.

```markdown
# Troubleshooting {#accordion_item}
- "User has not enabled the Apps Script API" :: enable it at script.google.com/home/usersettings
```

### `# References` `{#link_list}`

Bullet list of URLs, optionally `- label — url`.

---

## What the Parser Derives (never author these)

The MD file contains **content only**. The training runbook derives all
machinery deterministically:

- `jump_nav` — generated from step headings
- progress ring — `Computed` over `command_step` done-states
- `state_primitives`, `actions`, `wire` bindings — from the runbook template
- layout order, surface theming, accent palette — runbook + surface config

If you are tempted to write any of these into the MD, the content is in
the wrong layer.

---

## Lint Rules

Errors (parser rejects; message round-trips to the authoring LLM):

| Code | Rule |
|------|------|
| E01  | missing or malformed frontmatter |
| E02  | missing required frontmatter key (`id`, `domain`, `name`, `source`, `license`) |
| E03  | `domain` is not `training` |
| E04  | no `# Steps` section, or `# Steps` has zero steps |
| E05  | step missing both `cmd` and `do`, or has both |
| E06  | step numbering not sequential from 1 |
| E07  | unknown key inside a step block |
| E08  | `# Troubleshooting` entry without `::` separator |
| E09  | forbidden frontmatter key (`render`, or any presentation key) |
| E10  | `# Checkpoints` entry with `Q:` but no matching `A:` |

Warnings (parse succeeds; reported in coverage output):

| Code | Rule |
|------|------|
| W01  | unknown atom hint in a heading attribute (default atom used) |
| W02  | optional section absent (reported, per section, as coverage) |
| W03  | step has no `verify` (done-checkbox will be unverified self-report) |
| W04  | `license` is `Unknown — verify before publishing` |

The coverage report lists W02 findings as an audit of the **source
document**: "populated 4 of 6 sections; no Troubleshooting, no
Checkpoints" is a finding about the source's gaps, not a defect of the
output.

---

## Complete Compliant Example

```markdown
---
id: clasp-basics
domain: training
subtype: tool-kt
name: "clasp — Apps Script CLI workflow"
audience: "developers new to Apps Script"
source: "github.com/google/clasp README, June 2026"
license: "Apache-2.0"
est_minutes: 20
---

# Prerequisites {#prerequisite_checklist}
- Node 18+ installed
- Google account with Apps Script API enabled

# Concepts {#glossary .weight-high}
- **clasp** — CLI that syncs local files with an Apps Script project
- **scriptId** — the project identifier stored in .clasp.json

# Steps
## 1. Install clasp {#command_step}
cmd: npm install -g @google/clasp
expect: version number prints
verify: clasp --version

## 2. Authenticate {#command_step}
cmd: clasp login
note: opens a browser for OAuth consent
verify: ~/.clasprc.json exists

## 3. Clone an existing project {#command_step}
cmd: clasp clone <scriptId>
expect: project files download to the current directory
verify: .clasp.json exists

## 4. Push local changes {#command_step}
cmd: clasp push
expect: file list prints with "Pushed N files"

# Checkpoints {#quiz}
Q: Where does clasp store the project binding?
A: .clasp.json in the project root

Q: What must be enabled before clasp login works?
A: The Apps Script API in user settings

# Troubleshooting {#accordion_item}
- "User has not enabled the Apps Script API" :: enable it at script.google.com/home/usersettings
- "Push failed. Files in project did not match" :: run clasp pull first, resolve, then push

# References {#link_list}
- clasp repository — https://github.com/google/clasp
```

---

## Versioning

This spec is `training-md-v0.1`. A compliant file targets exactly one spec
version; the parser declares which versions it accepts (same contract
pattern as `catalogId`/`supportedCatalogIds`). Breaking changes to section
formats or step keys bump the minor version and get a new file.
