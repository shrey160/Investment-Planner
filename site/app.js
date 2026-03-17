/* ─── State ─────────────────────────────────────────────────────── */
const PALETTE = ['#185FA5','#1D9E75','#7F77DD','#D85A30','#BA7517','#D4537E','#639922','#0F6E56'];

let portfolios   = [];
let spendEvents  = [];
let transfers    = [];
let pausePeriods = [];   // { id, pfId, years: Set<number>, label, raw }
let pfCounter    = 0;
let trCounter    = 0;
let paCounter    = 0;
let chart        = null;
let currency     = 'INR';

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
  ['portfolios', 'spends', 'transfers', 'pauses'].forEach(t => {
    document.getElementById('panel-' + t).style.display = t === tab ? '' : 'none';
    document.getElementById('tab-' + t).className = 'tab-btn' + (t === tab ? ' active' : '');
  });
  if (tab === 'transfers') refreshTransferSelects();
  if (tab === 'pauses')    refreshPauseSelect();
}

/* ─── Portfolio computation ─────────────────────────────────────── */
/**
 * Computes year-by-year balances for a portfolio over `maxYear` years.
 * After pf.years the portfolio is "closed" — balance held constant,
 * no more compounding or deposits, but transfers and spends still apply.
 */
function computePortfolio(pf, maxYear) {
  const r    = pf.rate      / 100;
  const infR = pf.inflation / 100;

  // Spend withdrawals keyed by year
  const spendMap = {};
  spendEvents.forEach(ev => {
    const a = ev.amounts[pf.id] || 0;
    if (a > 0 && ev.year > 0) spendMap[ev.year] = (spendMap[ev.year] || 0) + a;
  });

  // Transfer flows keyed by year (negative = outflow, positive = inflow)
  const transferMap = {};
  transfers.forEach(tr => {
    if (tr.from === pf.id) transferMap[tr.year] = (transferMap[tr.year] || 0) - tr.amount;
    if (tr.to   === pf.id) transferMap[tr.year] = (transferMap[tr.year] || 0) + tr.amount;
  });

  // Build set of paused years for this portfolio
  const pausedYears = new Set();
  pausePeriods.forEach(pa => {
    if (pa.pfId === pf.id) pa.years.forEach(y => pausedYears.add(y));
  });

  const limit = maxYear !== undefined ? maxYear : pf.years;
  let balance = pf.principal, totalDeposited = pf.principal;
  const balances = [balance];

  for (let y = 1; y <= limit; y++) {
    if (y <= pf.years) {
      // Active: always compound
      balance *= (1 + r);
      // Deposit only if not paused this year
      if (!pausedYears.has(y)) {
        const deposit = pf.inflateDeposits
          ? pf.annual * Math.pow(1 + infR, y - 1)
          : pf.annual;
        balance        += deposit;
        totalDeposited += deposit;
      }
      balance = Math.max(0, balance - (spendMap[y]    || 0));
      balance = Math.max(0, balance + (transferMap[y] || 0));
    }
    // Closed: balance stays flat (no compounding, no deposits)
    balances.push(Math.round(balance));
  }

  const finalIdx = Math.min(pf.years, balances.length - 1);
  return {
    balances,
    totalDeposited,
    final:    balances[finalIdx],
    interest: Math.max(0, balances[finalIdx] - totalDeposited)
  };
}

/* ─── Chart ─────────────────────────────────────────────────────── */
function updateChart() {
  if (!portfolios.length) {
    if (chart) { chart.destroy(); chart = null; }
    return;
  }

  const maxY      = Math.max(...portfolios.map(p => p.years));
  const labels    = Array.from({ length: maxY + 1 }, (_, i) => i === 0 ? 'Now' : 'Yr ' + i);
  const showTotal = document.getElementById('total-tog').checked;
  const allBals   = portfolios.map(pf => computePortfolio(pf, maxY).balances);

  const datasets = [];

  // Each portfolio: solid active line + dashed flat tail after close
  portfolios.forEach((pf, pi) => {
    datasets.push({
      label:            pf.name,
      borderColor:      pf.color,
      backgroundColor:  pf.color + '18',
      data:             allBals[pi].map((v, i) => i <= pf.years ? v : null),
      fill:             false,
      tension:          0.3,
      pointRadius:      2,
      pointHoverRadius: 5,
      borderWidth:      2,
      spanGaps:         false
    });
    if (pf.years < maxY) {
      datasets.push({
        label:            pf.name + '_tail',
        borderColor:      pf.color,
        backgroundColor:  'transparent',
        data:             allBals[pi].map((v, i) => i >= pf.years ? v : null),
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

  // Total line — sums all portfolios including held-constant closed ones
  if (showTotal && portfolios.length > 1) {
    datasets.push({
      label:            'Total',
      borderColor:      '#8a8278',
      backgroundColor:  'transparent',
      data:             labels.map((_, i) => {
        let sum = 0;
        portfolios.forEach((_, pi) => { sum += allBals[pi][i] || 0; });
        return Math.round(sum);
      }),
      fill:             false,
      tension:          0.3,
      pointRadius:      0,
      pointHoverRadius: 5,
      borderWidth:      2,
      borderDash:       [6, 3]
    });
  }

  // Legend
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
      : '');

  // Always destroy and recreate to avoid stale dataset state
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
          callbacks: { label: ctx => ctx.dataset.label + ': ' + fmt(ctx.raw) }
        }
      },
      scales: {
        x: { ticks: { autoSkip: true, maxTicksLimit: 13, color: '#9e958a' }, grid: { display: false } },
        y: { ticks: { color: '#9e958a', callback: v => fmtShort(v) }, grid: { color: 'rgba(100,88,70,0.08)' } }
      }
    }
  });
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
    const pills = portfolios.map(pf => {
      const a = ev.amounts[pf.id] || 0;
      if (!a) return '';
      return `<div class="pf-pill" style="background:${pf.color}18;">
        <span class="pf-pill-dot" style="background:${pf.color};"></span>
        <span style="color:${pf.color};">${pf.name}</span>
        <span style="color:var(--color-text);margin-left:4px;">${fmt(a)}</span>
      </div>`;
    }).join('') || `<span class="hint-label">No amounts set</span>`;

    return `<div class="event-card">
      <div class="event-header">
        <div><p class="event-title">${ev.label}</p><p class="event-year">Year ${ev.year}</p></div>
        <button class="icon-btn" onclick="removeSpendEvent(${i})">×</button>
      </div>
      <div class="pills-row">${pills}</div>
    </div>`;
  }).join('');
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

/* ─── Full re-render ────────────────────────────────────────────── */
function renderAll() {
  portfolios.forEach(pf => renderPortfolioCard(pf));
  renderSpendEvents();
  renderSpendAmounts();
  renderTransfers();
  refreshTransferSelects();
  renderPauses();
  refreshPauseSelect();
  updateChart();
  updateSummary();
}

/* ─── Init ──────────────────────────────────────────────────────── */
addPortfolio({ name: 'Portfolio 1', rate: 7,  annual: 120000, years: 25 });
addPortfolio({ name: 'Portfolio 2', rate: 12, annual: 200000, years: 20 });
