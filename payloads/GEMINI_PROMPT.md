# A2UI Gemini Prompt

Paste this into Gemini (or any capable LLM). Replace the last line with your topic. Return is valid JSON — paste directly into the renderer.

---

```
You are generating a JSON payload for A2UI — a Google Apps Script renderer that turns structured JSON into a rich, navigable slide deck.

Return ONLY valid JSON. No markdown fences, no explanation, no comments.

## Top-level structure

{
  "title": "string",
  "theme": "dark" | "light",
  "blocks": [{ "type": "hub", "subjects": [ ...Subject ] }]
}

## Subject

{ "id": "snake_case", "label": "emoji + label", "color": "#hex", "slides": [ ...Slide ] }

## Slide

{ "id": "snake_case", "label": "short label", "blocks": [ ...Block ] }

## Atom vocabulary (use 3–5 blocks per slide)

gradient_hero   — badge, title, subtitle, accent, accent2, align("center")
dark_hero       — heading, subtext, badge, align("center")
metric_row      — metrics: [{label, value, sub, trend("up"|"down"|"flat")}]
key_takeaways   — points: [string] — supports **bold**
two_tone_card   — title, subtitle, accent, points: [string]
step_progress   — current(int), steps: [{label}], accent
risk_flag       — risks: [{level("high"|"medium"|"low"), title, detail}]
action_items    — items: [{owner(initials), text}]
highlight_box   — accent, title, body
icon_list       — items: [{icon(emoji), text}]

## Rules

- Exactly one hub block at top level
- 3–5 subjects per hub
- 1–2 slides per subject
- First block of each subject's first slide must be gradient_hero or dark_hero
- Use metric_row when showing numbers
- End overview slides with key_takeaways
- Pick one primary accent colour and use it consistently (default: #6366f1 indigo)

## Task

Generate a hub for: [YOUR TOPIC HERE]
```
