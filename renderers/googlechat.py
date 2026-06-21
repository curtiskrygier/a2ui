"""Google Chat cardsV2 renderer — block list → cardsV2 JSON.

Takes a list of typed block dicts (conforming to atoms/schema.yaml) and returns
a complete Google Chat message dict with cardsV2 format, ready to POST to a webhook.

Only renders atoms tagged works_on: googlechat in the schema.
Atoms tagged degraded_on: googlechat get best-effort cardsV2 approximations.
Atoms tagged incompatible_on: googlechat are skipped with a comment widget.
"""

from typing import List, Dict, Any
import re


# ── Helpers ───────────────────────────────────────────────────────────────────

def _md_to_chat(text: str) -> str:
    """Convert basic markdown to Google Chat textParagraph HTML subset.
    Chat supports: <b>, <i>, <s>, <u>, <a href>, <font color>, <br>.
    """
    text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)
    text = re.sub(r'\*(.+?)\*',     r'<i>\1</i>', text)
    text = re.sub(r'`(.+?)`',       r'<font color="#1a73e8">\1</font>', text)
    text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', text)
    return text


def _text(text: str) -> Dict:
    return {"textParagraph": {"text": _md_to_chat(text)}}


def _divider() -> Dict:
    return {"divider": {}}


def _button(label: str, url: str = "", color: str = "") -> Dict:
    btn = {"text": label}
    if url:
        btn["onClick"] = {"openLink": {"url": url}}
    if color:
        btn["color"] = _hex_to_color(color)
    return btn


def _hex_to_color(hex_color: str) -> Dict:
    """Convert hex color to Google Chat RGBA dict."""
    h = hex_color.lstrip('#')
    if len(h) == 6:
        r, g, b = int(h[0:2], 16)/255, int(h[2:4], 16)/255, int(h[4:6], 16)/255
        return {"red": round(r, 3), "green": round(g, 3), "blue": round(b, 3), "alpha": 1.0}
    return {"red": 0, "green": 0, "blue": 0, "alpha": 1.0}


# ── Atom renderers ────────────────────────────────────────────────────────────

def _render_intro(b: dict) -> List[Dict]:
    parts = []
    if b.get("series_label") and b.get("series_url"):
        text = f'<i>In <a href="{b["series_url"]}">{b["series_label"]}</a>, {_md_to_chat(b.get("continuation", ""))}</i>'
        parts.append(_text(text))
    if b.get("note"):
        parts.append(_text(f'<i>{_md_to_chat(b["note"])}</i>'))
    return parts


def _render_body(b: dict) -> List[Dict]:
    paragraphs = b.get("text", "").strip().split("\n\n")
    return [_text(_md_to_chat(p.strip())) for p in paragraphs if p.strip()]


def _render_heading(b: dict) -> List[Dict]:
    return [_text(f'<b>{_md_to_chat(b.get("text", ""))}</b>')]


def _render_subheading(b: dict) -> List[Dict]:
    return [_text(f'<b>{_md_to_chat(b.get("text", ""))}</b>')]


def _render_quote(b: dict) -> List[Dict]:
    # Degraded: no blockquote in Chat — use italic with dash prefix
    text = f'<i>"{_md_to_chat(b.get("text", ""))}"</i>'
    if b.get("attribution"):
        text += f'<br/>— <b>{b["attribution"]}</b>'
    return [_text(text)]


def _render_code(b: dict) -> List[Dict]:
    # Degraded: no syntax highlighting — monospace via font tag
    lang = b.get("language", "")
    content = b.get("content", "").replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br/>")
    label = f'<b><font color="#1a73e8">{lang}</font></b><br/>' if lang else ""
    return [_text(f'{label}<font color="#666">{content}</font>')]


def _render_bullet_list(b: dict) -> List[Dict]:
    items = b.get("items", [])
    lines = []
    for item in items:
        if item.get("label"):
            lines.append(f'• <b>{_md_to_chat(item["label"])}</b> {_md_to_chat(item.get("text", ""))}')
        else:
            lines.append(f'• {_md_to_chat(item.get("text", ""))}')
    return [_text("<br/>".join(lines))]


def _render_divider(b: dict) -> List[Dict]:
    return [_divider()]


def _render_image(b: dict) -> List[Dict]:
    widgets = [{"image": {"imageUrl": b.get("url", ""), "altText": b.get("alt", "")}}]
    if b.get("caption"):
        widgets.append(_text(f'<font color="#999"><i>{b["caption"]}</i></font>'))
    return widgets


def _render_image_pair(b: dict) -> List[Dict]:
    # Degraded: use columns widget for side-by-side
    left  = b.get("left",  {})
    right = b.get("right", {})
    widgets = [{
        "columns": {
            "columnItems": [
                {
                    "horizontalSizeStyle": "FILL_AVAILABLE_SPACE",
                    "widgets": [
                        {"image": {"imageUrl": left.get("url", ""), "altText": left.get("alt", "")}},
                        *([_text(f'<font color="#999"><i>{left["caption"]}</i></font>')] if left.get("caption") else [])
                    ]
                },
                {
                    "horizontalSizeStyle": "FILL_AVAILABLE_SPACE",
                    "widgets": [
                        {"image": {"imageUrl": right.get("url", ""), "altText": right.get("alt", "")}},
                        *([_text(f'<font color="#999"><i>{right["caption"]}</i></font>')] if right.get("caption") else [])
                    ]
                }
            ]
        }
    }]
    return widgets


def _render_repo_links(b: dict) -> List[Dict]:
    buttons = [_button(l["label"], l.get("url", "")) for l in b.get("links", [])]
    return [{"buttonList": {"buttons": buttons}}]


def _render_closing(b: dict) -> List[Dict]:
    widgets = [_text(_md_to_chat(b.get("text", "")))]
    tags = b.get("tags", [])
    if tags:
        widgets.append(_text(f'<font color="#999">{" ".join("#" + t for t in tags)}</font>'))
    return widgets


def _render_callout(b: dict) -> List[Dict]:
    # Degraded: use decoratedText with icon for kind
    icon_map = {"info": "INFO", "warning": "WARNING", "tip": "STAR", "danger": "ERROR"}
    color_map = {"info": "#1a73e8", "warning": "#f9ab00", "tip": "#34a853", "danger": "#ea4335"}
    kind  = b.get("kind", "info")
    icon  = icon_map.get(kind, "INFO")
    color = color_map.get(kind, "#1a73e8")
    title = b.get("title", "")
    text  = _md_to_chat(b.get("text", ""))
    content = f'<b><font color="{color}">{title}</font></b><br/>{text}' if title else f'<font color="{color}">{text}</font>'
    return [{
        "decoratedText": {
            "startIcon": {"knownIcon": icon},
            "text": content,
            "wrapText": True
        }
    }]


def _render_table(b: dict) -> List[Dict]:
    # Degraded: render as formatted textParagraph rows
    headers = b.get("headers", [])
    rows    = b.get("rows", [])
    caption = b.get("caption", "")
    lines   = []
    if caption:
        lines.append(f'<i><font color="#999">{caption}</font></i>')
    if headers:
        lines.append("<b>" + " | ".join(headers) + "</b>")
        lines.append("—" * 30)
    for row in rows:
        lines.append(" | ".join(str(c) for c in row))
    return [_text("<br/>".join(lines))]


def _render_key_value(b: dict) -> List[Dict]:
    items   = b.get("items", [])
    title   = b.get("title", "")
    widgets = []
    if title:
        widgets.append(_text(f'<b>{title}</b>'))
    for item in items:
        req = " <font color=\"#ea4335\">*required</font>" if item.get("required") else ""
        default = f' <font color="#34a853">default: {item["default"]}</font>' if "default" in item else ""
        widgets.append({
            "decoratedText": {
                "topLabel": item.get("key", ""),
                "text": _md_to_chat(item.get("description", "")) + req + default,
                "wrapText": True
            }
        })
    return widgets


def _render_stat_card(b: dict) -> List[Dict]:
    value  = b.get("value", "—")
    label  = b.get("label", "")
    delta  = b.get("delta", "")
    is_up  = b.get("is_up", True)
    arrow  = "▲" if is_up else "▼"
    color  = "#34a853" if is_up else "#ea4335"
    delta_html = f' <font color="{color}">{arrow} {delta}</font>' if delta else ""
    return [{
        "decoratedText": {
            "topLabel": label.upper(),
            "text": f'<b>{value}</b>{delta_html}',
            "wrapText": False
        }
    }]


def _render_badge_group(b: dict) -> List[Dict]:
    badges  = b.get("badges", [])
    title   = b.get("title", "")
    COLOR_HEX = {
        "green": "#34a853", "cyan": "#00acc1", "blue": "#4285f4",
        "yellow": "#f9ab00", "red": "#ea4335", "purple": "#8430ce", "grey": "#9aa0a6"
    }
    chips = []
    for badge in badges:
        color = COLOR_HEX.get(badge.get("color", "grey"), "#9aa0a6")
        chips.append({
            "label": badge.get("text", ""),
            "labelType": "LABEL",
        })
    widgets = []
    if title:
        widgets.append(_text(f'<font color="#999"><i>{title}</i></font>'))
    if chips:
        widgets.append({"chipList": {"chips": chips}})
    return widgets


def _render_gallery(b: dict) -> List[Dict]:
    images  = b.get("images", [])
    caption = b.get("caption", "")
    # Use cardsV2 grid widget
    items   = []
    for img in images[:4]:  # grid supports up to 4 cleanly
        item = {"image": {"imageUri": img.get("url", ""), "altText": img.get("alt", "")}}
        if img.get("caption"):
            item["title"] = img["caption"]
        items.append(item)
    widgets = [{"grid": {"columnCount": min(len(items), 3), "items": items}}]
    if caption:
        widgets.append(_text(f'<font color="#999"><i>{caption}</i></font>'))
    return widgets


def _render_divider_fallback(b: dict) -> List[Dict]:
    return [_divider()]


# ── Incompatible fallback ─────────────────────────────────────────────────────

def _incompatible(atom_type: str) -> List[Dict]:
    return [_text(f'<font color="#ea4335"><i>[{atom_type} not supported in Google Chat]</i></font>')]


# ── Registry ─────────────────────────────────────────────────────────────────

RENDERERS: Dict[str, Any] = {
    # works_on: googlechat
    "intro":        _render_intro,
    "body":         _render_body,
    "heading":      _render_heading,
    "subheading":   _render_subheading,
    "bullet_list":  _render_bullet_list,
    "closing":      _render_closing,
    "divider":      _render_divider,
    "image":        _render_image,
    "repo_links":   _render_repo_links,
    # degraded_on: googlechat (best-effort)
    "quote":        _render_quote,
    "code":         _render_code,
    "pipeline":     lambda b: [_text(" ──► ".join(b.get("steps", [])))],
    "image_pair":   _render_image_pair,
    "diagram":      lambda b: _render_image(b),
    "table":        _render_table,
    "key_value":    _render_key_value,
    "callout":      _render_callout,
    "steps":        lambda b: [_text("<br/>".join(
                        f'<b>{i+1}.</b> {"<b>" + s["label"] + "</b> " if s.get("label") else ""}{_md_to_chat(s.get("text",""))}'
                        for i, s in enumerate(b.get("items", []))))],
    "api_reference": lambda b: _render_key_value({
                        "title": b.get("name", ""),
                        "items": b.get("parameters", [])
                    }),
    "timeline":     lambda b: [_text("<br/>".join(
                        f'<b><font color="#1a73e8">{e.get("date","")}</font></b> {e.get("label","")} — {_md_to_chat(e.get("text",""))}'
                        for e in b.get("events", [])))],
    "gallery":      _render_gallery,
    "stat_card":    _render_stat_card,
    "badge_group":  _render_badge_group,
    "metric_delta": lambda b: [{"textParagraph": {"text": "<b>" + b.get("label", b.get("title", "metric_delta")) + "</b><br/>" + b.get("text", b.get("content", ""))}}],
    "trend_indicator": lambda b: [{"textParagraph": {"text": "<b>" + b.get("label", b.get("title", "trend_indicator")) + "</b><br/>" + b.get("text", b.get("content", ""))}}],
    "glossary_term": lambda b: [{"textParagraph": {"text": "<b>" + b.get("label", b.get("title", "glossary_term")) + "</b><br/>" + b.get("text", b.get("content", ""))}}],
    "footnote": lambda b: [{"textParagraph": {"text": "<b>" + b.get("label", b.get("title", "footnote")) + "</b><br/>" + b.get("text", b.get("content", ""))}}],
    "pull_stat": lambda b: [{"textParagraph": {"text": "<b>" + b.get("label", b.get("title", "pull_stat")) + "</b><br/>" + b.get("text", b.get("content", ""))}}],
    "audio_link": lambda b: [{"textParagraph": {"text": "<b>" + b.get("label", b.get("title", "audio_link")) + "</b><br/>" + b.get("text", b.get("content", ""))}}],
    "document_link": lambda b: [{"textParagraph": {"text": "<b>" + b.get("label", b.get("title", "document_link")) + "</b><br/>" + b.get("text", b.get("content", ""))}}],
    "image_with_caption": lambda b: [{"textParagraph": {"text": "<b>" + b.get("label", b.get("title", "image_with_caption")) + "</b><br/>" + b.get("text", b.get("content", ""))}}],
    "action_required_card": lambda b: [{"textParagraph": {"text": "<b>" + b.get("label", b.get("title", "action_required_card")) + "</b><br/>" + b.get("text", b.get("content", ""))}}],
    "pricing_tier_card": lambda b: [{"textParagraph": {"text": "<b>" + b.get("label", b.get("title", "pricing_tier_card")) + "</b><br/>" + b.get("text", b.get("content", ""))}}],
    "pros_cons_list": lambda b: [{"textParagraph": {"text": "<b>" + b.get("label", b.get("title", "pros_cons_list")) + "</b><br/>" + b.get("text", b.get("content", ""))}}],
    "rating_comparison": lambda b: [{"textParagraph": {"text": "<b>" + b.get("label", b.get("title", "rating_comparison")) + "</b><br/>" + b.get("text", b.get("content", ""))}}],
    "entity_list": lambda b: [_text("<br/>".join(
        "<b>" + e.get("name", "") + "</b>"
        + (" — " + e.get("subtitle", "") if e.get("subtitle") else "")
        + (" [" + e.get("status", "") + "]" if e.get("status") else "")
        for e in b.get("items", [])
    ))],
    "model_card": lambda b: [_text(
        "<b>" + b.get("name", "") + "</b>"
        + (" · " + b.get("provider", "") if b.get("provider") else "")
        + ("<br/>" + b.get("description", "") if b.get("description") else "")
    )],
    "conversation_snippet": lambda b: [_text(
        "<b>" + b.get("user_label", "You") + ":</b> " + b.get("user", "")
        + "<br/><b>" + b.get("ai_label", "Assistant") + ":</b> " + b.get("response", "")
    )],
    "shortcut_legend": lambda b: [_text(
        ("<b>" + b.get("title", "") + "</b><br/>" if b.get("title") else "")
        + "<br/>".join(
            " + ".join(i.get("keys", [])) + " — " + i.get("action", "")
            for i in b.get("items", [])
        )
    )],
    "rating_summary_bar": lambda b: [_text(
        "⭐ <b>" + str(b.get("average", "")) + "</b>"
        + (" / " + str(b.get("total", "")) + " ratings" if b.get("total") else "")
    )],
    "roadmap_card": lambda b: [_text(
        "<b>" + b.get("title", b.get("name", "Roadmap")) + "</b>"
        + ("<br/>" + b.get("description", b.get("text", "")) if b.get("description") or b.get("text") else "")
    )],
    "notification_stack": lambda b: [_text(
        "<br/>".join(
            "🔔 <b>" + n.get("title", "") + "</b>"
            + (" — " + n.get("body", "") if n.get("body") else "")
            for n in b.get("notifications", [])[:3]
        ) or "🔔 " + b.get("title", "notification_stack")
    )],
    "text_callout": lambda b: [_text(b.get("text", b.get("content", "")))],
}


# ── Builder ───────────────────────────────────────────────────────────────────

def render(blocks: List[Dict[str, Any]],
           title: str = "",
           subtitle: str = "") -> Dict[str, Any]:
    """Render a list of blocks to a Google Chat cardsV2 message.

    Args:
        blocks:   List of block dicts conforming to atoms/schema.yaml
        title:    Optional card header title
        subtitle: Optional card header subtitle

    Returns:
        Google Chat message dict with cardsV2 format — POST to webhook directly
    """
    sections = []
    current_widgets = []

    for block in blocks:
        btype = block.get("type", "")
        fn = RENDERERS.get(btype)

        if fn is None:
            # Incompatible atom — add fallback
            current_widgets.extend(_incompatible(btype))
            continue

        widgets = fn(block)

        # Headings start a new section
        if btype in ("heading",) and current_widgets:
            sections.append({"widgets": current_widgets})
            current_widgets = []

        current_widgets.extend(widgets)

    if current_widgets:
        sections.append({"widgets": current_widgets})

    card = {"sections": sections if sections else [{"widgets": []}]}
    if title:
        card["header"] = {
            "title": title,
            "subtitle": subtitle or "",
        }

    return {"cardsV2": [{"cardId": "1", "card": card}]}


def post(blocks: List[Dict[str, Any]], webhook_url: str,
         title: str = "", subtitle: str = "") -> Dict:
    """Render blocks and POST to a Google Chat webhook."""
    import requests as req
    message = render(blocks, title=title, subtitle=subtitle)
    resp = req.post(webhook_url, json=message)
    return {"status": resp.status_code, "response": resp.json() if resp.ok else resp.text}
