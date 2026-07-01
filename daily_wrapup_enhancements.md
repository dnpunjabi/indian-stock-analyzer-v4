# WhatsApp Daily Wrap-Up: Enterprise Enhancements & Backlog

This document outlines design patterns, requirements, and blueprints for future enterprise-grade enhancements to the Daily Market Wrap-Up feature.

---

## 📋 Table of Contents
1. [Two-Way Interactive WhatsApp Buttons](#1-two-way-interactive-whatsapp-buttons)
2. [Dynamic Chart Image Attachments](#2-dynamic-chart-image-attachments)
3. [Resilient Task Queue & Failure Alerting](#3-resilient-task-queue--failure-alerting)
4. [Customizable Message Template Builder](#4-customizable-message-template-builder)

---

## 1. Two-Way Interactive WhatsApp Buttons

### Goal
Turn the static daily wrap-up notification into an interactive mobile terminal, allowing the user to request detailed reports directly from their phone.

### Architecture & Meta Integration
*   **Message Type**: Meta Cloud API `interactive` templates (button groups or list menus).
*   **Trigger Flow**:
    ```mermaid
    sequenceDiagram
        User->>WhatsApp API: Clicks "[📊 Full Portfolio Details]"
        WhatsApp API->>FastAPI Webhook: POST /api/alerts/whatsapp/webhook
        FastAPI Webhook->>SQLite / Cache: Queries detailed holding assets
        FastAPI Webhook->>WhatsApp API: Replies with detailed asset breakdown
        WhatsApp API->>User: Displays detailed message bubble
    ```
*   **Webhook Payload Sample**:
    ```json
    {
      "object": "whatsapp_business_account",
      "entry": [{
        "changes": [{
          "value": {
            "messages": [{
              "type": "interactive",
              "interactive": {
                "type": "button_reply",
                "button_reply": { "id": "btn_portfolio_details", "title": "Portfolio Details" }
              }
            }]
          }
        }]
      }]
    }
    ```

---

## 2. Dynamic Chart Image Attachments

### Goal
Provide high-resolution visual charts representing daily portfolio performance or key sector momentum curves alongside the text summary.

### Implementation Blueprint
1.  **Rendering Engine**:
    *   Utilize `matplotlib` or `seaborn` in headless mode (using `Agg` backend) inside Python:
    ```python
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    
    # Generate daily portfolio returns area chart
    fig, ax = plt.subplots(figsize=(6, 3))
    # ... styling chart in dark mode ...
    plt.savefig('/tmp/portfolio_daily_trend.png', dpi=200, bbox_inches='tight')
    ```
2.  **Meta Media Dispatch**:
    *   Upload the compiled png via Meta’s media upload API endpoint (`POST /v1/media`).
    *   Reference the returned `media_id` when constructing the interactive message JSON payload:
    ```json
    {
      "messaging_product": "whatsapp",
      "type": "image",
      "image": { "id": "MEDIA_ID" }
    }
    ```

---

## 3. Resilient Task Queue & Failure Alerting

### Goal
Implement enterprise-grade reliability to prevent missing a wrap-up report due to server downtime, api rate limits, or network failures.

### System Design
*   **Retry with Exponential Backoff**:
    *   If Meta returns an HTTP `429` (Rate Limited) or `5xx` (Server Error), the message task is scheduled for retries:
        $$\text{Delay} = 60 \times 2^{\text{retry\_count}} \text{ seconds}$$
*   **Dead Letter Queue (DLQ)**:
    *   If all 3 retries fail, move the task status to `FAILED` in the SQLite table `daily_wrapup_logs`.
*   **Alert HUD Integration**:
    *   Expose failed dispatch indicators on the alerts tab (`index.html`) using a red diagnostic badge.

---

## 4. Customizable Message Template Builder

### Goal
Provide a user-friendly drag-and-drop dashboard widget to let the user choose which metrics to include, change layout structures, or localize wording.

### Frontend UI mockup
*   A text editing pane with predefined placeholder tags:
    *   `{date}`: Today's date string.
    *   `{nifty_performance}`: Nifty index level and % change.
    *   `{portfolio_pl}`: Realized and unrealized daily profit/loss figures.
    *   `{sectors_radar}`: Strongest and weakest sectors.
*   The edit pane stores values in SQLite as a string block under `alert_settings` with the key `daily_wrapup_template`.
