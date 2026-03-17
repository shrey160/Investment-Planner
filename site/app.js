/* ─── State ─────────────────────────────────────────────────────── */
const PALETTE = ['#185FA5','#1D9E75','#7F77DD','#D85A30','#BA7517','#D4537E','#639922','#0F6E56'];

let portfolios   = [];
let spendEvents  = [];
let transfers    = [];
let pausePeriods = [];   // { id, pfId, years: Set<number>, label, raw }
let withdrawals  = [];   // { id, pfId, startYear, endYear, baseAmount, inflationRate, inflateWithdrawal, label }
let pfCounter    = 0;
let trCounter    = 0;
let paCounter    = 0;
let wdCounter    = 0;
let chart        = null;
let currency     = 'INR';
let zoomMode     = 'x';   // 'x' | 'y' | 'xy'

/* ─── Currency helpers ──────────────────────────────────────────── */
function getSymbol() {
  if (currency === 'INR') return '₹';
  return (document.getElementById('conv-sym')?.value || '$').trim();
}
function getRate() {
  if (currency === 'INR') return 1;
  return parseFloat(document.getElementById('conv-rate')?.value) || 1;
}
function fmt(v) {
  const c = v * getRate(), s = getSymbol();
  if (Math.abs(c) >= 1e7) return s + (c / 1e7).toFixed(2) + 'Cr';
  if (Math.abs(c) >= 1e5) return s + (c / 1e5).toFixed(2) + 'L';
  if (Math.abs(c) >= 1000) return s + Math.round(c).toLocaleString();
  return s + Math.round(c);
}
function fmtShort(v) {
  const c = v * getRate(), s = getSymbol();
  if (Math.abs(c) >= 1e9) return s + (c / 1e9).toFixed(1) + 'B';
  if (Math.abs(c) >= 1e6) return s + (c / 1e6).toFixed(1) + 'M';
  if (Math.abs(c) >= 1e7) return s + (c / 1e7).toFixed(1) + 'Cr';
  if (Math.abs(c) >= 1e5) return s + (c / 1e5).toFixed(1) + 'L';
  if (Math.abs(c) >= 1000) return s + (c / 1000).toFixed(0) + 'k';
  return s + Math.round(c);
}

/* ─── Currency toggle ───────────────────────────────────────────── */
function setCurrency(cur) {
  currency = cur;
  document.getElementById('cur-inr').className   = 'cur-btn' + (cur === 'INR' ? ' active' : '');
  document.getElementById('cur-other').className  = 'cur-btn' + (cur !== 'INR' ? ' active' : '');
  document.getElementById('conv-wrap').style.display = cur !== 'INR' ? 'flex' : 'none';
  renderAll();
}

/* ─── Tab switching ─────────────────────────────────────────────── */
function switchTab(tab) {
  ['portfolios', 'spends', 'transfers', 'pauses', 'withdrawals'].forEach(t => {
    document.getElementById('panel-' + t).style.display = t === tab ? '' : 'none';
    document.getElementById('tab-' + t).className = 'tab-btn' + (t === tab ? ' active' : '');
  });
  if (tab === 'transfers')  refreshTransferSelects();
  if (tab === 'pauses')     refreshPauseSelect();
  if (tab === 'withdrawals') refreshWithdrawalSelect();
}

/* ─── Portfolio computation ─────────────────────────────────────── */
/**
 * Computes year-by-year balances for a portfolio over `maxYear` years.
 * After pf.years the portfolio is "closed" — balance held constant,
 * no more compounding or deposits, but transfers and spends still apply.
 */
function computePortfolio(pf, maxYear) {
  const r      = pf.rate      / 100;
  const infR   = pf.inflation / 100;
  const start  = pf.startYear || 0;
  const limit  = maxYear !== undefined ? maxYear : start + pf.years;

  // All events use GLOBAL years on the shared timeline.

  // Spend withdrawals keyed by GLOBAL year
  const spendMap = {};
  spendEvents.forEach(ev => {
    const a = ev.amounts[pf.id] || 0;
    if (a > 0 && ev.year > 0) spendMap[ev.year] = (spendMap[ev.year] || 0) + a;
  });

  // Transfer flows keyed by GLOBAL year
  const transferMap = {};
  transfers.forEach(tr => {
    if (tr.from === pf.id) transferMap[tr.year] = (transferMap[tr.year] || 0) - tr.amount;
    if (tr.to   === pf.id) transferMap[tr.year] = (transferMap[tr.year] || 0) + tr.amount;
  });

  // Paused global years — deposit skipped when g is in this set
  const pausedGlobalYears = new Set();
  pausePeriods.forEach(pa => {
    if (pa.pfId === pf.id) pa.years.forEach(y => pausedGlobalYears.add(y));
  });

  // Continuous withdrawal map keyed by GLOBAL year
  // Each active withdrawal contributes its inflation-adjusted amount for each year in [startYear..endYear]
  const withdrawalMap = {};
  withdrawals.forEach(wd => {
    if (wd.pfId !== pf.id) return;
    const wdInfR = (wd.inflateWithdrawal ? (wd.inflationRate || 0) : 0) / 100;
    for (let g = wd.startYear; g <= wd.endYear && g <= limit; g++) {
      const yearsIn = g - wd.startYear;   // 0-indexed: first year = no inflation yet
      const amount  = wd.baseAmount * Math.pow(1 + wdInfR, yearsIn);
      withdrawalMap[g] = (withdrawalMap[g] || 0) + amount;
    }
  });

  const balances = new Array(limit + 1).fill(null);

  let balance = pf.principal;
  let totalDeposited = pf.principal;
  balances[start] = Math.round(balance);

  for (let g = start + 1; g <= limit; g++) {
    const localY = g - start;   // 1-indexed local portfolio year (for inflation calc only)

    if (localY <= pf.years) {
      // Active: compound always
      balance *= (1 + r);

      // Deposit unless this global year is paused
      if (!pausedGlobalYears.has(g)) {
        const deposit = pf.inflateDeposits
          ? pf.annual * Math.pow(1 + infR, localY - 1)
          : pf.annual;
        balance        += deposit;
        totalDeposited += deposit;
      }

      // Spends and transfers at this global year
      balance = Math.max(0, balance - (spendMap[g]       || 0));
      balance = Math.max(0, balance + (transferMap[g]    || 0));
      // Continuous withdrawals
      balance = Math.max(0, balance - (withdrawalMap[g]  || 0));
    } else {
      // Closed: no compounding, no deposits — transfers and withdrawals still apply
      balance = Math.max(0, balance + (transferMap[g]   || 0));
      balance = Math.max(0, balance - (withdrawalMap[g] || 0));
    }

    balances[g] = Math.round(balance);
  }

  const finalGlobal = Math.min(start + pf.years, limit);
  const finalVal    = balances[finalGlobal] ?? 0;

  return {
    balances,
    totalDeposited,
    final:    finalVal,
    interest: Math.max(0, finalVal - totalDeposited)
  };
}

/* ─── Chart ─────────────────────────────────────────────────────── */
function updateChart() {
  if (!portfolios.length) {
    if (chart) { chart.destroy(); chart = null; }
    return;
  }

  const maxY      = Math.max(...portfolios.map(p => (p.startYear || 0) + p.years));
  const labels    = Array.from({ length: maxY + 1 }, (_, i) => i === 0 ? 'Now' : 'Yr ' + i);
  const showTotal = document.getElementById('total-tog').checked;
  const allBals   = portfolios.map(pf => computePortfolio(pf, maxY).balances);

  const datasets = [];

  portfolios.forEach((pf, pi) => {
    const start   = pf.startYear || 0;
    const endGlob = start + pf.years;

    datasets.push({
      label:            pf.name,
      borderColor:      pf.color,
      backgroundColor:  pf.color + '18',
      data:             allBals[pi].map((v, i) => (i >= start && i <= endGlob) ? v : null),
      fill:             false,
      tension:          0.3,
      pointRadius:      2,
      pointHoverRadius: 5,
      borderWidth:      2,
      spanGaps:         false
    });

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

  document.getElementById('legend').innerHTML =
    portfolios.map(pf =>
      `<span class="legend-item">
        <span class="legend-dot" style="background:${pf.color};"></span>${pf.name}
      </span>`
    ).join('') +
    (showTotal && portfolios.length > 1
      ? `<span class="legend-item">
           <span class="legend-dash"></span>
           <span style="color:var(--color-text-secondary);">Total</span>
         </span>`
      : '') +
    (spendEvents.length
      ? `<span class="legend-item">
           <span class="legend-spend-marker"></span>
           <span style="color:var(--color-text-secondary);">Spend</span>
         </span>`
      : '');

  // ── Build spend annotations ──────────────────────────────────────
  // Group all spend events by global year, collect labels for each year
  const spendByYear = {};
  spendEvents.forEach(ev => {
    if (!spendByYear[ev.year]) spendByYear[ev.year] = [];
    spendByYear[ev.year].push(ev.label);
  });

  const annotations = {};
  Object.entries(spendByYear).forEach(([yr, labels]) => {
    const y = parseInt(yr);
    if (y < 0 || y > maxY) return;
    const xLabel = y === 0 ? 'Now' : 'Yr ' + y;
    const labelText = labels.join(', ');
    annotations['spend_' + y] = {
      type:        'line',
      scaleID:     'x',
      value:       xLabel,
      borderColor: '#D85A30',
      borderWidth: 1.5,
      borderDash:  [4, 3],
      label: {
        display:         true,
        content:         labelText,
        position:        'start',
        yAdjust:         -6,
        backgroundColor: 'rgba(216,90,48,0.12)',
        color:           '#D85A30',
        font:            { size: 10, weight: 'normal' },
        padding:         { x: 5, y: 3 },
        borderRadius:    3,
      }
    };
  });

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
        legend:  { display: false },
        tooltip: {
          filter: item => !item.dataset.label.endsWith('_tail'),
          callbacks: {
            label: ctx => ctx.dataset.label + ': ' + fmt(ctx.raw),
            afterBody: ctx => {
              // Show any spend events at this year in the tooltip
              const yr = ctx[0]?.dataIndex;
              if (yr === undefined) return [];
              const evs = spendEvents.filter(ev => ev.year === yr);
              if (!evs.length) return [];
              return ['', '— Spends this year —',
                ...evs.map(ev => {
                  const parts = portfolios
                    .filter(pf => ev.amounts[pf.id] > 0)
                    .map(pf => `${pf.name}: −${fmt(ev.amounts[pf.id])}`);
                  return `${ev.label}` + (parts.length ? ': ' + parts.join(', ') : '');
                })
              ];
            }
          }
        },
        annotation: { annotations },
        zoom: {
          pan: {
            enabled:    true,
            mode:       zoomMode === 'y' ? 'y' : zoomMode === 'xy' ? 'xy' : 'x',
            threshold:  5,
            onPan:      () => showResetZoom(),
          },
          zoom: {
            wheel:   { enabled: true, speed: 0.08 },
            pinch:   { enabled: true },
            mode:    zoomMode,
            onZoom:  () => showResetZoom(),
          },
          limits: {
            x: { minRange: 2 }
          }
        }
      },
      scales: {
        x: { ticks: { autoSkip: true, maxTicksLimit: 13, color: '#9e958a' }, grid: { display: false } },
        y: { ticks: { color: '#9e958a', callback: v => fmtShort(v) }, grid: { color: 'rgba(100,88,70,0.08)' } }
      }
    }
  });
}

function showResetZoom() {
  const btn = document.getElementById('reset-zoom-btn');
  if (btn) btn.style.display = '';
}

function resetChartZoom() {
  if (chart) {
    chart.resetZoom();
    const btn = document.getElementById('reset-zoom-btn');
    if (btn) btn.style.display = 'none';
  }
}

function setZoomMode(mode) {
  zoomMode = mode;
  // Update button active states
  ['x', 'y', 'xy'].forEach(m => {
    const btn = document.getElementById('zm-' + m);
    if (btn) btn.className = 'zoom-mode-btn' + (m === mode ? ' active' : '');
  });
  // Update the live chart plugin without full rebuild — faster response
  if (chart) {
    chart.options.plugins.zoom.pan.mode  = mode === 'y' ? 'y' : mode === 'xy' ? 'xy' : 'x';
    chart.options.plugins.zoom.zoom.mode = mode;
    chart.update('none');
  }
}

/* ─── Summary row ───────────────────────────────────────────────── */
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

/* ─── Inline edit helpers ───────────────────────────────────────── */
const FIELD_CONFIG = {
  principal:      { min: 500,  max: 10000000, step: 500,  isFloat: false, rv: pf => pf.principal      },
  annual:         { min: 0,    max: 2000000,  step: 1000, isFloat: false, rv: pf => pf.annual         },
  rate:           { min: 0.5,  max: 25,       step: 0.5,  isFloat: true,  rv: pf => pf.rate           },
  inflation:      { min: 0,    max: 15,       step: 0.5,  isFloat: true,  rv: pf => pf.inflation      },
  years:          { min: 1,    max: 50,       step: 1,    isFloat: false, rv: pf => pf.years          },
  startYear:      { min: 0,    max: 49,       step: 1,    isFloat: false, rv: pf => pf.startYear      },
};

function startInlineEdit(spanEl, pfId, key) {
  const pf  = portfolios.find(p => p.id === pfId);
  if (!pf) return;
  const cfg = FIELD_CONFIG[key];
  const inp = document.createElement('input');
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
    if (isNaN(val)) val = cfg.rv(pf);
    val = Math.min(cfg.max, Math.max(cfg.min, val));
    updatePf(pfId, key, val);
  }

  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { updatePf(pfId, key, cfg.rv(pf)); }
  });
  inp.addEventListener('blur', commit);
}

/* ─── Portfolio card rendering ──────────────────────────────────── */
function renderPortfolioCard(pf) {
  const el = document.getElementById('pf-' + pf.id);
  if (!el) return;

  const { totalDeposited, final, interest } = computePortfolio(pf);

  function valSpan(key, display) {
    return `<span class="pf-row-val" title="Click to type a value"
      onclick="startInlineEdit(this,${pf.id},'${key}')">${display}</span>`;
  }

  const slidersHTML = pf.collapsed ? '' : `
    <div class="pf-sliders">
      <div class="pf-row">
        <label class="pf-row-label"><span>Initial deposit</span>${valSpan('principal', fmt(pf.principal))}</label>
        <input type="range" min="500" max="10000000" step="500" value="${pf.principal}"
               oninput="updatePf(${pf.id},'principal',+this.value)">
      </div>
      <div class="pf-row">
        <label class="pf-row-label"><span>Annual deposit</span>${valSpan('annual', fmt(pf.annual) + '/yr')}</label>
        <input type="range" min="0" max="2000000" step="1000" value="${pf.annual}"
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

/* ─── Spend events ──────────────────────────────────────────────── */
function renderSpendEvents() {
  const el = document.getElementById('spends-list');
  if (!spendEvents.length) {
    el.innerHTML = `<p class="no-items">No spend events yet. Add one below.</p>`;
    return;
  }

  el.innerHTML = spendEvents.map((ev, i) => {
    const sym = getSymbol();

    // Pills: show all portfolios that have a non-zero amount
    const activePills = portfolios
      .filter(pf => ev.amounts[pf.id] > 0)
      .map(pf => `
        <div class="pf-pill" style="background:${pf.color}18;">
          <span class="pf-pill-dot" style="background:${pf.color};"></span>
          <span style="color:${pf.color};">${pf.name}</span>
          <span style="color:var(--color-text);margin-left:4px;">${fmt(ev.amounts[pf.id])}</span>
        </div>`)
      .join('');

    // Unset portfolios shown as muted pills
    const unsetPills = portfolios
      .filter(pf => !(ev.amounts[pf.id] > 0))
      .map(pf => `
        <div class="pf-pill" style="background:var(--color-bg-tertiary);opacity:0.6;">
          <span class="pf-pill-dot" style="background:${pf.color};"></span>
          <span style="color:var(--color-text-secondary);">${pf.name}</span>
          <span style="color:var(--color-text-hint);margin-left:3px;">—</span>
        </div>`)
      .join('');

    // Editable amount rows for all portfolios
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
          <input class="event-title-input sinput"
                 value="${ev.label}"
                 id="se-lbl-${i}"
                 style="font-weight:500;font-size:13px;width:100%;margin-bottom:2px;"
                 placeholder="Label" />
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:11px;color:var(--color-text-secondary);">Year</span>
            <input type="number" id="se-yr-${i}" class="sinput"
                   value="${ev.year}" min="1" max="99"
                   style="width:60px;font-size:11px;padding:2px 6px;" />
          </div>
        </div>
        <button class="icon-btn" onclick="removeSpendEvent(${i})">×</button>
      </div>

      <div class="pills-row" style="margin-bottom:8px;">
        ${activePills || ''}${unsetPills}
      </div>

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

  // Rotate arrow on open/close
  spendEvents.forEach((_, i) => {
    const det = document.querySelector(`#spends-list details:nth-child(${i + 1})`);
    if (!det) return;
    det.addEventListener('toggle', () => {
      const arrow = document.getElementById('se-arrow-' + i);
      if (arrow) arrow.style.transform = det.open ? 'rotate(90deg)' : '';
    });
  });
}

function saveSpendEvent(i) {
  const ev  = spendEvents[i];
  if (!ev) return;

  // Read updated year and label
  const yrEl  = document.getElementById('se-yr-'  + i);
  const lblEl = document.getElementById('se-lbl-' + i);
  const yr    = parseInt(yrEl?.value);
  const lbl   = lblEl?.value.trim() || ev.label;
  if (!isNaN(yr) && yr > 0) ev.year = yr;
  ev.label = lbl;

  // Read updated amounts for all current portfolios
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
  document.getElementById('sp-yr').value  = '';
  document.getElementById('sp-lbl').value = '';
  portfolios.forEach(pf => { const e = document.getElementById('sa-' + pf.id); if (e) e.value = ''; });
  renderAll();
}
function removeSpendEvent(i) { spendEvents.splice(i, 1); renderAll(); }

/* ─── Transfers ─────────────────────────────────────────────────── */
function refreshTransferSelects() {
  ['tr-from', 'tr-to'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const prev = parseInt(sel.value);
    sel.innerHTML = portfolios.map(pf =>
      `<option value="${pf.id}"${pf.id === prev ? ' selected' : ''}>${pf.name}</option>`
    ).join('');
  });
}

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
    if (!from || !to) return '';
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

function addTransfer() {
  const yr   = parseInt(document.getElementById('tr-yr').value);
  const amt  = parseFloat(document.getElementById('tr-amt').value);
  const from = parseInt(document.getElementById('tr-from').value);
  const to   = parseInt(document.getElementById('tr-to').value);
  const lbl  = document.getElementById('tr-lbl').value.trim() || 'Transfer';
  if (!yr || yr < 1 || !amt || amt <= 0 || from === to) return;
  transfers.push({ id: ++trCounter, year: yr, from, to, amount: amt, label: lbl });
  transfers.sort((a, b) => a.year - b.year);
  document.getElementById('tr-yr').value  = '';
  document.getElementById('tr-amt').value = '';
  document.getElementById('tr-lbl').value = '';
  renderAll();
}
function removeTransfer(i) { transfers.splice(i, 1); renderAll(); }

/* ─── Pauses ─────────────────────────────────────────────────────── */

/**
 * Parse a string like "3-6, 8, 10-12" into a sorted array of year numbers.
 * Returns { years: number[], error: string|null }
 */
function parseYearRanges(raw) {
  const years = new Set();
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
  for (const part of parts) {
    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
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

/** Format a sorted year array back into compact range notation */
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

function refreshPauseSelect() {
  const sel = document.getElementById('pa-pf');
  if (!sel) return;
  const prev = parseInt(sel.value);
  sel.innerHTML = portfolios.map(pf =>
    `<option value="${pf.id}"${pf.id === prev ? ' selected' : ''}>${pf.name}</option>`
  ).join('');
}

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
    const yearStr = formatYears([...pa.years].sort((a, b) => a - b));
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

function addPause() {
  const pfId = parseInt(document.getElementById('pa-pf').value);
  const raw  = document.getElementById('pa-years').value.trim();
  const lbl  = document.getElementById('pa-lbl').value.trim() || 'Pause';
  const prev = document.getElementById('pa-parse-preview');

  if (!raw) { prev.textContent = 'Please enter at least one year.'; prev.style.color = '#c0392b'; return; }

  const { years, error } = parseYearRanges(raw);
  if (error) { prev.textContent = 'Error: ' + error; prev.style.color = '#c0392b'; return; }
  if (!years.length) { prev.textContent = 'No valid years found.'; prev.style.color = '#c0392b'; return; }

  pausePeriods.push({ id: ++paCounter, pfId, years: new Set(years), label: lbl, raw });
  document.getElementById('pa-years').value = '';
  document.getElementById('pa-lbl').value   = '';
  prev.textContent = '';
  renderAll();
}

function removePause(i) {
  pausePeriods.splice(i, 1);
  renderAll();
}

/* Live preview while typing years */
function previewPauseYears() {
  const raw  = document.getElementById('pa-years')?.value.trim();
  const prev = document.getElementById('pa-parse-preview');
  if (!prev) return;
  if (!raw) { prev.textContent = ''; return; }
  const { years, error } = parseYearRanges(raw);
  if (error) { prev.textContent = 'Error: ' + error; prev.style.color = '#c0392b'; }
  else { prev.textContent = years.length ? 'Pausing: ' + formatYears(years) : ''; prev.style.color = 'var(--color-text-secondary)'; }
}

/* ─── Portfolio CRUD ────────────────────────────────────────────── */
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
    collapsed:       false
  };
  portfolios.push(pf);
  const div = document.createElement('div');
  div.className = 'pf-card';
  div.id        = 'pf-' + id;
  document.getElementById('pf-container').appendChild(div);
  renderAll();
  return pf;
}

function removePortfolio(id) {
  portfolios = portfolios.filter(p => p.id !== id);
  document.getElementById('pf-' + id)?.remove();
  spendEvents.forEach(ev => delete ev.amounts[id]);
  transfers    = transfers.filter(tr => tr.from !== id && tr.to !== id);
  pausePeriods = pausePeriods.filter(pa => pa.pfId !== id);
  withdrawals  = withdrawals.filter(wd => wd.pfId !== id);
  renderAll();
}

function renamePf(id, val) {
  const pf = portfolios.find(p => p.id === id);
  if (!pf) return;
  pf.name = val;
  updateChart();
  updateSummary();
  renderSpendEvents();
  renderSpendAmounts();
  renderTransfers();
  refreshTransferSelects();
  renderPauses();
  refreshPauseSelect();
  renderWithdrawals();
  refreshWithdrawalSelect();
}

function toggleCollapse(id) {
  const pf = portfolios.find(p => p.id === id);
  if (pf) { pf.collapsed = !pf.collapsed; renderPortfolioCard(pf); }
}

function updatePf(id, key, val) {
  const pf = portfolios.find(p => p.id === id);
  if (!pf) return;
  pf[key] = val;
  renderPortfolioCard(pf);
  updateChart();
  updateSummary();
}

/* ─── CSV Import ────────────────────────────────────────────────── */

/**
 * Parse a CSV string respecting quoted fields (including embedded commas/newlines).
 * Returns an array of string arrays.
 */
function parseCSVText(text) {
  const rows = [];
  let row = [], field = '', inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (inQuote) {
      if (ch === '"' && next === '"') { field += '"'; i++; }
      else if (ch === '"')            { inQuote = false; }
      else                            { field += ch; }
    } else {
      if      (ch === '"')  { inQuote = true; }
      else if (ch === ',')  { row.push(field.trim()); field = ''; }
      else if (ch === '\n') { row.push(field.trim()); rows.push(row); row = []; field = ''; }
      else if (ch === '\r') { /* skip */ }
      else                  { field += ch; }
    }
  }
  row.push(field.trim());
  if (row.some(c => c !== '')) rows.push(row);
  return rows;
}

function showImportStatus(msg, isError = false) {
  const el = document.getElementById('import-status');
  el.textContent = msg;
  el.className = 'import-status ' + (isError ? 'error' : 'success');
  el.style.display = '';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}

function importCSV(input) {
  const file = input.files[0];
  if (!file) return;
  // Reset the input so the same file can be re-imported
  input.value = '';

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

function _applyImportedRows(rows) {
  // Split into sections by looking for the === SECTION === sentinel lines
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

  // We need the PORTFOLIO SUMMARY section to restore settings
  const summaryKey = Object.keys(sections).find(k => k.includes('PORTFOLIO SUMMARY'));
  if (!summaryKey) throw new Error('Could not find "PORTFOLIO SUMMARY" section in the file.');

  const summaryRows = sections[summaryKey].filter(r => r.some(c => c));

  // ── Parse currency from the BALANCES section header ─────────────
  const balanceKey  = Object.keys(sections).find(k => k.includes('YEAR-BY-YEAR'));
  let importRate    = 1;
  let importSymbol  = '₹';

  if (balanceKey) {
    // First data row: "Currency: ₹ (rate: 1)"  or  "Currency: $ (rate: 0.011)"
    const balRows   = sections[balanceKey];
    const currRow   = balRows.find(r => (r[0] || '').startsWith('Currency:'));
    if (currRow) {
      const m = currRow[0].match(/Currency:\s*(.+?)\s*\(rate:\s*([\d.]+)\)/);
      if (m) { importSymbol = m[1].trim(); importRate = parseFloat(m[2]) || 1; }
    }
  }

  // Inverse of the export rate: stored values were multiplied by rate, so divide to get back INR
  const invRate = importRate > 0 ? 1 / importRate : 1;

  // ── Parse portfolio settings ─────────────────────────────────────
  // Rows: heading row "Portfolio settings", header row, then one row per portfolio
  let settingsStart = -1;
  summaryRows.forEach((r, i) => {
    if ((r[0] || '').trim() === 'Portfolio settings') settingsStart = i;
  });
  if (settingsStart === -1) throw new Error('Missing "Portfolio settings" block.');

  // Header:  Name | Initial deposit | Annual deposit | Rate (%) | Inflation (%) | Years | Start year | Inflate deposits
  const settingsHeader = summaryRows[settingsStart + 1];
  const settingsData   = [];
  for (let i = settingsStart + 2; i < summaryRows.length; i++) {
    const r = summaryRows[i];
    if (!r[0] || r[0].trim() === '' || r[0].trim() === 'Portfolio results') break;
    settingsData.push(r);
  }
  if (!settingsData.length) throw new Error('No portfolio data found in the settings block.');

  // ── Parse events section ─────────────────────────────────────────
  const eventsKey  = Object.keys(sections).find(k => k.includes('EVENTS'));
  const eventRows  = eventsKey ? sections[eventsKey].filter(r => r.some(c => c)) : [];

  // Split event rows into sub-sections by their heading rows
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

  // ── Build portfolio name → temp ID map (used to link events) ────
  // We'll create portfolios in order and record the new IDs by name
  const nameToId = {};

  // ── Reset state and rebuild ──────────────────────────────────────
  // Remove all existing portfolio DOM nodes
  portfolios.forEach(pf => {
    const el = document.getElementById('pf-' + pf.id);
    if (el) el.remove();
  });
  portfolios   = [];
  spendEvents  = [];
  transfers    = [];
  pausePeriods = [];
  withdrawals  = [];
  pfCounter    = 0;
  trCounter    = 0;
  paCounter    = 0;
  wdCounter    = 0;

  // ── Create portfolios ────────────────────────────────────────────
  settingsData.forEach(r => {
    const name            = r[0] || 'Portfolio';
    const principal       = parseFloat(r[1]) * invRate || 500000;
    const annual          = parseFloat(r[2]) * invRate || 120000;
    const rate            = parseFloat(r[3]) || 7;
    const inflation       = parseFloat(r[4]) || 6;
    const years           = parseInt(r[5])   || 25;
    const startYear       = parseInt(r[6])   || 0;
    const inflateDeposits = (r[7] || '').trim().toLowerCase() !== 'no';

    const pf = addPortfolio({ name, principal, annual, rate, inflation, years, startYear, inflateDeposits });
    nameToId[name] = pf.id;
  });

  // ── Parse spend events ───────────────────────────────────────────
  const spendRows = eventSections['Spend events'] || [];
  if (spendRows.length && (spendRows[0][0] || '') !== '(none)') {
    const header = spendRows[0]; // Year, Label, Portfolio1, Portfolio2, ...
    for (let i = 1; i < spendRows.length; i++) {
      const r   = spendRows[i];
      if (!r[0]) continue;
      const yr  = parseInt(r[0]);
      const lbl = r[1] || 'Spend';
      if (isNaN(yr)) continue;
      const amounts = {};
      for (let j = 2; j < header.length; j++) {
        const pfName = header[j];
        const id     = nameToId[pfName];
        const v      = parseFloat(r[j]) * invRate;
        if (id && !isNaN(v) && v > 0) amounts[id] = v;
      }
      spendEvents.push({ year: yr, label: lbl, amounts });
    }
    spendEvents.sort((a, b) => a.year - b.year);
  }

  // ── Parse transfers ──────────────────────────────────────────────
  const trRows = eventSections['Transfers'] || [];
  if (trRows.length && (trRows[0][0] || '') !== '(none)') {
    for (let i = 1; i < trRows.length; i++) {
      const r = trRows[i];
      if (!r[0]) continue;
      const yr     = parseInt(r[0]);
      const lbl    = r[1] || 'Transfer';
      const fromId = nameToId[r[2]];
      const toId   = nameToId[r[3]];
      const amt    = parseFloat(r[4]) * invRate;
      if (isNaN(yr) || !fromId || !toId || isNaN(amt) || amt <= 0) continue;
      transfers.push({ id: ++trCounter, year: yr, from: fromId, to: toId, amount: amt, label: lbl });
    }
    transfers.sort((a, b) => a.year - b.year);
  }

  // ── Parse pause periods ──────────────────────────────────────────
  const paRows = eventSections['Deposit pauses'] || [];
  if (paRows.length && (paRows[0][0] || '') !== '(none)') {
    for (let i = 1; i < paRows.length; i++) {
      const r    = paRows[i];
      if (!r[0]) continue;
      const pfId = nameToId[r[0]];
      const lbl  = r[1] || 'Pause';
      const raw  = r[2] || '';
      if (!pfId || !raw) continue;
      const yrs  = raw.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
      if (!yrs.length) continue;
      pausePeriods.push({ id: ++paCounter, pfId, years: new Set(yrs), label: lbl, raw });
    }
  }

  // ── Parse continuous withdrawals ─────────────────────────────────
  // Header: Portfolio | Label | Start year | End year | Base amount | Inflation rate (%) | Inflate withdrawal
  const wdRows = eventSections['Continuous withdrawals'] || [];
  if (wdRows.length && (wdRows[0][0] || '') !== '(none)') {
    for (let i = 1; i < wdRows.length; i++) {
      const r    = wdRows[i];
      if (!r[0]) continue;
      const pfId      = nameToId[r[0]];
      const lbl       = r[1] || 'Withdrawal';
      const startYear = parseInt(r[2]);
      const endYear   = parseInt(r[3]);
      const baseAmt   = parseFloat(r[4]) * invRate;
      const infRate   = parseFloat(r[5]) || 0;
      const inflate   = (r[6] || '').trim().toLowerCase() !== 'no';
      if (!pfId || isNaN(startYear) || isNaN(endYear) || isNaN(baseAmt) || baseAmt <= 0) continue;
      withdrawals.push({ id: ++wdCounter, pfId, startYear, endYear, baseAmount: baseAmt, inflationRate: infRate, inflateWithdrawal: inflate, label: lbl });
    }
    withdrawals.sort((a, b) => a.startYear - b.startYear);
  }

  // ── Restore currency display ─────────────────────────────────────
  if (importRate !== 1) {
    currency = 'OTHER';
    document.getElementById('cur-inr').className   = 'cur-btn';
    document.getElementById('cur-other').className = 'cur-btn active';
    document.getElementById('conv-wrap').style.display = 'flex';
    const rateInput = document.getElementById('conv-rate');
    const symInput  = document.getElementById('conv-sym');
    if (rateInput) rateInput.value = importRate;
    if (symInput)  symInput.value  = importSymbol;
  } else {
    currency = 'INR';
    document.getElementById('cur-inr').className   = 'cur-btn active';
    document.getElementById('cur-other').className = 'cur-btn';
    document.getElementById('conv-wrap').style.display = 'none';
  }

  renderAll();
  showImportStatus(`Imported ${portfolios.length} portfolio${portfolios.length > 1 ? 's' : ''} successfully.`);
}

/* ─── CSV Export ────────────────────────────────────────────────── */
function exportCSV() {
  if (!portfolios.length) return;

  const sym  = getSymbol();
  const rate = getRate();
  const maxY = Math.max(...portfolios.map(p => (p.startYear || 0) + p.years));

  // Convert a raw rupee value to display currency, plain number (no symbol)
  const cv = v => v !== null && v !== undefined ? (v * rate).toFixed(2) : '';

  // ── Sheet 1: Year-by-year balances ──────────────────────────────
  const allResults = portfolios.map(pf => computePortfolio(pf, maxY));

  const balanceRows = [];

  // Header row
  const balanceHeader = ['Year', ...portfolios.map(p => p.name)];
  if (portfolios.length > 1) balanceHeader.push('Total');
  balanceRows.push(balanceHeader);

  // Currency row
  const currencyRow = [`Currency: ${sym} (rate: ${rate})`, ...portfolios.map(() => ''), portfolios.length > 1 ? '' : ''];
  balanceRows.push(currencyRow);

  // Data rows — one per global year
  for (let y = 0; y <= maxY; y++) {
    const label = y === 0 ? 'Now' : `Year ${y}`;
    const vals  = allResults.map(r => cv(r.balances[y]));
    const row   = [label, ...vals];
    if (portfolios.length > 1) {
      const total = allResults.reduce((s, r) => s + (r.balances[y] ?? 0), 0);
      // Only show total for years where at least one portfolio has started
      const anyActive = allResults.some(r => r.balances[y] !== null && r.balances[y] !== undefined);
      row.push(anyActive ? cv(total) : '');
    }
    balanceRows.push(row);
  }

  // ── Sheet 2: Portfolio summary ───────────────────────────────────
  const summaryRows = [];
  summaryRows.push(['Portfolio settings']);
  summaryRows.push(['Name', 'Initial deposit', 'Annual deposit', 'Rate (%)', 'Inflation (%)', 'Years', 'Start year', 'Inflate deposits']);
  portfolios.forEach(pf => {
    summaryRows.push([
      pf.name,
      cv(pf.principal),
      cv(pf.annual),
      pf.rate.toFixed(1),
      pf.inflation.toFixed(1),
      pf.years,
      pf.startYear || 0,
      pf.inflateDeposits ? 'Yes' : 'No'
    ]);
  });

  summaryRows.push([]);
  summaryRows.push(['Portfolio results']);
  summaryRows.push(['Name', 'Final balance', 'Total deposited', 'Interest earned', 'Interest %']);
  portfolios.forEach((pf, i) => {
    const r = allResults[i];
    const pct = r.totalDeposited > 0
      ? ((r.interest / r.totalDeposited) * 100).toFixed(1) + '%'
      : '0%';
    summaryRows.push([pf.name, cv(r.final), cv(r.totalDeposited), cv(r.interest), pct]);
  });

  // ── Sheet 3: Events ──────────────────────────────────────────────
  const eventRows = [];
  eventRows.push(['Spend events']);
  if (spendEvents.length) {
    const spendHeader = ['Year', 'Label', ...portfolios.map(p => p.name)];
    eventRows.push(spendHeader);
    spendEvents.forEach(ev => {
      eventRows.push([
        ev.year, ev.label,
        ...portfolios.map(pf => cv(ev.amounts[pf.id] || 0))
      ]);
    });
  } else {
    eventRows.push(['(none)']);
  }

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

  eventRows.push([]);
  eventRows.push(['Deposit pauses']);
  if (pausePeriods.length) {
    eventRows.push(['Portfolio', 'Label', 'Global years paused']);
    pausePeriods.forEach(pa => {
      const pf  = portfolios.find(p => p.id === pa.pfId);
      const yrs = [...pa.years].sort((a, b) => a - b).join(', ');
      eventRows.push([pf?.name || pa.pfId, pa.label, yrs]);
    });
  } else {
    eventRows.push(['(none)']);
  }

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

  // ── Combine into one CSV with section separators ─────────────────
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

  const separator = '\n\n';
  const csv = [
    '=== YEAR-BY-YEAR BALANCES (' + sym + ' ' + (rate !== 1 ? `rate:${rate}` : 'INR') + ') ===',
    rowsToCSV(balanceRows),
    separator,
    '=== PORTFOLIO SUMMARY ===',
    rowsToCSV(summaryRows),
    separator,
    '=== EVENTS ===',
    rowsToCSV(eventRows)
  ].join('\n');

  // ── Trigger download ─────────────────────────────────────────────
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

/* ─── Withdrawals ────────────────────────────────────────────────── */

function refreshWithdrawalSelect() {
  const sel = document.getElementById('wd-pf');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = portfolios.map(pf =>
    `<option value="${pf.id}"${pf.id == prev ? ' selected' : ''}>${pf.name}</option>`
  ).join('');
}

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

    // Show the projected first and last withdrawal amounts
    const wdInfR = wd.inflateWithdrawal ? (wd.inflationRate || 0) / 100 : 0;
    const lastAmt = wd.baseAmount * Math.pow(1 + wdInfR, wd.endYear - wd.startYear);
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

function addWithdrawal() {
  const pfId      = portfolios.find(p => p.id == document.getElementById('wd-pf')?.value)?.id;
  const startYear = parseInt(document.getElementById('wd-start').value);
  const endYear   = parseInt(document.getElementById('wd-end').value);
  const baseAmt   = parseFloat(document.getElementById('wd-amount').value);
  const infRate   = parseFloat(document.getElementById('wd-infrate').value) || 0;
  const inflate   = document.getElementById('wd-inflate').checked;
  const lbl       = document.getElementById('wd-lbl').value.trim() || 'Withdrawal';

  if (!pfId || isNaN(startYear) || isNaN(endYear) || isNaN(baseAmt)
      || startYear < 0 || endYear < startYear || baseAmt <= 0) return;

  withdrawals.push({
    id: ++wdCounter,
    pfId, startYear, endYear,
    baseAmount: baseAmt,
    inflationRate: infRate,
    inflateWithdrawal: inflate,
    label: lbl
  });
  withdrawals.sort((a, b) => a.startYear - b.startYear);

  // Clear form
  document.getElementById('wd-start').value  = '';
  document.getElementById('wd-end').value    = '';
  document.getElementById('wd-amount').value = '';
  document.getElementById('wd-lbl').value    = '';

  renderAll();
}

function removeWithdrawal(i) {
  withdrawals.splice(i, 1);
  renderAll();
}

/* ─── Full re-render ────────────────────────────────────────────── */
function renderAll() {
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

/* ─── Init ──────────────────────────────────────────────────────── */
addPortfolio({ name: 'Portfolio 1', rate: 7,  annual: 120000, years: 25 });
addPortfolio({ name: 'Portfolio 2', rate: 12, annual: 200000, years: 20 });