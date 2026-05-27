// ===========================================================================
// app.js — Wifix webapp (Fase 2). Maneja el flujo de la app: login, menú,
// pantallas de Datos Personales, Datos del Servicio, Red Interna,
// Herramientas y Equipos Retirados. Toda la entrada/salida pasa por
// WifixAPI (api.js): por defecto mock, alternable a backend real
// (WifixAPI.useRealApi = true).
// ===========================================================================

// === Referencias del DOM ====================================================
const loginScreen = document.getElementById('loginScreen');
const loginForm = document.getElementById('loginForm');
const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
const loginError = document.getElementById('loginError');
const loginSubmit = document.getElementById('loginSubmit');
const logoutBtn = document.getElementById('logoutBtn');

const cards = document.querySelectorAll('.category-card');
const subscreen = document.getElementById('subscreen');
const subHeading = document.getElementById('subHeading');
const subEyebrow = document.getElementById('subEyebrow');
const backBtn = document.getElementById('backBtn');
const subCards = document.querySelectorAll('.sub-card');

const detailPersonales = document.getElementById('detailPersonales');
const detailEyebrow = document.getElementById('detailEyebrow');
const accountChip = document.getElementById('accountChip');
const detailList = document.getElementById('detailList');
const backFromPersonales = document.getElementById('backFromPersonales');

const detailServicio = document.getElementById('detailServicio');
const servicioChip = document.getElementById('servicioChip');
const servicioList = document.getElementById('servicioList');
const backFromServicio = document.getElementById('backFromServicio');

const detailRed = document.getElementById('detailRed');
const redChip = document.getElementById('redChip');
const redList = document.getElementById('redList');
const backFromRed = document.getElementById('backFromRed');

const labels = {
  instalaciones: { eyebrow: 'Categoría', title: 'Instalaciones' },
  visitas:       { eyebrow: 'Categoría', title: 'Visitas Técnicas' },
};

let currentCategory = 'instalaciones';

// === Login y sesión =========================================================
function showLogin() {
  loginScreen.classList.add('open');
  loginScreen.setAttribute('aria-hidden', 'false');
  loginError.textContent = '';
  loginPassword.value = '';
}

function hideLogin() {
  loginScreen.classList.remove('open');
  loginScreen.setAttribute('aria-hidden', 'true');
}

if (WifixAPI.isAuthenticated()) {
  hideLogin();
} else {
  showLogin();
}

loginForm.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  loginError.textContent = '';
  loginSubmit.disabled = true;
  loginSubmit.textContent = 'Ingresando…';
  try {
    await WifixAPI.login(loginEmail.value.trim(), loginPassword.value);
    hideLogin();
    loginEmail.value = '';
    loginPassword.value = '';
  } catch (err) {
    console.error('[Wifix] login error:', err);
    loginError.textContent = err.message || 'No se pudo iniciar sesión.';
  } finally {
    loginSubmit.disabled = false;
    loginSubmit.textContent = 'Ingresar';
  }
});

logoutBtn.addEventListener('click', () => {
  WifixAPI.logout();
  // Cerrar todas las detail screens y el subscreen al cerrar sesión.
  document.querySelectorAll('.detailscreen, .subscreen').forEach((el) => {
    el.classList.remove('open');
    el.setAttribute('aria-hidden', 'true');
  });
  showLogin();
});

window.addEventListener('wifix:unauthorized', () => {
  console.warn('[Wifix] sesión expirada, volviendo a login.');
  document.querySelectorAll('.detailscreen, .subscreen').forEach((el) => {
    el.classList.remove('open');
    el.setAttribute('aria-hidden', 'true');
  });
  showLogin();
  loginError.textContent = 'Tu sesión expiró. Vuelve a ingresar.';
});

// === Categorías =============================================================
cards.forEach(card => {
  card.addEventListener('click', () => {
    const type = card.dataset.type;
    currentCategory = type;
    const meta = labels[type];
    if (meta) {
      subEyebrow.textContent = meta.eyebrow;
      subHeading.textContent = meta.title;
    }
    subscreen.classList.add('open');
    subscreen.setAttribute('aria-hidden', 'false');
  });
});

backBtn.addEventListener('click', () => {
  subscreen.classList.remove('open');
  subscreen.setAttribute('aria-hidden', 'true');
});

// === Account input ==========================================================
const accountInput = document.getElementById('accountInput');
const clearAccount = document.getElementById('clearAccount');
const inputWrap = accountInput.closest('.input-wrap');

accountInput.addEventListener('input', () => {
  inputWrap.classList.toggle('has-value', accountInput.value.length > 0);
});
clearAccount.addEventListener('click', () => {
  accountInput.value = '';
  inputWrap.classList.remove('has-value');
  accountInput.focus();
});

// === Sub categorías =========================================================
subCards.forEach(card => {
  card.addEventListener('click', () => {
    const sub = card.dataset.sub;
    if (sub === 'personales') openDatosPersonales();
    if (sub === 'servicio') openDatosServicio();
    if (sub === 'red') openRedInterna();
    if (sub === 'herramientas') openHerramientas();
    if (sub === 'retirados') openRetirados();
  });
});

backFromPersonales.addEventListener('click', () => {
  detailPersonales.classList.remove('open');
  detailPersonales.setAttribute('aria-hidden', 'true');
});
backFromServicio.addEventListener('click', () => {
  detailServicio.classList.remove('open');
  detailServicio.setAttribute('aria-hidden', 'true');
});
backFromRed.addEventListener('click', () => {
  detailRed.classList.remove('open');
  detailRed.setAttribute('aria-hidden', 'true');
});

// === Herramientas + Equipos Retirados (Fase 1, sin cambios) =================
const detailHerramientas = document.getElementById('detailHerramientas');
const herramientasChip = document.getElementById('herramientasChip');
const herramientasList = document.getElementById('herramientasList');
const backFromHerramientas = document.getElementById('backFromHerramientas');

const detailRetirados = document.getElementById('detailRetirados');
const retiradosChip = document.getElementById('retiradosChip');
const retiradosForm = document.getElementById('retiradosForm');
const backFromRetirados = document.getElementById('backFromRetirados');

backFromHerramientas.addEventListener('click', () => {
  detailHerramientas.classList.remove('open');
  detailHerramientas.setAttribute('aria-hidden', 'true');
});
backFromRetirados.addEventListener('click', () => {
  detailRetirados.classList.remove('open');
  detailRetirados.setAttribute('aria-hidden', 'true');
});

// === Helpers compartidos ====================================================
function currentAccount() {
  return (accountInput.value || '').trim();
}

function showSaveFeedback(button, message, success) {
  const original = button.textContent;
  button.textContent = message;
  button.classList.remove('ok', 'fail');
  button.classList.add(success ? 'ok' : 'fail');
  button.disabled = true;
  setTimeout(() => {
    button.textContent = original;
    button.classList.remove('ok', 'fail');
    button.disabled = false;
  }, 2200);
}

function num(value) {
  if (value === '' || value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function nonEmpty(value) {
  if (value === '' || value === null || value === undefined) return undefined;
  return String(value).trim() || undefined;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Mock data generation (sin cambios — usado donde la API no aplica)
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

function pad(n, len = 2) { return String(n).padStart(len, '0'); }
function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear().toString().slice(-2)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function formatDatePill(iso) {
  if (!iso) return '<span class="event-date-day">—</span>';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return `<span class="event-date-day">${escapeHtml(String(iso))}</span>`;
  const day = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear().toString().slice(-2)}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `<span class="event-date-day">${day}</span><span class="event-date-time">${time}</span>`;
}

// ============================================================================
// ICONOS
// ============================================================================
const SERVICIO_ICONS = {
  nap:   '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s7-7.5 7-13a7 7 0 1 0-14 0c0 5.5 7 13 7 13z"/><circle cx="12" cy="9" r="2"/></svg>',
  user:  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>',
  ports: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M19 10h.01M7 14h.01M11 14h.01M15 14h.01M19 14h.01"/></svg>',
  alert: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.7L2 18a2 2 0 0 0 1.7 3h16.6A2 2 0 0 0 22 18L13.7 3.7a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
  note:  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h4"/></svg>',
  history:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 8v5l3 2"/></svg>',
  metrics:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 14l3-3 4 4 5-6"/></svg>',
  wifi:  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12a10 10 0 0 1 14 0"/><path d="M8.5 15.5a5 5 0 0 1 7 0"/><circle cx="12" cy="19" r="1.2" fill="currentColor"/></svg>',
  lan:   '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="9" width="18" height="10" rx="2"/><path d="M7 9V5h10v4M9 13h.01M13 13h.01"/></svg>',
  key:   '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="3"/><path d="M10.5 13l8.5-8.5M16 7l3 3"/></svg>',
  chev:  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
};

const TOOL_ICONS = {
  distance: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h18"/><path d="M3 8l-2 4 2 4M21 8l2 4-2 4"/></svg>',
  speed:    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 18 0"/><path d="M12 12l4-3"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></svg>',
  heatmap:  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8a4 4 0 0 1 8 0"/><path d="M3 14a4 4 0 0 1 8 0"/><path d="M13 11a4 4 0 0 1 8 0"/><circle cx="6" cy="20" r="1.2" fill="currentColor"/></svg>',
  ping:     '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="10"/></svg>',
  trace:    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="6" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="18" r="2"/><path d="M7 6h3l2 4M14 12h3l2 4"/></svg>',
  chev:     SERVICIO_ICONS.chev,
};

const ICONS = {
  user: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>',
  pin:  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s7-7.5 7-13a7 7 0 1 0-14 0c0 5.5 7 13 7 13z"/><circle cx="12" cy="9" r="2.5"/></svg>',
  phone:'<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L7.9 9.7a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2z"/></svg>',
  plan: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7H4a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1z"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>',
  speed:'<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 18 0"/><path d="M12 12l4-3"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></svg>',
  edit: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>',
};

// ============================================================================
// Datos Personales (campos 1-5 + PUT) — usa WifixAPI.getClientProfile
// ============================================================================
function renderDetailRow(icon, label, value, opts = {}) {
  const cls = opts.mono ? 'detail-value mono' : 'detail-value';
  const hl  = opts.highlight ? ' highlight' : '';
  return `
    <div class="detail-row">
      <div class="detail-icon">${icon}</div>
      <div class="detail-body">
        <span class="detail-label">${label}</span>
        <span class="${cls}${hl}">${value}</span>
      </div>
    </div>`;
}

async function openDatosPersonales() {
  const cuenta = currentAccount();
  if (!cuenta) {
    alert('Ingresa primero el número de cuenta.');
    return;
  }
  accountChip.textContent = cuenta;
  detailEyebrow.textContent = labels[currentCategory].title;

  detailList.innerHTML = `<div class="detail-loading">Cargando datos del cliente…</div>`;
  detailPersonales.classList.add('open');
  detailPersonales.setAttribute('aria-hidden', 'false');

  let profile;
  try {
    profile = await WifixAPI.getClientProfile(cuenta);
  } catch (err) {
    console.error('[Wifix] client-profile:', err);
    detailList.innerHTML = `<div class="detail-error">No se pudo cargar el perfil: ${escapeHtml(err.message || 'Error')}</div>`;
    return;
  }

  renderClientProfile(profile, cuenta);
}

function renderClientProfile(profile, cuenta) {
  const phonesHtml = (profile.phones && profile.phones.length)
    ? profile.phones.map(escapeHtml).join('<br/>')
    : '—';
  const speedTxt = `${profile.contractedDownloadMbps ?? '—'} ↓ / ${profile.contractedUploadMbps ?? '—'} ↑ Mbps`;

  detailList.innerHTML = [
    renderDetailRow(ICONS.user,  'Nombres y Apellidos', escapeHtml(profile.fullName || '—')),
    renderDetailRow(ICONS.pin,   'Dirección', escapeHtml(profile.address || '—')),
    renderDetailRow(ICONS.phone, 'Teléfonos', phonesHtml),
    renderDetailRow(ICONS.plan,  'Plan Contratado', escapeHtml(profile.planName || '—'), { highlight: true }),
    renderDetailRow(ICONS.speed, 'Velocidad Contratada', speedTxt, { highlight: true }),
    `<button class="save-btn outline" id="editProfileBtn">${ICONS.edit}<span style="margin-left:6px">Actualizar datos</span></button>`,
    `<div id="editProfileForm" class="profile-edit-form" hidden></div>`,
  ].join('');

  const editBtn = document.getElementById('editProfileBtn');
  const editFormSlot = document.getElementById('editProfileForm');
  editBtn.addEventListener('click', () => {
    if (editFormSlot.hasAttribute('hidden')) {
      editFormSlot.removeAttribute('hidden');
      renderEditProfileForm(profile, cuenta, editFormSlot);
    } else {
      editFormSlot.setAttribute('hidden', '');
      editFormSlot.innerHTML = '';
    }
  });
}

function renderEditProfileForm(profile, cuenta, slot) {
  slot.innerHTML = `
    <div class="tool-form" data-form="profile-edit">
      <label class="form-row"><span class="form-label">Nombres y Apellidos</span>
        <input type="text" data-field="fullName" value="${escapeHtml(profile.fullName || '')}"></label>
      <label class="form-row"><span class="form-label">Dirección</span>
        <textarea data-field="address" rows="2">${escapeHtml(profile.address || '')}</textarea></label>
      <label class="form-row"><span class="form-label">Teléfonos (uno por línea)</span>
        <textarea data-field="phones" rows="3">${escapeHtml((profile.phones || []).join('\n'))}</textarea></label>
      <button class="save-btn" data-action="save-profile">Guardar cambios</button>
    </div>`;

  const formEl = slot.querySelector('[data-form="profile-edit"]');
  const saveBtn = formEl.querySelector('[data-action="save-profile"]');
  saveBtn.addEventListener('click', async () => {
    const fullName = nonEmpty(formEl.querySelector('[data-field="fullName"]').value);
    const address = nonEmpty(formEl.querySelector('[data-field="address"]').value);
    const phonesRaw = formEl.querySelector('[data-field="phones"]').value || '';
    const phones = phonesRaw.split('\n').map(s => s.trim()).filter(Boolean);
    const update = {};
    if (fullName !== undefined && fullName !== profile.fullName) update.fullName = fullName;
    if (address !== undefined && address !== profile.address) update.address = address;
    if (JSON.stringify(phones) !== JSON.stringify(profile.phones || [])) update.phones = phones;

    if (Object.keys(update).length === 0) {
      showSaveFeedback(saveBtn, 'Sin cambios', false);
      return;
    }
    try {
      const updated = await WifixAPI.updateClientProfile(cuenta, update);
      showSaveFeedback(saveBtn, '✓ Actualizado', true);
      renderClientProfile(updated, cuenta);
    } catch (err) {
      console.error('[Wifix] update client-profile:', err);
      showSaveFeedback(saveBtn, '✗ ' + (err.message || 'Error'), false);
    }
  });
}

// ============================================================================
// Datos del Servicio (campos 6-18) — usa varios endpoints
// ============================================================================
function renderStatusFromContract(contract, account) {
  const own = contract.accounts.find(a => a.accountNumber === account) || contract.accounts[0];
  const status = own ? own.status : '—';
  const statusClass = status === 'ACTIVA' ? 'ok' : status === 'SUSPENDIDA' ? 'warn' : 'fail';
  return `
    <div class="status-grid">
      <div class="status-tile ${statusClass}">
        <span class="st-label">Estado</span>
        <span class="st-value">${escapeHtml(status)}</span>
      </div>
      <div class="status-tile">
        <span class="st-label">Cliente</span>
        <span class="st-value">${escapeHtml(contract.clientName || '—')}</span>
      </div>
    </div>
    ${contract.accounts.map(a => `
      <div class="mini-row">
        <span class="mr-label">${escapeHtml(a.accountNumber)}</span>
        <span class="mr-value">${escapeHtml(a.contractId)} · ${escapeHtml(a.status)}</span>
      </div>`).join('')}`;
}

function renderNapsList(naps) {
  if (!naps || naps.length === 0) return `<div class="detail-empty">No hay NAPs cercanas.</div>`;
  return naps.map(n => `
    <div class="nap-card" data-nap="${escapeHtml(n.napCode)}">
      <div class="nap-head">
        <span class="nap-name">${escapeHtml(n.napCode)}</span>
        <span class="nap-distance">${n.distanceMeters.toFixed(1)} m · ${n.occupiedPorts}/${n.totalPorts} puertos</span>
      </div>
      <button class="add-row-btn" data-action="view-ports" data-nap="${escapeHtml(n.napCode)}">Ver puertos</button>
      <div class="nap-ports-slot" data-slot="ports-${escapeHtml(n.napCode)}"></div>
    </div>`).join('');
}

function renderPortsTable(napPorts) {
  return `
    <div class="port-grid">
      ${napPorts.ports.map(p => `
        <div class="port-cell ${p.occupied ? 'busy' : 'free'}" title="${p.clientAccountNumber ? escapeHtml(p.clientAccountNumber) + ' (' + (p.clientStatus || '—') + ')' : 'Libre'}">
          ${pad(p.portNumber)}${p.clientStatus ? '<small>' + p.clientStatus + '</small>' : ''}
        </div>`).join('')}
    </div>
    <div class="port-legend">
      <span><span class="dot free"></span>Libre</span>
      <span><span class="dot busy"></span>Ocupado</span>
    </div>`;
}

function renderMetrics(m) {
  const tech = m.technology;
  const rxTx = m.signalLevels
    ? `<div class="mini-row"><span class="mr-label">RX / TX</span><span class="mr-value">${m.signalLevels.rxDbm} dBm / ${m.signalLevels.txDbm} dBm</span></div>`
    : '';
  const snr = m.signalToNoiseDb !== undefined
    ? `<div class="mini-row"><span class="mr-label">SNR (HFC)</span><span class="mr-value">${m.signalToNoiseDb} dB</span></div>` : '';
  const fec = m.fecCorrectedPercent !== undefined
    ? `<div class="mini-row"><span class="mr-label">FEC corregidos</span><span class="mr-value">${m.fecCorrectedPercent}%</span></div>
       <div class="mini-row"><span class="mr-label">FEC sin corregir</span><span class="mr-value">${m.fecUncorrectedPercent}%</span></div>` : '';
  return `
    <div class="mini-row"><span class="mr-label">Tecnología</span><span class="mr-value">${escapeHtml(tech)}</span></div>
    ${rxTx}
    ${snr}
    ${fec}
    <div class="mini-row"><span class="mr-label">Caídas 24h</span><span class="mr-value">${m.outagesLast24h}</span></div>
    <div class="mini-row"><span class="mr-label">Tráfico in / out</span><span class="mr-value">${m.trafficMbpsIn} / ${m.trafficMbpsOut} Mbps</span></div>`;
}

function renderEventsList(events) {
  if (!events || events.length === 0) return `<div class="detail-empty">Sin eventos registrados.</div>`;
  const badgeClass = s => s === 'RESUELTO' ? 'badge-resolved' : s === 'PENDIENTE' ? 'badge-pending' : 'badge-fail';
  return events.map(e => `
    <div class="event-item">
      <span class="event-date">${formatDatePill(e.occurredAt)}</span>
      <div class="event-body">
        <span class="event-badge ${badgeClass(e.status)}">${escapeHtml(e.status)}</span>
        <span class="event-title">${escapeHtml(e.type)}</span>
        <span class="event-desc">${escapeHtml(e.description || '')}</span>
      </div>
    </div>`).join('');
}

function renderTasksList(tasks) {
  if (!tasks || tasks.length === 0) return `<div class="detail-empty">Sin tareas registradas.</div>`;
  const badgeClass = r => r === 'SATISFACTORIA' ? 'badge-resolved' : r === 'PENDIENTE' ? 'badge-pending' : 'badge-fail';
  return tasks.map(t => `
    <div class="event-item">
      <span class="event-date">${formatDatePill(t.occurredAt)}</span>
      <div class="event-body">
        <span class="event-badge ${badgeClass(t.result)}">${escapeHtml(t.result)}</span>
        <span class="event-title">${escapeHtml(t.taskId)} · ${escapeHtml(t.technician || '—')}</span>
        <span class="event-desc"><strong>${escapeHtml(t.reason)}</strong> — ${escapeHtml(t.closingNotes || '')}</span>
      </div>
    </div>`).join('');
}

function renderHistorySummary(history) {
  const lines = [
    ['Distance', history.distanceMeasurements.length],
    ['Speedtest', history.speedtests.length],
    ['Heatmap', history.wifiHeatmaps.length],
    ['Ping', history.pingTests.length],
    ['Traceroute', history.tracerouteTests.length],
    ['Equipos retirados', history.retiredEquipment.length],
  ];
  return lines.map(([label, n]) => `
    <div class="mini-row"><span class="mr-label">${label}</span><span class="mr-value">${n}</span></div>`).join('');
}

const SERVICIO_ITEMS = [
  { id: 'naps',    icon: SERVICIO_ICONS.nap,     title: 'NAPs cercanas (distancia y puertos)',
    load: (cuenta) => WifixAPI.getNearbyNaps(cuenta).then(renderNapsList) },
  { id: 'status',  icon: SERVICIO_ICONS.user,    title: 'Status del cliente por contrato/cuenta',
    load: (cuenta) => WifixAPI.getContractStatus(cuenta).then(c => renderStatusFromContract(c, cuenta)) },
  { id: 'metrics', icon: SERVICIO_ICONS.metrics, title: 'Métricas de red (RX/TX, SNR, tráfico)',
    load: (cuenta) => WifixAPI.getNetworkMetrics(cuenta).then(renderMetrics) },
  { id: 'events',  icon: SERVICIO_ICONS.alert,   title: 'Daños (eventos) en el nodo',
    load: (cuenta) => WifixAPI.getNodeEvents(cuenta).then(renderEventsList) },
  { id: 'unsat',   icon: SERVICIO_ICONS.note,    title: 'Tareas insatisfactorias (cierre)',
    load: (cuenta) => WifixAPI.getUnsatisfactoryTasks(cuenta).then(renderTasksList) },
  { id: 'visits',  icon: SERVICIO_ICONS.history, title: 'Visitas anteriores',
    load: (cuenta) => WifixAPI.getPreviousVisits(cuenta).then(renderTasksList) },
  { id: 'history', icon: SERVICIO_ICONS.history, title: 'Historial de la app (registros guardados)',
    load: (cuenta) => WifixAPI.getAccountToolHistory(cuenta).then(renderHistorySummary) },
];

function openDatosServicio() {
  const cuenta = currentAccount();
  if (!cuenta) {
    alert('Ingresa primero el número de cuenta.');
    return;
  }
  servicioChip.textContent = cuenta;

  servicioList.innerHTML = SERVICIO_ITEMS.map(item => `
    <div class="servicio-item" data-id="${item.id}">
      <button class="servicio-head" type="button">
        <div class="servicio-icon">${item.icon}</div>
        <div class="servicio-title">${escapeHtml(item.title)}</div>
        <div class="servicio-chev">${SERVICIO_ICONS.chev}</div>
      </button>
      <div class="servicio-body">
        <div class="servicio-body-inner" data-slot="body"><div class="detail-loading">Toca para cargar…</div></div>
      </div>
    </div>`).join('');

  servicioList.querySelectorAll('.servicio-item').forEach(node => {
    const id = node.dataset.id;
    const item = SERVICIO_ITEMS.find(x => x.id === id);
    const head = node.querySelector('.servicio-head');
    const body = node.querySelector('[data-slot="body"]');

    head.addEventListener('click', async () => {
      const wasOpen = node.classList.contains('open');
      node.classList.toggle('open');
      if (!wasOpen && !body.dataset.loaded) {
        body.innerHTML = `<div class="detail-loading">Cargando…</div>`;
        try {
          body.innerHTML = await item.load(cuenta);
          body.dataset.loaded = '1';
          wireNapPortsButtons(body);
        } catch (err) {
          console.error('[Wifix] servicio', id, err);
          body.innerHTML = `<div class="detail-error">${escapeHtml(err.message || 'Error al cargar')}</div>`;
        }
      }
    });
  });

  detailServicio.classList.add('open');
  detailServicio.setAttribute('aria-hidden', 'false');
}

function wireNapPortsButtons(scope) {
  scope.querySelectorAll('[data-action="view-ports"]').forEach((btn) => {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const napCode = btn.dataset.nap;
      const slot = scope.querySelector(`[data-slot="ports-${CSS.escape(napCode)}"]`);
      if (!slot) return;
      if (slot.dataset.loaded === '1') {
        slot.classList.toggle('hidden');
        return;
      }
      slot.innerHTML = `<div class="detail-loading">Cargando puertos…</div>`;
      try {
        const data = await WifixAPI.getNapPorts(napCode);
        slot.innerHTML = renderPortsTable(data);
        slot.dataset.loaded = '1';
      } catch (err) {
        slot.innerHTML = `<div class="detail-error">${escapeHtml(err.message || 'Error')}</div>`;
      }
    });
  });
}

// ============================================================================
// Red Interna (campos 19-21) — LAN, WiFi devices y cambio de SSID/contraseña
// ============================================================================
function renderLanDevices(devices) {
  if (!devices || devices.length === 0) return `<div class="detail-empty">No hay dispositivos en la red local.</div>`;
  return devices.map(d => `
    <div class="mini-row">
      <span class="mr-label">${escapeHtml(d.hostname || '—')}</span>
      <span class="mr-value mono">${escapeHtml(d.ipAddress)} · ${escapeHtml(d.macAddress)}</span>
    </div>`).join('');
}

function renderWifiDevices(devices) {
  if (!devices || devices.length === 0) return `<div class="detail-empty">No hay dispositivos WiFi conectados.</div>`;
  const byBand = { '2.4GHz': [], '5GHz': [] };
  devices.forEach(d => { if (byBand[d.band]) byBand[d.band].push(d); });
  return Object.keys(byBand).map(band => `
    <div class="band-section">
      <h4 class="band-title">${band}</h4>
      ${byBand[band].length === 0 ? '<div class="detail-empty">Sin dispositivos.</div>' :
        byBand[band].map(d => `
          <div class="mini-row">
            <span class="mr-label">${escapeHtml(d.hostname || '—')}</span>
            <span class="mr-value mono">${escapeHtml(d.macAddress)} · ${d.signalDbm} dBm</span>
          </div>`).join('')}
    </div>`).join('');
}

function renderWifiConfigForm(config, cuenta) {
  const get = (band) => (config.bands.find(b => b.band === band) || { ssid: '' });
  const b24 = get('2.4GHz');
  const b5 = get('5GHz');
  return `
    <div class="tool-form" data-form="wifi-config">
      <div class="band-section">
        <h4 class="band-title">2.4GHz</h4>
        <label class="form-row"><span class="form-label">SSID</span>
          <input type="text" data-band="2.4GHz" data-field="ssid" value="${escapeHtml(b24.ssid)}" maxlength="32"></label>
        <label class="form-row"><span class="form-label">Nueva contraseña (opcional, ≥ 8)</span>
          <input type="password" data-band="2.4GHz" data-field="password" placeholder="••••••••" minlength="8" maxlength="63"></label>
      </div>
      <div class="band-section">
        <h4 class="band-title">5GHz</h4>
        <label class="form-row"><span class="form-label">SSID</span>
          <input type="text" data-band="5GHz" data-field="ssid" value="${escapeHtml(b5.ssid)}" maxlength="32"></label>
        <label class="form-row"><span class="form-label">Nueva contraseña (opcional, ≥ 8)</span>
          <input type="password" data-band="5GHz" data-field="password" placeholder="••••••••" minlength="8" maxlength="63"></label>
      </div>
      <button class="save-btn" data-action="save-wifi">Aplicar cambios WiFi</button>
    </div>`;
}

function readWifiBand(formEl, band) {
  const ssid = nonEmpty(formEl.querySelector(`[data-band="${band}"][data-field="ssid"]`).value);
  const password = nonEmpty(formEl.querySelector(`[data-band="${band}"][data-field="password"]`).value);
  if (!ssid) return null;
  const out = { band, ssid };
  if (password) out.password = password;
  return out;
}

const RED_ITEMS = [
  { id: 'lan',  icon: SERVICIO_ICONS.lan,  title: 'Equipos en la red local (DHCP)',
    load: (cuenta) => WifixAPI.getLanDevices(cuenta).then(renderLanDevices) },
  { id: 'wifi', icon: SERVICIO_ICONS.wifi, title: 'Dispositivos WiFi por banda',
    load: (cuenta) => WifixAPI.getWifiDevices(cuenta).then(renderWifiDevices) },
  { id: 'config', icon: SERVICIO_ICONS.key, title: 'Cambiar SSID y contraseña',
    load: async (cuenta) => {
      const cfg = await WifixAPI.getWifiConfig(cuenta);
      return renderWifiConfigForm(cfg, cuenta);
    },
    onMount: (body, cuenta) => {
      const formEl = body.querySelector('[data-form="wifi-config"]');
      if (!formEl) return;
      const saveBtn = formEl.querySelector('[data-action="save-wifi"]');
      saveBtn.addEventListener('click', async () => {
        const b24 = readWifiBand(formEl, '2.4GHz');
        const b5 = readWifiBand(formEl, '5GHz');
        const bands = [b24, b5].filter(Boolean);
        if (bands.length === 0) {
          showSaveFeedback(saveBtn, 'Indica al menos un SSID', false);
          return;
        }
        try {
          const updated = await WifixAPI.updateWifiConfig(cuenta, { bands });
          console.log('[Wifix] wifi-config actualizado:', updated);
          showSaveFeedback(saveBtn, '✓ Aplicado', true);
        } catch (err) {
          console.error('[Wifix] wifi-config:', err);
          showSaveFeedback(saveBtn, '✗ ' + (err.message || 'Error'), false);
        }
      });
    },
  },
];

function openRedInterna() {
  const cuenta = currentAccount();
  if (!cuenta) {
    alert('Ingresa primero el número de cuenta.');
    return;
  }
  redChip.textContent = cuenta;

  redList.innerHTML = RED_ITEMS.map(item => `
    <div class="servicio-item" data-id="${item.id}">
      <button class="servicio-head" type="button">
        <div class="servicio-icon">${item.icon}</div>
        <div class="servicio-title">${escapeHtml(item.title)}</div>
        <div class="servicio-chev">${SERVICIO_ICONS.chev}</div>
      </button>
      <div class="servicio-body">
        <div class="servicio-body-inner" data-slot="body"><div class="detail-loading">Toca para cargar…</div></div>
      </div>
    </div>`).join('');

  redList.querySelectorAll('.servicio-item').forEach(node => {
    const id = node.dataset.id;
    const item = RED_ITEMS.find(x => x.id === id);
    const head = node.querySelector('.servicio-head');
    const body = node.querySelector('[data-slot="body"]');

    head.addEventListener('click', async () => {
      const wasOpen = node.classList.contains('open');
      node.classList.toggle('open');
      if (!wasOpen && !body.dataset.loaded) {
        body.innerHTML = `<div class="detail-loading">Cargando…</div>`;
        try {
          body.innerHTML = await item.load(cuenta);
          body.dataset.loaded = '1';
          if (item.onMount) item.onMount(body, cuenta);
        } catch (err) {
          console.error('[Wifix] red-interna', id, err);
          body.innerHTML = `<div class="detail-error">${escapeHtml(err.message || 'Error al cargar')}</div>`;
        }
      }
    });
  });

  detailRed.classList.add('open');
  detailRed.setAttribute('aria-hidden', 'false');
}

// ============================================================================
// Herramientas (Fase 1, sin cambios funcionales)
// ============================================================================
function distanceFormHtml() {
  return `
    <div class="tool-form" data-tool="distance">
      <label class="form-row"><span class="form-label">Distancia (metros) *</span>
        <input type="number" step="0.01" min="0" data-field="distanceMeters" placeholder="142.7"></label>
      <div class="form-grid-2">
        <label class="form-row"><span class="form-label">Latitud inicio</span>
          <input type="number" step="any" data-field="startLat" placeholder="-0.180653"></label>
        <label class="form-row"><span class="form-label">Longitud inicio</span>
          <input type="number" step="any" data-field="startLng" placeholder="-78.467834"></label>
      </div>
      <div class="form-grid-2">
        <label class="form-row"><span class="form-label">Latitud fin</span>
          <input type="number" step="any" data-field="endLat" placeholder="-0.180700"></label>
        <label class="form-row"><span class="form-label">Longitud fin</span>
          <input type="number" step="any" data-field="endLng" placeholder="-78.468000"></label>
      </div>
      <label class="form-row"><span class="form-label">Notas</span>
        <textarea data-field="notes" rows="2" placeholder="Casa al poste"></textarea></label>
      <button class="save-btn" data-action="save">Guardar medición</button>
    </div>`;
}

function speedtestFormHtml() {
  return `
    <div class="tool-form" data-tool="speedtest">
      <div class="form-grid-2">
        <label class="form-row"><span class="form-label">Descarga (Mbps) *</span>
          <input type="number" step="0.1" min="0" data-field="downloadMbps" placeholder="185.4"></label>
        <label class="form-row"><span class="form-label">Subida (Mbps) *</span>
          <input type="number" step="0.1" min="0" data-field="uploadMbps" placeholder="92.1"></label>
      </div>
      <div class="form-grid-2">
        <label class="form-row"><span class="form-label">Latencia (ms)</span>
          <input type="number" step="0.1" data-field="latencyMs" placeholder="11.3"></label>
        <label class="form-row"><span class="form-label">Jitter (ms)</span>
          <input type="number" step="0.1" data-field="jitterMs" placeholder="1.8"></label>
      </div>
      <label class="form-row"><span class="form-label">Pérdida de paquetes (%)</span>
        <input type="number" step="0.1" min="0" max="100" data-field="packetLossPercent" placeholder="0"></label>
      <label class="form-row"><span class="form-label">Servidor / ISP</span>
        <input type="text" data-field="serverName" placeholder="Servidor Quito"></label>
      <label class="form-row"><span class="form-label">Notas</span>
        <textarea data-field="notes" rows="2"></textarea></label>
      <button class="save-btn" data-action="save">Guardar speedtest</button>
    </div>`;
}

function heatmapFormHtml() {
  return `
    <div class="tool-form" data-tool="heatmap">
      <label class="form-row"><span class="form-label">Etiqueta del relevamiento</span>
        <input type="text" data-field="label" placeholder="Piso 1"></label>
      <div class="rooms-list" data-slot="rooms"></div>
      <button class="add-row-btn" data-action="add-room">+ Agregar habitación</button>
      <label class="form-row"><span class="form-label">Notas generales</span>
        <textarea data-field="notes" rows="2"></textarea></label>
      <button class="save-btn" data-action="save">Guardar medición</button>
    </div>`;
}

function roomRowHtml(index) {
  return `
    <div class="room-row" data-room-index="${index}">
      <div class="room-row-head">
        <span class="form-label">Habitación ${index + 1}</span>
        <button class="row-remove" data-action="remove-room">×</button>
      </div>
      <div class="form-grid-2">
        <label class="form-row"><span class="form-label">Nombre *</span>
          <input type="text" data-field="roomName" placeholder="Dormitorio"></label>
        <label class="form-row"><span class="form-label">Piso</span>
          <input type="number" step="1" min="1" value="1" data-field="floor"></label>
      </div>
      <label class="form-row"><span class="form-label">signalDbm * (-120 a 0)</span>
        <input type="number" step="1" min="-120" max="0" data-field="signalDbm" placeholder="-58"></label>
    </div>`;
}

function pingFormHtml() {
  return `
    <div class="tool-form" data-tool="ping">
      <label class="form-row"><span class="form-label">Target (IP o URL) *</span>
        <input type="text" data-field="target" placeholder="8.8.8.8"></label>
      <div class="form-grid-2">
        <label class="form-row"><span class="form-label">Paquetes enviados</span>
          <input type="number" step="1" min="0" data-field="packetsSent" placeholder="10"></label>
        <label class="form-row"><span class="form-label">Paquetes recibidos</span>
          <input type="number" step="1" min="0" data-field="packetsReceived" placeholder="10"></label>
      </div>
      <div class="form-grid-2">
        <label class="form-row"><span class="form-label">Latencia mín (ms)</span>
          <input type="number" step="0.1" data-field="minLatencyMs"></label>
        <label class="form-row"><span class="form-label">Latencia prom (ms)</span>
          <input type="number" step="0.1" data-field="avgLatencyMs"></label>
      </div>
      <label class="form-row"><span class="form-label">Latencia máx (ms)</span>
        <input type="number" step="0.1" data-field="maxLatencyMs"></label>
      <label class="form-row"><span class="form-label">Habitación (si asocias a una medición)</span>
        <input type="text" data-field="roomName" placeholder="Sala"></label>
      <button class="save-btn" data-action="save">Guardar ping</button>
    </div>`;
}

function tracerouteFormHtml() {
  return `
    <div class="tool-form" data-tool="traceroute">
      <label class="form-row"><span class="form-label">Target *</span>
        <input type="text" data-field="target" placeholder="www.example.com"></label>
      <div class="hops-list" data-slot="hops"></div>
      <button class="add-row-btn" data-action="add-hop">+ Agregar salto</button>
      <label class="form-row"><span class="form-label">Notas</span>
        <textarea data-field="notes" rows="2"></textarea></label>
      <button class="save-btn" data-action="save">Guardar traceroute</button>
    </div>`;
}

function hopRowHtml(index) {
  return `
    <div class="hop-row" data-hop-index="${index}">
      <div class="hop-row-head">
        <span class="form-label">Salto ${index + 1}</span>
        <button class="row-remove" data-action="remove-hop">×</button>
      </div>
      <div class="form-grid-3">
        <label class="form-row"><span class="form-label">#</span>
          <input type="number" step="1" min="1" value="${index + 1}" data-field="hopNumber"></label>
        <label class="form-row"><span class="form-label">Host / IP</span>
          <input type="text" data-field="host" placeholder="10.0.0.1"></label>
        <label class="form-row"><span class="form-label">Latencia (ms)</span>
          <input type="number" step="0.1" data-field="latencyMs"></label>
      </div>
    </div>`;
}

function collectFields(formEl) {
  const out = {};
  formEl.querySelectorAll(':scope > .form-row [data-field], :scope > .form-grid-2 [data-field], :scope > .form-grid-3 [data-field]').forEach(el => {
    out[el.dataset.field] = el.value;
  });
  return out;
}
function collectRows(listEl, perRow) {
  return Array.from(listEl.children).map(perRow);
}

function collectDistance(formEl) {
  const f = collectFields(formEl);
  const payload = { distanceMeters: num(f.distanceMeters) };
  if (num(f.startLat) !== undefined && num(f.startLng) !== undefined) {
    payload.startPoint = { latitude: num(f.startLat), longitude: num(f.startLng) };
  }
  if (num(f.endLat) !== undefined && num(f.endLng) !== undefined) {
    payload.endPoint = { latitude: num(f.endLat), longitude: num(f.endLng) };
  }
  if (nonEmpty(f.notes)) payload.notes = nonEmpty(f.notes);
  return payload;
}
function collectSpeedtest(formEl) {
  const f = collectFields(formEl);
  const payload = { downloadMbps: num(f.downloadMbps), uploadMbps: num(f.uploadMbps) };
  ['latencyMs', 'jitterMs', 'packetLossPercent'].forEach(k => {
    if (num(f[k]) !== undefined) payload[k] = num(f[k]);
  });
  if (nonEmpty(f.serverName)) payload.serverName = nonEmpty(f.serverName);
  if (nonEmpty(f.notes)) payload.notes = nonEmpty(f.notes);
  return payload;
}
function collectHeatmap(formEl) {
  const f = collectFields(formEl);
  const roomsEl = formEl.querySelector('[data-slot="rooms"]');
  const rooms = collectRows(roomsEl, (row) => {
    const get = (k) => row.querySelector(`[data-field="${k}"]`).value;
    return {
      roomName: nonEmpty(get('roomName')),
      floor: num(get('floor')) || 1,
      signalDbm: num(get('signalDbm')),
      measuredAt: new Date().toISOString(),
    };
  });
  const payload = { rooms };
  if (nonEmpty(f.label)) payload.label = nonEmpty(f.label);
  if (nonEmpty(f.notes)) payload.notes = nonEmpty(f.notes);
  return payload;
}
function collectPing(formEl) {
  const f = collectFields(formEl);
  const payload = { target: nonEmpty(f.target) };
  ['packetsSent','packetsReceived','minLatencyMs','avgLatencyMs','maxLatencyMs'].forEach(k => {
    if (num(f[k]) !== undefined) payload[k] = num(f[k]);
  });
  if (nonEmpty(f.roomName)) payload.roomName = nonEmpty(f.roomName);
  return payload;
}
function collectTraceroute(formEl) {
  const f = collectFields(formEl);
  const hopsEl = formEl.querySelector('[data-slot="hops"]');
  const hops = collectRows(hopsEl, (row) => {
    const get = (k) => row.querySelector(`[data-field="${k}"]`).value;
    return {
      hopNumber: num(get('hopNumber')),
      host: nonEmpty(get('host')) || null,
      latencyMs: num(get('latencyMs')),
    };
  });
  const payload = { target: nonEmpty(f.target), hops };
  if (nonEmpty(f.notes)) payload.notes = nonEmpty(f.notes);
  return payload;
}

const HERRAMIENTAS_ITEMS = [
  { id: 'speedtest', title: 'Test de Velocidad', icon: TOOL_ICONS.speed,
    render: speedtestFormHtml, collect: collectSpeedtest,
    save: (acct, payload) => WifixAPI.createSpeedtest(acct, payload) },
  { id: 'heatmap', title: 'Medición de Señal WiFi', icon: TOOL_ICONS.heatmap,
    render: heatmapFormHtml, collect: collectHeatmap,
    save: (acct, payload) => WifixAPI.createWifiHeatmap(acct, payload) },
  { id: 'ping', title: 'Ping', icon: TOOL_ICONS.ping,
    render: pingFormHtml, collect: collectPing,
    save: (acct, payload) => WifixAPI.createPingTest(acct, payload) },
  { id: 'traceroute', title: 'Traceroute', icon: TOOL_ICONS.trace,
    render: tracerouteFormHtml, collect: collectTraceroute,
    save: (acct, payload) => WifixAPI.createTracerouteTest(acct, payload) },
];

function openHerramientas() {
  const cuenta = currentAccount() || `WX-${randInt(100000, 999999)}`;
  herramientasChip.textContent = cuenta;

  herramientasList.innerHTML = HERRAMIENTAS_ITEMS.map(item => `
    <div class="servicio-item" data-id="${item.id}">
      <button class="servicio-head" type="button">
        <div class="servicio-icon">${item.icon}</div>
        <div class="servicio-title">${item.title}</div>
        <div class="servicio-chev">${TOOL_ICONS.chev}</div>
      </button>
      <div class="servicio-body">
        <div class="servicio-body-inner" data-slot="body"></div>
      </div>
    </div>`).join('');

  herramientasList.querySelectorAll('.servicio-item').forEach(node => {
    const id = node.dataset.id;
    const item = HERRAMIENTAS_ITEMS.find(x => x.id === id);
    const head = node.querySelector('.servicio-head');
    const body = node.querySelector('[data-slot="body"]');

    head.addEventListener('click', () => {
      const wasOpen = node.classList.contains('open');
      if (!wasOpen && !body.dataset.rendered) {
        body.innerHTML = item.render();
        body.dataset.rendered = '1';
        wireToolForm(body, item);
      }
      node.classList.toggle('open');
    });
  });

  detailHerramientas.classList.add('open');
  detailHerramientas.setAttribute('aria-hidden', 'false');
}

function wireToolForm(bodyEl, item) {
  const formEl = bodyEl.querySelector('.tool-form');
  if (!formEl) return;

  const roomsSlot = formEl.querySelector('[data-slot="rooms"]');
  const hopsSlot = formEl.querySelector('[data-slot="hops"]');
  if (roomsSlot) {
    let idx = 0;
    const addRoom = () => { roomsSlot.insertAdjacentHTML('beforeend', roomRowHtml(idx)); idx++; };
    addRoom();
    formEl.querySelector('[data-action="add-room"]').addEventListener('click', addRoom);
    roomsSlot.addEventListener('click', (ev) => {
      if (ev.target.matches('[data-action="remove-room"]')) {
        const row = ev.target.closest('.room-row');
        if (roomsSlot.children.length > 1) row.remove();
      }
    });
  }
  if (hopsSlot) {
    let idx = 0;
    const addHop = () => { hopsSlot.insertAdjacentHTML('beforeend', hopRowHtml(idx)); idx++; };
    addHop();
    formEl.querySelector('[data-action="add-hop"]').addEventListener('click', addHop);
    hopsSlot.addEventListener('click', (ev) => {
      if (ev.target.matches('[data-action="remove-hop"]')) {
        const row = ev.target.closest('.hop-row');
        if (hopsSlot.children.length > 1) row.remove();
      }
    });
  }

  const saveBtn = formEl.querySelector('[data-action="save"]');
  saveBtn.addEventListener('click', async () => {
    const cuenta = currentAccount();
    if (!cuenta) {
      showSaveFeedback(saveBtn, 'Falta nº de cuenta', false);
      return;
    }
    let payload;
    try {
      payload = item.collect(formEl);
    } catch (err) {
      console.error('[Wifix]', err);
      showSaveFeedback(saveBtn, 'Datos inválidos', false);
      return;
    }
    try {
      await item.save(cuenta, payload);
      showSaveFeedback(saveBtn, '✓ Guardado', true);
    } catch (err) {
      console.error('[Wifix] error al guardar:', err);
      showSaveFeedback(saveBtn, '✗ ' + (err.message || 'Error'), false);
    }
  });
}

// ============================================================================
// Equipos Retirados (Fase 1, sin cambios funcionales)
// ============================================================================
async function openRetirados() {
  const cuenta = currentAccount() || `WX-${randInt(100000, 999999)}`;
  retiradosChip.textContent = cuenta;

  retiradosForm.innerHTML = `
    <div class="tool-form" data-form="retired">
      <label class="form-row"><span class="form-label">Número de serie *</span>
        <input type="text" data-field="serialValue" placeholder="48575443A1B2C3D4"></label>
      <label class="form-row"><span class="form-label">Modelo del equipo *</span>
        <select data-field="equipmentModelId"><option value="">Cargando...</option></select></label>
      <label class="form-row"><span class="form-label">Motivo de retiro *</span>
        <select data-field="removalReasonCode"><option value="">Cargando...</option></select></label>
      <label class="form-row"><span class="form-label">Observaciones</span>
        <textarea data-field="observations" rows="3" placeholder="Detalles del retiro"></textarea></label>
      <label class="form-row"><span class="form-label">Foto del código de barras (opcional)</span>
        <input type="file" accept="image/jpeg,image/png" data-field="barcodePhoto"></label>
      <div class="barcode-status" data-slot="barcodeStatus"></div>
      <button class="save-btn" data-action="save">Guardar retiro</button>
    </div>`;

  const formEl = retiradosForm.querySelector('[data-form="retired"]');
  const modelSel = formEl.querySelector('[data-field="equipmentModelId"]');
  const reasonSel = formEl.querySelector('[data-field="removalReasonCode"]');
  const fileInput = formEl.querySelector('[data-field="barcodePhoto"]');
  const barcodeStatus = formEl.querySelector('[data-slot="barcodeStatus"]');
  const saveBtn = formEl.querySelector('[data-action="save"]');

  try {
    const [models, reasons] = await Promise.all([
      WifixAPI.listEquipmentModels(),
      WifixAPI.listRemovalReasons(),
    ]);
    modelSel.innerHTML = `<option value="">Selecciona un modelo</option>` +
      models.filter(m => m.active).map(m =>
        `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)} (${escapeHtml(m.serialFieldType)})</option>`).join('');
    reasonSel.innerHTML = `<option value="">Selecciona un motivo</option>` +
      reasons.filter(r => r.active).map(r =>
        `<option value="${escapeHtml(r.code)}">${escapeHtml(r.label)}</option>`).join('');
  } catch (err) {
    console.error('[Wifix] catálogos:', err);
    modelSel.innerHTML = `<option value="">No se pudo cargar</option>`;
    reasonSel.innerHTML = `<option value="">No se pudo cargar</option>`;
  }

  let uploadedPhotoId = null;
  fileInput.addEventListener('change', async () => {
    uploadedPhotoId = null;
    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      barcodeStatus.textContent = '';
      return;
    }
    barcodeStatus.textContent = 'Subiendo foto...';
    try {
      const media = await WifixAPI.uploadMedia(file);
      uploadedPhotoId = media.id;
      barcodeStatus.textContent = `✓ Foto cargada (${Math.round((media.sizeBytes || file.size) / 1024)} KB)`;
      barcodeStatus.classList.add('ok');
      barcodeStatus.classList.remove('fail');
    } catch (err) {
      console.error('[Wifix] upload media:', err);
      barcodeStatus.textContent = `✗ ${err.message || 'No se pudo subir la foto.'}`;
      barcodeStatus.classList.add('fail');
      barcodeStatus.classList.remove('ok');
    }
  });

  saveBtn.addEventListener('click', async () => {
    const acct = currentAccount();
    if (!acct) {
      showSaveFeedback(saveBtn, 'Falta nº de cuenta', false);
      return;
    }
    const serial = nonEmpty(formEl.querySelector('[data-field="serialValue"]').value);
    const modelId = modelSel.value;
    const reasonCode = reasonSel.value;
    if (!serial || !modelId || !reasonCode) {
      showSaveFeedback(saveBtn, 'Completa serie, modelo y motivo', false);
      return;
    }
    const payload = {
      serialValue: serial,
      equipmentModelId: modelId,
      removalReasonCode: reasonCode,
      observations: nonEmpty(formEl.querySelector('[data-field="observations"]').value),
    };
    if (uploadedPhotoId) payload.barcodePhotoId = uploadedPhotoId;

    try {
      await WifixAPI.createRetiredEquipment(acct, payload);
      showSaveFeedback(saveBtn, '✓ Guardado', true);
    } catch (err) {
      console.error('[Wifix] retiro error:', err);
      showSaveFeedback(saveBtn, '✗ ' + (err.message || 'Error'), false);
    }
  });

  detailRetirados.classList.add('open');
  detailRetirados.setAttribute('aria-hidden', 'false');
}
