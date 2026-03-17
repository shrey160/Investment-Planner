# Multi-Portfolio Compound Interest Calculator

An interactive investment calculator that lets you model, compare, and stress-test multiple portfolios on a shared timeline — with inflation-adjusted deposits, staggered start years, major spend events, cross-portfolio transfers, deposit pauses, CSV export and import, and multi-currency display.

---

## Getting started

Open `index.html` in any modern browser. No build step or server required — keep `index.html`, `styles.css`, and `app.js` in the same folder.

Two portfolios are pre-loaded. Every change — slider, toggle, typed value, or event — updates the chart and all summary cards instantly.

---

## Shared timeline

All year numbers across the app refer to the **global timeline** shown on the chart. Year 0 is "now". If a portfolio starts at year 5, then a spend at year 8 hits that portfolio during its third active year. Pauses, spends, and transfers all use the same global year scale so they line up consistently on the chart.

---

## Portfolios tab

### Adding and removing portfolios

- Click **+ Add portfolio** to create a new one. Each gets a unique colour automatically.
- Click **×** on a portfolio header to delete it. All associated spends, transfers, and pauses tied to that portfolio are removed too.
- Click **− collapse** to tuck a portfolio away once configured. Click **+ expand** to reopen it.

### Renaming a portfolio

Click directly on the portfolio name and type to rename it. Names update everywhere — the chart legend, summary cards, transfer dropdowns, pause cards, and spend event inputs.

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
| **Inflate deposits** | When on, the annual deposit grows each year by the inflation rate, keeping real contributions constant |

### Setting values by typing

Every value label next to a slider is clickable. Click it to open an inline number input, type a precise value, then press **Enter** to confirm or **Escape** to cancel. Values are automatically clamped to the allowed range.

### Summary cards

Each portfolio shows **Final balance**, **Total deposited**, and **Interest earned** at a glance.

### Start year and the chart

Portfolios with a start year greater than 0 appear on the chart only from that year onward. Before their start year the line is absent. After their end year (`startYear + years`) the balance is shown as a flat dashed line, indicating the portfolio is closed but its value still contributes to the total.

---

## Chart

The line chart shows the balance of every portfolio over the global timeline. Each portfolio has:
- A **solid line** for its active years
- A **dashed flat line** after it closes, showing the held balance

### Show total toggle

Toggle **Show total** (top-right of the chart) to display a dashed grey line summing all portfolios at each year, including closed ones at their final held value. A **Total** card also appears in the summary row. The total line only begins from the year the first portfolio starts.

---

## Major spends tab

Model large one-off withdrawals — a house down payment, a car, school fees, etc.

### How spends work

Each spend event has a **global year**, a **label**, and a **per-portfolio amount**. You set a separate amount for each portfolio — leave a portfolio blank to exclude it. The same life event can therefore hit different portfolios by different amounts, or only some of them.

### Adding a spend event

1. Switch to **Major spends**.
2. Enter the **global year** and a **label**.
3. Enter withdrawal amounts next to whichever portfolios should be affected (leave others blank).
4. Click **+ Add spend event**.

### Editing a spend event

Every saved spend event is fully editable. Click **Edit amounts** on any event card to expand an inline editor showing amount inputs for **all current portfolios** — including any added after the event was originally created. You can also update the label and year directly on the card. Click **Save changes** to apply.

Portfolios with an amount set show as coloured pills. Portfolios with no amount show as muted grey pills so you can see at a glance what is and isn't set.

---

## Transfers tab

Move an amount from one portfolio to another at a specific global year. The source portfolio's balance drops at that year and the destination portfolio's balance rises by the same amount. All subsequent compounding reflects the new balances on both sides.

### Adding a transfer

1. Switch to **Transfers**.
2. Enter the **global year**, **amount**, **from portfolio**, and **to portfolio**.
3. Optionally add a label (e.g. "Rebalance to equity").
4. Click **+ Add transfer**.

Transfers are listed as cards showing the from → to flow with colour-coded pills. Click **×** to remove one.

**Note:** transfers are applied even during a pause period and even after a portfolio's active years end.

---

## Pause deposits tab

Skip annual deposits for a portfolio during specific global years while compounding continues uninterrupted.

### Adding a pause

1. Switch to **Pause deposits**.
2. Select the **portfolio** from the dropdown.
3. Enter the **global years** to pause in the text field. You can use:
   - Single years: `8`
   - Ranges: `3-6`
   - Any combination: `3-6, 8, 10-12`
4. A live preview below the field confirms which years will be paused before you save.
5. Optionally add a label (e.g. "Career break").
6. Click **+ Add pause**.

Pause periods appear as cards showing the portfolio and the paused year range. Click **×** to remove one.

**Note:** years are global (same scale as the chart). If a portfolio starts at year 5 and you pause global year 8, the deposit is skipped during that portfolio's third active year.

---

## Currency

All values default to **Indian Rupees (₹)**. The underlying data is always stored in rupees — currency conversion is display only.

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

Click **₹ Rupee** at any time to reset.

---

## Export and import

### Exporting data

Click **↓ Export CSV** in the top bar to download `portfolio_data.csv`. The file contains three sections:

- **Year-by-year balances** — one row per global year, one column per portfolio, plus a Total column. Values are in the currently selected display currency.
- **Portfolio summary** — full settings for each portfolio and their final results (balance, deposited, interest earned, interest %).
- **Events** — spend events (with per-portfolio amounts), transfers, and deposit pauses.

All values with commas or quotes are properly escaped, so the file opens cleanly in Excel, Google Sheets, and Numbers.

### Importing data

Click **↑ Import CSV** in the top bar and select a CSV file that was previously exported from this tool. The importer restores:

- All portfolios with their full settings
- All spend events with per-portfolio amounts
- All transfers
- All deposit pause periods
- The currency setting (symbol and conversion rate)

The current session is fully replaced by the imported data. If the import fails — for example if the file is corrupted or not in the expected format — a red error message appears describing what went wrong. On success a green confirmation shows how many portfolios were loaded.

---

## File structure

```
index.html   — HTML structure and layout
styles.css   — All visual styling, warm-linen palette, light/dark mode
app.js       — All application logic
```

The app has no dependencies beyond Chart.js, which is loaded from a CDN in `index.html`.

---

## Tips

- **Model staggered strategies** — set one portfolio to start now and another to start in year 10 (e.g. when a child starts school) to plan for future commitments.
- **Compare risk vs reward** — set one portfolio to a conservative 6% FD rate and another to 12% equity and watch how the gap widens over time.
- **Stress-test withdrawals** — add a spend event to both portfolios at the same year and see which strategy weathers it better.
- **Update spends as you add portfolios** — if you add a new portfolio after creating a spend event, open the event card and hit Edit amounts to include the new portfolio.
- **Simulate a career break** — add a pause period for the years you expect to stop contributing, and compare the long-term cost against uninterrupted contributions.
- **Rebalance across portfolios** — use a transfer to move funds from a maturing conservative portfolio into an aggressive one at a key year.
- **Save and restore sessions** — use Export CSV to save your current setup, and Import CSV to restore it later or share it with someone else.
- **Inflate deposits** — toggle "Inflate deposits" on and off to see how much it matters to grow contributions in line with inflation over 20–30 years.
- **Rename everything** — giving portfolios and events real names (e.g. "Nifty 50 SIP", "Child's college fund", "Home purchase") makes the comparison far easier to read.
- **Collapse settled portfolios** — once a portfolio is configured, collapse it to reduce clutter while you work on others.
- **Click values to type** — for any slider, click the value label to enter a precise number directly instead of dragging.