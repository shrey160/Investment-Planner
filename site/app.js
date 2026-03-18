/*
 * app.js — Multi-Portfolio Compound Interest Calculator
 * ──────────────────────────────────────────────────────
 * Table of contents
 *   1.  Global state
 *   2.  Currency helpers
 *   3.  Currency toggle
 *   4.  Tab switching
 *   5.  Portfolio computation  ← core maths lives here
 *   6.  Chart
 *   6a.   Dataset builders (active line, tail, total)
 *   6b.   Legend
 *   6c.   Annotations (spend markers, pause boxes, withdrawal boxes)
 *   6d.   Chart.js instance + zoom/pan plugin config
 *   6e.   Zoom helpers (show/reset zoom, set axis mode, shading toggles)
 *   7.  Summary row
 *   8.  Inline edit (click-to-type on slider values)
 *   9.  Portfolio card rendering
 *  10.  Spend events (render list, add, save, remove)
 *  11.  Transfers (render list, add, remove)
 *  12.  Pause deposits (parse ranges, render list, add, remove)
 *  13.  Withdrawals (render list, add, remove)
 *  14.  Portfolio CRUD (add, remove, rename, collapse, update)
 *  15.  CSV import
 *  16.  CSV export
 *  17.  Full re-render
 *  18.  Init (seed two default portfolios)
 */


/* ═══════════════════════════════════════════════════════════════════
   1. GLOBAL STATE
   All mutable application state lives here as module-level lets.
   Data shapes:
     portfolio  — { id, name, color, principal, annual, rate,
                    inflation, years, startYear, inflateDeposits, collapsed }
     spendEvent — { year, label, amounts: { [pfId]: number } }
     transfer   — { id, year, from, to, amount, label }
     pausePeriod— { id, pfId, years: Set<number>, label, raw }
     withdrawal — { id, pfId, startYear, endYear, baseAmount,
                    inflationRate, inflateWithdrawal, label }
   ═══════════════════════════════════════════════════════════════════ */

/** Colour palette cycled when new portfolios are created. */
const PALETTE = ['#185FA5','#1D9E75','#7F77DD','#D85A30','#BA7517','#D4537E','#639922','#0F6E56'];

let portfolios   = [];   // Array<portfolio>
let spendEvents  = [];   // Array<spendEvent>  — one-off withdrawals
let transfers    = [];   // Array<transfer>    — moves between portfolios
let pausePeriods = [];   // Array<pausePeriod> — years with deposit skipped
let withdrawals  = [];   // Array<withdrawal>  — recurring annual withdrawals

/** Auto-increment counters used as stable integer IDs. */
let pfCounter = 0;
let trCounter = 0;
let paCounter = 0;
let wdCounter = 0;

/** The live Chart.js instance. Destroyed and recreated on every updateChart(). */
let chart = null;

/** 'INR' or 'OTHER'. Controls which display-currency functions are used. */
let currency = 'INR';

/**
 * Current zoom axis mode for the chart plugin.
 * 'x' | 'y' | 'xy' — which axis responds to scroll/pinch/drag.
 */
let zoomMode = 'x';

/**
 * Import lock. Set true at the start of _applyImportedRows() so that
 * every addPortfolio() call during batch import is a no-op for renderAll().
 * Set false again just before the single final renderAll() at the end.
 */
let _importing = false;

/** Whether the pause-period shading boxes are drawn on the chart. */
let showPauseHighlight = true;

/** Whether the withdrawal-period shading boxes are drawn on the chart. */
let showWithdrawalHighlight = true;

/**
 * Calendar year that corresponds to global year 0 ("Now").
 * Only used for X-axis label display — all computation uses global years unchanged.
 */
let baseYear    = new Date().getFullYear();

/**
 * When true, X-axis labels show actual calendar years (baseYear + globalYear).
 * When false, labels show "Now", "Yr 1", "Yr 2", …
 */
let useBaseYear = false;


/* ═══════════════════════════════════════════════════════════════════
   2. CURRENCY HELPERS
   All monetary values are stored internally in Indian Rupees (₹).
   getRate() and getSymbol() read the current display-currency settings
   so that fmt() / fmtShort() always output in the user's chosen unit.
   ═══════════════════════════════════════════════════════════════════ */

/** Returns the active currency symbol (₹ or whatever the user typed). */
function getSymbol() {
  if (currency === 'INR') return '₹';
  return (document.getElementById('conv-sym')?.value || '$').trim();
}

/**
 * Returns the active conversion rate (rupees × rate = display currency).
 * Always 1 for INR.
 */
function getRate() {
  if (currency === 'INR') return 1;
  return parseFloat(document.getElementById('conv-rate')?.value) || 1;
}

/**
 * Format a rupee value for display in the current currency.
 * Uses Indian short suffixes (Cr / L) or plain comma-separated numbers.
 * @param {number} v  Raw value in rupees.
 */
function fmt(v) {
  const c = v * getRate(), s = getSymbol();
  if (Math.abs(c) >= 1e7) return s + (c / 1e7).toFixed(2) + 'Cr';
  if (Math.abs(c) >= 1e5) return s + (c / 1e5).toFixed(2) + 'L';
  if (Math.abs(c) >= 1000) return s + Math.round(c).toLocaleString();
  return s + Math.round(c);
}

/**
 * Compact format for chart axis labels (B / M / Cr / L / k).
 * @param {number} v  Raw value in rupees.
 */
function fmtShort(v) {
  const c = v * getRate(), s = getSymbol();
  if (Math.abs(c) >= 1e9) return s + (c / 1e9).toFixed(1) + 'B';
  if (Math.abs(c) >= 1e6) return s + (c / 1e6).toFixed(1) + 'M';
  if (Math.abs(c) >= 1e7) return s + (c / 1e7).toFixed(1) + 'Cr';
  if (Math.abs(c) >= 1e5) return s + (c / 1e5).toFixed(1) + 'L';
  if (Math.abs(c) >= 1000) return s + (c / 1000).toFixed(0) + 'k';
  return s + Math.round(c);
}


/* ═══════════════════════════════════════════════════════════════════
   3. CURRENCY TOGGLE
   Switches between INR baseline and a user-supplied conversion.
   Shows/hides the custom conversion inputs and re-renders everything.
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Switch the display currency.
 * @param {'INR'|'OTHER'} cur
 */
function setCurrency(cur) {
  currency = cur;
  document.getElementById('cur-inr').className   = 'cur-btn' + (cur === 'INR'  ? ' active' : '');
  document.getElementById('cur-other').className = 'cur-btn' + (cur !== 'INR' ? ' active' : '');
  document.getElementById('conv-wrap').style.display = cur !== 'INR' ? 'flex' : 'none';
  renderAll();
}


/* ═══════════════════════════════════════════════════════════════════
   4. TAB SWITCHING
   Shows the selected panel and hides the other four.
   Also refreshes dropdown selects that depend on the current portfolio
   list whenever their tab becomes visible.
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Switch the visible tab panel.
 * @param {'portfolios'|'spends'|'transfers'|'pauses'|'withdrawals'} tab
 */
function switchTab(tab) {
  ['portfolios', 'spends', 'transfers', 'pauses', 'withdrawals'].forEach(t => {
    document.getElementById('panel-' + t).style.display = t === tab ? '' : 'none';
    document.getElementById('tab-'   + t).className     = 'tab-btn' + (t === tab ? ' active' : '');
  });
  // Populate dropdowns on demand so they always reflect the current portfolio list
  if (tab === 'transfers')  refreshTransferSelects();
  if (tab === 'pauses')     refreshPauseSelect();
  if (tab === 'withdrawals') refreshWithdrawalSelect();
}


/* ═══════════════════════════════════════════════════════════════════
   5. PORTFOLIO COMPUTATION  ← CORE MATHS
   computePortfolio() is the single source of truth for every balance
   value shown on the chart, in summary cards, and in the CSV export.

   GLOBAL vs LOCAL YEARS
   ─────────────────────
   All events (spends, transfers, pauses, withdrawals) are stored with
   GLOBAL year numbers that match the shared X axis on the chart.
   Year 0 = "Now". Year 5 = five years from now, regardless of when a
   particular portfolio started.

   A portfolio's LOCAL year is  g − startYear  (1-indexed, used only
   for the inflation scaling of annual deposits and withdrawals).

   LIFECYCLE OF A PORTFOLIO
   ─────────────────────────
   Active (g ≤ startYear + years):
     • balance compounds at the interest rate each year
     • annual deposit added (unless that global year is paused)
     • spends deducted, transfers applied, continuous withdrawals deducted

   Closed (g > startYear + years):
     • no more compounding or deposits — balance is held constant
     • transfers and continuous withdrawals still apply (e.g. post-
       retirement drawdown continues after the accumulation phase ends)

   @param {Object}  pf       Portfolio object.
   @param {number}  maxYear  Last global year to compute (inclusive).
   @returns {{ balances, totalDeposited, final, interest }}
   ═══════════════════════════════════════════════════════════════════ */
function computePortfolio(pf, maxYear) {
  const r    = pf.rate      / 100;   // annual return rate as a decimal
  const infR = pf.inflation / 100;   // inflation rate as a decimal
  const start = pf.startYear || 0;
  const limit = maxYear !== undefined ? maxYear : start + pf.years;

  // ── Pre-build lookup tables keyed by global year ─────────────────
  // These avoid scanning full arrays inside the hot loop below.

  // spendMap[g]    — total one-off withdrawal from this portfolio in global year g
  const spendMap = {};
  spendEvents.forEach(ev => {
    const a = ev.amounts[pf.id] || 0;
    if (a > 0 && ev.year > 0)
      spendMap[ev.year] = (spendMap[ev.year] || 0) + a;
  });

  // transferMap[g] — net transfer flow (positive = inflow, negative = outflow)
  const transferMap = {};
  transfers.forEach(tr => {
    if (tr.from === pf.id) transferMap[tr.year] = (transferMap[tr.year] || 0) - tr.amount;
    if (tr.to   === pf.id) transferMap[tr.year] = (transferMap[tr.year] || 0) + tr.amount;
  });

  // Maturity inflows: other portfolios whose maturityAction is 'transfer' pointing
  // at this portfolio dump their entire final balance here at their close year.
  //
  // IMPORTANT: we must compute the source's final balance *before* the maturity
  // zeroing step, so we temporarily override maturityAction to 'hold' for that
  // recursive call. This avoids getting back 0 (which is what the source shows
  // after zeroing itself out).
  portfolios.forEach(src => {
    if (src.id === pf.id) return;
    if (src.maturityAction !== 'transfer' || src.maturityTarget !== pf.id) return;
    const srcCloseYear = (src.startYear || 0) + src.years;
    if (srcCloseYear > limit) return;

    // Temporarily treat source as 'hold' to get the true pre-transfer balance
    const origAction = src.maturityAction;
    src.maturityAction = 'hold';
    const srcResult = computePortfolio(src, srcCloseYear);
    src.maturityAction = origAction;

    const srcFinal = srcResult.balances[srcCloseYear] ?? 0;
    if (srcFinal > 0) {
      transferMap[srcCloseYear] = (transferMap[srcCloseYear] || 0) + srcFinal;
    }
  });

  // Maturity action: if this portfolio is set to transfer its balance to another
  // portfolio at end-of-life, we record the close year so the loop can zero it out.
  const maturityYear   = start + pf.years;
  const willTransfer   = pf.maturityAction === 'transfer' && pf.maturityTarget !== null
                         && pf.maturityTarget !== pf.id;

  // pausedGlobalYears — Set of global years where this portfolio's deposit is skipped.
  // pa.years may be a Set (created normally) or a plain Array (after CSV import),
  // so we normalise defensively.
  const pausedGlobalYears = new Set();
  pausePeriods.forEach(pa => {
    if (pa.pfId !== pf.id) return;
    const yrs = pa.years instanceof Set
      ? pa.years
      : new Set(Array.isArray(pa.years) ? pa.years : []);
    yrs.forEach(y => pausedGlobalYears.add(y));
  });

  // withdrawalMap[g] — total inflation-adjusted withdrawal amount in global year g.
  // Each withdrawal plan runs from startYear to endYear inclusive, compounding the
  // base amount by its own inflation rate each year (0-indexed: first year is base).
  const withdrawalMap = {};
  withdrawals.forEach(wd => {
    if (wd.pfId !== pf.id) return;
    const wdInfR = (wd.inflateWithdrawal ? (wd.inflationRate || 0) : 0) / 100;
    for (let g = wd.startYear; g <= wd.endYear && g <= limit; g++) {
      const yearsIn = g - wd.startYear;  // 0 on first year → base amount unchanged
      const amount  = wd.baseAmount * Math.pow(1 + wdInfR, yearsIn);
      withdrawalMap[g] = (withdrawalMap[g] || 0) + amount;
    }
  });

  // ── Year-by-year simulation ──────────────────────────────────────
  const balances = new Array(limit + 1).fill(null);

  let balance        = pf.principal;
  let totalDeposited = pf.principal;
  balances[start]    = Math.round(balance);   // balance at year 0 of this portfolio

  for (let g = start + 1; g <= limit; g++) {
    const localY = g - start;   // 1-indexed local year; used only for inflation scaling

    if (localY <= pf.years) {
      // ── ACTIVE phase ───────────────────────────────────────────
      // Step 1: compound the balance
      balance *= (1 + r);

      // Step 2: add annual deposit unless this global year is paused
      if (!pausedGlobalYears.has(g)) {
        // If inflateDeposits is on, each successive year's deposit grows by the
        // portfolio's inflation rate to preserve its real purchasing-power value.
        const deposit = pf.inflateDeposits
          ? pf.annual * Math.pow(1 + infR, localY - 1)
          : pf.annual;
        balance        += deposit;
        totalDeposited += deposit;
      }

      // Step 3: apply one-off spends (deduct), then transfers (net flow)
      balance = Math.max(0, balance - (spendMap[g]    || 0));
      balance = Math.max(0, balance + (transferMap[g] || 0));

      // Step 4: deduct continuous withdrawal for this year (if any)
      balance = Math.max(0, balance - (withdrawalMap[g] || 0));

      // Step 5: if this is the close year and maturityAction is 'transfer',
      // zero out this portfolio (the full balance flows to the target).
      if (willTransfer && localY === pf.years) balance = 0;

    } else {
      // ── CLOSED phase ───────────────────────────────────────────
      // No compounding, no deposits. Transfers and withdrawals still apply.
      // If maturityAction is 'transfer', balance was already zeroed at close year.
      balance = Math.max(0, balance + (transferMap[g]   || 0));
      balance = Math.max(0, balance - (withdrawalMap[g] || 0));
    }

    balances[g] = Math.round(balance);
  }

  // Final balance is taken at the portfolio's close year, not necessarily maxYear
  const finalGlobal = Math.min(start + pf.years, limit);
  const finalVal    = balances[finalGlobal] ?? 0;

  return {
    balances,           // Array<number|null> — null before portfolio start
    totalDeposited,     // cumulative deposits including principal
    final:    finalVal,
    interest: Math.max(0, finalVal - totalDeposited)
  };
}


/* ═══════════════════════════════════════════════════════════════════
   6. CHART
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Convert a global year index to its X-axis label string.
 * When useBaseYear is on:  0 → "2025",  5 → "2030", etc.
 * When useBaseYear is off: 0 → "Now",   5 → "Yr 5"
 *
 * This is the ONLY place in the codebase that knows about the calendar
 * year display. All annotations and dataset data still reference the
 * same Chart.js label strings via this function, so everything stays
 * consistent when the toggle is switched.
 *
 * @param {number} g  Global year index (0 = Now).
 * @returns {string}
 */
function getXLabel(g) {
  if (useBaseYear) return String(baseYear + g);
  return g === 0 ? 'Now' : 'Yr ' + g;
}
function updateChart() {
  // Nothing to draw — clear the canvas and bail out
  if (!portfolios.length) {
    if (chart) { chart.destroy(); chart = null; }
    return;
  }

  // Global timeline spans from year 0 to the latest portfolio close year
  const maxY      = Math.max(...portfolios.map(p => (p.startYear || 0) + p.years));
  const labels    = Array.from({ length: maxY + 1 }, (_, i) => getXLabel(i));
  const showTotal = document.getElementById('total-tog').checked;

  // Pre-compute all portfolio balance arrays once (reused in datasets + total line)
  const allBals = portfolios.map(pf => computePortfolio(pf, maxY).balances);

  // ── 6a. DATASETS ─────────────────────────────────────────────────
  const datasets = [];

  portfolios.forEach((pf, pi) => {
    const start   = pf.startYear || 0;
    const endGlob = start + pf.years;

    // Solid line: visible only during the portfolio's active years
    datasets.push({
      label:            pf.name,
      borderColor:      pf.color,
      backgroundColor:  pf.color + '18',   // hex + 2-digit alpha ≈ 10% opacity
      data:             allBals[pi].map((v, i) => (i >= start && i <= endGlob) ? v : null),
      fill:             false,
      tension:          0.3,
      pointRadius:      2,
      pointHoverRadius: 5,
      borderWidth:      2,
      spanGaps:         false
    });

    // Dashed tail: flat line after the portfolio closes — shows the held balance.
    // Only rendered if the portfolio ends before the global timeline ends.
    // Named with '_tail' suffix so the tooltip filter can hide it.
    if (endGlob < maxY) {
      datasets.push({
        label:            pf.name + '_tail',
        borderColor:      pf.color,
        backgroundColor:  'transparent',
        data:             allBals[pi].map((v, i) => i >= endGlob ? v : null),
        fill:             false,
        tension:          0,
        pointRadius:      0,
        pointHoverRadius: 0,
        borderWidth:      1.5,
        borderDash:       [4, 4],
        spanGaps:         false
      });
    }
  });

  // Grey dashed total line: sum of all portfolio balances at each year.
  // Null for any year where no portfolio has started yet.
  if (showTotal && portfolios.length > 1) {
    datasets.push({
      label:            'Total',
      borderColor:      '#8a8278',
      backgroundColor:  'transparent',
      data:             labels.map((_, i) => {
        const vals = portfolios.map((_, pi) => allBals[pi][i]);
        if (vals.every(v => v === null || v === undefined)) return null;
        return Math.round(vals.reduce((s, v) => s + (v || 0), 0));
      }),
      fill:             false,
      tension:          0.3,
      pointRadius:      0,
      pointHoverRadius: 5,
      borderWidth:      2,
      borderDash:       [6, 3],
      spanGaps:         false
    });
  }

  // ── 6b. LEGEND ───────────────────────────────────────────────────
  // Rendered as HTML in the #legend div (not Chart.js's built-in legend,
  // which can't show custom markers like the spend/pause/withdrawal icons).
  document.getElementById('legend').innerHTML =
    // One coloured square per portfolio
    portfolios.map(pf =>
      `<span class="legend-item">
        <span class="legend-dot" style="background:${pf.color};"></span>${pf.name}
      </span>`
    ).join('') +

    // Dashed grey line icon for the total
    (showTotal && portfolios.length > 1
      ? `<span class="legend-item">
           <span class="legend-dash"></span>
           <span style="color:var(--color-text-secondary);">Total</span>
         </span>`
      : '') +

    // Orange vertical bar icon for spend events
    (spendEvents.length
      ? `<span class="legend-item">
           <span class="legend-spend-marker"></span>
           <span style="color:var(--color-text-secondary);">Spend</span>
         </span>`
      : '') +

    // Dashed box icon for pauses (only when shading is on)
    (pausePeriods.length && showPauseHighlight
      ? `<span class="legend-item">
           <span class="legend-pause-marker"></span>
           <span style="color:var(--color-text-secondary);">Paused</span>
         </span>`
      : '') +

    // Green dashed box icon for withdrawals (only when shading is on)
    (withdrawals.length && showWithdrawalHighlight
      ? `<span class="legend-item">
           <span class="legend-withdrawal-marker"></span>
           <span style="color:var(--color-text-secondary);">Withdrawal</span>
         </span>`
      : '');

  // ── 6c. ANNOTATIONS ──────────────────────────────────────────────
  // chartjs-plugin-annotation overlays shapes on top of the chart canvas.
  // All annotations are keyed by unique string IDs.
  const annotations = {};

  // Spend event markers — thin vertical dashed orange lines.
  // Multiple spend events at the same global year are merged into one marker
  // with a comma-separated label.
  const spendByYear = {};
  spendEvents.forEach(ev => {
    if (!spendByYear[ev.year]) spendByYear[ev.year] = [];
    spendByYear[ev.year].push(ev.label);
  });
  Object.entries(spendByYear).forEach(([yr, lbls]) => {
    const y = parseInt(yr);
    if (y < 0 || y > maxY) return;
    annotations['spend_' + y] = {
      type:        'line',
      scaleID:     'x',
      value:       getXLabel(y),
      borderColor: '#D85A30',
      borderWidth: 1.5,
      borderDash:  [4, 3],
      label: {
        display:         true,
        content:         lbls.join(', '),
        position:        'start',   // top of chart
        yAdjust:         -6,
        backgroundColor: 'rgba(216,90,48,0.12)',
        color:           '#D85A30',
        font:            { size: 10, weight: 'normal' },
        padding:         { x: 5, y: 3 },
        borderRadius:    3,
      }
    };
  });

  // Pause highlight boxes — shown only when the "Pause shading" toggle is active.
  // Each pause period can have non-contiguous years (e.g. "3-6, 8, 11").
  // We group those into contiguous runs and draw one box per run, so
  // years 3-6 become a single wide box rather than four single-year boxes.
  if (showPauseHighlight && pausePeriods.length) {
    let boxIdx = 0;
    pausePeriods.forEach(pa => {
      const pf = portfolios.find(p => p.id === pa.pfId);
      if (!pf) return;

      // Normalise pa.years: may be Set (normal) or Array (after import)
      const yearsArr = (pa.years instanceof Set)
        ? [...pa.years]
        : Array.isArray(pa.years) ? [...pa.years] : [];
      if (!yearsArr.length) return;

      // Hex → rgba helper. Uses bit shifts to avoid variable name collisions.
      const toRgba = (h, a) => {
        const n = parseInt(h.replace('#', ''), 16);
        return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
      };

      // Build contiguous runs from the sorted year list
      const sorted = yearsArr.map(Number).sort((a, b) => a - b);
      const runs = [];
      let s = sorted[0], e = sorted[0];
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] === e + 1) { e = sorted[i]; }
        else { runs.push([s, e]); s = e = sorted[i]; }
      }
      runs.push([s, e]);

      // Draw one box per run.
      // xMax is set to "Yr (to+1)" so the box covers the full "to" year visually.
      runs.forEach(([from, to]) => {
        if (from > maxY) return;
        annotations['pause_' + pa.id + '_' + boxIdx++] = {
          type:            'box',
          xMin:            getXLabel(from),
          xMax:            getXLabel(Math.min(to + 1, maxY)),
          backgroundColor: toRgba(pf.color, 0.10),   // 10% fill
          borderColor:     toRgba(pf.color, 0.35),   // 35% border
          borderWidth:     1,
          borderDash:      [3, 3],
          label: {
            display:         true,
            content:         [pf.name, 'paused'],    // two-line label
            position:        { x: 'center', y: 'start' },   // top of box
            yAdjust:         6,
            backgroundColor: 'transparent',
            color:           toRgba(pf.color, 0.65),
            font:            { size: 10, weight: 'normal' },
            padding:         0,
          }
        };
      });
    });
  }

  // Withdrawal highlight boxes — shown only when "Withdrawal shading" toggle is active.
  // Each withdrawal spans startYear..endYear continuously (no gaps needed).
  // The label shows "base → final/yr" when inflation-adjusted, or just "base/yr" if fixed.
  // Labels are bottom-anchored to visually distinguish from pause boxes (top-anchored).
  if (showWithdrawalHighlight && withdrawals.length) {
    const toRgba = (h, a) => {
      const n = parseInt(h.replace('#', ''), 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    };

    withdrawals.forEach((wd, idx) => {
      const pf = portfolios.find(p => p.id === wd.pfId);
      if (!pf) return;

      const from = Math.max(0, wd.startYear);
      const to   = Math.min(wd.endYear, maxY);
      if (from > maxY) return;

      // Build the two-line label: portfolio name + amount range
      const wdInfR   = wd.inflateWithdrawal ? (wd.inflationRate || 0) / 100 : 0;
      const lastAmt  = wd.baseAmount * Math.pow(1 + wdInfR, wd.endYear - wd.startYear);
      const amtLabel = wd.inflateWithdrawal && lastAmt !== wd.baseAmount
        ? `${fmt(wd.baseAmount)}→${fmt(lastAmt)}/yr`   // inflation-adjusted: show range
        : `${fmt(wd.baseAmount)}/yr`;                   // fixed: show single value

      annotations['wd_' + wd.id + '_' + idx] = {
        type:            'box',
        xMin:            getXLabel(from),
        xMax:            getXLabel(Math.min(to + 1, maxY)),
        backgroundColor: toRgba(pf.color, 0.07),   // slightly lighter than pause (7%)
        borderColor:     toRgba(pf.color, 0.50),   // more opaque border
        borderWidth:     1.5,
        borderDash:      [6, 3],                    // longer dashes than pause to distinguish
        label: {
          display:         true,
          content:         [pf.name, amtLabel],
          position:        { x: 'center', y: 'end' },   // bottom of box (vs top for pause)
          yAdjust:         -6,
          backgroundColor: 'transparent',
          color:           toRgba(pf.color, 0.75),
          font:            { size: 10, weight: 'normal' },
          padding:         0,
        }
      };
    });
  }

  // ── 6d. CHART.JS INSTANCE ────────────────────────────────────────
  // Hide the reset-zoom button and destroy the old chart before
  // creating a fresh one. This avoids stale dataset/plugin state.
  const zoomBtn = document.getElementById('reset-zoom-btn');
  if (zoomBtn) zoomBtn.style.display = 'none';
  if (chart) { chart.destroy(); chart = null; }

  chart = new Chart(document.getElementById('mainChart'), {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive:          true,
      maintainAspectRatio: false,

      plugins: {
        // Hide Chart.js's built-in legend — we render our own HTML legend above
        legend: { display: false },

        // Tooltip: shown on hover
        tooltip: {
          // Don't show tooltip entries for tail datasets
          filter: item => !item.dataset.label.endsWith('_tail'),
          callbacks: {
            // Main value line: "Portfolio Name: ₹12.34Cr"
            label: ctx => ctx.dataset.label + ': ' + fmt(ctx.raw),

            // Extra lines appended below the main value lines:
            // spends, paused portfolios, and active withdrawals at this year
            afterBody: ctx => {
              const yr = ctx[0]?.dataIndex;
              if (yr === undefined) return [];
              const lines = [];

              // Section: spend events at this year
              const evs = spendEvents.filter(ev => ev.year === yr);
              if (evs.length) {
                lines.push('', '— Spends —');
                evs.forEach(ev => {
                  const parts = portfolios
                    .filter(pf => ev.amounts[pf.id] > 0)
                    .map(pf => `${pf.name}: −${fmt(ev.amounts[pf.id])}`);
                  lines.push(ev.label + (parts.length ? ': ' + parts.join(', ') : ''));
                });
              }

              // Section: portfolios whose deposit is paused this year
              const pausedNames = pausePeriods
                .filter(pa => {
                  // Defensive normalisation — pa.years could be Set or Array
                  const yrs = pa.years instanceof Set
                    ? pa.years
                    : new Set(Array.isArray(pa.years) ? pa.years : []);
                  return yrs.has(yr);
                })
                .map(pa => portfolios.find(p => p.id === pa.pfId)?.name)
                .filter(Boolean);
              if (pausedNames.length) {
                lines.push('', '— Deposit paused —');
                pausedNames.forEach(n => lines.push(n));
              }

              // Section: active withdrawals this year (with inflation-adjusted amount)
              const activeWds = withdrawals.filter(wd => yr >= wd.startYear && yr <= wd.endYear);
              if (activeWds.length) {
                lines.push('', '— Withdrawals —');
                activeWds.forEach(wd => {
                  const pf = portfolios.find(p => p.id === wd.pfId);
                  if (!pf) return;
                  const wdInfR = wd.inflateWithdrawal ? (wd.inflationRate || 0) / 100 : 0;
                  const amt    = wd.baseAmount * Math.pow(1 + wdInfR, yr - wd.startYear);
                  lines.push(`${pf.name} (${wd.label}): −${fmt(amt)}`);
                });
              }

              return lines;
            }
          }
        },

        // Annotation plugin: spend lines, pause boxes, withdrawal boxes
        annotation: { annotations },

        // Zoom plugin: scroll/pinch/drag interactivity
        zoom: {
          pan: {
            enabled:   true,
            // Pan axis follows the zoom axis mode (dragging Y when in Y mode, etc.)
            mode:      zoomMode === 'y' ? 'y' : zoomMode === 'xy' ? 'xy' : 'x',
            threshold: 5,           // minimum pixel drag before pan activates
            onPan:     () => showResetZoom(),   // reveal the reset button
          },
          zoom: {
            wheel: { enabled: true, speed: 0.08 },  // slow scroll for fine control
            pinch: { enabled: true },               // two-finger pinch on trackpad/mobile
            mode:  zoomMode,
            onZoom: () => showResetZoom(),
          },
          limits: {
            x: { minRange: 2 }  // prevent zooming past a 2-year window
          }
        }
      },

      scales: {
        x: {
          ticks: { autoSkip: true, maxTicksLimit: 13, color: '#9e958a' },
          grid:  { display: false }
        },
        y: {
          ticks: { color: '#9e958a', callback: v => fmtShort(v) },
          grid:  { color: 'rgba(100,88,70,0.08)' }
        }
      }
    }
  });
}


/* ═══════════════════════════════════════════════════════════════════
   6e. ZOOM HELPERS
   ═══════════════════════════════════════════════════════════════════ */

/** Make the "↺ Reset zoom" button visible (called on any zoom or pan event). */
function showResetZoom() {
  const btn = document.getElementById('reset-zoom-btn');
  if (btn) btn.style.display = '';
}

/** Reset chart to full view and hide the reset button. */
function resetChartZoom() {
  if (chart) {
    chart.resetZoom();
    const btn = document.getElementById('reset-zoom-btn');
    if (btn) btn.style.display = 'none';
  }
}

/**
 * Switch which axis is zoomed by scroll/pinch.
 * Updates the X/Y/XY button states and patches the live chart plugin
 * options without destroying and recreating the whole chart instance.
 * @param {'x'|'y'|'xy'} mode
 */
function setZoomMode(mode) {
  zoomMode = mode;
  ['x', 'y', 'xy'].forEach(m => {
    const btn = document.getElementById('zm-' + m);
    if (btn) btn.className = 'zoom-mode-btn' + (m === mode ? ' active' : '');
  });
  // Patch the live plugin options so the mode change takes effect immediately
  if (chart) {
    chart.options.plugins.zoom.pan.mode  = mode === 'y' ? 'y' : mode === 'xy' ? 'xy' : 'x';
    chart.options.plugins.zoom.zoom.mode = mode;
    chart.update('none');   // 'none' = skip animation
  }
}

/**
 * Toggle pause-period shading boxes on/off.
 * Only calls updateChart() — not a full renderAll() — since only the
 * chart canvas needs to change.
 */
function togglePauseHighlight() {
  showPauseHighlight = !showPauseHighlight;
  const btn = document.getElementById('pause-highlight-btn');
  if (btn) btn.className = 'zoom-mode-btn' + (showPauseHighlight ? ' active' : '');
  updateChart();
}

/**
 * Toggle withdrawal-period shading boxes on/off.
 * Same pattern as togglePauseHighlight().
 */
function toggleWithdrawalHighlight() {
  showWithdrawalHighlight = !showWithdrawalHighlight;
  const btn = document.getElementById('wd-highlight-btn');
  if (btn) btn.className = 'zoom-mode-btn' + (showWithdrawalHighlight ? ' active' : '');
  updateChart();
}

/**
 * Toggle whether the X axis shows calendar years or relative "Yr N" labels.
 * Only rebuilds the chart — computation is unaffected.
 */
function toggleBaseYear() {
  useBaseYear = !useBaseYear;
  const btn   = document.getElementById('base-year-tog-btn');
  const wrap  = document.getElementById('base-year-input-wrap');
  if (btn)  btn.className = 'zoom-mode-btn' + (useBaseYear ? ' active' : '');
  if (wrap) wrap.style.display = useBaseYear ? 'flex' : 'none';
  updateChart();
}

/**
 * Update the base year value from the input field and redraw.
 * Called on every keystroke in the base-year input.
 */
function setBaseYear() {
  const inp = document.getElementById('base-year-input');
  const val = parseInt(inp?.value);
  if (!isNaN(val) && val >= 1900 && val <= 2200) {
    baseYear = val;
    updateChart();
  }
}


/* ═══════════════════════════════════════════════════════════════════
   7. SUMMARY ROW
   Renders one stat card per portfolio (final balance) plus an optional
   Total card at the end. Lives in #summary-grid.
   ═══════════════════════════════════════════════════════════════════ */
function updateSummary() {
  const el = document.getElementById('summary-grid');
  if (!portfolios.length) { el.innerHTML = ''; return; }

  let totalFinal = 0;
  let html = portfolios.map(pf => {
    const { final } = computePortfolio(pf);
    totalFinal += final;
    return `<div class="summary-card" style="border-left:3px solid ${pf.color};border-radius:0 8px 8px 0;">
      <p class="summary-label">${pf.name}</p>
      <p class="summary-val">${fmt(final)}</p>
    </div>`;
  }).join('');

  if (portfolios.length > 1 && document.getElementById('total-tog').checked) {
    html += `<div class="summary-card total">
      <p class="summary-label">Total</p>
      <p class="summary-val">${fmt(totalFinal)}</p>
    </div>`;
  }
  el.innerHTML = html;
}


/* ═══════════════════════════════════════════════════════════════════
   8. INLINE EDIT — click-to-type on slider values
   Clicking a .pf-row-val span calls startInlineEdit(), which replaces
   the span with an <input>. Committing (Enter / blur) calls updatePf().
   Escaping restores the original value without a state change.
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Config for each editable portfolio field.
 *   min / max      — bounds enforced on the inline number input (click-to-type)
 *   sliderMin / sliderMax — range shown on the range slider (coarser, more practical range)
 *   step           — slider step (inline input uses the same step)
 *   isFloat        — parse with parseFloat (true) or parseInt (false)
 *   rv()           — reads the current value from a portfolio object
 *
 * principal / annual have a wide input range (0–20Cr) but a tighter slider
 * range (0–20L) so the slider stays usable for typical values while
 * power users can still type a precise figure beyond the slider's max.
 */
const FIELD_CONFIG = {
  principal: { min: 0,   max: 200000000, sliderMin: 0,   sliderMax: 2000000, step: 500,  isFloat: false, rv: pf => pf.principal  },
  annual:    { min: 0,   max: 200000000, sliderMin: 0,   sliderMax: 2000000, step: 1000, isFloat: false, rv: pf => pf.annual      },
  rate:      { min: 0.5, max: 25,        sliderMin: 0.5, sliderMax: 25,      step: 0.5,  isFloat: true,  rv: pf => pf.rate        },
  inflation: { min: 0,   max: 15,        sliderMin: 0,   sliderMax: 15,      step: 0.5,  isFloat: true,  rv: pf => pf.inflation   },
  years:     { min: 1,   max: 50,        sliderMin: 1,   sliderMax: 50,      step: 1,    isFloat: false, rv: pf => pf.years       },
  startYear: { min: 0,   max: 49,        sliderMin: 0,   sliderMax: 49,      step: 1,    isFloat: false, rv: pf => pf.startYear   },
};

/**
 * Replace a value label span with a number input for direct editing.
 * @param {HTMLElement} spanEl  The .pf-row-val span being clicked.
 * @param {number}      pfId    Portfolio id.
 * @param {string}      key     The FIELD_CONFIG key being edited.
 */
function startInlineEdit(spanEl, pfId, key) {
  const pf  = portfolios.find(p => p.id === pfId);
  if (!pf) return;
  const cfg = FIELD_CONFIG[key];

  const inp     = document.createElement('input');
  inp.type      = 'number';
  inp.className = 'pf-row-val-input';
  inp.value     = cfg.rv(pf);
  inp.min       = cfg.min;
  inp.max       = cfg.max;
  inp.step      = cfg.step;
  spanEl.replaceWith(inp);
  inp.focus();
  inp.select();

  function commit() {
    let val = cfg.isFloat ? parseFloat(inp.value) : parseInt(inp.value);
    if (isNaN(val)) val = cfg.rv(pf);          // revert on bad input
    val = Math.min(cfg.max, Math.max(cfg.min, val));  // clamp to allowed range
    updatePf(pfId, key, val);
  }

  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { updatePf(pfId, key, cfg.rv(pf)); }  // revert
  });
  inp.addEventListener('blur', commit);
}


/* ═══════════════════════════════════════════════════════════════════
   9. PORTFOLIO CARD RENDERING
   renderPortfolioCard() writes the full innerHTML of a portfolio's
   .pf-card div (which was created and appended by addPortfolio()).
   It is called by renderAll() and directly by updatePf() / toggleCollapse()
   for lightweight updates that don't need a full re-render.
   ═══════════════════════════════════════════════════════════════════ */
function renderPortfolioCard(pf) {
  const el = document.getElementById('pf-' + pf.id);
  if (!el) return;

  const { totalDeposited, final, interest } = computePortfolio(pf);

  /**
   * Wrap a displayed value in a clickable span that triggers inline editing.
   * @param {string} key     FIELD_CONFIG key
   * @param {string} display Formatted display string
   */
  function valSpan(key, display) {
    return `<span class="pf-row-val" title="Click to type a value"
      onclick="startInlineEdit(this,${pf.id},'${key}')">${display}</span>`;
  }

  // Sliders grid — empty string when the card is collapsed
  const slidersHTML = pf.collapsed ? '' : `
    <div class="pf-sliders">
      <div class="pf-row">
        <label class="pf-row-label"><span>Initial deposit</span>${valSpan('principal', fmt(pf.principal))}</label>
        <input type="range" min="0" max="2000000" step="500" value="${Math.min(pf.principal, 2000000)}"
               oninput="updatePf(${pf.id},'principal',+this.value)">
      </div>
      <div class="pf-row">
        <label class="pf-row-label"><span>Annual deposit</span>${valSpan('annual', fmt(pf.annual) + '/yr')}</label>
        <input type="range" min="0" max="2000000" step="1000" value="${Math.min(pf.annual, 2000000)}"
               oninput="updatePf(${pf.id},'annual',+this.value)">
      </div>
      <div class="pf-row">
        <label class="pf-row-label"><span>Interest rate</span>${valSpan('rate', pf.rate.toFixed(1) + '%')}</label>
        <input type="range" min="0.5" max="25" step="0.5" value="${pf.rate}"
               oninput="updatePf(${pf.id},'rate',+this.value)">
      </div>
      <div class="pf-row">
        <label class="pf-row-label"><span>Inflation rate</span>${valSpan('inflation', pf.inflation.toFixed(1) + '%')}</label>
        <input type="range" min="0" max="15" step="0.5" value="${pf.inflation}"
               oninput="updatePf(${pf.id},'inflation',+this.value)">
      </div>
      <div class="pf-row">
        <label class="pf-row-label"><span>Start year</span>${valSpan('startYear', pf.startYear === 0 ? 'Now (yr 0)' : 'Yr ' + pf.startYear)}</label>
        <input type="range" min="0" max="49" step="1" value="${pf.startYear}"
               oninput="updatePf(${pf.id},'startYear',+this.value)">
      </div>
      <div class="pf-row">
        <label class="pf-row-label"><span>Years</span>${valSpan('years', pf.years)}</label>
        <input type="range" min="1" max="50" step="1" value="${pf.years}"
               oninput="updatePf(${pf.id},'years',+this.value)">
      </div>
      <div class="inflate-toggle-row">
        <label class="tog">
          <input type="checkbox" ${pf.inflateDeposits ? 'checked' : ''}
                 onchange="updatePf(${pf.id},'inflateDeposits',this.checked)">
          <span class="tog-track"></span><span class="tog-thumb"></span>
        </label>
        <span class="muted-label" style="font-size:12px;">Inflate deposits</span>
      </div>

      <div class="maturity-row">
        <span class="muted-label" style="font-size:12px;white-space:nowrap;">At end of term</span>
        <div class="maturity-options">
          <label class="maturity-opt ${pf.maturityAction === 'hold' ? 'active' : ''}">
            <input type="radio" name="mat-${pf.id}" value="hold"
                   ${pf.maturityAction === 'hold' ? 'checked' : ''}
                   onchange="updatePf(${pf.id},'maturityAction','hold')">
            Keep balance
          </label>
          <label class="maturity-opt ${pf.maturityAction === 'transfer' ? 'active' : ''}">
            <input type="radio" name="mat-${pf.id}" value="transfer"
                   ${pf.maturityAction === 'transfer' ? 'checked' : ''}
                   onchange="updatePf(${pf.id},'maturityAction','transfer')">
            Transfer to
          </label>
        </div>
        ${pf.maturityAction === 'transfer' ? `
        <select class="sinput maturity-target-select" style="font-size:12px;padding:3px 8px;"
                onchange="updatePf(${pf.id},'maturityTarget',+this.value)">
          <option value="" disabled ${!pf.maturityTarget ? 'selected' : ''}>Choose portfolio…</option>
          ${portfolios.filter(p => p.id !== pf.id).map(p =>
            `<option value="${p.id}" ${pf.maturityTarget === p.id ? 'selected' : ''}>${p.name}</option>`
          ).join('')}
        </select>` : ''}
      </div>
    </div>`;

  el.innerHTML = `
    <div class="pf-header">
      <div class="pf-dot" style="background:${pf.color};"></div>
      <input class="pf-name" value="${pf.name}" onchange="renamePf(${pf.id}, this.value)">
      <button class="collapse-btn" onclick="toggleCollapse(${pf.id})">${pf.collapsed ? '+ expand' : '− collapse'}</button>
      <button class="icon-btn" onclick="removePortfolio(${pf.id})">×</button>
    </div>
    <div class="pf-stats-grid">
      <div class="pf-stat-card"><p class="pf-stat-label">Final</p><p class="pf-stat-val">${fmt(final)}</p></div>
      <div class="pf-stat-card"><p class="pf-stat-label">Deposited</p><p class="pf-stat-val">${fmt(totalDeposited)}</p></div>
      <div class="pf-stat-card"><p class="pf-stat-label">Interest</p><p class="pf-stat-val">${fmt(interest)}</p></div>
    </div>
    ${slidersHTML}`;
}


/* ═══════════════════════════════════════════════════════════════════
   10. SPEND EVENTS
   Spend events are one-off withdrawals at a specific global year,
   with independent amounts per portfolio (some portfolios can be
   excluded by leaving their amount blank).

   Saved events show:
     • Coloured pills for portfolios with a set amount
     • Muted grey pills for portfolios with no amount (so the user
       can see at a glance which portfolios aren't affected)
     • A collapsible "Edit amounts" section with all current portfolios
       (including ones added after the event was created)
   ═══════════════════════════════════════════════════════════════════ */
function renderSpendEvents() {
  const el = document.getElementById('spends-list');
  if (!spendEvents.length) {
    el.innerHTML = `<p class="no-items">No spend events yet. Add one below.</p>`;
    return;
  }

  el.innerHTML = spendEvents.map((ev, i) => {
    const sym = getSymbol();

    // Portfolios with a set amount — shown as coloured pills
    const activePills = portfolios
      .filter(pf => ev.amounts[pf.id] > 0)
      .map(pf => `
        <div class="pf-pill" style="background:${pf.color}18;">
          <span class="pf-pill-dot" style="background:${pf.color};"></span>
          <span style="color:${pf.color};">${pf.name}</span>
          <span style="color:var(--color-text);margin-left:4px;">${fmt(ev.amounts[pf.id])}</span>
        </div>`)
      .join('');

    // Portfolios with no amount — shown as muted pills so the user sees what's missing
    const unsetPills = portfolios
      .filter(pf => !(ev.amounts[pf.id] > 0))
      .map(pf => `
        <div class="pf-pill" style="background:var(--color-bg-tertiary);opacity:0.6;">
          <span class="pf-pill-dot" style="background:${pf.color};"></span>
          <span style="color:var(--color-text-secondary);">${pf.name}</span>
          <span style="color:var(--color-text-hint);margin-left:3px;">—</span>
        </div>`)
      .join('');

    // Editable amount row for every current portfolio (inside the collapsible section)
    const amountInputs = portfolios.map(pf => `
      <div class="pf-amount-row" style="margin-bottom:5px;">
        <div class="pf-dot" style="background:${pf.color};"></div>
        <span class="pf-amount-name">${pf.name}</span>
        <span class="muted-label" style="font-size:12px;">${sym}</span>
        <input type="number" id="se-${i}-${pf.id}" class="sinput"
               value="${ev.amounts[pf.id] > 0 ? ev.amounts[pf.id] : ''}"
               placeholder="0" min="0" style="width:110px;text-align:right;">
      </div>`).join('');

    return `<div class="event-card">
      <div class="event-header">
        <div style="flex:1;min-width:0;">
          <!-- Inline-editable label -->
          <input class="event-title-input sinput"
                 value="${ev.label}" id="se-lbl-${i}"
                 style="font-weight:500;font-size:13px;width:100%;margin-bottom:2px;"
                 placeholder="Label" />
          <!-- Inline-editable year -->
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:11px;color:var(--color-text-secondary);">Year</span>
            <input type="number" id="se-yr-${i}" class="sinput"
                   value="${ev.year}" min="1" max="99"
                   style="width:60px;font-size:11px;padding:2px 6px;" />
          </div>
        </div>
        <button class="icon-btn" onclick="removeSpendEvent(${i})">×</button>
      </div>

      <!-- Summary pills row -->
      <div class="pills-row" style="margin-bottom:8px;">
        ${activePills || ''}${unsetPills}
      </div>

      <!-- Collapsible edit section: rotates arrow on open/close -->
      <details style="margin-top:4px;">
        <summary style="font-size:12px;color:var(--color-text-secondary);cursor:pointer;user-select:none;list-style:none;display:flex;align-items:center;gap:4px;">
          <span id="se-arrow-${i}" style="font-size:10px;transition:transform .15s;">▶</span>
          Edit amounts
        </summary>
        <div style="margin-top:10px;">
          ${amountInputs}
          <button class="add-btn" onclick="saveSpendEvent(${i})" style="margin-top:6px;padding:7px;">
            Save changes
          </button>
        </div>
      </details>
    </div>`;
  }).join('');

  // Wire up the arrow rotation for each <details> element
  spendEvents.forEach((_, i) => {
    const det = document.querySelector(`#spends-list details:nth-child(${i + 1})`);
    if (!det) return;
    det.addEventListener('toggle', () => {
      const arrow = document.getElementById('se-arrow-' + i);
      if (arrow) arrow.style.transform = det.open ? 'rotate(90deg)' : '';
    });
  });
}

/**
 * Persist edits made inside a spend event's collapsible section.
 * Reads the inline year/label inputs and all per-portfolio amount inputs,
 * then re-sorts and re-renders.
 * @param {number} i  Index into spendEvents[].
 */
function saveSpendEvent(i) {
  const ev = spendEvents[i];
  if (!ev) return;

  const yr  = parseInt(document.getElementById('se-yr-'  + i)?.value);
  const lbl = document.getElementById('se-lbl-' + i)?.value.trim() || ev.label;

  if (!isNaN(yr) && yr > 0) ev.year = yr;
  ev.label = lbl;

  // Collect amounts for all current portfolios (a portfolio added after this
  // event was created will now be included)
  const newAmounts = {};
  portfolios.forEach(pf => {
    const inp = document.getElementById(`se-${i}-${pf.id}`);
    const v   = parseFloat(inp?.value);
    if (!isNaN(v) && v > 0) newAmounts[pf.id] = v;
  });
  ev.amounts = newAmounts;

  spendEvents.sort((a, b) => a.year - b.year);
  renderAll();
}

/**
 * Rebuild the per-portfolio amount inputs in the "Add spend event" form.
 * Called by renderAll() whenever the portfolio list changes.
 */
function renderSpendAmounts() {
  const el = document.getElementById('sp-pf-amounts');
  if (!portfolios.length) {
    el.innerHTML = `<p class="hint-label" style="margin-bottom:8px;">Add portfolios first.</p>`;
    return;
  }
  el.innerHTML = portfolios.map(pf => `
    <div class="pf-amount-row">
      <div class="pf-dot" style="background:${pf.color};"></div>
      <span class="pf-amount-name">${pf.name}</span>
      <span class="muted-label">${getSymbol()}</span>
      <input type="number" id="sa-${pf.id}" class="sinput" placeholder="0" min="0">
    </div>`).join('');
}

/** Read the add-spend form, push a new event, clear the form, re-render. */
function addSpend() {
  const yr  = parseInt(document.getElementById('sp-yr').value);
  const lbl = document.getElementById('sp-lbl').value.trim() || 'Spend';
  if (!yr || yr < 1) return;

  const amounts = {};
  portfolios.forEach(pf => {
    const v = parseFloat(document.getElementById('sa-' + pf.id)?.value);
    if (v > 0) amounts[pf.id] = v;
  });

  spendEvents.push({ year: yr, label: lbl, amounts });
  spendEvents.sort((a, b) => a.year - b.year);

  // Clear form inputs
  document.getElementById('sp-yr').value  = '';
  document.getElementById('sp-lbl').value = '';
  portfolios.forEach(pf => { const e = document.getElementById('sa-' + pf.id); if (e) e.value = ''; });

  renderAll();
}

/** Remove a spend event by index and re-render. */
function removeSpendEvent(i) { spendEvents.splice(i, 1); renderAll(); }


/* ═══════════════════════════════════════════════════════════════════
   11. TRANSFERS
   A transfer moves a fixed amount from one portfolio to another at a
   specific global year. The source balance dips; the destination rises.
   Both continue compounding from their new balances.
   ═══════════════════════════════════════════════════════════════════ */

/** Repopulate the from/to dropdowns in the transfer form. */
function refreshTransferSelects() {
  ['tr-from', 'tr-to'].forEach(id => {
    const sel  = document.getElementById(id);
    if (!sel) return;
    const prev = parseInt(sel.value);  // preserve selection after repopulate
    sel.innerHTML = portfolios.map(pf =>
      `<option value="${pf.id}"${pf.id === prev ? ' selected' : ''}>${pf.name}</option>`
    ).join('');
  });
}

/** Render the saved transfers list in #transfers-list. */
function renderTransfers() {
  const el = document.getElementById('transfers-list');
  if (!el) return;

  if (!transfers.length) {
    el.innerHTML = `<p class="no-items">No transfers yet. Add one below.</p>`;
    return;
  }

  el.innerHTML = transfers.map((tr, i) => {
    const from = portfolios.find(p => p.id === tr.from);
    const to   = portfolios.find(p => p.id === tr.to);
    if (!from || !to) return '';  // portfolio may have been deleted
    return `<div class="event-card">
      <div class="event-header">
        <div><p class="event-title">${tr.label}</p><p class="event-year">Year ${tr.year}</p></div>
        <button class="icon-btn" onclick="removeTransfer(${i})">×</button>
      </div>
      <div class="pills-row">
        <div class="pf-pill" style="background:${from.color}18;">
          <span class="pf-pill-dot" style="background:${from.color};"></span>
          <span style="color:${from.color};">${from.name}</span>
          <span style="color:var(--color-text);margin-left:4px;">−${fmt(tr.amount)}</span>
        </div>
        <span class="transfer-arrow">→</span>
        <div class="pf-pill" style="background:${to.color}18;">
          <span class="pf-pill-dot" style="background:${to.color};"></span>
          <span style="color:${to.color};">${to.name}</span>
          <span style="color:var(--color-text);margin-left:4px;">+${fmt(tr.amount)}</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

/** Read the add-transfer form, validate, push, clear, re-render. */
function addTransfer() {
  const yr   = parseInt(document.getElementById('tr-yr').value);
  const amt  = parseFloat(document.getElementById('tr-amt').value);
  const from = parseInt(document.getElementById('tr-from').value);
  const to   = parseInt(document.getElementById('tr-to').value);
  const lbl  = document.getElementById('tr-lbl').value.trim() || 'Transfer';

  // Reject self-transfers and invalid inputs
  if (!yr || yr < 1 || !amt || amt <= 0 || from === to) return;

  transfers.push({ id: ++trCounter, year: yr, from, to, amount: amt, label: lbl });
  transfers.sort((a, b) => a.year - b.year);

  document.getElementById('tr-yr').value  = '';
  document.getElementById('tr-amt').value = '';
  document.getElementById('tr-lbl').value = '';
  renderAll();
}

/** Remove a transfer by index and re-render. */
function removeTransfer(i) { transfers.splice(i, 1); renderAll(); }


/* ═══════════════════════════════════════════════════════════════════
   12. PAUSE DEPOSITS
   A pause period skips the annual deposit for one portfolio during a
   set of global years. Compounding still runs — only the cash injection
   is skipped, modelling a career break or similar interruption.

   Years are stored as a Set<number> so membership checks are O(1).
   The user enters ranges with syntax like "3-6, 8, 10-12".
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Parse "3-6, 8, 10-12" into a sorted number array.
 * @param {string} raw  User input string.
 * @returns {{ years: number[], error: string|null }}
 */
function parseYearRanges(raw) {
  const years = new Set();
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);

  for (const part of parts) {
    const range  = part.match(/^(\d+)\s*-\s*(\d+)$/);
    const single = part.match(/^(\d+)$/);

    if (range) {
      const from = parseInt(range[1]), to = parseInt(range[2]);
      if (from > to) return { years: [], error: `"${part}": start must be ≤ end` };
      for (let y = from; y <= to; y++) years.add(y);
    } else if (single) {
      years.add(parseInt(single[1]));
    } else {
      return { years: [], error: `"${part}" is not a valid year or range` };
    }
  }
  return { years: [...years].sort((a, b) => a - b), error: null };
}

/**
 * Format a sorted number array back into compact range notation for display.
 * [3,4,5,6,8] → "Yr 3–6, 8"
 * @param {number[]} arr
 */
function formatYears(arr) {
  if (!arr.length) return '';
  const ranges = [];
  let start = arr[0], end = arr[0];
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] === end + 1) { end = arr[i]; }
    else { ranges.push(start === end ? `${start}` : `${start}–${end}`); start = end = arr[i]; }
  }
  ranges.push(start === end ? `${start}` : `${start}–${end}`);
  return 'Yr ' + ranges.join(', ');
}

/** Repopulate the portfolio dropdown in the add-pause form. */
function refreshPauseSelect() {
  const sel = document.getElementById('pa-pf');
  if (!sel) return;
  const prev = parseInt(sel.value);
  sel.innerHTML = portfolios.map(pf =>
    `<option value="${pf.id}"${pf.id === prev ? ' selected' : ''}>${pf.name}</option>`
  ).join('');
}

/** Render the saved pause periods list in #pauses-list. */
function renderPauses() {
  const el = document.getElementById('pauses-list');
  if (!el) return;

  if (!pausePeriods.length) {
    el.innerHTML = `<p class="no-items">No pause periods yet. Add one below.</p>`;
    return;
  }

  el.innerHTML = pausePeriods.map((pa, i) => {
    const pf = portfolios.find(p => p.id === pa.pfId);
    if (!pf) return '';

    // pa.years may be Set or Array depending on origin — normalise for spread
    const yearsArr = pa.years instanceof Set
      ? [...pa.years]
      : Array.isArray(pa.years) ? pa.years : [];
    const yearStr = formatYears(yearsArr.sort((a, b) => a - b));

    return `<div class="event-card">
      <div class="event-header">
        <div>
          <p class="event-title">${pa.label}</p>
          <p class="event-year">${yearStr}</p>
        </div>
        <button class="icon-btn" onclick="removePause(${i})">×</button>
      </div>
      <div class="pills-row">
        <div class="pf-pill" style="background:${pf.color}18;">
          <span class="pf-pill-dot" style="background:${pf.color};"></span>
          <span style="color:${pf.color};">${pf.name}</span>
        </div>
        <span style="font-size:12px;color:var(--color-text-secondary);">deposits paused</span>
      </div>
    </div>`;
  }).join('');
}

/** Read the add-pause form, validate, push, clear, re-render. */
function addPause() {
  const pfId = parseInt(document.getElementById('pa-pf').value);
  const raw  = document.getElementById('pa-years').value.trim();
  const lbl  = document.getElementById('pa-lbl').value.trim() || 'Pause';
  const prev = document.getElementById('pa-parse-preview');

  if (!raw) { prev.textContent = 'Please enter at least one year.'; prev.style.color = '#c0392b'; return; }

  const { years, error } = parseYearRanges(raw);
  if (error)         { prev.textContent = 'Error: ' + error;          prev.style.color = '#c0392b'; return; }
  if (!years.length) { prev.textContent = 'No valid years found.';    prev.style.color = '#c0392b'; return; }

  pausePeriods.push({ id: ++paCounter, pfId, years: new Set(years), label: lbl, raw });
  document.getElementById('pa-years').value = '';
  document.getElementById('pa-lbl').value   = '';
  prev.textContent = '';
  renderAll();
}

/** Remove a pause period by index and re-render. */
function removePause(i) { pausePeriods.splice(i, 1); renderAll(); }

/**
 * Live parse-preview: called on every keystroke in the years input.
 * Shows the parsed year list (or an error) below the input field
 * before the user commits.
 */
function previewPauseYears() {
  const raw  = document.getElementById('pa-years')?.value.trim();
  const prev = document.getElementById('pa-parse-preview');
  if (!prev) return;
  if (!raw) { prev.textContent = ''; return; }

  const { years, error } = parseYearRanges(raw);
  if (error) {
    prev.textContent = 'Error: ' + error;
    prev.style.color = '#c0392b';
  } else {
    prev.textContent = years.length ? 'Pausing: ' + formatYears(years) : '';
    prev.style.color = 'var(--color-text-secondary)';
  }
}


/* ═══════════════════════════════════════════════════════════════════
   13. WITHDRAWALS
   A continuous withdrawal subtracts a fixed annual amount from a
   portfolio each year over a global year range. Optionally the amount
   grows each year at an inflation rate to preserve purchasing power
   (e.g. model a retirement income that keeps pace with costs).
   ═══════════════════════════════════════════════════════════════════ */

/** Repopulate the portfolio dropdown in the add-withdrawal form. */
function refreshWithdrawalSelect() {
  const sel = document.getElementById('wd-pf');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = portfolios.map(pf =>
    `<option value="${pf.id}"${pf.id == prev ? ' selected' : ''}>${pf.name}</option>`
  ).join('');
}

/** Render the saved withdrawal plans list in #withdrawals-list. */
function renderWithdrawals() {
  const el = document.getElementById('withdrawals-list');
  if (!el) return;

  if (!withdrawals.length) {
    el.innerHTML = `<p class="no-items">No withdrawal plans yet. Add one below.</p>`;
    return;
  }

  el.innerHTML = withdrawals.map((wd, i) => {
    const pf = portfolios.find(p => p.id === wd.pfId);
    if (!pf) return '';

    // Show the projected first and last year withdrawal amounts
    const wdInfR      = wd.inflateWithdrawal ? (wd.inflationRate || 0) / 100 : 0;
    const lastAmt     = wd.baseAmount * Math.pow(1 + wdInfR, wd.endYear - wd.startYear);
    const durationYrs = wd.endYear - wd.startYear + 1;

    return `<div class="event-card">
      <div class="event-header">
        <div>
          <p class="event-title">${wd.label}</p>
          <p class="event-year">Yr ${wd.startYear} – Yr ${wd.endYear} &nbsp;·&nbsp; ${durationYrs} yr${durationYrs !== 1 ? 's' : ''}</p>
        </div>
        <button class="icon-btn" onclick="removeWithdrawal(${i})">×</button>
      </div>
      <div class="pills-row" style="margin-bottom:8px;">
        <div class="pf-pill" style="background:${pf.color}18;">
          <span class="pf-pill-dot" style="background:${pf.color};"></span>
          <span style="color:${pf.color};">${pf.name}</span>
        </div>
        <span style="font-size:12px;color:var(--color-text-secondary);">
          ${fmt(wd.baseAmount)}/yr
          ${wd.inflateWithdrawal
            ? `→ ${fmt(lastAmt)}/yr by Yr ${wd.endYear} <span style="color:var(--color-text-hint)">(+${wd.inflationRate}%/yr)</span>`
            : '<span style="color:var(--color-text-hint)">(fixed)</span>'}
        </span>
      </div>
    </div>`;
  }).join('');
}

/** Read the add-withdrawal form, validate, push, clear, re-render. */
function addWithdrawal() {
  const pfId      = portfolios.find(p => p.id == document.getElementById('wd-pf')?.value)?.id;
  const startYear = parseInt(document.getElementById('wd-start').value);
  const endYear   = parseInt(document.getElementById('wd-end').value);
  const baseAmt   = parseFloat(document.getElementById('wd-amount').value);
  const infRate   = parseFloat(document.getElementById('wd-infrate').value) || 0;
  const inflate   = document.getElementById('wd-inflate').checked;
  const lbl       = document.getElementById('wd-lbl').value.trim() || 'Withdrawal';

  // Validate: portfolio must exist, years must be valid, amount must be positive
  if (!pfId || isNaN(startYear) || isNaN(endYear) || isNaN(baseAmt)
      || startYear < 0 || endYear < startYear || baseAmt <= 0) return;

  withdrawals.push({
    id: ++wdCounter,
    pfId, startYear, endYear,
    baseAmount:        baseAmt,
    inflationRate:     infRate,
    inflateWithdrawal: inflate,
    label:             lbl
  });
  withdrawals.sort((a, b) => a.startYear - b.startYear);

  // Clear form
  document.getElementById('wd-start').value  = '';
  document.getElementById('wd-end').value    = '';
  document.getElementById('wd-amount').value = '';
  document.getElementById('wd-lbl').value    = '';

  renderAll();
}

/** Remove a withdrawal plan by index and re-render. */
function removeWithdrawal(i) { withdrawals.splice(i, 1); renderAll(); }


/* ═══════════════════════════════════════════════════════════════════
   14. PORTFOLIO CRUD
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Create a new portfolio, append its card div to #pf-container, and
 * trigger a full re-render. Returns the portfolio object so the CSV
 * importer can capture its generated id.
 * @param {Object} opts  Optional overrides for any portfolio field.
 */
function addPortfolio(opts = {}) {
  const id       = ++pfCounter;
  const colorIdx = portfolios.length % PALETTE.length;

  const pf = {
    id,
    name:            opts.name            || 'Portfolio ' + id,
    color:           PALETTE[colorIdx],
    principal:       opts.principal       || 500000,
    annual:          opts.annual          || 120000,
    rate:            opts.rate            || 7,
    inflation:       opts.inflation       || 6,
    years:           opts.years           || 25,
    startYear:       opts.startYear       || 0,
    inflateDeposits: opts.inflateDeposits !== undefined ? opts.inflateDeposits : true,
    // What happens when this portfolio reaches its end year:
    //   'hold'     — balance stays constant (default current behaviour)
    //   'transfer' — entire balance is moved to maturityTarget portfolio
    maturityAction: opts.maturityAction || 'hold',
    maturityTarget: opts.maturityTarget || null,   // pfId of destination portfolio
    collapsed:       false
  };

  portfolios.push(pf);

  // Create the card container — renderPortfolioCard() fills it in during renderAll()
  const div = document.createElement('div');
  div.className = 'pf-card';
  div.id        = 'pf-' + id;
  document.getElementById('pf-container').appendChild(div);

  // renderAll() is a no-op during batch import (_importing === true),
  // preventing dozens of intermediate re-renders. A single render fires
  // at the end of _applyImportedRows() after all state is populated.
  renderAll();
  return pf;
}

/**
 * Delete a portfolio and all data associated with it:
 * its spend amounts, transfers, pause periods, and withdrawals.
 * @param {number} id  Portfolio id.
 */
function removePortfolio(id) {
  portfolios   = portfolios.filter(p => p.id !== id);
  document.getElementById('pf-' + id)?.remove();

  // Clean up references in all event types
  spendEvents.forEach(ev  => delete ev.amounts[id]);
  transfers    = transfers.filter(tr  => tr.from !== id && tr.to  !== id);
  pausePeriods = pausePeriods.filter(pa => pa.pfId !== id);
  withdrawals  = withdrawals.filter(wd  => wd.pfId !== id);

  renderAll();
}

/**
 * Rename a portfolio and refresh all UI elements that display its name
 * (chart legend, summary cards, dropdown selects, event lists).
 * @param {number} id   Portfolio id.
 * @param {string} val  New name.
 */
function renamePf(id, val) {
  const pf = portfolios.find(p => p.id === id);
  if (!pf) return;
  pf.name = val;

  // Targeted updates — cheaper than a full renderAll() for a rename.
  // portfolios.forEach re-renders each card so maturity dropdowns pick up the new name.
  updateChart();
  updateSummary();
  portfolios.forEach(p => renderPortfolioCard(p));
  renderSpendEvents();
  renderSpendAmounts();
  renderTransfers();
  refreshTransferSelects();
  renderPauses();
  refreshPauseSelect();
  renderWithdrawals();
  refreshWithdrawalSelect();
}

/**
 * Toggle the collapsed state of a portfolio card.
 * Only re-renders the specific card (not the whole page).
 * @param {number} id  Portfolio id.
 */
function toggleCollapse(id) {
  const pf = portfolios.find(p => p.id === id);
  if (pf) { pf.collapsed = !pf.collapsed; renderPortfolioCard(pf); }
}

/**
 * Update a single field on a portfolio and refresh its card + chart + summary.
 * Called by slider oninput events and by startInlineEdit() on commit.
 * @param {number}  id   Portfolio id.
 * @param {string}  key  Field name.
 * @param {*}       val  New value.
 */
function updatePf(id, key, val) {
  const pf = portfolios.find(p => p.id === id);
  if (!pf) return;
  pf[key] = val;
  renderPortfolioCard(pf);
  updateChart();
  updateSummary();
}


/* ═══════════════════════════════════════════════════════════════════
   15. CSV IMPORT
   Restores a complete session from a previously exported CSV file.

   Import flow:
     1. FileReader reads the raw text
     2. parseCSVText() tokenises into a 2D array of strings
     3. _applyImportedRows() splits into named sections (===...===),
        resets all state, rebuilds portfolios/events, restores currency
     4. One final renderAll() fires after _importing is set back to false

   _importing flag:
     Set true before any addPortfolio() call so that the renderAll()
     inside addPortfolio() is suppressed. Without this, each portfolio
     added during import would trigger a full re-render with incomplete
     state (pauses and withdrawals not yet loaded), causing visual
     artefacts and potentially incorrect balance computations.
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Tokenise a raw CSV string into a 2D array of strings.
 * Handles RFC 4180: quoted fields with embedded commas, newlines,
 * and escaped double-quotes ("").
 * @param {string} text  Raw CSV file content.
 * @returns {string[][]}
 */
function parseCSVText(text) {
  const rows = [];
  let row = [], field = '', inQuote = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (inQuote) {
      if (ch === '"' && next === '"') { field += '"'; i++; }  // escaped "
      else if (ch === '"')             { inQuote = false; }   // closing "
      else                             { field += ch; }
    } else {
      if      (ch === '"')  { inQuote = true; }
      else if (ch === ',')  { row.push(field.trim()); field = ''; }
      else if (ch === '\n') { row.push(field.trim()); rows.push(row); row = []; field = ''; }
      else if (ch === '\r') { /* skip — handle CRLF line endings */ }
      else                  { field += ch; }
    }
  }
  // Push the final field/row (no trailing newline in some files)
  row.push(field.trim());
  if (row.some(c => c !== '')) rows.push(row);
  return rows;
}

/**
 * Show a brief success or error message in the #import-status div,
 * then auto-hide it after 4 seconds.
 * @param {string}  msg      Message text.
 * @param {boolean} isError  If true, uses the error colour style.
 */
function showImportStatus(msg, isError = false) {
  const el = document.getElementById('import-status');
  el.textContent = msg;
  el.className   = 'import-status ' + (isError ? 'error' : 'success');
  el.style.display = '';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}

/**
 * Triggered by the hidden file input's onchange event.
 * Resets the input so the same file can be re-imported.
 * @param {HTMLInputElement} input
 */
function importCSV(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';  // allow re-selecting the same file

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const rows = parseCSVText(e.target.result);
      _applyImportedRows(rows);
    } catch (err) {
      showImportStatus('Import failed: ' + err.message, true);
    }
  };
  reader.readAsText(file);
}

/**
 * Apply a parsed CSV (2D string array) to restore the full application state.
 * This is the core import logic.
 * @param {string[][]} rows  Output of parseCSVText().
 */
function _applyImportedRows(rows) {
  // ── Split rows into named sections ───────────────────────────────
  // The export writes sentinel lines like "=== EVENTS ===" between sections.
  // We collect rows until the next sentinel.
  const sections = {};
  let currentKey = null, currentRows = [];

  rows.forEach(row => {
    const first = (row[0] || '').trim();
    if (first.startsWith('=== ') && first.endsWith(' ===')) {
      if (currentKey) sections[currentKey] = currentRows;
      currentKey  = first.replace(/^=== | ===$/g, '');
      currentRows = [];
    } else {
      currentRows.push(row);
    }
  });
  if (currentKey) sections[currentKey] = currentRows;

  // Require the portfolio summary section — it's the source of truth for settings
  const summaryKey = Object.keys(sections).find(k => k.includes('PORTFOLIO SUMMARY'));
  if (!summaryKey) throw new Error('Could not find "PORTFOLIO SUMMARY" section in the file.');
  const summaryRows = sections[summaryKey].filter(r => r.some(c => c));

  // ── Parse currency from the balances section header ───────────────
  // The export embeds "Currency: $ (rate: 0.011)" in the second row
  // of the balances section so we can reverse the conversion on import.
  const balanceKey = Object.keys(sections).find(k => k.includes('YEAR-BY-YEAR'));
  let importRate   = 1;
  let importSymbol = '₹';

  if (balanceKey) {
    const currRow = sections[balanceKey].find(r => (r[0] || '').startsWith('Currency:'));
    if (currRow) {
      const m = currRow[0].match(/Currency:\s*(.+?)\s*\(rate:\s*([\d.]+)\)/);
      if (m) { importSymbol = m[1].trim(); importRate = parseFloat(m[2]) || 1; }
    }
  }

  // Stored values = raw_rupees × importRate, so divide by importRate to recover rupees
  const invRate = importRate > 0 ? 1 / importRate : 1;

  // ── Locate the portfolio settings block ──────────────────────────
  let settingsStart = -1;
  summaryRows.forEach((r, i) => {
    if ((r[0] || '').trim() === 'Portfolio settings') settingsStart = i;
  });
  if (settingsStart === -1) throw new Error('Missing "Portfolio settings" block.');

  // Header row is at settingsStart+1; data rows follow until a blank or "Portfolio results"
  const settingsData = [];
  for (let i = settingsStart + 2; i < summaryRows.length; i++) {
    const r = summaryRows[i];
    if (!r[0] || r[0].trim() === '' || r[0].trim() === 'Portfolio results') break;
    settingsData.push(r);
  }
  if (!settingsData.length) throw new Error('No portfolio data found in the settings block.');

  // ── Locate the events section ────────────────────────────────────
  const eventsKey = Object.keys(sections).find(k => k.includes('EVENTS'));
  const eventRows = eventsKey ? sections[eventsKey].filter(r => r.some(c => c)) : [];

  // Split event rows into named sub-sections by their heading rows
  const eventSections = {};
  let evKey = null, evRows = [];
  eventRows.forEach(r => {
    const first = (r[0] || '').trim();
    if (['Spend events', 'Transfers', 'Deposit pauses', 'Continuous withdrawals'].includes(first)) {
      if (evKey) eventSections[evKey] = evRows;
      evKey  = first;
      evRows = [];
    } else {
      evRows.push(r);
    }
  });
  if (evKey) eventSections[evKey] = evRows;

  // nameToId maps portfolio name → newly assigned id
  // (needed to link events to the right portfolios after re-creation)
  const nameToId = {};

  // ── Reset all state ───────────────────────────────────────────────
  // Suppress re-renders during the batch rebuild — release below.
  _importing = true;

  portfolios.forEach(pf => document.getElementById('pf-' + pf.id)?.remove());
  portfolios   = [];
  spendEvents  = [];
  transfers    = [];
  pausePeriods = [];
  withdrawals  = [];
  pfCounter    = 0;
  trCounter    = 0;
  paCounter    = 0;
  wdCounter    = 0;

  // ── Recreate portfolios ───────────────────────────────────────────
  // Column order: Name | Initial deposit | Annual deposit | Rate | Inflation |
  //               Years | Start year | Inflate deposits | Maturity action | Maturity target
  // Maturity target is stored as a portfolio name; resolve to id in a second pass below.
  const maturityTargetNames = {};   // pfId → target portfolio name (resolved after all portfolios exist)
  settingsData.forEach(r => {
    const pf = addPortfolio({
      name:            r[0] || 'Portfolio',
      principal:       parseFloat(r[1]) * invRate || 500000,
      annual:          parseFloat(r[2]) * invRate || 120000,
      rate:            parseFloat(r[3]) || 7,
      inflation:       parseFloat(r[4]) || 6,
      years:           parseInt(r[5])   || 25,
      startYear:       parseInt(r[6])   || 0,
      inflateDeposits: (r[7] || '').trim().toLowerCase() !== 'no',
      maturityAction:  (r[8] || 'hold').trim().toLowerCase() === 'transfer' ? 'transfer' : 'hold',
      maturityTarget:  null   // resolved below once all portfolios exist
    });
    nameToId[r[0]] = pf.id;
    const targetName = (r[9] || '').trim();
    if (targetName) maturityTargetNames[pf.id] = targetName;
  });

  // Second pass: resolve maturity target names → ids now that nameToId is fully built
  Object.entries(maturityTargetNames).forEach(([pfId, targetName]) => {
    const pf       = portfolios.find(p => p.id === parseInt(pfId));
    const targetId = nameToId[targetName];
    if (pf && targetId && targetId !== pf.id) pf.maturityTarget = targetId;
  });

  // ── Restore spend events ──────────────────────────────────────────
  // Header: Year | Label | Portfolio1 | Portfolio2 | ...
  const spendRows = eventSections['Spend events'] || [];
  if (spendRows.length && (spendRows[0][0] || '') !== '(none)') {
    const header = spendRows[0];
    for (let i = 1; i < spendRows.length; i++) {
      const r  = spendRows[i];
      if (!r[0]) continue;
      const yr = parseInt(r[0]);
      if (isNaN(yr)) continue;
      const amounts = {};
      for (let j = 2; j < header.length; j++) {
        const id = nameToId[header[j]];
        const v  = parseFloat(r[j]) * invRate;
        if (id && !isNaN(v) && v > 0) amounts[id] = v;
      }
      spendEvents.push({ year: yr, label: r[1] || 'Spend', amounts });
    }
    spendEvents.sort((a, b) => a.year - b.year);
  }

  // ── Restore transfers ─────────────────────────────────────────────
  // Header: Year | Label | From | To | Amount
  const trRows = eventSections['Transfers'] || [];
  if (trRows.length && (trRows[0][0] || '') !== '(none)') {
    for (let i = 1; i < trRows.length; i++) {
      const r      = trRows[i];
      if (!r[0]) continue;
      const yr     = parseInt(r[0]);
      const fromId = nameToId[r[2]];
      const toId   = nameToId[r[3]];
      const amt    = parseFloat(r[4]) * invRate;
      if (isNaN(yr) || !fromId || !toId || isNaN(amt) || amt <= 0) continue;
      transfers.push({ id: ++trCounter, year: yr, from: fromId, to: toId, amount: amt, label: r[1] || 'Transfer' });
    }
    transfers.sort((a, b) => a.year - b.year);
  }

  // ── Restore pause periods ─────────────────────────────────────────
  // Header: Portfolio | Label | Global years paused
  // Years are stored as a comma-separated list of integers (e.g. "3, 4, 5, 6, 8").
  // We always create a proper Set<number> here so downstream code works correctly.
  const paRows = eventSections['Deposit pauses'] || [];
  if (paRows.length && (paRows[0][0] || '') !== '(none)') {
    for (let i = 1; i < paRows.length; i++) {
      const r    = paRows[i];
      if (!r[0]) continue;
      const pfId = nameToId[r[0]];
      const raw  = r[2] || '';
      if (!pfId || !raw) continue;
      const yrs = raw.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
      if (!yrs.length) continue;
      // Store raw as normalised comma-separated string for consistency with addPause()
      pausePeriods.push({ id: ++paCounter, pfId, years: new Set(yrs), label: r[1] || 'Pause', raw: yrs.join(', ') });
    }
  }

  // ── Restore continuous withdrawals ────────────────────────────────
  // Header: Portfolio | Label | Start year | End year | Base amount |
  //         Inflation rate (%) | Inflate withdrawal
  const wdRows = eventSections['Continuous withdrawals'] || [];
  if (wdRows.length && (wdRows[0][0] || '') !== '(none)') {
    for (let i = 1; i < wdRows.length; i++) {
      const r         = wdRows[i];
      if (!r[0]) continue;
      const pfId      = nameToId[r[0]];
      const startYear = parseInt(r[2]);
      const endYear   = parseInt(r[3]);
      const baseAmt   = parseFloat(r[4]) * invRate;
      const infRate   = parseFloat(r[5]) || 0;
      const inflate   = (r[6] || '').trim().toLowerCase() !== 'no';
      if (!pfId || isNaN(startYear) || isNaN(endYear) || isNaN(baseAmt) || baseAmt <= 0) continue;
      withdrawals.push({ id: ++wdCounter, pfId, startYear, endYear, baseAmount: baseAmt, inflationRate: infRate, inflateWithdrawal: inflate, label: r[1] || 'Withdrawal' });
    }
    withdrawals.sort((a, b) => a.startYear - b.startYear);
  }

  // ── Restore currency display ──────────────────────────────────────
  if (importRate !== 1) {
    currency = 'OTHER';
    document.getElementById('cur-inr').className   = 'cur-btn';
    document.getElementById('cur-other').className = 'cur-btn active';
    document.getElementById('conv-wrap').style.display = 'flex';
    const ri = document.getElementById('conv-rate');
    const si = document.getElementById('conv-sym');
    if (ri) ri.value = importRate;
    if (si) si.value = importSymbol;
  } else {
    currency = 'INR';
    document.getElementById('cur-inr').className   = 'cur-btn active';
    document.getElementById('cur-other').className = 'cur-btn';
    document.getElementById('conv-wrap').style.display = 'none';
  }

  // Release the import lock and do a single clean render with all state in place
  _importing = false;
  renderAll();
  showImportStatus(`Imported ${portfolios.length} portfolio${portfolios.length > 1 ? 's' : ''} successfully.`);
}


/* ═══════════════════════════════════════════════════════════════════
   16. CSV EXPORT
   Builds a three-section CSV and triggers a browser file download.

   Section 1 — YEAR-BY-YEAR BALANCES
     Rows: year label | balance per portfolio | total
     Values are converted to the current display currency (not rupees).
     A "Currency: ..." row embeds the rate so the import can reverse it.

   Section 2 — PORTFOLIO SUMMARY
     Sub-section "Portfolio settings": full config row per portfolio.
     Sub-section "Portfolio results":  final balance, deposited, interest.

   Section 3 — EVENTS
     Sub-sections for Spend events, Transfers, Deposit pauses,
     and Continuous withdrawals. Each has its own column header row.
     Rows with no events use a single "(none)" placeholder so the
     importer can reliably detect empty sections.
   ═══════════════════════════════════════════════════════════════════ */
function exportCSV() {
  if (!portfolios.length) return;

  const sym  = getSymbol();
  const rate = getRate();
  const maxY = Math.max(...portfolios.map(p => (p.startYear || 0) + p.years));

  // Helper: convert raw rupee value to display currency (plain number, no symbol)
  const cv = v => v !== null && v !== undefined ? (v * rate).toFixed(2) : '';

  // ── Section 1: Year-by-year balances ─────────────────────────────
  const allResults  = portfolios.map(pf => computePortfolio(pf, maxY));
  const balanceRows = [];

  // Column headers
  const balanceHeader = ['Year', ...portfolios.map(p => p.name)];
  if (portfolios.length > 1) balanceHeader.push('Total');
  balanceRows.push(balanceHeader);

  // Currency meta-row — used by the importer to reverse conversion
  balanceRows.push([`Currency: ${sym} (rate: ${rate})`, ...portfolios.map(() => ''), portfolios.length > 1 ? '' : '']);

  // One data row per global year
  for (let y = 0; y <= maxY; y++) {
    const label = y === 0 ? 'Now' : `Year ${y}`;
    const vals  = allResults.map(r => cv(r.balances[y]));
    const row   = [label, ...vals];
    if (portfolios.length > 1) {
      const total     = allResults.reduce((s, r) => s + (r.balances[y] ?? 0), 0);
      const anyActive = allResults.some(r => r.balances[y] !== null && r.balances[y] !== undefined);
      row.push(anyActive ? cv(total) : '');
    }
    balanceRows.push(row);
  }

  // ── Section 2: Portfolio summary ──────────────────────────────────
  const summaryRows = [];
  summaryRows.push(['Portfolio settings']);
  summaryRows.push(['Name', 'Initial deposit', 'Annual deposit', 'Rate (%)', 'Inflation (%)', 'Years', 'Start year', 'Inflate deposits', 'Maturity action', 'Maturity target']);
  portfolios.forEach(pf => {
    const targetName = pf.maturityAction === 'transfer' && pf.maturityTarget
      ? (portfolios.find(p => p.id === pf.maturityTarget)?.name || '')
      : '';
    summaryRows.push([
      pf.name,
      cv(pf.principal),
      cv(pf.annual),
      pf.rate.toFixed(1),
      pf.inflation.toFixed(1),
      pf.years,
      pf.startYear || 0,
      pf.inflateDeposits ? 'Yes' : 'No',
      pf.maturityAction || 'hold',
      targetName
    ]);
  });

  summaryRows.push([]);  // blank separator row
  summaryRows.push(['Portfolio results']);
  summaryRows.push(['Name', 'Final balance', 'Total deposited', 'Interest earned', 'Interest %']);
  portfolios.forEach((pf, i) => {
    const r   = allResults[i];
    const pct = r.totalDeposited > 0
      ? ((r.interest / r.totalDeposited) * 100).toFixed(1) + '%'
      : '0%';
    summaryRows.push([pf.name, cv(r.final), cv(r.totalDeposited), cv(r.interest), pct]);
  });

  // ── Section 3: Events ─────────────────────────────────────────────
  const eventRows = [];

  // Spend events
  eventRows.push(['Spend events']);
  if (spendEvents.length) {
    eventRows.push(['Year', 'Label', ...portfolios.map(p => p.name)]);
    spendEvents.forEach(ev => {
      eventRows.push([ev.year, ev.label, ...portfolios.map(pf => cv(ev.amounts[pf.id] || 0))]);
    });
  } else {
    eventRows.push(['(none)']);
  }

  // Transfers
  eventRows.push([]);
  eventRows.push(['Transfers']);
  if (transfers.length) {
    eventRows.push(['Year', 'Label', 'From', 'To', 'Amount']);
    transfers.forEach(tr => {
      const from = portfolios.find(p => p.id === tr.from)?.name || tr.from;
      const to   = portfolios.find(p => p.id === tr.to)?.name   || tr.to;
      eventRows.push([tr.year, tr.label, from, to, cv(tr.amount)]);
    });
  } else {
    eventRows.push(['(none)']);
  }

  // Deposit pauses — years exported as an expanded comma-separated list ("3, 4, 5, 6, 8")
  // so the importer can simply split on commas without needing range-parsing logic.
  eventRows.push([]);
  eventRows.push(['Deposit pauses']);
  if (pausePeriods.length) {
    eventRows.push(['Portfolio', 'Label', 'Global years paused']);
    pausePeriods.forEach(pa => {
      const pf  = portfolios.find(p => p.id === pa.pfId);
      const yrs = (pa.years instanceof Set ? [...pa.years] : Array.isArray(pa.years) ? pa.years : [])
        .sort((a, b) => a - b).join(', ');
      eventRows.push([pf?.name || pa.pfId, pa.label, yrs]);
    });
  } else {
    eventRows.push(['(none)']);
  }

  // Continuous withdrawals
  eventRows.push([]);
  eventRows.push(['Continuous withdrawals']);
  if (withdrawals.length) {
    eventRows.push(['Portfolio', 'Label', 'Start year', 'End year', 'Base amount', 'Inflation rate (%)', 'Inflate withdrawal']);
    withdrawals.forEach(wd => {
      const pf = portfolios.find(p => p.id === wd.pfId);
      eventRows.push([
        pf?.name || wd.pfId,
        wd.label,
        wd.startYear,
        wd.endYear,
        cv(wd.baseAmount),
        wd.inflationRate,
        wd.inflateWithdrawal ? 'Yes' : 'No'
      ]);
    });
  } else {
    eventRows.push(['(none)']);
  }

  // ── Serialise rows to CSV text ────────────────────────────────────
  // RFC 4180: quote any field containing a comma, double-quote, or newline.
  // Double-quotes inside quoted fields are escaped as "".
  function rowsToCSV(rows) {
    return rows.map(r =>
      r.map(cell => {
        const s = String(cell ?? '');
        return s.includes(',') || s.includes('"') || s.includes('\n')
          ? `"${s.replace(/"/g, '""')}"`
          : s;
      }).join(',')
    ).join('\n');
  }

  const csv = [
    '=== YEAR-BY-YEAR BALANCES (' + sym + ' ' + (rate !== 1 ? `rate:${rate}` : 'INR') + ') ===',
    rowsToCSV(balanceRows),
    '\n\n',
    '=== PORTFOLIO SUMMARY ===',
    rowsToCSV(summaryRows),
    '\n\n',
    '=== EVENTS ===',
    rowsToCSV(eventRows)
  ].join('\n');

  // ── Trigger browser download ──────────────────────────────────────
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'portfolio_data.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}


/* ═══════════════════════════════════════════════════════════════════
   17. FULL RE-RENDER
   renderAll() is the single function that rebuilds every piece of UI
   from the current state. Called after any mutating action.

   It is guarded by _importing: during a batch CSV import, the flag
   suppresses all intermediate renders so only one clean render fires
   at the very end, after all portfolios, events, and currency are set.
   ═══════════════════════════════════════════════════════════════════ */
function renderAll() {
  if (_importing) return;  // suppress during batch import

  portfolios.forEach(pf => renderPortfolioCard(pf));
  renderSpendEvents();
  renderSpendAmounts();
  renderTransfers();
  refreshTransferSelects();
  renderPauses();
  refreshPauseSelect();
  renderWithdrawals();
  refreshWithdrawalSelect();
  updateChart();
  updateSummary();
}


/* ═══════════════════════════════════════════════════════════════════
   18. INIT
   Seed the app with two default portfolios representing a conservative
   FD-style strategy and an equity-style strategy so the chart is
   immediately populated on first load.
   ═══════════════════════════════════════════════════════════════════ */
addPortfolio({ name: 'Portfolio 1', rate: 7,  annual: 120000, years: 25 });
addPortfolio({ name: 'Portfolio 2', rate: 12, annual: 200000, years: 20 });

// Pre-fill the base-year input with the current year so it's ready when toggled on
const _byInp = document.getElementById('base-year-input');
if (_byInp) _byInp.value = baseYear;