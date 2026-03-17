# Multi-Portfolio Compound Interest Calculator

An interactive investment calculator that lets you model, compare, and stress-test multiple portfolios on a shared timeline — with inflation-adjusted deposits, staggered start years, major spend events, cross-portfolio transfers, deposit pauses, continuous withdrawals, CSV export/import, interactive chart zooming, and multi-currency display.

---

## Getting started

Open `index.html` in any modern browser. No build step or server required — keep `index.html`, `styles.css`, and `app.js` in the same folder.

Two portfolios are pre-loaded. Every change — slider, toggle, typed value, or event — updates the chart and all summary cards instantly.

---

## Shared timeline

All year numbers across the app refer to the **global timeline** shown on the chart. Year 0 is "now". If a portfolio starts at year 5, then a spend at year 8 hits that portfolio during its third active year. Pauses, spends, transfers, and withdrawals all use the same global year scale so they line up consistently on the chart.

---

## Portfolios tab

### Adding and removing portfolios

- Click **+ Add portfolio** to create a new one. Each gets a unique colour automatically.
- Click **×** on a portfolio header to delete it. All associated spends, transfers, pauses, and withdrawals are removed too.
- Click **− collapse** to tuck a portfolio away once configured. Click **+ expand** to reopen it.

### Renaming a portfolio

Click directly on the portfolio name and type to rename it. Names update everywhere — the chart legend, summary cards, transfer dropdowns, pause cards, and withdrawal cards.

### Portfolio settings

Each portfolio has seven independent controls:

| Setting | What it does |
|---|---|
| **Initial deposit** | The lump sum placed at the portfolio's start year |
| **Annual deposit** | How much is added each active year |
| **Interest rate** | Annual return rate (%) |
| **Inflation rate** | Used to scale annual deposits upward if the toggle is on |
| **Years** | How long the portfolio runs from its start year |
| **Start year** | The global year this portfolio begins (0 = now) |
| **Inflate deposits** | When on, the annual deposit grows each year by the inflation rate |

### Setting values by typing

Every value label next to a slider is clickable. Click it to open an inline number input, type a precise value, then press **Enter** to confirm or **Escape** to cancel.

### Summary cards

Each portfolio shows **Final balance**, **Total deposited**, and **Interest earned** at a glance.

---

## Chart

The line chart shows the balance of every portfolio over the global timeline.

- **Solid line** — active years
- **Dashed flat line** — after a portfolio closes, balance held constant
- **Orange dashed vertical lines** — major spend events
- **Coloured shaded boxes (top-anchored)** — deposit pause periods (toggle on/off)
- **Coloured shaded boxes (bottom-anchored)** — continuous withdrawal periods (toggle on/off)

Hovering over any point shows a tooltip with the balance, plus any spends, pauses, or withdrawals active that year.

### Show total toggle

Displays a dashed grey line summing all portfolios at each year. Closed portfolios contribute their final held value. A **Total** card appears in the summary row.

### Zoom and pan

- **Scroll wheel** — zoom in/out
- **Pinch** — two-finger zoom on mobile or trackpad
- **Drag** — pan along the zoomed view
- **X / Y / XY buttons** — switch which axis the scroll/pinch zooms
- **↺ Reset zoom** — appears when zoomed; click to return to full view

### Pause and withdrawal shading toggles

- **Pause shading** — shows/hides the coloured boxes marking deposit pause periods
- **Withdrawal shading** — shows/hides the coloured boxes marking continuous withdrawal periods

Both appear in the chart header and stay in sync with the legend.

---

## Major spends tab

Model large one-off withdrawals — a house down payment, a car, school fees, etc.

Each spend event has a **global year**, a **label**, and a **per-portfolio amount**. Leave a portfolio blank to exclude it from the event.

### Adding a spend event

1. Switch to **Major spends**.
2. Enter the **global year** and a **label**.
3. Enter withdrawal amounts for each affected portfolio.
4. Click **+ Add spend event**.

### Editing a spend event

Every saved spend event is fully editable. Click **Edit amounts** on any card to expand inline inputs for **all current portfolios** — including those added after the event was created. Update the label, year, and amounts then click **Save changes**.

---

## Transfers tab

Move an amount from one portfolio to another at a specific global year. The source dips and the destination rises; all subsequent compounding reflects the new balances.

1. Enter the **global year**, **amount**, **from** and **to** portfolios, and an optional label.
2. Click **+ Add transfer**.

Transfers apply even during pause periods and after a portfolio's active years end.

---

## Pause deposits tab

Skip annual deposits for a portfolio during specific global years while compounding continues uninterrupted.

Enter global years using single values or ranges: `3-6, 8, 10-12`. A live preview confirms which years will be paused before you save.

The paused periods are visualised as shaded boxes on the chart (toggle with **Pause shading**).

---

## Withdrawals tab

Set up a recurring annual withdrawal from a portfolio over a range of global years, optionally growing with inflation each year to preserve real purchasing power.

| Field | What it does |
|---|---|
| **Portfolio** | Which portfolio to withdraw from |
| **Start / End year** | Global year range for the withdrawal |
| **Annual withdrawal amount** | Base amount withdrawn each year |
| **Inflation rate (%)** | Rate at which the withdrawal amount grows annually |
| **Adjust for inflation** | When on, the amount increases each year by the inflation rate |

The withdrawal periods are visualised as shaded boxes on the chart (toggle with **Withdrawal shading**). Hovering over any year in the withdrawal range shows the exact inflation-adjusted amount for that year in the tooltip.

---

## Currency

All values default to **Indian Rupees (₹)**. The underlying data is always stored in rupees — conversion is display only.

### Switching to a custom currency

1. Click **Custom currency** in the top bar.
2. Enter the **conversion ratio** — how much 1 rupee is worth in your target currency.
3. Enter the **currency symbol**.

```
Conversion ratio = 1 ÷ exchange rate

Examples:
  USD  →  1 ÷ 91  ≈ 0.011
  EUR  →  1 ÷ 100 ≈ 0.010
  GBP  →  1 ÷ 108 ≈ 0.0093
  AED  →  1 ÷ 25  ≈ 0.040
```

---

## Export and import

### Exporting data

Click **↓ Export CSV** to download `portfolio_data.csv` with three sections:

- **Year-by-year balances** — one row per global year, one column per portfolio, plus a Total column
- **Portfolio summary** — settings and results for each portfolio
- **Events** — spend events, transfers, deposit pauses, and continuous withdrawals

### Importing data

Click **↑ Import CSV** and select a previously exported file. The importer restores all portfolios, events, pauses, withdrawals, and the currency setting. The current session is fully replaced.

A green confirmation shows on success; a red error message describes any problem if the import fails.

---

## File structure

```
index.html   — HTML structure and layout
styles.css   — All visual styling, warm-linen palette, light/dark mode
app.js       — All application logic
```

The app has no dependencies beyond Chart.js, chartjs-plugin-annotation, hammerjs, and chartjs-plugin-zoom — all loaded from CDN in `fin_calc.html`. For the site, these packages are included in deplib folder.

---

## Tips

- **Model staggered strategies** — set one portfolio to start now and another at year 10 to plan for future commitments like a child's education fund.
- **Compare risk vs reward** — set one portfolio to 6% FD and another to 12% equity to see how the gap widens.
- **Simulate retirement income** — add a withdrawal plan starting at the year you retire, inflated at your expected cost-of-living growth rate.
- **Stress-test withdrawals** — add a spend event to both portfolios at the same year and see which strategy survives it better.
- **Simulate a career break** — add a pause period and compare the long-term cost against uninterrupted contributions.
- **Rebalance across portfolios** — use a transfer to move funds from a conservative portfolio into an aggressive one at a key year.
- **Save and restore sessions** — Export CSV to save your setup; Import CSV to restore it or share it.
- **Update spends after adding portfolios** — if you add a portfolio after creating a spend event, open the event card and click Edit amounts to include the new portfolio.
- **Zoom in on key years** — use scroll wheel zoom on the X axis to examine a specific decade closely, then hit ↺ Reset zoom.
- **Toggle shading independently** — use the Pause shading and Withdrawal shading buttons to declutter the chart when you have many overlapping events.
- **Click values to type** — for any slider, click the value label to enter a precise number directly instead of dragging.
- **Collapse settled portfolios** — once configured, collapse a portfolio card to reduce clutter while working on others.