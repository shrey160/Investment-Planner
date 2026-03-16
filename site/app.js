/* ─── State ─────────────────────────────────────────────────────── */
const PALETTE = [
  '#185FA5', '#1D9E75', '#7F77DD', '#D85A30',
  '#BA7517', '#D4537E', '#639922', '#0F6E56'
];

let portfolios  = [];
let spendEvents = [];
let pfCounter   = 0;
let chart       = null;
let currency    = 'INR';

/* ─── Currency helpers ──────────────────────────────────────────── */
function getSymbol() {
  if (currency === 'INR') return '₹';
  return (document.getElementById('conv-symbol')?.value || '$').trim();
}

function getRate() {
  if (currency === 'INR') return 1;
  return parseFloat(document.getElementById('conv-rate')?.value) || 1;
}

function fmt(v) {
  const c   = v * getRate();
  const sym = getSymbol();
  if (Math.abs(c) >= 1e7) return sym + (c / 1e7).toFixed(2) + 'Cr';
  if (Math.abs(c) >= 1e5) return sym + (c / 1e5).toFixed(2) + 'L';
  if (Math.abs(c) >= 1000) return sym + Math.round(c).toLocaleString();
  return sym + Math.round(c);
}

function fmtShort(v) {
  const c   = v * getRate();
  const sym = getSymbol();
  if (Math.abs(c) >= 1e9) return sym + (c / 1e9).toFixed(1) + 'B';
  if (Math.abs(c) >= 1e6) return sym + (c / 1e6).toFixed(1) + 'M';
  if (Math.abs(c) >= 1e7) return sym + (c / 1e7).toFixed(1) + 'Cr';
  if (Math.abs(c) >= 1e5) return sym + (c / 1e5).toFixed(1) + 'L';
  if (Math.abs(c) >= 1000) return sym + (c / 1000).toFixed(0) + 'k';
  return sym + Math.round(c);
}

/* ─── Currency toggle ───────────────────────────────────────────── */
function setCurrency(cur) {
  currency = cur;
  document.getElementById('cur-inr').className   = 'cur-btn' + (cur === 'INR' ? ' active' : '');
  document.getElementById('cur-other').className  = 'cur-btn' + (cur !== 'INR' ? ' active' : '');
  document.getElementById('conversion-wrap').style.display = cur !== 'INR' ? 'flex' : 'none';
  renderAll();
}

/* ─── Tab switching ─────────────────────────────────────────────── */
function switchTab(tab) {
  document.getElementById('panel-portfolios').style.display = tab === 'portfolios' ? '' : 'none';
  document.getElementById('panel-spends').style.display     = tab === 'spends'     ? '' : 'none';
  document.getElementById('tab-portfolios').className = 'tab-btn' + (tab === 'portfolios' ? ' active' : '');
  document.getElementById('tab-spends').className     = 'tab-btn' + (tab === 'spends'     ? ' active' : '');
}

/* ─── Portfolio computation ─────────────────────────────────────── */
function computePortfolio(pf) {
  const r    = pf.rate      / 100;
  const infR = pf.inflation / 100;

  const spendMap = {};
  spendEvents.forEach(ev => {
    const amt = ev.amounts[pf.id] || 0;
    if (amt > 0 && ev.year > 0) spendMap[ev.year] = (spendMap[ev.year] || 0) + amt;
  });

  let balance = pf.principal, totalDeposited = pf.principal;
  const balances = [balance];

  for (let y = 1; y <= pf.years; y++) {
    balance *= (1 + r);
    const deposit = pf.inflateDeposits
      ? pf.annual * Math.pow(1 + infR, y - 1)
      : pf.annual;
    balance        += deposit;
    totalDeposited += deposit;
    balance = Math.max(0, balance - (spendMap[y] || 0));
    balances.push(balance);
  }

  return {
    balances,
    totalDeposited,
    final:    balance,
    interest: Math.max(0, balance - totalDeposited)
  };
}

/* ─── Chart ─────────────────────────────────────────────────────── */
function updateChart() {
  if (!portfolios.length) {
    if (chart) { chart.destroy(); chart = null; }
    return;
  }

  const maxY    = Math.max(...portfolios.map(p => p.years));
  const labels  = Array.from({ length: maxY + 1 }, (_, i) => i === 0 ? 'Now' : 'Yr ' + i);
  const showTotal = document.getElementById('total-toggle').checked;

  const allBalances = portfolios.map(pf => computePortfolio(pf).balances);

  const datasets = portfolios.map((pf, pi) => ({
    label:           pf.name,
    borderColor:     pf.color,
    backgroundColor: pf.color + '18',
    data:            labels.map((_, i) => i < allBalances[pi].length ? Math.round(allBalances[pi][i]) : null),
    fill:            false,
    tension:         0.3,
    pointRadius:     2,
    pointHoverRadius:5,
    borderWidth:     2
  }));

  if (showTotal && portfolios.length > 1) {
    datasets.push({
      label:           'Total',
      borderColor:     '#888780',
      backgroundColor: 'transparent',
      data:            labels.map((_, i) => {
        let sum = 0;
        portfolios.forEach((pf, pi) => { if (i < allBalances[pi].length) sum += allBalances[pi][i]; });
        return Math.round(sum);
      }),
      fill:            false,
      tension:         0.3,
      pointRadius:     0,
      pointHoverRadius:5,
      borderWidth:     2,
      borderDash:      [6, 3]
    });
  }

  const legendEl = document.getElementById('legend');
  legendEl.innerHTML = portfolios.map(pf =>
    `<span class="legend-item">
      <span class="legend-dot" style="background:${pf.color};"></span>${pf.name}
    </span>`
  ).join('');

  if (showTotal && portfolios.length > 1) {
    legendEl.innerHTML +=
      `<span class="legend-item">
        <span class="legend-dash"></span>
        <span style="color:var(--color-text-secondary);">Total</span>
      </span>`;
  }

  if (chart) {
    chart.data.labels   = labels;
    chart.data.datasets = datasets;
    chart.update();
  } else {
    chart = new Chart(document.getElementById('mainChart'), {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        plugins: {
          legend:  { display: false },
          tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ' + fmt(ctx.raw) } }
        },
        scales: {
          x: {
            ticks: { autoSkip: true, maxTicksLimit: 13, color: '#9e958a' },
            grid:  { display: false }
          },
          y: {
            ticks: { color: '#9e958a', callback: v => fmtShort(v) },
            grid:  { color: 'rgba(100, 88, 70, 0.08)' }
          }
        }
      }
    });
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

  if (portfolios.length > 1 && document.getElementById('total-toggle').checked) {
    html += `<div class="summary-card total">
      <p class="summary-label">Total</p>
      <p class="summary-val">${fmt(totalFinal)}</p>
    </div>`;
  }

  el.innerHTML = html;
}

/* ─── Inline edit helpers ───────────────────────────────────────── */

/**
 * Config for each editable field:
 *   key       — property name on the portfolio object
 *   min/max   — hard clamp limits
 *   step      — slider step (used to snap typed values)
 *   isFloat   — parse as float (rate / inflation), else integer
 *   suffix    — display-only suffix appended after the raw value
 *   rawValue  — fn(pf) → the raw number to prefill the input with
 */
const FIELD_CONFIG = {
  principal: { min: 500,   max: 10000000, step: 500,  isFloat: false, suffix: '',   rawValue: pf => pf.principal },
  annual:    { min: 0,     max: 2000000,  step: 1000, isFloat: false, suffix: '/yr',rawValue: pf => pf.annual    },
  rate:      { min: 0.5,   max: 25,       step: 0.5,  isFloat: true,  suffix: '%',  rawValue: pf => pf.rate      },
  inflation: { min: 0,     max: 15,       step: 0.5,  isFloat: true,  suffix: '%',  rawValue: pf => pf.inflation },
  years:     { min: 1,     max: 50,       step: 1,    isFloat: false, suffix: '',   rawValue: pf => pf.years     },
};

function startInlineEdit(spanEl, pfId, key) {
  const pf  = portfolios.find(p => p.id === pfId);
  if (!pf) return;
  const cfg = FIELD_CONFIG[key];

  const input = document.createElement('input');
  input.type      = 'number';
  input.className = 'pf-row-val-input';
  input.value     = cfg.rawValue(pf);
  input.min       = cfg.min;
  input.max       = cfg.max;
  input.step      = cfg.step;

  spanEl.replaceWith(input);
  input.focus();
  input.select();

  function commit() {
    let val = cfg.isFloat ? parseFloat(input.value) : parseInt(input.value);
    if (isNaN(val)) val = cfg.rawValue(pf);
    val = Math.min(cfg.max, Math.max(cfg.min, val));
    updatePf(pfId, key, val);
    // renderPortfolioCard re-renders the whole card, so the input is gone automatically
  }

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { updatePf(pfId, key, cfg.rawValue(pf)); }
  });
  input.addEventListener('blur', commit);
}

/* ─── Portfolio card rendering ──────────────────────────────────── */
function renderPortfolioCard(pf) {
  const el = document.getElementById('pf-' + pf.id);
  if (!el) return;

  const { totalDeposited, final, interest } = computePortfolio(pf);

  // Helper: builds the clickable value span for a slider row
  function valSpan(key, display) {
    return `<span
      class="pf-row-val"
      title="Click to type a value"
      onclick="startInlineEdit(this, ${pf.id}, '${key}')"
    >${display}</span>`;
  }

  const slidersHTML = pf.collapsed ? '' : `
    <div class="pf-sliders">
      <div class="pf-row">
        <label class="pf-row-label">
          <span>Initial deposit</span>
          ${valSpan('principal', fmt(pf.principal))}
        </label>
        <input type="range" min="500" max="10000000" step="500" value="${pf.principal}"
               oninput="updatePf(${pf.id},'principal',+this.value)">
      </div>
      <div class="pf-row">
        <label class="pf-row-label">
          <span>Annual deposit</span>
          ${valSpan('annual', fmt(pf.annual) + '/yr')}
        </label>
        <input type="range" min="0" max="2000000" step="1000" value="${pf.annual}"
               oninput="updatePf(${pf.id},'annual',+this.value)">
      </div>
      <div class="pf-row">
        <label class="pf-row-label">
          <span>Interest rate</span>
          ${valSpan('rate', pf.rate.toFixed(1) + '%')}
        </label>
        <input type="range" min="0.5" max="25" step="0.5" value="${pf.rate}"
               oninput="updatePf(${pf.id},'rate',+this.value)">
      </div>
      <div class="pf-row">
        <label class="pf-row-label">
          <span>Inflation rate</span>
          ${valSpan('inflation', pf.inflation.toFixed(1) + '%')}
        </label>
        <input type="range" min="0" max="15" step="0.5" value="${pf.inflation}"
               oninput="updatePf(${pf.id},'inflation',+this.value)">
      </div>
      <div class="pf-row">
        <label class="pf-row-label">
          <span>Years</span>
          ${valSpan('years', pf.years)}
        </label>
        <input type="range" min="1" max="50" step="1" value="${pf.years}"
               oninput="updatePf(${pf.id},'years',+this.value)">
      </div>
      <div class="inflate-toggle-row">
        <label class="tog">
          <input type="checkbox" ${pf.inflateDeposits ? 'checked' : ''}
                 onchange="updatePf(${pf.id},'inflateDeposits',this.checked)">
          <span class="tog-track"></span>
          <span class="tog-thumb"></span>
        </label>
        <span class="muted-label" style="font-size:12px;">Inflate deposits</span>
      </div>
    </div>`;

  el.innerHTML = `
    <div class="pf-header">
      <div class="pf-dot" style="background:${pf.color};"></div>
      <input class="pf-name" value="${pf.name}" onchange="renamePf(${pf.id}, this.value)">
      <button class="collapse-btn" onclick="toggleCollapse(${pf.id})">
        ${pf.collapsed ? '+ expand' : '− collapse'}
      </button>
      <button class="icon-btn" onclick="removePortfolio(${pf.id})">×</button>
    </div>
    <div class="pf-stats-grid">
      <div class="pf-stat-card"><p class="pf-stat-label">Final</p><p class="pf-stat-val">${fmt(final)}</p></div>
      <div class="pf-stat-card"><p class="pf-stat-label">Deposited</p><p class="pf-stat-val">${fmt(totalDeposited)}</p></div>
      <div class="pf-stat-card"><p class="pf-stat-label">Interest</p><p class="pf-stat-val">${fmt(interest)}</p></div>
    </div>
    ${slidersHTML}
  `;
}

/* ─── Spend events rendering ────────────────────────────────────── */
function renderSpendEvents() {
  const el = document.getElementById('spends-container');

  if (!spendEvents.length) {
    el.innerHTML = `<p class="no-items">No spend events yet. Add one below.</p>`;
    return;
  }

  el.innerHTML = spendEvents.map((ev, i) => {
    const pillsHTML = portfolios
      .map(pf => {
        const amt = ev.amounts[pf.id] || 0;
        if (!amt) return '';
        return `<div class="pf-pill" style="background:${pf.color}18;">
          <span class="pf-pill-dot" style="background:${pf.color};"></span>
          <span style="color:${pf.color};">${pf.name}</span>
          <span style="color:var(--color-text);margin-left:4px;">${fmt(amt)}</span>
        </div>`;
      })
      .join('') || `<span class="hint-label">No amounts set</span>`;

    return `<div class="spend-event-card">
      <div class="spend-event-header">
        <div>
          <p class="spend-event-title">${ev.label}</p>
          <p class="spend-event-year">Year ${ev.year}</p>
        </div>
        <button class="icon-btn" onclick="removeSpendEvent(${i})">×</button>
      </div>
      <div class="spend-pills">${pillsHTML}</div>
    </div>`;
  }).join('');
}

function renderNewSpendAmounts() {
  const el = document.getElementById('new-pf-amounts');

  if (!portfolios.length) {
    el.innerHTML = `<p class="hint-label" style="margin-bottom:8px;">Add portfolios first.</p>`;
    return;
  }

  const sym = getSymbol();
  el.innerHTML = portfolios.map(pf => `
    <div class="pf-amount-row">
      <div class="pf-dot" style="background:${pf.color};"></div>
      <span class="pf-amount-name">${pf.name}</span>
      <span class="muted-label">${sym}</span>
      <input type="number" id="amt-${pf.id}" class="sinput" placeholder="0" min="0">
    </div>
  `).join('');
}

/* ─── Spend CRUD ────────────────────────────────────────────────── */
function addSpendEvent() {
  const yr  = parseInt(document.getElementById('new-sy').value);
  const lbl = document.getElementById('new-sl').value.trim() || 'Spend';
  if (!yr || yr < 1) return;

  const amounts = {};
  portfolios.forEach(pf => {
    const v = parseFloat(document.getElementById('amt-' + pf.id)?.value);
    if (v > 0) amounts[pf.id] = v;
  });

  spendEvents.push({ year: yr, label: lbl, amounts });
  spendEvents.sort((a, b) => a.year - b.year);

  document.getElementById('new-sy').value = '';
  document.getElementById('new-sl').value = '';
  portfolios.forEach(pf => {
    const el = document.getElementById('amt-' + pf.id);
    if (el) el.value = '';
  });

  renderAll();
}

function removeSpendEvent(i) {
  spendEvents.splice(i, 1);
  renderAll();
}

/* ─── Portfolio CRUD ────────────────────────────────────────────── */
function addPortfolio(opts = {}) {
  const id       = ++pfCounter;
  const colorIdx = portfolios.length % PALETTE.length;
  const pf = {
    id,
    name:            opts.name     || 'Portfolio ' + id,
    color:           PALETTE[colorIdx],
    principal:       opts.principal || 500000,
    annual:          opts.annual    || 120000,
    rate:            opts.rate      || 7,
    inflation:       opts.inflation || 6,
    years:           opts.years     || 25,
    inflateDeposits: opts.inflateDeposits !== undefined ? opts.inflateDeposits : true,
    collapsed:       false
  };

  portfolios.push(pf);

  const div = document.createElement('div');
  div.className = 'pf-card';
  div.id        = 'pf-' + id;
  document.getElementById('portfolios-container').appendChild(div);

  renderAll();
  return pf;
}

function removePortfolio(id) {
  portfolios = portfolios.filter(p => p.id !== id);
  document.getElementById('pf-' + id)?.remove();
  spendEvents.forEach(ev => delete ev.amounts[id]);
  renderAll();
}

function renamePf(id, val) {
  const pf = portfolios.find(p => p.id === id);
  if (!pf) return;
  pf.name = val;
  updateChart();
  updateSummary();
  renderSpendEvents();
  renderNewSpendAmounts();
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
  renderNewSpendAmounts();
  updateChart();
  updateSummary();
}

/* ─── Init ──────────────────────────────────────────────────────── */
addPortfolio({ name: 'Portfolio 1', rate: 7,  annual: 120000 });
addPortfolio({ name: 'Portfolio 2', rate: 12, annual: 200000 });
