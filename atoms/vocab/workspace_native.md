---
category: workspace_native
title: Workspace-Native (Apps Script only)
atom_count: 14
platform_support:
  web: 0/14
  meet-stage: 0/14
  googlechat: 0/14
  apps-script-web: 14/14
  email: 0/14
  pdf: 0/14
maturity: stable
source: atoms/schema.yaml
---

# Workspace-Native (Apps Script only)

> 14 atoms · `*` = degraded (limited support) · Bold surface = full support

| Atom type | Description | Surfaces | Key fields |
|-----------|-------------|----------|------------|
| `drive_file_list` | live list of Drive folder files | **GAS Web App** | `folder_id` — string. The Google Drive folder ID to list files from.<br>`max_results` — integer (optional). Maximum number of files to return. Default is 10. |
| `sheet_preview` | live read-only Google Sheet range preview | **GAS Web App** | `spreadsheet_id` — string. The Google Sheets ID.<br>`sheet_name` — string. The name of the sheet tab.<br>`range` — string. The A1 notation range (e.g. A1:D10). |
| `gmail_summary` | list of recent Gmail messages matching query | **GAS Web App** | `query` — string. The search query (e.g. "is:unread label:work").<br>`max_results` — integer (optional). Maximum number of emails to display. Default is 5. |
| `calendar_upcoming` | list of upcoming calendar events | **GAS Web App** | `max_results` — integer (optional). Maximum number of upcoming events to show. Default is 5. |
| `user_greeting` | personalised greeting with active user email | **GAS Web App** | `prefix` — string (optional). The greeting prefix. Default is "Hello". |
| `script_run_button` | button to trigger server-side Apps Script function | **GAS Web App** | `label` — string. The button text.<br>`function_name` — string. The name of the server-side V8 JavaScript function to call.<br>`argument` — string (optional). Optional string argument to pass to the function. |
| `calendar_today` | today's calendar events from the user's default calendar | **GAS Web App** | `title` — string (optional). Card heading. Default is "Today's Schedule".<br>`max_results` — integer (optional). Maximum events to show. Default 8. |
| `drive_recent_files` | recently modified files across the user's Drive with type icons and dates | **GAS Web App** | `label` — string (optional). Card heading. Default is "Recent Files".<br>`max_results` — integer (optional). Maximum files to show. Default 8. |
| `sheet_stats` | aggregate stats from a sheet range displayed as stat badges | **GAS Web App** | `spreadsheet_id` — string. The Google Sheets ID.<br>`sheet_name` — string (optional). Sheet tab name.<br>`range` — string. A1 notation range (e.g. B2:B50).<br>`label` — string (optional). Card heading. Default is "Sheet Stats".<br>`show` — array (optional). Which stats to show — any of sum, average, count, min, max. Default ["sum","average","count"].<br>`accent` — string (optional). Accent colour for stat values. |
| `gmail_unread_count` | unread count badges for Gmail labels | **GAS Web App** | `labels` — array (optional). Gmail label names to count. Default ["INBOX"].<br>`title` — string (optional). Card heading. Default is "Gmail".<br>`accent` — string (optional). Badge colour for non-zero counts. Default red. |
| `user_profile_card` | user avatar, display name, email and domain from active session | **GAS Web App** | `accent` — string (optional). Avatar background colour.<br>`subtitle` — string (optional). Role or team label shown below the email. |
| `drive_storage_usage` | Drive storage quota as a labelled progress bar | **GAS Web App** | `label` — string (optional). Card heading. Default is "Drive Storage".<br>`accent` — string (optional). Bar colour below 70% usage. |
| `sheet_form_submit` | inline form that appends a row to a Google Sheet on submit | **GAS Web App** | `spreadsheet_id` — string. Target Google Sheets ID.<br>`sheet_name` — string (optional). Sheet tab name. Default is "Sheet1".<br>`title` — string (optional). Form heading.<br>`fields` — array. Array of {label, name, type, placeholder} objects. type is text, email, number, or textarea.<br>`submit_label` — string (optional). Submit button text. Default is "Submit".<br>`accent` — string (optional). Submit button colour. |
| `tasks_today` | incomplete Google Tasks from the user's task list | **GAS Web App** | `title` — string (optional). Card heading. Default is "Today's Tasks".<br>`max_results` — integer (optional). Maximum tasks to show. Default 10.<br>`list_name` — string (optional). Name of the task list. Defaults to the first list. |
