const appState = {
  token: localStorage.getItem('token') || '',
  currentUser: null,
  lookups: null,
  activeTab: 'dashboard'
};
const tabs = ['dashboard', 'clients', 'training-types', 'packages', 'purchases', 'trainers', 'branches', 'bookings', 'expenses', 'users'];
const content = document.querySelector('#content');
const lookupSourceModules = new Set(['clients', 'training-types', 'packages', 'trainers', 'branches']);
const lookupConsumerTabs = new Set(['clients', 'training-types', 'packages', 'purchases', 'trainers', 'branches', 'bookings', 'expenses']);

function toast(msg) {
  const box = document.createElement('div');
  box.className = 'toast';
  box.textContent = msg;
  document.querySelector('#toast').appendChild(box);
  setTimeout(() => box.remove(), 2500);
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (appState.token) headers.Authorization = `Bearer ${appState.token}`;
  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || 'Request failed');
    err.status = res.status;
    err.path = path;
    throw err;
  }
  return data;
}

function fmtMoney(v) { return `$${Number(v || 0).toFixed(2)}`; }
function esc(v) { return `${v ?? ''}`.replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\'': '&#39;', '"': '&quot;' }[c])); }
function paymentStatusClass(v) { return `${v || ''}`.toLowerCase().replace(/\s+/g, '-'); }

function financialSnapshotHtml(d) {
  const snapshot = d.financialSnapshot || d;
  const paymentsMonth = Math.max(0, Number(snapshot.paymentsThisMonth || 0));
  const expensesMonth = Math.max(0, Number(snapshot.expensesThisMonth || 0));
  const netMonth = Number(snapshot.netThisMonth || 0);
  const paymentVsExpenseTotal = paymentsMonth + expensesMonth;
  const paymentSliceDeg = paymentVsExpenseTotal ? (paymentsMonth / paymentVsExpenseTotal) * 360 : 0;
  const pieGradient = paymentVsExpenseTotal
    ? `conic-gradient(#2563eb 0deg ${paymentSliceDeg}deg, #e11d48 ${paymentSliceDeg}deg 360deg)`
    : 'conic-gradient(#e5e7eb 0deg 360deg)';

  return `
    <div class="finance-chart-wrap">
      <div class="finance-pie" style="--pie-gradient:${pieGradient};">
        <div class="finance-pie-center">
          <span>Net</span>
          <strong class="${netMonth >= 0 ? 'amount-positive' : 'amount-negative'}">${fmtMoney(netMonth)}</strong>
        </div>
      </div>
      <div class="finance-legend">
        <div>
          <span class="legend-dot legend-payments"></span>
          <span>Payments this month</span>
          <strong>${fmtMoney(paymentsMonth)}</strong>
        </div>
        <div>
          <span class="legend-dot legend-expenses"></span>
          <span>Expenses this month</span>
          <strong>${fmtMoney(expensesMonth)}</strong>
        </div>
        <div>
          <span class="legend-dot legend-net"></span>
          <span>Net this month</span>
          <strong class="${netMonth >= 0 ? 'amount-positive' : 'amount-negative'}">${fmtMoney(netMonth)}</strong>
        </div>
        ${paymentVsExpenseTotal ? '' : '<div class="empty">No payment or expense records this month yet.</div>'}
      </div>
    </div>
  `;
}

function renderTabs() {
  const el = document.querySelector('#tabs');
  el.innerHTML = tabs.map((t) => `
    <button data-tab="${t}" class="${appState.activeTab === t ? 'active' : ''}">
      <span class="tab-dot"></span>
      <span>${t.replace(/-/g, ' ')}</span>
    </button>
  `).join('');
  el.querySelectorAll('button').forEach((b) => b.onclick = () => { appState.activeTab = b.dataset.tab; renderCurrent(); renderTabs(); });
}

async function ensureLookups(force = false) {
  if (!force && appState.lookups) return;
  appState.lookups = await api('/api/lookups');
}

function invalidateLookups() {
  appState.lookups = null;
}

function renderLogin() {
  document.querySelector('#authView').classList.remove('hidden');
  document.querySelector('#appView').classList.add('hidden');
}

function renderAppShell() {
  document.querySelector('#authView').classList.add('hidden');
  document.querySelector('#appView').classList.remove('hidden');
  document.querySelector('#whoami').textContent = `${appState.currentUser.username} (${appState.currentUser.role})`;
  renderTabs();
}

async function renderDashboard() {
  content.innerHTML = '<div class="loading">Loading dashboard...</div>';
  const d = await api('/api/dashboard');
  const branchOptions = [{ id: '', name: 'All branches' }, ...(d.financialBranches || [])];
  const kpis = [
    { label: 'Total clients', value: d.totalClients, tone: 'blue' },
    { label: 'Active clients', value: d.activeClients, tone: 'teal' },
    { label: 'Payments total', value: fmtMoney(d.totalPaymentsReceived), tone: 'violet' },
    { label: 'Payments this month', value: fmtMoney(d.paymentsThisMonth), tone: 'indigo' },
    { label: 'Expenses this month', value: fmtMoney(d.expensesThisMonth), tone: 'amber' },
    { label: 'Net this month', value: fmtMoney(d.netThisMonth), tone: Number(d.netThisMonth || 0) >= 0 ? 'green' : 'rose' },
    { label: 'Today bookings', value: d.todaysBookings, tone: 'cyan' },
    { label: 'Upcoming this week', value: d.upcomingSessionsWeek, tone: 'sky' }
  ];
  content.innerHTML = `
    <section class="dashboard-hero">
      <div>
        <h3>Operations Overview</h3>
        <p>Live metrics from your current records, organized for faster daily decisions.</p>
      </div>
      <div class="hero-chip">Updated in real time</div>
    </section>

    <div class="dashboard-kpis">
      ${kpis.map((k) => `
        <div class="kpi-card tone-${k.tone}">
          <h4>${k.label}</h4>
          <strong>${k.value}</strong>
        </div>
      `).join('')}
    </div>

    <div class="dashboard-panels dashboard-panels-single">
      <section class="section panel">
        <div class="panel-head">
          <div>
            <h3>Financial snapshot</h3>
            <small>Current month</small>
          </div>
          <label class="finance-filter">
            <span>Branch</span>
            <select id="financialBranchSelect">
              ${branchOptions.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}
            </select>
          </label>
        </div>
        <div id="financialSnapshotBody">
          ${financialSnapshotHtml(d)}
        </div>
      </section>
    </div>

  `;
  const branchSelect = content.querySelector('#financialBranchSelect');
  branchSelect.onchange = async () => {
    const branchId = branchSelect.value;
    branchSelect.disabled = true;
    try {
      const qs = branchId ? `?branch_id=${encodeURIComponent(branchId)}` : '';
      const snapshot = await api(`/api/dashboard${qs}`);
      content.querySelector('#financialSnapshotBody').innerHTML = financialSnapshotHtml(snapshot);
    } catch (err) {
      toast(err.message);
    } finally {
      branchSelect.disabled = false;
      branchSelect.value = branchId;
    }
  };
}

function renderTable(headers, rows) {
  if (!rows?.length) return '<div class="empty">No records yet.</div>';
  return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td data-label="${esc(headers[i] || '')}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

async function renderCrud(module, opts) {
  const { endpoint, title, fields, row, detailsButton, itemLabel } = opts;
  let page = 1;
  let q = '';
  let openId = null;
  let isFormOpen = false;
  let isSaving = false;
  const section = document.createElement('div');
  section.className = 'section';
  content.innerHTML = '';
  content.appendChild(section);

  function readFormData() {
    const form = section.querySelector('#crudForm');
    return Object.fromEntries(new FormData(form).entries());
  }

  function resetForm() {
    const form = section.querySelector('#crudForm');
    form.reset();
    fields.forEach((f) => {
      const input = form.querySelector(`[name="${f.name}"]`);
      if (!input) return;
      if (f.type === 'multi-select') Array.from(input.options).forEach((o) => { o.selected = false; });
      if (f.type === 'checkbox') input.value = 'true';
    });
  }

  function validateForm(raw) {
    for (const f of fields) {
      const value = raw[f.name];
      if (f.required && (value === undefined || value === null || `${value}`.trim() === '')) {
        return `${f.label} is required`;
      }
      if (f.type === 'number' && value !== undefined && value !== null && `${value}`.trim() !== '') {
        const n = Number(value);
        if (!Number.isFinite(n)) return `${f.label} must be a valid number`;
        if (f.min !== undefined && n < f.min) return `${f.label} must be at least ${f.min}`;
      }
    }
    return null;
  }

  function syncFormModeUi() {
    const form = section.querySelector('#crudForm');
    if (!form) return;
    const isEditMode = Boolean(openId);
    const label = isSaving ? 'Saving...' : (isEditMode ? 'Update' : 'Create');
    const title = `${isEditMode ? 'Edit' : 'Add'} ${itemLabel}`;
    const titleEl = form.querySelector('h4');
    const saveBtn = form.querySelector('#saveBtn');
    if (titleEl) titleEl.textContent = title;
    if (saveBtn) saveBtn.textContent = label;
  }

  async function reloadTable() {
    try {
      await load();
    } catch (err) {
      section.innerHTML = `<h3>${title}</h3><div class="empty">Failed to load data: ${esc(err.message || 'unknown error')}</div>`;
      throw err;
    }
  }

  async function load() {
    const isEditMode = Boolean(openId);
    const actionLabel = isEditMode ? 'Update' : 'Create';
    const formTitle = `${isEditMode ? 'Edit' : 'Add'} ${itemLabel}`;
    section.innerHTML = `<h3>${title}</h3><div class="loading">Loading...</div>`;
    const list = await api(`/api/${endpoint}?page=${page}&pageSize=12&q=${encodeURIComponent(q)}`);
    const data = list.data || list;
    const pagination = list.pagination || { page: 1, totalPages: 1 };
    section.innerHTML = `
      <h3>${title}</h3>
      <div class="toolbar">
        <input id="searchInput" placeholder="Search..." value="${esc(q)}" />
        <button id="searchBtn" class="outline" type="button">Search</button>
        <button id="clearBtn" class="outline" type="button">Clear</button>
        <button id="addBtn" type="button">Add ${itemLabel}</button>
      </div>
      <form id="crudForm" class="toolbar ${isFormOpen ? '' : 'hidden'}"><h4 style="margin:0 0 4px 0;width:100%;">${formTitle}</h4>${fields.map((f) => fieldHtml(f)).join('')}<button id="saveBtn" type="submit">${isSaving ? 'Saving...' : actionLabel}</button><button id="cancelBtn" class="outline" type="button">Cancel</button></form>
      <div>${data.length ? `<table><thead><tr>${Object.values(row.headers).map((h) => `<th>${h}</th>`).join('')}<th>Actions</th></tr></thead><tbody>${data.map((x) => rowHtml(x, row, detailsButton)).join('')}</tbody></table>` : '<div class="empty">No records yet.</div>'}</div>
      <div class="toolbar">
        <button id="prevPage" class="outline" type="button" ${pagination.page <= 1 ? 'disabled' : ''}>Prev</button>
        <span>Page ${pagination.page} / ${pagination.totalPages}</span>
        <button id="nextPage" class="outline" type="button" ${pagination.page >= pagination.totalPages ? 'disabled' : ''}>Next</button>
      </div>
    `;

    section.querySelector('#searchBtn').onclick = async () => { q = section.querySelector('#searchInput').value.trim(); page = 1; await reloadTable(); };
    section.querySelector('#clearBtn').onclick = async () => { q = ''; page = 1; await reloadTable(); };
    section.querySelector('#prevPage').onclick = async () => { page = Math.max(1, page - 1); await reloadTable(); };
    section.querySelector('#nextPage').onclick = async () => { page += 1; await reloadTable(); };
    section.querySelector('#addBtn').onclick = async () => {
      openId = null;
      isFormOpen = true;
      await reloadTable();
    };

    section.querySelector('#crudForm').onsubmit = async (e) => {
      e.preventDefault();
      if (isSaving) return;
      const formData = readFormData();
      const validationErr = validateForm(formData);
      if (validationErr) {
        toast(validationErr);
        return;
      }
      const body = parseFieldValues(fields, formData);
      try {
        isSaving = true;
        const saveBtn = section.querySelector('#saveBtn');
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }
        if (openId) await api(`/api/${endpoint}/${openId}`, { method: 'PUT', body: JSON.stringify(body) });
        else await api(`/api/${endpoint}`, { method: 'POST', body: JSON.stringify(body) });
        toast(openId ? `${itemLabel} updated successfully` : `${itemLabel} created successfully`);
        if (lookupSourceModules.has(module)) {
          invalidateLookups();
          await ensureLookups(true);
        }
        openId = null;
        isFormOpen = false;
        await reloadTable();
      } catch (err) {
        toast(err.message);
      } finally {
        isSaving = false;
      }
    };
    section.querySelector('#cancelBtn').onclick = async () => {
      openId = null;
      isFormOpen = false;
      await reloadTable();
    };

    section.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => {
      openId = Number(b.dataset.edit);
      isFormOpen = true;
      section.querySelector('#crudForm').classList.remove('hidden');
      syncFormModeUi();
      const rec = data.find((x) => x.id === openId);
      fields.forEach((f) => {
        const input = section.querySelector(`[name="${f.name}"]`);
        if (!input) return;
        if (f.type === 'multi-select') {
          Array.from(input.options).forEach((o) => { o.selected = (rec[f.name] || []).includes(Number(o.value)); });
        } else input.value = rec[f.name] ?? '';
      });
    });
    section.querySelectorAll('[data-delete]').forEach((b) => b.onclick = async () => {
      if (!confirm('Delete this record?')) return;
      await api(`/api/${endpoint}/${b.dataset.delete}`, { method: 'DELETE' });
      toast('Deleted');
      if (lookupSourceModules.has(module)) {
        invalidateLookups();
        await ensureLookups(true);
      }
      await reloadTable();
    });
    section.querySelectorAll('[data-detail]').forEach((b) => b.onclick = () => detailsButton?.handler(Number(b.dataset.detail)));
    if (isFormOpen && !openId) resetForm();
    if (module === 'payments') {
      const form = section.querySelector('#crudForm');
      const clientInput = form.querySelector('[name="client_id"]');
      const purchaseInput = form.querySelector('[name="package_purchase_id"]');
      if (clientInput && purchaseInput) {
        clientInput.onchange = () => populatePaymentPurchaseOptions(form, '');
        await populatePaymentPurchaseOptions(form, purchaseInput.value);
      }
    }
    syncFormModeUi();
  }
  await reloadTable();
}

function fieldHtml(f) {
  if (f.type === 'select') return `<label>${f.label}<select name="${f.name}" ${f.required ? 'required' : ''}>${(f.options || []).map((o) => `<option value="${o.value}">${o.label}</option>`).join('')}</select></label>`;
  if (f.type === 'multi-select') return `<label>${f.label}<select name="${f.name}" multiple>${(f.options || []).map((o) => `<option value="${o.value}">${o.label}</option>`).join('')}</select></label>`;
  if (f.type === 'textarea') return `<label>${f.label}<textarea name="${f.name}" placeholder="${f.placeholder || ''}"></textarea></label>`;
  if (f.type === 'date') return `<label>${f.label}<input type="date" name="${f.name}" ${f.required ? 'required' : ''}></label>`;
  if (f.type === 'datetime') return `<label>${f.label}<input type="datetime-local" name="${f.name}" ${f.required ? 'required' : ''}></label>`;
  if (f.type === 'checkbox') return `<label>${f.label}<select name="${f.name}"><option value="true">Active</option><option value="false">Inactive</option></select></label>`;
  return `<label>${f.label}<input name="${f.name}" type="${f.type || 'text'}" placeholder="${f.placeholder || ''}" ${f.required ? 'required' : ''}></label>`;
}

function parseFieldValues(fields, raw) {
  const out = {};
  for (const f of fields) {
    if (f.type === 'multi-select') out[f.name] = Array.from(document.querySelector(`[name="${f.name}"]`).selectedOptions).map((o) => Number(o.value));
    else if (f.type === 'number') out[f.name] = raw[f.name] === '' ? null : Number(raw[f.name]);
    else if (f.type === 'checkbox') out[f.name] = raw[f.name] === 'true';
    else out[f.name] = raw[f.name] === '' ? null : raw[f.name];
  }
  return out;
}

function rowHtml(x, row, detailsButton) {
  const cells = Object.keys(row.headers).map((k) => `<td data-label="${esc(row.headers[k] || k)}">${row.render ? row.render(k, x[k], x) : esc(x[k])}</td>`).join('');
  return `<tr>${cells}<td class="row-actions" data-label="Actions">${detailsButton ? `<button data-detail="${x.id}" class="outline">${detailsButton.label}</button>` : ''}<button data-edit="${x.id}" class="outline">Edit</button><button data-delete="${x.id}">Delete</button></td></tr>`;
}

async function populatePaymentPurchaseOptions(form, selectedPurchaseId = '') {
  const clientInput = form.querySelector('[name="client_id"]');
  const purchaseInput = form.querySelector('[name="package_purchase_id"]');
  if (!clientInput || !purchaseInput) return;

  const clientId = clientInput.value;
  const selectedId = selectedPurchaseId || purchaseInput.value;
  if (!clientId) {
    purchaseInput.innerHTML = '<option value="">None</option>';
    return;
  }

  const qs = new URLSearchParams({ page: '1', pageSize: '100', client_id: clientId });
  const list = await api(`/api/purchases?${qs.toString()}`);
  const rows = list.data || [];
  const options = rows.map((p) => {
    const dateLabel = p.purchase_date && dayjs(p.purchase_date).isValid() ? dayjs(p.purchase_date).format('MMM YYYY') : 'Unknown date';
    const sessions = p.sessions_purchased ?? '-';
    const remaining = p.sessions_remaining ?? '-';
    const label = `${p.package_name || 'Package'} (${sessions} sessions, ${remaining} remaining) - ${dateLabel}`;
    return `<option value="${p.id}" ${Number(selectedId) === Number(p.id) ? 'selected' : ''}>${esc(label)}</option>`;
  }).join('');
  purchaseInput.innerHTML = `<option value="">None</option>${options}`;
}

async function renderPurchases() {
  const lookups = appState.lookups || { clients: [], packages: [], branches: [] };
  const clientOptions = lookups.clients.map((x) => ({ value: x.id, label: `${x.first_name} ${x.last_name}` }));
  const packageOptions = lookups.packages.map((x) => ({ value: x.id, label: `${x.name} (${x.training_type_name})` }));
  const branchOptions = lookups.branches.map((x) => ({ value: x.id, label: x.name }));
  let page = 1;
  let filterClientId = '';
  let isPurchaseFormOpen = false;
  let editingPurchase = null;
  let selectedPaymentPurchase = null;
  let receiptState = { isOpen: false, isLoading: false, data: null, error: '' };
  let isSavingPayment = false;
  let isReceiptExporting = false;
  const section = document.createElement('div');
  section.className = 'section';
  content.innerHTML = '';
  content.appendChild(section);

  function purchaseFormHtml() {
    const editing = Boolean(editingPurchase);
    const purchaseDateValue = editing && dayjs(editingPurchase.purchase_date).isValid()
      ? dayjs(editingPurchase.purchase_date).format('YYYY-MM-DD')
      : '';
    const expiryDateValue = editing && editingPurchase.expiry_date && dayjs(editingPurchase.expiry_date).isValid()
      ? dayjs(editingPurchase.expiry_date).format('YYYY-MM-DD')
      : '';
    const currentPackageOptions = editing && !packageOptions.some((o) => Number(o.value) === Number(editingPurchase.package_id))
      ? [...packageOptions, { value: editingPurchase.package_id, label: `${editingPurchase.package_name} (${editingPurchase.training_type_name})` }]
      : packageOptions;
    const optionHtml = (o, selectedValue) => `<option value="${esc(o.value)}" ${Number(o.value) === Number(selectedValue) ? 'selected' : ''}>${esc(o.label)}</option>`;
    return `<form id="purchaseForm" class="toolbar ${isPurchaseFormOpen ? '' : 'hidden'}">
      <h4 style="margin:0 0 4px 0;width:100%;">${editing ? 'Edit Purchase' : 'Add Purchase'}</h4>
      <label>Client<select name="client_id" required>${[{ value: '', label: 'Select client' }, ...clientOptions].map((o) => optionHtml(o, editingPurchase?.client_id)).join('')}</select></label>
      <label>Package<select name="package_id" required>${[{ value: '', label: 'Select package' }, ...currentPackageOptions].map((o) => optionHtml(o, editingPurchase?.package_id)).join('')}</select></label>
      ${editing ? `<label>Sessions purchased<input name="sessions_purchased" type="number" min="${esc(editingPurchase.sessions_used)}" required value="${esc(editingPurchase.sessions_purchased)}"></label>` : ''}
      <label>Purchase date<input type="date" name="purchase_date" required value="${esc(purchaseDateValue)}"></label>
      <label>Expiry date<input type="date" name="expiry_date" value="${esc(expiryDateValue)}"></label>
      <label>Status<select name="status">
        ${[{ value: 'active', label: 'active' }, { value: 'inactive', label: 'inactive' }, { value: 'expired', label: 'expired' }].map((o) => optionHtml(o, editingPurchase?.stored_status || editingPurchase?.status || 'active')).join('')}
      </select></label>
      <button id="savePurchaseBtn" type="submit">${editing ? 'Update' : 'Create'}</button>
      <button id="cancelPurchaseBtn" class="outline" type="button">Cancel</button>
    </form>`;
  }

  function paymentModalHtml() {
    if (!selectedPaymentPurchase) return '';
    const p = selectedPaymentPurchase;
    const remaining = Math.max(0, Number(p.remaining_balance || 0));
    return `<div class="modal-backdrop" role="dialog" aria-modal="true">
      <form id="purchasePaymentForm" class="modal-card">
        <div class="modal-head">
          <h3>Record Payment</h3>
          <button id="closePaymentModal" class="outline" type="button">Close</button>
        </div>
        <div class="payment-summary">
          <div><span>Client</span><strong>${esc(p.client_name)}</strong></div>
          <div><span>Package</span><strong>${esc(p.package_name)}</strong></div>
          <div><span>Price</span><strong>${fmtMoney(p.package_price)}</strong></div>
          <div><span>Already paid</span><strong>${fmtMoney(p.total_paid)}</strong></div>
          <div><span>Remaining</span><strong>${fmtMoney(remaining)}</strong></div>
        </div>
        <input type="hidden" name="client_id" value="${esc(p.client_id)}">
        <input type="hidden" name="package_purchase_id" value="${esc(p.id)}">
        ${fieldHtml({ name: 'amount_paid', label: 'Amount', type: 'number', required: true, min: 0 })}
        ${fieldHtml({ name: 'payment_method', label: 'Payment Method', type: 'select', required: true, options: [{ value: 'Cash', label: 'Cash' }, { value: 'Whish', label: 'Whish' }] })}
        ${fieldHtml({ name: 'branch_id', label: 'Branch', type: 'select', required: true, options: [{ value: '', label: 'Select branch' }, ...branchOptions] })}
        ${fieldHtml({ name: 'notes', label: 'Notes', type: 'textarea' })}
        <div class="toolbar modal-actions">
          <button id="savePaymentBtn" type="submit">${isSavingPayment ? 'Saving...' : 'Save Payment'}</button>
          <button id="cancelPaymentBtn" class="outline" type="button">Cancel</button>
        </div>
      </form>
    </div>`;
  }

  function receiptText(r) {
    if (!r) return '';
    const lines = [
      'EZ Gym',
      'Package Purchase Receipt',
      `Receipt: ${r.receipt.number}`,
      `Purchase ID: ${r.purchase.id}`,
      '',
      `Client: ${r.client.name}`,
      `Package: ${r.package.name}`,
      `Training Type: ${r.package.training_type_name}`,
      `Package Price: ${fmtMoney(r.purchase.package_price)}`,
      `Sessions Purchased: ${r.purchase.sessions_purchased}`,
      `Sessions Used: ${r.purchase.sessions_used}`,
      `Remaining Sessions: ${r.purchase.sessions_remaining}`,
      `Purchase Date: ${r.purchase.purchase_date || '-'}`,
      `Expiry Date: ${r.purchase.expiry_date || '-'}`,
      `Purchase Status: ${r.purchase.status}`,
      `Payment Status: ${r.payment_summary.payment_status}`,
      `Total Paid: ${fmtMoney(r.payment_summary.total_paid)}`,
      `Remaining Balance: ${fmtMoney(r.payment_summary.remaining_balance)}`,
      '',
      'Payment History:'
    ];
    if (r.payments.length) {
      r.payments.forEach((p, idx) => {
        lines.push(`${idx + 1}. ${p.payment_date || '-'} | ${fmtMoney(p.amount_paid)} | ${p.payment_method || '-'} | ${p.branch_name || '-'}${p.notes ? ` | ${p.notes}` : ''}`);
      });
    } else {
      lines.push('No linked payments yet.');
    }
    return lines.join('\n');
  }

  async function copyReceiptText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const ok = document.execCommand('copy');
    textArea.remove();
    if (!ok) throw new Error('Copy failed');
  }

  function printReceiptDocument() {
    if (isReceiptExporting) return;
    const receipt = section.querySelector('.receipt-print-area');
    if (!receipt) {
      toast('Receipt is not ready yet');
      return;
    }
    isReceiptExporting = true;
    document.querySelector('#receiptPrintFrame')?.remove();
    const frame = document.createElement('iframe');
    frame.id = 'receiptPrintFrame';
    frame.title = 'Receipt print preview';
    frame.style.position = 'fixed';
    frame.style.right = '0';
    frame.style.bottom = '0';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    document.body.appendChild(frame);

    const printDoc = frame.contentDocument || frame.contentWindow.document;
    printDoc.open();
    printDoc.write(`<!doctype html>
      <html>
        <head>
          <title>EZ Gym Receipt</title>
          <style>
            @page { size: A4; margin: 12mm; }
            * { box-sizing: border-box; }
            body { margin: 0; color: #101828; font-family: Inter, Arial, sans-serif; background: #fff; }
            .receipt-print-area { width: 100%; border: 0; border-radius: 0; padding: 0; background: #fff; display: grid; gap: 12px; page-break-inside: avoid; break-inside: avoid; }
            .receipt-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; border-bottom: 1px solid #d0d5dd; padding-bottom: 10px; page-break-inside: avoid; break-inside: avoid; }
            .receipt-business { display: block; color: #1d4ed8; font-size: 18px; margin-bottom: 4px; }
            h3, h4 { margin: 0; }
            .receipt-meta { text-align: right; display: grid; gap: 3px; }
            .receipt-meta span, .receipt-grid span { color: #667085; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; }
            .receipt-meta strong { font-size: 17px; }
            .receipt-meta small { color: #667085; }
            .receipt-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; page-break-inside: avoid; break-inside: avoid; }
            .receipt-grid > div { border: 1px solid #e7edf7; border-radius: 8px; background: #fafcff; padding: 8px; display: grid; gap: 4px; page-break-inside: avoid; break-inside: avoid; }
            .receipt-grid strong { font-size: 12px; }
            .status { display: inline-block; border-radius: 999px; padding: 2px 8px; font-size: 11px; background: #ecfdf3; color: #067647; }
            .status.inactive, .status.expired, .status.payment-unpaid { background: #fef3f2; color: #b42318; }
            .status.payment-partially-paid { background: #fffaeb; color: #b54708; }
            .status.payment-fully-paid { background: #ecfdf3; color: #067647; }
            .table-wrap { overflow: visible; page-break-inside: avoid; break-inside: avoid; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; page-break-inside: avoid; break-inside: avoid; }
            th, td { padding: 6px 7px; border-bottom: 1px solid #eef2f7; text-align: left; vertical-align: top; }
            th { color: #475467; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; background: #f9fbff; }
            tr, td, th { page-break-inside: avoid; break-inside: avoid; }
            .empty { color: #667085; }
          </style>
        </head>
        <body>${receipt.outerHTML}</body>
      </html>`);
    printDoc.close();

    const cleanup = () => {
      isReceiptExporting = false;
      setTimeout(() => frame.remove(), 500);
    };
    setTimeout(() => {
      if (!frame.isConnected) return;
      frame.contentWindow.focus();
      frame.contentWindow.onafterprint = cleanup;
      frame.contentWindow.print();
      setTimeout(cleanup, 1500);
    }, 100);
  }

  function receiptModalHtml() {
    if (!receiptState.isOpen) return '';
    const r = receiptState.data;
    const loadingOrError = receiptState.isLoading
      ? '<div class="loading">Loading receipt...</div>'
      : (receiptState.error ? `<div class="empty">${esc(receiptState.error)}</div>` : '');
    const paymentRows = r?.payments?.length
      ? r.payments.map((p) => `<tr>
          <td data-label="Date">${esc(p.payment_date || '-')}</td>
          <td data-label="Amount">${fmtMoney(p.amount_paid)}</td>
          <td data-label="Method">${esc(p.payment_method || '-')}</td>
          <td data-label="Branch">${esc(p.branch_name || '-')}</td>
          <td data-label="Notes">${esc(p.notes || '-')}</td>
        </tr>`).join('')
      : '<tr><td colspan="5" class="empty">No linked payments yet.</td></tr>';
    const body = r ? `<article class="receipt-print-area">
      <div class="receipt-head">
        <div>
          <strong class="receipt-business">${esc(r.business.name)}</strong>
          <h3>${esc(r.receipt.title)}</h3>
        </div>
        <div class="receipt-meta">
          <span>Receipt</span>
          <strong>${esc(r.receipt.number)}</strong>
          <small>Purchase ID ${esc(r.purchase.id)}</small>
        </div>
      </div>
      <div class="receipt-grid">
        <div><span>Client</span><strong>${esc(r.client.name)}</strong></div>
        <div><span>Package</span><strong>${esc(r.package.name)}</strong></div>
        <div><span>Training Type</span><strong>${esc(r.package.training_type_name)}</strong></div>
        <div><span>Package Price</span><strong>${fmtMoney(r.purchase.package_price)}</strong></div>
        <div><span>Sessions Purchased</span><strong>${esc(r.purchase.sessions_purchased)}</strong></div>
        <div><span>Sessions Used</span><strong>${esc(r.purchase.sessions_used)}</strong></div>
        <div><span>Remaining Sessions</span><strong>${esc(r.purchase.sessions_remaining)}</strong></div>
        <div><span>Purchase Date</span><strong>${esc(r.purchase.purchase_date || '-')}</strong></div>
        ${r.purchase.expiry_date ? `<div><span>Expiry Date</span><strong>${esc(r.purchase.expiry_date)}</strong></div>` : ''}
        <div><span>Purchase Status</span><strong><span class="status ${r.purchase.status === 'active' ? '' : esc(r.purchase.status)}">${esc(r.purchase.status)}</span></strong></div>
        <div><span>Payment Status</span><strong><span class="status payment-${paymentStatusClass(r.payment_summary.payment_status)}">${esc(r.payment_summary.payment_status)}</span></strong></div>
        <div><span>Total Paid</span><strong>${fmtMoney(r.payment_summary.total_paid)}</strong></div>
        <div><span>Remaining Balance</span><strong>${fmtMoney(r.payment_summary.remaining_balance)}</strong></div>
      </div>
      <h4>Payment History</h4>
      <div class="table-wrap receipt-payments">
        <table>
          <thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Branch</th><th>Notes</th></tr></thead>
          <tbody>${paymentRows}</tbody>
        </table>
      </div>
    </article>` : loadingOrError;
    return `<div class="modal-backdrop" role="dialog" aria-modal="true">
      <div class="modal-card receipt-modal">
        <div class="modal-head receipt-actions-head">
          <h3>Receipt</h3>
          <button id="closeReceiptModal" class="outline" type="button">Close</button>
        </div>
        ${body}
        <div class="toolbar modal-actions no-print">
          <button id="printReceiptBtn" type="button" ${r ? '' : 'disabled'}>Print</button>
          <button id="pdfReceiptBtn" class="outline" type="button" ${r ? '' : 'disabled'}>Download / Save as PDF</button>
          ${r && navigator.share ? '<button id="shareReceiptBtn" class="outline" type="button">Share</button>' : ''}
          <button id="copyReceiptBtn" class="outline" type="button" ${r ? '' : 'disabled'}>Copy receipt text</button>
        </div>
      </div>
    </div>`;
  }

  function purchaseRowHtml(p) {
    return `<tr>
      <td data-label="Client">${esc(p.client_name)}</td>
      <td data-label="Package">${esc(p.package_name)}</td>
      <td data-label="Price">${fmtMoney(p.package_price)}</td>
      <td data-label="Paid">${fmtMoney(p.total_paid)}</td>
      <td data-label="Remaining">${fmtMoney(p.remaining_balance)}</td>
      <td data-label="Payment Status"><span class="status payment-${paymentStatusClass(p.payment_status)}">${esc(p.payment_status)}</span></td>
      <td data-label="Sessions Purchased">${esc(p.sessions_purchased)}</td>
      <td data-label="Used">${esc(p.sessions_used)}</td>
      <td data-label="Remaining Sessions">${esc(p.sessions_remaining)}</td>
      <td data-label="Date">${esc(p.purchase_date)}</td>
      <td data-label="Expiry Date">${p.expiry_date ? esc(p.expiry_date) : '-'}</td>
      <td data-label="Status"><span class="status ${p.status === 'active' ? '' : esc(p.status)}">${esc(p.status)}</span></td>
      <td class="row-actions" data-label="Actions">
        <button data-record-payment="${p.id}" type="button">Record Payment</button>
        <button data-receipt-purchase="${p.id}" class="outline" type="button">Receipt</button>
        <button data-edit-purchase="${p.id}" class="outline" type="button">Edit</button>
        <button data-delete-purchase="${p.id}" class="danger" type="button">Delete</button>
      </td>
    </tr>`;
  }

  async function load() {
    section.innerHTML = '<h3>Client Package Purchases</h3><div class="loading">Loading...</div>';
    const qs = new URLSearchParams({ page: `${page}`, pageSize: '12' });
    if (filterClientId) qs.set('client_id', filterClientId);
    const list = await api(`/api/purchases?${qs.toString()}`);
    const data = list.data || [];
    const pagination = list.pagination || { page: 1, totalPages: 1 };
    section.innerHTML = `
      <h3>Client Package Purchases</h3>
      <div class="toolbar">
        <label>Filter by Client
          <select id="purchaseClientFilter">
            <option value="">All clients</option>
            ${clientOptions.map((o) => `<option value="${esc(o.value)}" ${Number(o.value) === Number(filterClientId) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
          </select>
        </label>
        <button id="clearPurchaseClientFilter" class="outline" type="button" ${filterClientId ? '' : 'disabled'}>Clear Filter</button>
        <button id="addPurchaseBtn" type="button">Add Purchase</button>
      </div>
      ${purchaseFormHtml()}
      <div class="table-wrap">
        ${data.length ? `<table><thead><tr>
          <th>Client</th><th>Package</th><th>Price</th><th>Paid</th><th>Remaining</th><th>Payment Status</th>
          <th>Sessions Purchased</th><th>Used</th><th>Remaining Sessions</th><th>Date</th><th>Expiry Date</th><th>Status</th><th>Actions</th>
        </tr></thead><tbody>${data.map(purchaseRowHtml).join('')}</tbody></table>` : '<div class="empty">No records yet.</div>'}
      </div>
      <div class="toolbar">
        <button id="prevPage" class="outline" type="button" ${pagination.page <= 1 ? 'disabled' : ''}>Prev</button>
        <span>Page ${pagination.page} / ${pagination.totalPages}</span>
        <button id="nextPage" class="outline" type="button" ${pagination.page >= pagination.totalPages ? 'disabled' : ''}>Next</button>
      </div>
      ${paymentModalHtml()}
      ${receiptModalHtml()}
    `;

    const clientFilter = section.querySelector('#purchaseClientFilter');
    clientFilter.onchange = async () => { filterClientId = clientFilter.value; page = 1; await load(); };
    section.querySelector('#clearPurchaseClientFilter').onclick = async () => { filterClientId = ''; page = 1; await load(); };
    section.querySelector('#addPurchaseBtn').onclick = async () => { editingPurchase = null; isPurchaseFormOpen = true; await load(); };
    section.querySelector('#prevPage').onclick = async () => { page = Math.max(1, page - 1); await load(); };
    section.querySelector('#nextPage').onclick = async () => { page += 1; await load(); };

    const purchaseForm = section.querySelector('#purchaseForm');
    if (purchaseForm) {
      if (isPurchaseFormOpen && !purchaseForm.querySelector('[name="purchase_date"]').value) {
        purchaseForm.querySelector('[name="purchase_date"]').value = dayjs().format('YYYY-MM-DD');
      }
      purchaseForm.onsubmit = async (e) => {
        e.preventDefault();
        const body = Object.fromEntries(new FormData(purchaseForm).entries());
        body.client_id = Number(body.client_id);
        body.package_id = Number(body.package_id);
        if (body.sessions_purchased !== undefined) body.sessions_purchased = Number(body.sessions_purchased);
        try {
          const endpoint = editingPurchase ? `/api/purchases/${editingPurchase.id}` : '/api/purchases';
          await api(endpoint, { method: editingPurchase ? 'PUT' : 'POST', body: JSON.stringify(body) });
          toast(editingPurchase ? 'Purchase updated successfully' : 'Purchase created successfully');
          isPurchaseFormOpen = false;
          editingPurchase = null;
          await load();
        } catch (err) { toast(err.message); }
      };
      section.querySelector('#cancelPurchaseBtn').onclick = async () => { isPurchaseFormOpen = false; editingPurchase = null; await load(); };
    }

    section.querySelectorAll('[data-record-payment]').forEach((btn) => {
      btn.onclick = async () => {
        selectedPaymentPurchase = data.find((x) => Number(x.id) === Number(btn.dataset.recordPayment));
        await load();
      };
    });
    section.querySelectorAll('[data-receipt-purchase]').forEach((btn) => {
      btn.onclick = async () => {
        const purchaseId = Number(btn.dataset.receiptPurchase);
        selectedPaymentPurchase = null;
        receiptState = { isOpen: true, isLoading: true, data: null, error: '' };
        await load();
        try {
          const receipt = await api(`/api/purchases/${purchaseId}/receipt`);
          receiptState = { isOpen: true, isLoading: false, data: receipt, error: '' };
        } catch (err) {
          receiptState = { isOpen: true, isLoading: false, data: null, error: err.message };
        }
        await load();
      };
    });
    section.querySelectorAll('[data-edit-purchase]').forEach((btn) => {
      btn.onclick = async () => {
        editingPurchase = data.find((x) => Number(x.id) === Number(btn.dataset.editPurchase));
        selectedPaymentPurchase = null;
        isPurchaseFormOpen = true;
        await load();
      };
    });
    section.querySelectorAll('[data-delete-purchase]').forEach((btn) => {
      btn.onclick = async () => {
        const purchase = data.find((x) => Number(x.id) === Number(btn.dataset.deletePurchase));
        if (!purchase) return;
        const paymentCount = Number(purchase.payment_count || 0);
        const bookingCount = Number(purchase.booking_count || 0);
        const linkedWarning = paymentCount || bookingCount
          ? `\n\nThis purchase has ${paymentCount} linked payment(s) and ${bookingCount} linked booking(s). Deletion will be blocked to protect those records.`
          : '';
        if (!window.confirm(`Delete purchase for ${purchase.client_name} - ${purchase.package_name}?${linkedWarning}`)) return;
        try {
          await api(`/api/purchases/${purchase.id}`, { method: 'DELETE' });
          toast('Purchase deleted');
          if (editingPurchase && Number(editingPurchase.id) === Number(purchase.id)) {
            editingPurchase = null;
            isPurchaseFormOpen = false;
          }
          await load();
        } catch (err) { toast(err.message); }
      };
    });

    const paymentForm = section.querySelector('#purchasePaymentForm');
    if (paymentForm && selectedPaymentPurchase) {
      paymentForm.querySelector('[name="amount_paid"]').value = Math.max(0, Number(selectedPaymentPurchase.remaining_balance || 0)).toFixed(2);
      section.querySelector('#closePaymentModal').onclick = async () => { selectedPaymentPurchase = null; await load(); };
      section.querySelector('#cancelPaymentBtn').onclick = async () => { selectedPaymentPurchase = null; await load(); };
      paymentForm.onsubmit = async (e) => {
        e.preventDefault();
        if (isSavingPayment) return;
        const body = Object.fromEntries(new FormData(paymentForm).entries());
        body.client_id = Number(body.client_id);
        body.package_purchase_id = Number(body.package_purchase_id);
        body.amount_paid = Number(body.amount_paid);
        body.branch_id = Number(body.branch_id);
        body.payment_date = dayjs().toISOString();
        if (!Number.isFinite(body.amount_paid) || body.amount_paid <= 0) {
          toast('Amount must be greater than zero');
          return;
        }
        try {
          isSavingPayment = true;
          const saveBtn = section.querySelector('#savePaymentBtn');
          if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }
          await api('/api/payments', { method: 'POST', body: JSON.stringify(body) });
          toast('Payment recorded');
          selectedPaymentPurchase = null;
          await load();
        } catch (err) {
          toast(err.message);
        } finally {
          isSavingPayment = false;
        }
      };
    }

    const closeReceiptBtn = section.querySelector('#closeReceiptModal');
    if (closeReceiptBtn) closeReceiptBtn.onclick = async () => { receiptState = { isOpen: false, isLoading: false, data: null, error: '' }; await load(); };
    const printReceiptBtn = section.querySelector('#printReceiptBtn');
    if (printReceiptBtn) printReceiptBtn.onclick = printReceiptDocument;
    const pdfReceiptBtn = section.querySelector('#pdfReceiptBtn');
    if (pdfReceiptBtn) pdfReceiptBtn.onclick = printReceiptDocument;
    const copyReceiptBtn = section.querySelector('#copyReceiptBtn');
    if (copyReceiptBtn) copyReceiptBtn.onclick = async () => {
      try {
        await copyReceiptText(receiptText(receiptState.data));
        toast('Receipt text copied');
      } catch {
        toast('Copy is not available in this browser');
      }
    };
    const shareReceiptBtn = section.querySelector('#shareReceiptBtn');
    if (shareReceiptBtn) shareReceiptBtn.onclick = async () => {
      try {
        await navigator.share({ title: 'EZ Gym Receipt', text: receiptText(receiptState.data) });
      } catch (err) {
        if (err.name !== 'AbortError') toast('Sharing is not available');
      }
    };
  }

  await load();
}

async function showClientDetails(clientId) {
  const d = await api(`/api/clients/${clientId}`);
  content.innerHTML = `
    <div class="section">
      <h3>${d.client.first_name} ${d.client.last_name}</h3>
      <div class="grid">
        <div class="stat"><h4>Used sessions</h4><strong>${d.usedSessions}</strong></div>
        <div class="stat"><h4>Remaining sessions</h4><strong>${d.remainingSessions}</strong></div>
        <div class="stat"><h4>Purchases</h4><strong>${d.purchases.length}</strong></div>
        <div class="stat"><h4>Payments</h4><strong>${d.payments.length}</strong></div>
      </div>
    </div>
    <div class="section"><h3>Purchased packages</h3>${renderTable(['Package', 'Type', 'Purchased', 'Used', 'Remaining', 'Expiry', 'Status'], d.purchases.map((p) => [p.package_name, p.training_type_name, p.sessions_purchased, p.sessions_used, p.sessions_remaining, p.expiry_date || '-', p.status]))}</div>
    <div class="section"><h3>Payment history</h3>${renderTable(['Date', 'Amount', 'Method', 'Branch', 'Notes'], d.payments.map((p) => [dayjs(p.payment_date).format('YYYY-MM-DD'), fmtMoney(p.amount_paid), p.payment_method, p.branch_name || '-', p.notes || '-']))}</div>
    <div class="section"><h3>Upcoming sessions</h3>${renderTable(['Date', 'Type', 'Trainer', 'Branch', 'Status'], d.upcomingSessions.map((s) => [dayjs(s.start_at).format('YYYY-MM-DD HH:mm'), s.training_type_name, s.trainer_name, s.branch_name, s.status]))}</div>
    <div class="section"><h3>Past sessions</h3>${renderTable(['Date', 'Type', 'Trainer', 'Branch', 'Status'], d.pastSessions.map((s) => [dayjs(s.start_at).format('YYYY-MM-DD HH:mm'), s.training_type_name, s.trainer_name, s.branch_name, s.status]))}</div>
  `;
}

async function renderBookings() {
  const lookups = appState.lookups || {
    clients: [],
    trainers: [],
    branches: [],
    trainingTypes: [],
    packages: [],
    paymentMethods: [],
    bookingStatuses: []
  };
  const cOpts = lookups.clients.map((x) => ({ value: x.id, label: `${x.first_name} ${x.last_name}` }));
  const tOpts = lookups.trainers.map((x) => ({ value: x.id, label: `${x.first_name} ${x.last_name}` }));
  const bOpts = lookups.branches.map((x) => ({ value: x.id, label: x.name }));
  const ttOpts = lookups.trainingTypes.map((x) => ({ value: x.id, label: `${x.name} (${x.duration_minutes}m)` }));

  let filterTrainer = '';
  let filterBranch = '';
  let filterType = '';
  let viewMode = 'week';
  let mobileMode = 'agenda';
  let currentDate = dayjs().startOf('day');
  let data = [];
  let selectedBookingId = null;
  let editingBookingId = null;
  const startHour = 6;
  const endHour = 22;
  const pxPerMin = 1;

  function toInputDateTime(v) { return dayjs(v).format('YYYY-MM-DDTHH:mm'); }
  function isMobileView() { return window.matchMedia('(max-width: 800px)').matches; }

  function dateRangeForView() {
    if (isMobileView()) {
      if (mobileMode === 'day') return { from: currentDate.startOf('day'), to: currentDate.endOf('day') };
      return { from: currentDate.startOf('day'), to: currentDate.add(13, 'day').endOf('day') };
    }
    if (viewMode === 'day') return { from: currentDate.startOf('day'), to: currentDate.endOf('day') };
    return { from: currentDate.startOf('week'), to: currentDate.endOf('week') };
  }

  function getVisibleDays() {
    if (viewMode === 'day') return [currentDate.startOf('day')];
    const start = currentDate.startOf('week');
    return Array.from({ length: 7 }, (_, i) => start.add(i, 'day'));
  }

  function bookingsForDay(day) {
    return data.filter((x) => dayjs(x.start_at).isSame(day, 'day'));
  }

  function durationLabel(startAt, endAt) {
    const mins = Math.max(0, dayjs(endAt).diff(dayjs(startAt), 'minute'));
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  function bookingCardHtml(b) {
    const start = dayjs(b.start_at);
    const end = dayjs(b.end_at);
    const startMin = Math.max(0, (start.hour() * 60 + start.minute()) - (startHour * 60));
    const endMin = Math.min((endHour - startHour) * 60, (end.hour() * 60 + end.minute()) - (startHour * 60));
    const top = Math.max(0, startMin * pxPerMin);
    const height = Math.max(24, (endMin - startMin) * pxPerMin);
    return `<button class="calendar-event ${b.status}" data-booking-id="${b.id}" style="top:${top}px;height:${height}px;">
      <strong>${esc(b.client_name || '-')}</strong>
      <small>${esc(b.training_type_name || '-')} • ${esc(b.trainer_name || '-')}</small>
      <small>${start.format('HH:mm')} - ${end.format('HH:mm')} • ${esc(b.branch_name || '-')}</small>
      <small>${esc(b.status)}</small>
    </button>`;
  }

  async function loadRows() {
    const { from, to } = dateRangeForView();
    const qs = new URLSearchParams({ page: '1', pageSize: '500', from: from.toISOString(), to: to.toISOString() });
    if (filterTrainer) qs.set('trainer_id', filterTrainer);
    if (filterBranch) qs.set('branch_id', filterBranch);
    if (filterType) qs.set('training_type_id', filterType);
    const list = await api(`/api/bookings?${qs.toString()}`);
    data = list.data || [];
  }

  function selectedBooking() {
    return data.find((x) => Number(x.id) === Number(selectedBookingId)) || null;
  }

  function detailsHtml() {
    const b = selectedBooking();
    if (!b) return '<div class="empty">Click a booking in the calendar to view details.</div>';
    return `
      <div class="booking-details">
        <h4>${esc(b.client_name || '-')}</h4>
        <p><strong>Trainer:</strong> ${esc(b.trainer_name || '-')}</p>
        <p><strong>Training Type:</strong> ${esc(b.training_type_name || '-')}</p>
        <p><strong>Branch:</strong> ${esc(b.branch_name || '-')}</p>
        <p><strong>Time:</strong> ${dayjs(b.start_at).format('YYYY-MM-DD HH:mm')} - ${dayjs(b.end_at).format('HH:mm')}</p>
        <p><strong>Status:</strong> <span class="status ${esc(b.status)}">${esc(b.status)}</span></p>
        <div class="toolbar">
          <select id="bookingStatusSelect">${lookups.bookingStatuses.map((s) => `<option ${s === b.status ? 'selected' : ''} value="${s}">${s}</option>`).join('')}</select>
          <button id="updateBookingStatus" type="button">Update Status</button>
          <button id="editBookingBtn" type="button" class="outline">Load Into Form</button>
        </div>
      </div>
    `;
  }

  function calendarHtml() {
    const days = getVisibleDays();
    const totalMins = (endHour - startHour) * 60;
    const columnHeight = totalMins * pxPerMin;
    const hourRows = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i);
    return `
      <div class="calendar-wrapper">
        <div class="calendar-header">
          <div class="calendar-time-col"></div>
          ${days.map((d) => `<div class="calendar-day-head">${d.format('ddd DD MMM')}</div>`).join('')}
        </div>
        <div class="calendar-body" style="height:${columnHeight}px;">
          <div class="calendar-time-col">
            ${hourRows.map((h) => `<div class="calendar-hour-label" style="top:${(h - startHour) * 60 * pxPerMin}px;">${`${h}`.padStart(2, '0')}:00</div>`).join('')}
          </div>
          ${days.map((d) => `
            <div class="calendar-day-col" data-slot-day="${d.format('YYYY-MM-DD')}">
              ${hourRows.map((h) => `<div class="calendar-hour-line" style="top:${(h - startHour) * 60 * pxPerMin}px;"></div>`).join('')}
              ${bookingsForDay(d).map(bookingCardHtml).join('')}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function bookingAgendaItemHtml(b) {
    const start = dayjs(b.start_at);
    const end = dayjs(b.end_at);
    return `<button class="agenda-item ${b.status}" data-booking-id="${b.id}">
      <div class="agenda-time">${start.format('HH:mm')} - ${end.format('HH:mm')} (${durationLabel(b.start_at, b.end_at)})</div>
      <div class="agenda-main">${esc(b.client_name || '-')} • ${esc(b.training_type_name || '-')}</div>
      <div class="agenda-meta">${esc(b.trainer_name || '-')} • ${esc(b.branch_name || '-')} • ${esc(b.status)}</div>
    </button>`;
  }

  function mobileAgendaHtml() {
    const days = Array.from({ length: 14 }, (_, i) => currentDate.startOf('day').add(i, 'day'));
    return `<div class="agenda-list">
      ${days.map((d) => {
        const rows = bookingsForDay(d);
        return `<div class="agenda-day-group">
          <div class="agenda-day-head">
            <strong>${d.format('ddd, DD MMM YYYY')}</strong>
            <button class="outline" type="button" data-prefill-day="${d.format('YYYY-MM-DD')}">New</button>
          </div>
          ${rows.length ? rows.map(bookingAgendaItemHtml).join('') : '<div class="empty">No bookings</div>'}
        </div>`;
      }).join('')}
    </div>`;
  }

  function mobileDayHtml() {
    const d = currentDate.startOf('day');
    const rows = bookingsForDay(d);
    return `<div class="agenda-list">
      <div class="agenda-day-group">
        <div class="agenda-day-head">
          <strong>${d.format('ddd, DD MMM YYYY')}</strong>
          <button class="outline" type="button" data-prefill-day="${d.format('YYYY-MM-DD')}">New</button>
        </div>
        ${rows.length ? rows.map(bookingAgendaItemHtml).join('') : '<div class="empty">No bookings</div>'}
      </div>
    </div>`;
  }

  function render() {
    const mobile = isMobileView();
    const { from, to } = dateRangeForView();
    const title = mobile
      ? (mobileMode === 'day' ? from.format('ddd, DD MMM YYYY') : `${from.format('DD MMM')} - ${to.format('DD MMM YYYY')}`)
      : (viewMode === 'day' ? from.format('ddd, DD MMM YYYY') : `${from.format('DD MMM')} - ${to.format('DD MMM YYYY')}`);
    content.innerHTML = `
      <div class="section">
        <h3>Calendar / Bookings</h3>
        <div class="toolbar">
          <button id="prevRange" class="outline" type="button">Prev</button>
          <button id="todayRange" class="outline" type="button">Today</button>
          <button id="nextRange" class="outline" type="button">Next</button>
          <strong>${title}</strong>
          ${mobile ? `
            <label>View
              <select id="mobileViewMode">
                <option value="agenda" ${mobileMode === 'agenda' ? 'selected' : ''}>Agenda</option>
                <option value="day" ${mobileMode === 'day' ? 'selected' : ''}>Day</option>
              </select>
            </label>
          ` : `
            <label>View
              <select id="viewMode">
                <option value="day" ${viewMode === 'day' ? 'selected' : ''}>Day</option>
                <option value="week" ${viewMode === 'week' ? 'selected' : ''}>Week</option>
              </select>
            </label>
          `}
        </div>
        <div class="toolbar">
          ${fieldHtml({ name: 'filter_trainer', label: 'Trainer', type: 'select', options: [{ value: '', label: 'All' }, ...tOpts] })}
          ${fieldHtml({ name: 'filter_branch', label: 'Branch', type: 'select', options: [{ value: '', label: 'All' }, ...bOpts] })}
          ${fieldHtml({ name: 'filter_type', label: 'Training type', type: 'select', options: [{ value: '', label: 'All' }, ...ttOpts] })}
        </div>
        ${mobile ? (mobileMode === 'day' ? mobileDayHtml() : mobileAgendaHtml()) : calendarHtml()}
      </div>
      <div class="section">
        <h3>Booking Details</h3>
        <div id="bookingDetailsBox">${detailsHtml()}</div>
      </div>
      <div class="section">
        <h3>${editingBookingId ? 'Edit Booking' : 'Create Booking'}</h3>
        <form id="bookingForm" class="toolbar">
          ${fieldHtml({ name: 'client_id', label: 'Client', type: 'select', required: true, options: [{ value: '', label: 'Select' }, ...cOpts] })}
          ${fieldHtml({ name: 'training_type_id', label: 'Training Type', type: 'select', required: true, options: [{ value: '', label: 'Select' }, ...ttOpts] })}
          ${fieldHtml({ name: 'package_purchase_id', label: 'Client Package', type: 'select', required: true, options: [{ value: '', label: 'Select client first' }] })}
          ${fieldHtml({ name: 'trainer_id', label: 'Trainer', type: 'select', required: true, options: [{ value: '', label: 'Select' }, ...tOpts] })}
          ${fieldHtml({ name: 'branch_id', label: 'Branch', type: 'select', required: true, options: [{ value: '', label: 'Select' }, ...bOpts] })}
          ${fieldHtml({ name: 'start_at', label: 'Date and Time', type: 'datetime', required: true })}
          ${fieldHtml({ name: 'notes', label: 'Notes', type: 'text' })}
          <button id="saveBookingBtn" type="submit">${editingBookingId ? 'Update Booking' : 'Create Booking'}</button>
          <button id="cancelEditBooking" class="outline ${editingBookingId ? '' : 'hidden'}" type="button">Cancel Edit</button>
        </form>
      </div>
    `;

    const filterTrainerEl = content.querySelector('[name="filter_trainer"]');
    const filterBranchEl = content.querySelector('[name="filter_branch"]');
    const filterTypeEl = content.querySelector('[name="filter_type"]');
    filterTrainerEl.value = filterTrainer;
    filterBranchEl.value = filterBranch;
    filterTypeEl.value = filterType;
    filterTrainerEl.onchange = async () => { filterTrainer = filterTrainerEl.value; await loadRows(); render(); };
    filterBranchEl.onchange = async () => { filterBranch = filterBranchEl.value; await loadRows(); render(); };
    filterTypeEl.onchange = async () => { filterType = filterTypeEl.value; await loadRows(); render(); };

    const desktopMode = content.querySelector('#viewMode');
    if (desktopMode) desktopMode.onchange = async (e) => { viewMode = e.target.value; await loadRows(); render(); };
    const mobileModeSel = content.querySelector('#mobileViewMode');
    if (mobileModeSel) mobileModeSel.onchange = async (e) => { mobileMode = e.target.value; await loadRows(); render(); };
    content.querySelector('#todayRange').onclick = async () => { currentDate = dayjs().startOf('day'); await loadRows(); render(); };
    content.querySelector('#prevRange').onclick = async () => {
      const step = isMobileView() ? (mobileMode === 'day' ? 1 : 7) : (viewMode === 'day' ? 1 : 7);
      currentDate = currentDate.subtract(step, 'day');
      await loadRows();
      render();
    };
    content.querySelector('#nextRange').onclick = async () => {
      const step = isMobileView() ? (mobileMode === 'day' ? 1 : 7) : (viewMode === 'day' ? 1 : 7);
      currentDate = currentDate.add(step, 'day');
      await loadRows();
      render();
    };

    content.querySelectorAll('[data-booking-id]').forEach((btn) => btn.onclick = () => {
      selectedBookingId = Number(btn.dataset.bookingId);
      render();
    });

    content.querySelectorAll('[data-slot-day]').forEach((col) => col.onclick = (e) => {
      if (e.target.closest('[data-booking-id]')) return;
      const rect = col.getBoundingClientRect();
      const minuteOffset = Math.max(0, Math.min((endHour - startHour) * 60, Math.round((e.clientY - rect.top) / pxPerMin)));
      const minutes = Math.floor(minuteOffset / 15) * 15;
      const slotTime = dayjs(`${col.dataset.slotDay}T00:00:00`).add(startHour * 60 + minutes, 'minute');
      const startInput = content.querySelector('#bookingForm [name="start_at"]');
      if (startInput) startInput.value = toInputDateTime(slotTime);
      editingBookingId = null;
      content.querySelector('#saveBookingBtn').textContent = 'Create Booking';
      content.querySelector('#cancelEditBooking').classList.add('hidden');
    });
    content.querySelectorAll('[data-prefill-day]').forEach((btn) => btn.onclick = () => {
      const slotTime = dayjs(`${btn.dataset.prefillDay}T09:00:00`);
      const startInput = content.querySelector('#bookingForm [name="start_at"]');
      if (startInput) startInput.value = toInputDateTime(slotTime);
      editingBookingId = null;
      content.querySelector('#saveBookingBtn').textContent = 'Create Booking';
      content.querySelector('#cancelEditBooking').classList.add('hidden');
    });

    const b = selectedBooking();
    if (b) {
      const updateStatusBtn = content.querySelector('#updateBookingStatus');
      const statusSel = content.querySelector('#bookingStatusSelect');
      const editBtn = content.querySelector('#editBookingBtn');
      if (updateStatusBtn && statusSel) {
        updateStatusBtn.onclick = async () => {
          updateStatusBtn.disabled = true;
          try {
            await api(`/api/bookings/${b.id}`, { method: 'PUT', body: JSON.stringify({ status: statusSel.value }) });
            await loadRows();
            selectedBookingId = b.id;
            render();
            toast('Status updated');
          } catch (err) {
            toast(err.message);
            updateStatusBtn.disabled = false;
          }
        };
      }
      if (editBtn) {
        editBtn.onclick = async () => {
          editingBookingId = b.id;
          const form = content.querySelector('#bookingForm');
          form.querySelector('[name="client_id"]').value = `${b.client_id}`;
          form.querySelector('[name="training_type_id"]').value = `${b.training_type_id}`;
          form.querySelector('[name="trainer_id"]').value = `${b.trainer_id}`;
          form.querySelector('[name="branch_id"]').value = `${b.branch_id}`;
          form.querySelector('[name="start_at"]').value = toInputDateTime(b.start_at);
          form.querySelector('[name="notes"]').value = b.notes || '';
          await loadPurchases(form, b.package_purchase_id);
          content.querySelector('#saveBookingBtn').textContent = 'Update Booking';
          content.querySelector('#cancelEditBooking').classList.remove('hidden');
        };
      }
    }

    const form = content.querySelector('#bookingForm');
    const cSel = form.querySelector('[name="client_id"]');
    const tSel = form.querySelector('[name="training_type_id"]');
    const pSel = form.querySelector('[name="package_purchase_id"]');

    async function loadPurchases(targetForm, selectedId = null) {
      const clientId = targetForm.querySelector('[name="client_id"]').value;
      const typeId = targetForm.querySelector('[name="training_type_id"]').value;
      const purchaseSel = targetForm.querySelector('[name="package_purchase_id"]');
      if (!clientId || !typeId) {
        purchaseSel.innerHTML = '<option value="">Select client and type first</option>';
        return;
      }
      const items = await api(`/api/clients/${clientId}/active-purchases?training_type_id=${typeId}&date=${dayjs().format('YYYY-MM-DD')}`);
      purchaseSel.innerHTML = `<option value="">Select package</option>${items.map((x) => `<option ${Number(selectedId) === Number(x.id) ? 'selected' : ''} value="${x.id}">${x.package_name} (${x.sessions_remaining} sessions left)</option>`).join('')}`;
    }

    cSel.onchange = () => loadPurchases(form);
    tSel.onchange = () => loadPurchases(form);

    content.querySelector('#cancelEditBooking').onclick = () => {
      editingBookingId = null;
      form.reset();
      pSel.innerHTML = '<option value="">Select client and type first</option>';
      content.querySelector('#saveBookingBtn').textContent = 'Create Booking';
      content.querySelector('#cancelEditBooking').classList.add('hidden');
    };

    form.onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(form).entries());
      body.client_id = Number(body.client_id);
      body.training_type_id = Number(body.training_type_id);
      body.package_purchase_id = Number(body.package_purchase_id);
      body.trainer_id = Number(body.trainer_id);
      body.branch_id = Number(body.branch_id);
      body.start_at = dayjs(body.start_at).toISOString();
      try {
        if (editingBookingId) {
          await api(`/api/bookings/${editingBookingId}`, { method: 'PUT', body: JSON.stringify(body) });
          toast('Booking updated');
        } else {
          await api('/api/bookings', { method: 'POST', body: JSON.stringify(body) });
          toast('Booking created');
        }
        editingBookingId = null;
        form.reset();
        pSel.innerHTML = '<option value="">Select client and type first</option>';
        await loadRows();
        render();
      } catch (err) { toast(err.message); }
    };
  }

  await loadRows();
  render();
}

async function renderCurrent() {
  if (lookupConsumerTabs.has(appState.activeTab)) await ensureLookups(true);
  const lookups = appState.lookups || {
    clients: [],
    trainers: [],
    branches: [],
    trainingTypes: [],
    packages: [],
    paymentMethods: [],
    bookingStatuses: []
  };
  const common = {
    dashboard: renderDashboard,
    clients: () => renderCrud('clients', { endpoint: 'clients', title: 'Clients', itemLabel: 'Client', fields: [{ name: 'first_name', label: 'First name', required: true }, { name: 'last_name', label: 'Last name', required: true }, { name: 'phone', label: 'Phone', required: true }, { name: 'notes', label: 'Notes', type: 'textarea' }], row: { headers: { first_name: 'First', last_name: 'Last', phone: 'Phone' }, render: (_k, v) => esc(v) }, detailsButton: { label: 'Details', handler: showClientDetails } }),
    'training-types': () => renderCrud('training-types', { endpoint: 'training-types', title: 'Training Types', itemLabel: 'Training Type', fields: [{ name: 'name', label: 'Name', required: true }, { name: 'duration_minutes', label: 'Duration (min)', type: 'number', required: true }, { name: 'active', label: 'Status', type: 'checkbox' }], row: { headers: { name: 'Name', duration_minutes: 'Duration', active: 'Status' }, render: (k, v) => k === 'active' ? `<span class="status ${v ? '' : 'inactive'}">${v ? 'active' : 'inactive'}</span>` : esc(v) } }),
    packages: () => renderCrud('packages', { endpoint: 'packages', title: 'Packages', itemLabel: 'Package', fields: [{ name: 'name', label: 'Package name', required: true }, { name: 'training_type_id', label: 'Training type', type: 'select', required: true, options: [{ value: '', label: 'Select training type' }, ...lookups.trainingTypes.map((x) => ({ value: x.id, label: x.name }))] }, { name: 'sessions_count', label: 'Number of sessions', type: 'number', required: true, min: 1 }, { name: 'price', label: 'Price', type: 'number', required: true, min: 0 }, { name: 'description', label: 'Description', type: 'textarea' }, { name: 'active', label: 'Status', type: 'checkbox' }], row: { headers: { name: 'Name', training_type_id: 'Type', sessions_count: 'Sessions', price: 'Price', active: 'Status' }, render: (k, v) => k === 'training_type_id' ? esc(lookups.trainingTypes.find((t) => t.id === v)?.name || '-') : (k === 'price' ? fmtMoney(v) : (k === 'active' ? `<span class="status ${v ? '' : 'inactive'}">${v ? 'active' : 'inactive'}</span>` : esc(v))) } }),
    purchases: renderPurchases,
    trainers: () => renderCrud('trainers', { endpoint: 'trainers', title: 'Trainers', itemLabel: 'Trainer', fields: [{ name: 'first_name', label: 'First name', required: true }, { name: 'last_name', label: 'Last name', required: true }, { name: 'phone', label: 'Phone' }, { name: 'supported_training_type_ids', label: 'Supported types', type: 'multi-select', options: lookups.trainingTypes.map((x) => ({ value: x.id, label: x.name })) }, { name: 'branch_ids', label: 'Assigned branches', type: 'multi-select', options: lookups.branches.map((x) => ({ value: x.id, label: x.name })) }, { name: 'notes', label: 'Notes', type: 'textarea' }, { name: 'active', label: 'Status', type: 'checkbox' }], row: { headers: { first_name: 'First', last_name: 'Last', phone: 'Phone', active: 'Status' }, render: (k, v) => k === 'active' ? `<span class="status ${v ? '' : 'inactive'}">${v ? 'active' : 'inactive'}</span>` : esc(v) } }),
    branches: () => renderCrud('branches', { endpoint: 'branches', title: 'Locations / Branches', itemLabel: 'Location', fields: [{ name: 'name', label: 'Name', required: true }, { name: 'active', label: 'Status', type: 'checkbox' }], row: { headers: { name: 'Name', active: 'Status' }, render: (k, v) => k === 'active' ? `<span class="status ${v ? '' : 'inactive'}">${v ? 'active' : 'inactive'}</span>` : esc(v) } }),
    bookings: renderBookings,
    payments: () => renderCrud('payments', { endpoint: 'payments', title: 'Payments', itemLabel: 'Payment', fields: [{ name: 'client_id', label: 'Client', type: 'select', options: [{ value: '', label: 'None' }, ...lookups.clients.map((x) => ({ value: x.id, label: `${x.first_name} ${x.last_name}` }))] }, { name: 'package_purchase_id', label: 'Related purchase', type: 'select', options: [{ value: '', label: 'None' }] }, { name: 'amount_paid', label: 'Amount', type: 'number', required: true }, { name: 'payment_date', label: 'Payment date', type: 'datetime', required: true }, { name: 'payment_method', label: 'Method', type: 'select', required: true, options: lookups.paymentMethods.map((x) => ({ value: x, label: x })) }, { name: 'branch_id', label: 'Branch', type: 'select', options: [{ value: '', label: 'None' }, ...lookups.branches.map((x) => ({ value: x.id, label: x.name }))] }, { name: 'notes', label: 'Notes', type: 'textarea' }], row: { headers: { client_name: 'Client', amount_paid: 'Amount', payment_method: 'Method', payment_date: 'Date', branch_name: 'Branch' }, render: (k, v) => k === 'amount_paid' ? fmtMoney(v) : esc(v) } }),
    expenses: () => renderCrud('expenses', { endpoint: 'expenses', title: 'Expenses', itemLabel: 'Expense', fields: [{ name: 'title', label: 'Title', required: true }, { name: 'amount', label: 'Amount', type: 'number', required: true }, { name: 'date', label: 'Date', type: 'datetime', required: true }, { name: 'branch_id', label: 'Branch', type: 'select', options: [{ value: '', label: 'None' }, ...lookups.branches.map((x) => ({ value: x.id, label: x.name }))] }, { name: 'notes', label: 'Notes', type: 'textarea' }], row: { headers: { title: 'Title', amount: 'Amount', date: 'Date', branch_name: 'Branch' }, render: (k, v) => k === 'amount' ? fmtMoney(v) : esc(v) } }),
    users: () => renderCrud('users', { endpoint: 'users', title: 'Users', itemLabel: 'User', fields: [{ name: 'username', label: 'Username', required: true }, { name: 'password', label: 'Password', required: true, type: 'text' }, { name: 'role', label: 'Role', required: true, type: 'select', options: [{ value: 'super_admin', label: 'super_admin' }, { value: 'admin', label: 'admin' }, { value: 'receptionist', label: 'receptionist' }] }, { name: 'active', label: 'Status', type: 'checkbox' }], row: { headers: { username: 'Username', role: 'Role', active: 'Status' }, render: (k, v) => k === 'active' ? `<span class="status ${v ? '' : 'inactive'}">${v ? 'active' : 'inactive'}</span>` : esc(v) } })
  };
  const handler = common[appState.activeTab] || common.dashboard;
  await handler();
}

function saveToken(token) {
  appState.token = token;
  localStorage.setItem('token', token);
}

function clearSession() {
  localStorage.removeItem('token');
  appState.token = '';
  appState.currentUser = null;
  appState.lookups = null;
  appState.activeTab = 'dashboard';
}

async function renderAuthenticatedDashboard() {
  renderAppShell();
  appState.activeTab = 'dashboard';
  renderTabs();
  await renderDashboard();
}

async function handleLoginSuccess(token) {
  if (!token) throw new Error('Missing token from login response');
  saveToken(token);
  appState.currentUser = await api('/api/auth/me');
  appState.activeTab = 'dashboard';
  renderAppShell();
  await renderDashboard();
}

async function boot() {
  document.querySelector('#logoutBtn').onclick = () => {
    clearSession();
    renderLogin();
  };

  document.querySelector('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(e.target).entries());
    try {
      const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) });
      await handleLoginSuccess(data.token);
      toast('Logged in');
    } catch (err) {
      console.error('Login flow failed:', err);
      if (err.path === '/api/auth/me' && err.status === 401) {
        clearSession();
        renderLogin();
      }
      toast(err.message);
    }
  };

  if (!appState.token) {
    renderLogin();
    return;
  }

  try {
    await handleLoginSuccess(appState.token);
  } catch (err) {
    console.error('Boot auth failed:', err);
    if (err.path === '/api/auth/me' && err.status === 401) {
      clearSession();
      renderLogin();
      return;
    }
    content.innerHTML = '<div class="section"><h3>Unable to load app</h3><div class="empty">Please refresh and try again.</div></div>';
  }
}

boot();
