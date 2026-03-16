# Multi-Portfolio Compound Interest Calculator

An interactive compound interest calculator that lets you model, compare, and stress-test multiple investment portfolios side by side — with inflation-adjusted deposits, major spend events, inline value editing, and multi-currency display.

---

## Getting started

The tool opens with two portfolios pre-loaded. Everything is live — any change you make to a slider, a typed value, or a toggle updates the chart and summary cards instantly.

---

## Portfolios tab

This is where you configure each investment portfolio.

### Adding and removing portfolios

- Click **+ Add portfolio** at the bottom to create a new one. Each portfolio gets a unique colour automatically.
- Click the **×** button on the right of a portfolio header to delete it.
- Click **− collapse** to tuck a portfolio away once it's set up, keeping the view tidy. Click **+ expand** to open it again.

### Renaming a portfolio

Click directly on the portfolio name (e.g. "Portfolio 1") and type to rename it — useful for labelling strategies like "Conservative", "Aggressive", or "S&P 500".

### Portfolio settings

Each portfolio has six independent controls:

| Setting | What it does |
|---|---|
| **Initial deposit** | The lump sum you start with (in ₹) |
| **Annual deposit** | How much you add each year |
| **Interest rate** | Annual return rate (%) |
| **Inflation rate** | Used to adjust annual deposits if the toggle is on |
| **Years** | How long the investment runs |
| **Inflate deposits** | Toggle — when on, your annual deposit increases each year by the inflation rate, keeping your real contribution constant |

### Setting values by typing

Every value label next to a slider is clickable. Click it to replace it with a text input, type the exact number you want, then press **Enter** to confirm or **Escape** to cancel. The slider position updates immediately to match. This is useful when you need a precise figure — like a specific SIP amount or an exact interest rate — rather than dragging to approximate.

- **Initial deposit** and **Annual deposit** — enter the raw rupee amount (e.g. `500000` for ₹5L)
- **Interest rate** and **Inflation rate** — enter the percentage as a number (e.g. `7.5` for 7.5%)
- **Years** — enter a whole number between 1 and 50

Values are automatically clamped to the allowed range if you type something outside it.

### Summary cards

Each portfolio shows three numbers at a glance: **Final balance**, **Total deposited**, and **Interest earned**.

---

## Major spends tab

This is where you model large one-off withdrawals — a house down payment, a car, a wedding, etc.

### How spends work

A spend event has:
- A **year** — when the withdrawal happens
- A **label** — a name for the event (e.g. "Buy car")
- A **per-portfolio amount** — you set a separate withdrawal amount for each portfolio. Leave a portfolio blank to exclude it from the event.

This means the same life event can hit different portfolios differently. For example, a house purchase might draw ₹20,00,000 from one portfolio and ₹10,00,000 from another.

### Adding a spend event

1. Switch to the **Major spends** tab.
2. Enter the **year** and a **label**.
3. Enter the withdrawal amount next to each portfolio you want affected (leave others blank).
4. Click **+ Add spend event**.

The event appears as a card showing which portfolios are affected and by how much, using colour-coded pills that match each portfolio's colour. Click **×** on any event card to remove it.

---

## Chart

The line chart shows the balance of each portfolio over time. Portfolios are colour-coded to match their cards.

### Show total toggle

When you have more than one portfolio, toggle **Show total** (top-right of the chart area) to display a dashed grey line representing the combined balance of all portfolios. A **Total** card also appears in the summary row at the top.

---

## Currency

By default all values are displayed in **Indian Rupees (₹)**.

### Switching to a custom currency

1. Click **Custom currency** in the top bar.
2. Enter the **conversion ratio** — this is how much 1 rupee is worth in your target currency.
   - Example: ₹1 = $0.011 (because 1 ÷ 91 ≈ 0.011 for USD)
   - Example: ₹1 = €0.010 (for EUR at roughly ₹100 per euro)
3. Enter the **currency symbol** (e.g. `$`, `€`, `£`).

All values across the chart, summary cards, portfolio stats, and spend events update immediately. The underlying data always stays in rupees — conversion is display only.

### Getting the conversion ratio

Divide 1 by the exchange rate:

```
Conversion ratio = 1 ÷ exchange rate

Examples:
  USD  →  1 ÷ 91  ≈ 0.011
  EUR  →  1 ÷ 100 ≈ 0.010
  GBP  →  1 ÷ 108 ≈ 0.0093
  AED  →  1 ÷ 25  ≈ 0.040
```

Switch back to **₹ Rupee** at any time to reset to the base currency.

---

## Tips

- **Model risk vs reward** — set one portfolio to a low, safe rate (e.g. 6% FD) and another to a higher, riskier rate (e.g. 12% equity) to see the long-term difference.
- **Type exact values** — click any value label next to a slider to type a precise figure. Useful for SIP amounts and specific rate targets.
- **Test inflation impact** — toggle "Inflate deposits" on and off to see how much it matters to grow your contributions over time.
- **Stress-test big purchases** — add a spend event and assign amounts to both portfolios to see which strategy survives large withdrawals better.
- **Collapse settled portfolios** — once you've dialled in a portfolio's settings, collapse it to reduce clutter while you work on others.
- **Rename everything** — giving portfolios and spend events real names (e.g. "Nifty 50 SIP", "Child's college fund", "Home purchase") makes the comparison much easier to read.