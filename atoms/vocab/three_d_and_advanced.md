---
category: three_d_and_advanced
title: 3D & Advanced Visualisation
atom_count: 4
platform_support:
  web: 4/4
  meet-stage: 4/4
  googlechat: 0/4
  apps-script-web: 4/4
  email: 0/4
  pdf: 0/4
maturity: stable
source: atoms/schema.yaml
---

# 3D & Advanced Visualisation

> 4 atoms · `*` = degraded (limited support) · Bold surface = full support

| Atom type | Description | Surfaces | Key fields |
|-----------|-------------|----------|------------|
| `call_mood_board` | visual summary board of call sentiments moods and active themes | **Web/Blog** · **Meet Stage** · **GAS Web App** | `title` — string (optional, e.g., 'Call Mood & Themes Summary')<br>`moods` — list of dictionaries representing call emotions: [{'mood': 'Collaborative', 'intensity': 85, 'color': '#10b981'}, ...]<br>`themes` — list of dictionaries representing keywords/themes: [{'term': 'Pricing', 'weight': 90, 'sentiment': 'neutral'}, ...]<br>`summary` — string (optional summary paragraph) |
| `sentiment_summary` | meeting sentiment analyzer with index arc and timeline chart | **Web/Blog** · **Meet Stage** · **GAS Web App** | `title` — string (optional, e.g., 'Call Sentiment & Mood Analysis')<br>`sentiment_index` — number representing overall positive sentiment percentage (0-100, e.g., 78)<br>`emotional_journey` — list of numbers representing call sentiment score over time intervals (values -1.0 to 1.0, e.g., [0.1, -0.2, 0.4, 0.8, 0.6])<br>`themes` — list of dictionaries representing key themes with weights or moods: [{'theme': 'Technical Alignment', 'mood': 'Analytical', 'score': 85}, ...] |
| `live_aggregator` | Real-time comparative bars for votes, counts, or percentages | **Web/Blog** · **Meet Stage** · **GAS Web App** | `items` — array of objects — label (string), value (number), color (optional hex).<br>`title` — string (optional). Section heading above the bars.<br>`max_value` — number (optional). Denominator for bar widths; auto-computed from max item value if omitted.<br>`show_values` — boolean (optional). Show numeric value next to each bar. Default true. |
| `media_stream_card` | Auto-detecting YouTube/Loom/Slides/Vimeo embed with skeleton loader | **Web/Blog** · **Meet Stage** · **GAS Web App** | `url` — string (required). Raw URL — YouTube, Loom, Google Slides, Vimeo, or any embeddable URL. Platform is auto-detected.<br>`title` — string (optional). Card label shown above the iframe. Defaults to detected platform name.<br>`height` — string (optional). CSS height for the iframe container. Default 360px. |
