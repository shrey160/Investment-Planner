# Multi-Portfolio Compound Interest Calculator

An interactive investment calculator that lets you model, compare, and stress-test multiple portfolios on a shared timeline — with inflation-adjusted deposits, staggered start years, portfolio maturity actions, major spend events, cross-portfolio transfers, deposit pauses (including open-ended), continuous withdrawals, interactive chart zooming, calendar year labels, CSV export/import, and multi-currency display.

---

## Getting started

Open `index.html` in any modern browser. No build step or server required. Keep all files in the same folder:

```
index.html
styles.css
app.js
deplib/
  chart.umd.js
  chartjs-plugin-annotation.min.js
  hammer.min.js
  chartjs-plugin-zoom.min.js
```

Two portfolios are pre-loaded. Every change — slider, toggle, typed value, or event — updates the chart and summary cards instantly.

---

## Shared timeline

All year numbers across the app refer to the **global timeline** shown on the chart. Year 0 is "Now". If a portfolio starts at year 5, then a spend at year 8 hits that portfolio during its third active year. Pauses, spends, transfers, and withdrawals all use the same global year scale.

---

## Portfolios tab

### Adding and removing portfolios

- Click **+ Add portfolio** to create a new one. Each gets a unique colour automatically.
- Click **×** on a portfolio header to delete it. All associated events (spends, transfers, pauses, withdrawals) are removed too.
- Click **− collapse** to tuck a portfolio away. Click **+ expand** to reopen.

### Renaming a portfolio

Click directly on the portfolio name and type. Names update everywhere — the chart legend, summary cards, dropdowns, and event cards.

### Portfolio settings

Each portfolio has seven slider controls:

| Setting | What it does |
|---|---|
| **Initial deposit** | Lump sum placed at the portfolio's start year |
| **Annual deposit** | Added each active year |
| **Interest rate** | Annual return rate (%) |
| **Inflation rate** | Used to scale annual deposits if the toggle is on |
| **Years** | How long the portfolio runs from its start year |
| **Start year** | The global year this portfolio begins (0 = Now) |
| **Inflate deposits** | When on, annual deposit grows each year by the inflation rate |

**Slider range vs typed range** — sliders go from ₹0 to ₹20L for practical dragging. Click any value label to type a precise number up to ₹20Cr.

### At end of term

Below the sliders, each portfolio has an **At end of term** setting with two options:

- **Keep balance** (default) — balance is frozen after the active years end; no further compounding or deposits, but withdrawals and transfers still apply
- **Transfer to** — the entire final balance is moved to a chosen portfolio at the close year. The source portfolio drops to ₹0; the target receives the full amount and continues compounding it forward

### Summary cards

Each portfolio shows **Final balance**, **Total deposited**, and **Interest earned** at a glance.

---

## Chart

The line chart shows each portfolio's balance over the global timeline.

- **Solid line** — active years
- **Dashed flat line** — after a portfolio closes, balance held (unless transferred)
- **Orange dashed vertical lines** — major spend events
- **Coloured shaded boxes (top-anchored label)** — deposit pause periods
- **Coloured shaded boxes (bottom-anchored label)** — continuous withdrawal periods

Hovering over any point shows a tooltip with the balance plus any spends, pauses, or withdrawals active that year.

### Show total

Displays a dashed grey line summing all portfolios. Closed portfolios contribute their final held value (or ₹0 if transferred out). A **Total** card appears in the summary row.

### Zoom and pan

- **Scroll wheel / pinch** — zoom in/out
- **Drag** — pan along the zoomed view
- **X / Y / XY buttons** — choose which axis zooms
- **↺ Reset zoom** — appears when zoomed; click to return to full view

### Pause and withdrawal shading toggles

- **Pause shading** — show/hide the pause-period boxes
- **Withdrawal shading** — show/hide the withdrawal-period boxes

### Calendar years

Click **Calendar years** in the chart header to switch the X axis from relative labels ("Yr 5") to actual calendar years ("2030"). Enter your base year in the input that appears. The underlying data and all event years are unchanged — only the axis labels update.

---

## Major spends tab

Model large one-off withdrawals — a house purchase, a car, school fees, etc.

Each event has a **global year**, a **label**, and a **per-portfolio amount**. Leave a portfolio blank to exclude it.

### Editing a spend event

Every saved event is fully editable. Click **Edit amounts** to expand inline inputs for **all current portfolios** — including ones added after the event was created. Coloured pills show set amounts; muted grey pills show which portfolios aren't affected.

---

## Transfers tab

Move a fixed amount from one portfolio to another at a specific global year. The source dips and the destination rises; both continue compounding from their new balances.

Transfers apply even during pause periods and after a portfolio's active years end.

---

## Pause deposits tab

Skip the annual deposit for a portfolio during a set of global years. Compounding continues uninterrupted — only the cash injection is skipped.

### Year range syntax

Enter years using single values, closed ranges, or open-ended ranges — all in one field:

| Input | Meaning |
|---|---|
| `8` | Year 8 only |
| `3-6` | Years 3, 4, 5, 6 |
| `3-6, 8` | Years 3–6 and year 8 |
| `27-I` | Year 27 to the end of the timeline (∞) |
| `3-6, 27-I` | Years 3–6, then year 27 onwards forever |

`I` stands for infinity. `∞`, `inf`, and `infinity` also work. A live preview below the input confirms the parsed years before you save.

Open-ended pauses extend the chart shading to the right edge and are labelled **"paused ∞"** in the annotation.

---

## Withdrawals tab

A recurring annual withdrawal from a portfolio over a global year range. Optionally grows each year with inflation to preserve real purchasing power.

| Field | What it does |
|---|---|
| **Portfolio** | Which portfolio to withdraw from |
| **Start / End year** | Global year range (inclusive) |
| **Annual withdrawal amount** | Base amount per year |
| **Inflation rate (%)** | Rate at which the withdrawal grows annually |
| **Adjust for inflation** | When on, amount increases each year by the inflation rate |

Hovering over a year in the withdrawal range shows the exact inflation-adjusted amount for that year in the tooltip.

---

## Currency

All values are stored in Indian Rupees (₹). Conversion is display-only — the underlying data never changes.

### Switching currency

1. Click **Custom currency**.
2. Enter the conversion ratio (`1 ÷ exchange rate`, e.g. `1 ÷ 91 ≈ 0.011` for USD).
3. Enter the currency symbol.

```
Examples:
  USD  →  1 ÷ 91  ≈ 0.011
  EUR  →  1 ÷ 100 ≈ 0.010
  GBP  →  1 ÷ 108 ≈ 0.0093
  AED  →  1 ÷ 25  ≈ 0.040
```

---

## Export and import

### Exporting

Click **↓ Export CSV** to download `portfolio_data.csv` with three sections:

- **Year-by-year balances** — one row per global year, one column per portfolio, plus Total
- **Portfolio summary** — full settings (including maturity action) and results per portfolio
- **Events** — spend events, transfers, deposit pauses (including open-ended), and continuous withdrawals

### Importing

Click **↑ Import CSV** and select a previously exported file. The importer restores all portfolios, maturity settings, events, pauses (including open-ended ranges), withdrawals, and the currency setting. The current session is fully replaced.

A green message confirms success; a red message describes any error.

---

## File structure

```
index.html      — HTML structure and layout
styles.css      — All visual styling, warm-linen palette, light/dark mode
app.js          — All application logic
deplib/         — Local copies of third-party libraries
  chart.umd.js                        — Chart.js 4.4.1
  chartjs-plugin-annotation.min.js   — Annotation plugin 3.0.1
  hammer.min.js                       — Hammer.js 2.0.8 (touch support)
  chartjs-plugin-zoom.min.js          — Zoom plugin 2.0.1
```

Download URLs for the deplib files:

| File | URL |
|---|---|
| `chart.umd.js` | `https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js` |
| `chartjs-plugin-annotation.min.js` | `https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@3.0.1/dist/chartjs-plugin-annotation.min.js` |
| `hammer.min.js` | `https://cdn.jsdelivr.net/npm/hammerjs@2.0.8/hammer.min.js` |
| `chartjs-plugin-zoom.min.js` | `https://cdn.jsdelivr.net/npm/chartjs-plugin-zoom@2.0.1/dist/chartjs-plugin-zoom.min.js` |

---

## Tips

- **Model staggered strategies** — set one portfolio to start now and another at year 10 to plan ahead for a future goal like a child's education fund.
- **Simulate retirement** — set a portfolio's end year to your retirement year, choose "Transfer to" another portfolio, and model your retirement corpus flowing into a drawdown fund.
- **Open-ended pause** — use `27-I` to model a permanent career exit or a portfolio where deposits stop at a specific year and never resume.
- **Inflation-adjusted withdrawal** — set the withdrawal inflation rate to match your expected cost-of-living growth to see how long a retirement corpus lasts in real terms.
- **Stress-test big purchases** — add a spend event to multiple portfolios at the same year to compare which strategy survives it better.
- **Transfer at maturity** — set a short-term savings portfolio to transfer its balance into your long-term equity portfolio at maturity, and watch the compounding effect.
- **Rebalance mid-way** — use the Transfers tab to move funds between portfolios at a specific year to simulate a planned rebalancing.
- **Calendar year labels** — toggle Calendar years and enter your current year to see actual target years ("2040" instead of "Yr 15") for milestones like retirement.
- **Zoom in on key years** — scroll-zoom on the X axis to examine a specific decade, then hit ↺ Reset zoom to return.
- **Toggle shading** — use Pause shading and Withdrawal shading buttons to declutter the chart when many events overlap.
- **Export and share** — Export CSV to save your setup, then import it on another device or share it with a financial advisor.
- **Click values to type** — click any slider value label to type a precise number instead of dragging. Accepts up to ₹20Cr.
- **Collapse settled portfolios** — once a portfolio is configured, collapse it to reduce clutter while working on others.