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
const subCards = subscreen.querySelectorAll('.sub-card');

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

    // "Instalaciones" (y cualquier otro tipo futuro): comportamiento original.
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

// Cache del perfil validado. Se invalida al cambiar el número de cuenta.
let validatedProfile = null;
let validatedAccount = null;

function invalidateAccountCache() {
  validatedProfile = null;
  validatedAccount = null;
  const subGrid = subscreen.querySelector('.sub-grid');
  if (subGrid) {
    subGrid.classList.remove('account-confirmed');
    subGrid.querySelectorAll('.sub-card').forEach((c) => {
      c.setAttribute('aria-disabled', 'true');
      c.setAttribute('tabindex', '-1');
    });
  }
  const feedback = document.getElementById('confirmAccountFeedback');
  if (feedback) {
    feedback.textContent = '';
    feedback.className = 'confirm-account-feedback';
  }
}

function enableSubCards() {
  const subGrid = subscreen.querySelector('.sub-grid');
  if (!subGrid) return;
  subGrid.querySelectorAll('.sub-card').forEach((c) => {
    c.removeAttribute('aria-disabled');
    c.removeAttribute('tabindex');
  });
}

accountInput.addEventListener('input', () => {
  inputWrap.classList.toggle('has-value', accountInput.value.length > 0);
  invalidateAccountCache();
});
clearAccount.addEventListener('click', () => {
  accountInput.value = '';
  inputWrap.classList.remove('has-value');
  invalidateAccountCache();
  accountInput.focus();
});

// Las tarjetas arrancan deshabilitadas para a11y; se habilitan al confirmar cuenta.
invalidateAccountCache();

// === Confirmar cuenta ========================================================
const confirmAccountBtn = document.getElementById('confirmAccount');
const confirmAccountFeedback = document.getElementById('confirmAccountFeedback');

confirmAccountBtn.addEventListener('click', async () => {
  const cuenta = currentAccount();
  if (!cuenta) {
    confirmAccountFeedback.textContent = 'Ingresá el número de cuenta.';
    confirmAccountFeedback.className = 'confirm-account-feedback error';
    return;
  }

  confirmAccountBtn.disabled = true;
  confirmAccountBtn.textContent = 'Validando…';
  confirmAccountFeedback.textContent = '';
  confirmAccountFeedback.className = 'confirm-account-feedback';

  try {
    const profile = await WifixAPI.getClientProfile(cuenta);
    validatedProfile = profile;
    validatedAccount = cuenta;

    const subGrid = subscreen.querySelector('.sub-grid');
    if (subGrid) subGrid.classList.add('account-confirmed');
    enableSubCards();

    confirmAccountFeedback.textContent = `Cuenta confirmada — ${profile.fullName}`;
    confirmAccountFeedback.className = 'confirm-account-feedback success';
  } catch (err) {
    console.error('[Wifix] confirm-account:', err);
    invalidateAccountCache();
    confirmAccountFeedback.textContent = err.message || 'No se pudo validar la cuenta.';
    confirmAccountFeedback.className = 'confirm-account-feedback error';
  } finally {
    confirmAccountBtn.disabled = false;
    confirmAccountBtn.textContent = 'Confirmar cuenta';
  }
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
  terminal: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
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

  detailPersonales.classList.add('open');
  detailPersonales.setAttribute('aria-hidden', 'false');

  // Reutilizar el perfil ya validado por "Confirmar cuenta" si coincide.
  if (validatedProfile && validatedAccount === cuenta) {
    renderClientProfile(validatedProfile, cuenta);
    return;
  }

  detailList.innerHTML = `<div class="detail-loading">Cargando datos del cliente…</div>`;

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

// ---------------------------------------------------------------------------
// Panel NAP / GPON Xtreme — estado de módulo por apertura
// ---------------------------------------------------------------------------
// El taskId se genera una vez por apertura del panel y se mantiene estable
// mientras el panel esté abierto. Se resetea en null al cerrar.
let _napPanelState = {
  taskId: null,
  openedAt: null,
  coords: null,      // { latitude, longitude, accuracy } cuando hay GPS
  selectedNap: null, // napCode seleccionado para GPON
  naps: [],          // array de NAPs cargadas (se guarda al cargar el panel)
};

// Fórmula de Haversine: distancia en metros entre dos coordenadas.
// Usada para calcular distancia NAP ↔ ubicación capturada.
// R = 6 371 000 m (radio medio de la Tierra).
function _napHaversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Genera un taskId en formato TASK/<6 dígitos>/<año> igual que los existentes
// en el sistema (ver mockClosedTask en api.js: 'TASK/' + (100000+seed) + '/2026').
function _napGenTaskId() {
  const year = new Date().getFullYear();
  const num6 = 100000 + Math.floor(Math.random() * 900000);
  return `TASK/${num6}/${year}`;
}

// Distancia en metros a la NAP. Se prefiere la que calcula la operadora
// (viene en la respuesta de /api/tec/naps); si no viene, se calcula con
// Haversine desde la coordenada capturada.
function _napDistanceToNap(nap) {
  if (nap && isFinite(nap.distanceMeters) && nap.distanceMeters > 0) {
    return nap.distanceMeters;
  }
  const c = _napPanelState.coords;
  if (!c || !nap || !isFinite(nap.latitude) || !isFinite(nap.longitude)) return null;
  return _napHaversineMeters(c.latitude, c.longitude, nap.latitude, nap.longitude);
}

// Texto de distancia para mostrar en la tarjeta.
function _napDistanceText(nap) {
  const d = _napDistanceToNap(nap);
  if (d === null) return '— (captura tu ubicación)';
  return `${d.toFixed(1)} m`;
}

// Porcentaje de puertos ocupados (0-100).
function _napOccupancyPct(nap) {
  if (!nap.totalPorts) return 0;
  return Math.round((nap.occupiedPorts / nap.totalPorts) * 100);
}

// Renderiza la barra visual de ocupación.
function _napOccupancyBar(nap) {
  const pct = _napOccupancyPct(nap);
  const cls = pct >= 100 ? 'full' : pct >= 75 ? 'high' : pct >= 50 ? 'mid' : 'low';
  const free = nap.freePorts !== undefined
    ? nap.freePorts
    : Math.max(0, (nap.totalPorts || 0) - (nap.occupiedPorts || 0));
  return `
    <div class="nap-occ-bar-wrap" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Ocupación ${pct}%">
      <div class="nap-occ-bar ${cls}" style="width:${pct}%"></div>
    </div>
    <span class="nap-occ-label">${nap.occupiedPorts}/${nap.totalPorts} ocupados · ${free} libre${free === 1 ? '' : 's'} · ${pct}%</span>`;
}

// Renderiza la lista de tarjetas NAP.
function _renderNapCards(naps, scope) {
  // Orden por distancia ascendente. La API ya las devuelve ordenadas, pero se
  // reordena por si la distancia se calculó localmente (Haversine).
  const sorted = [...naps].sort((a, b) => {
    const da = _napDistanceToNap(a);
    const db = _napDistanceToNap(b);
    if (da === null && db === null) return 0;
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  });

  const slot = scope.querySelector('[data-slot="nap-cards"]');
  if (!slot) return;
  slot.innerHTML = sorted.map(n => {
    const isSelected = _napPanelState.selectedNap === n.napCode;
    return `
      <div class="nap-card${isSelected ? ' nap-selected' : ''}" data-nap="${escapeHtml(n.napCode)}">
        <div class="nap-head">
          <span class="nap-name">${escapeHtml(n.napCode)}</span>
          ${isSelected ? '<span class="nap-selected-badge">GPON seleccionada</span>' : ''}
        </div>
        <span class="nap-distance">${_napDistanceText(n)}</span>
        ${_napOccupancyBar(n)}
        <div class="nap-actions">
          <button class="add-row-btn" data-action="view-ports" data-nap="${escapeHtml(n.napCode)}">Ver puertos</button>
          <button class="add-row-btn nap-gpon-btn" data-action="select-gpon" data-nap="${escapeHtml(n.napCode)}"
            aria-pressed="${isSelected}">
            ${isSelected ? 'Seleccionada' : 'Seleccionar para GPON'}
          </button>
        </div>
        <div class="nap-ports-slot" data-slot="ports-${escapeHtml(n.napCode)}"></div>
      </div>`;
  }).join('');
}

// Actualiza el bloque resumen de la NAP seleccionada para GPON.
async function _renderGponSummary(scope) {
  const summarySlot = scope.querySelector('[data-slot="gpon-summary"]');
  if (!summarySlot) return;
  const napCode = _napPanelState.selectedNap;
  if (!napCode) {
    summarySlot.innerHTML = '';
    summarySlot.hidden = true;
    return;
  }
  summarySlot.hidden = false;
  summarySlot.innerHTML = `<div class="detail-loading">Obteniendo puerto sugerido…</div>`;

  try {
    const data = await WifixAPI.getNapPorts(napCode);
    const naps = scope._napData || [];
    const nap = naps.find(n => n.napCode === napCode);
    const dist = nap ? _napDistanceToNap(nap) : null;
    const distTxt = dist !== null ? `${dist.toFixed(1)} m` : '—';
    const occ = nap ? `${nap.occupiedPorts}/${nap.totalPorts}` : '—';

    // Puerto libre sugerido: primer puerto con occupied=false.
    // Si la operadora no expone el detalle puerto a puerto, se informa el
    // número de puertos libres que sí viene en el listado de NAPs.
    const freePort = data.ports ? data.ports.find(p => !p.occupied) : null;
    let freeTxt;
    if (freePort) {
      freeTxt = `Puerto ${pad(freePort.portNumber)} (libre)`;
    } else if (data.detailAvailable === false) {
      const libres = nap
        ? (nap.freePorts !== undefined ? nap.freePorts : Math.max(0, nap.totalPorts - nap.occupiedPorts))
        : null;
      freeTxt = libres === null
        ? 'Detalle por puerto no disponible'
        : `${libres} puerto${libres === 1 ? '' : 's'} libre${libres === 1 ? '' : 's'} (sin detalle por puerto)`;
    } else {
      freeTxt = 'Sin puertos libres disponibles';
    }

    // TODO: a futuro -> enviar selección a API GPON Xtreme (POST .../assign-nap)

    summarySlot.innerHTML = `
      <div class="nap-gpon-summary">
        <div class="nap-gpon-summary-title">NAP seleccionada para GPON Xtreme</div>
        <div class="nap-gpon-summary-row">
          <span class="nap-gpon-key">NAP</span>
          <span class="nap-gpon-val nap-name">${escapeHtml(napCode)}</span>
        </div>
        <div class="nap-gpon-summary-row">
          <span class="nap-gpon-key">Distancia</span>
          <span class="nap-gpon-val">${escapeHtml(distTxt)}</span>
        </div>
        <div class="nap-gpon-summary-row">
          <span class="nap-gpon-key">Puertos</span>
          <span class="nap-gpon-val">${escapeHtml(occ)}</span>
        </div>
        <div class="nap-gpon-summary-row">
          <span class="nap-gpon-key">Puerto sugerido</span>
          <span class="nap-gpon-val nap-gpon-free-port">${escapeHtml(freeTxt)}</span>
        </div>
      </div>`;
  } catch (err) {
    summarySlot.innerHTML = `<div class="detail-error">${escapeHtml(err.message || 'Error al cargar puertos')}</div>`;
  }
}

// Consulta las NAPs cercanas a la coordenada capturada y pinta las tarjetas.
// La API de operadora (TEC) indexa por lat/lng, así que sin coordenada no hay
// nada que pedir: se muestra el aviso en vez de una lista vacía.
async function _napFetchAndRender(scope) {
  const slot = scope.querySelector('[data-slot="nap-cards"]');
  if (!slot) return;
  const coords = _napPanelState.coords;

  if (!coords) {
    slot.innerHTML = `<div class="detail-empty">Captura tu ubicación (GPS o lat/lng manual) para buscar las NAPs del sector.</div>`;
    return;
  }

  slot.innerHTML = `<div class="detail-loading">Buscando NAPs cercanas…</div>`;
  try {
    const naps = await WifixAPI.getNearbyNaps(coords);
    _napPanelState.naps = naps || [];
    scope._napData = _napPanelState.naps;

    if (_napPanelState.naps.length === 0) {
      slot.innerHTML = `<div class="detail-empty">No hay NAPs registradas cerca de esta coordenada.</div>`;
      return;
    }
    // Si la NAP seleccionada ya no está en el resultado, se limpia la selección.
    if (_napPanelState.selectedNap &&
        !_napPanelState.naps.some(n => n.napCode === _napPanelState.selectedNap)) {
      _napPanelState.selectedNap = null;
      await _renderGponSummary(scope);
    }
    _renderNapCards(_napPanelState.naps, scope);
    _wireNapCardButtons(scope, _napPanelState.naps);
  } catch (err) {
    console.error('[Wifix] NAPs cercanas', err);
    slot.innerHTML = `<div class="detail-error">${escapeHtml(err.message || 'No se pudieron consultar las NAPs.')}</div>`;
  }
}

// Conecta los botones del panel NAP: GPS, coordenadas manuales, selección GPON.
function _wireNapPanel(scope) {
  const gpsBtn = scope.querySelector('[data-action="nap-gps"]');
  const gpsStatus = scope.querySelector('[data-slot="nap-gps-status"]');
  const latInput = scope.querySelector('[data-field="nap-lat"]');
  const lngInput = scope.querySelector('[data-field="nap-lng"]');

  function applyCoords(lat, lng, acc) {
    _napPanelState.coords = { latitude: lat, longitude: lng, accuracy: acc };
    latInput.value = lat;
    lngInput.value = lng;
    gpsStatus.textContent = `Ubicación capturada (precisión ±${acc != null ? acc.toFixed(0) : '?'}m)`;
    gpsStatus.className = 'nap-gps-status ok';
    _napFetchAndRender(scope);
  }

  gpsBtn.addEventListener('click', async () => {
    gpsBtn.disabled = true;
    gpsBtn.textContent = 'Obteniendo…';
    gpsStatus.textContent = 'Solicitando GPS…';
    gpsStatus.className = 'nap-gps-status';
    try {
      const pos = await WifixNative.getCurrentPosition({ timeoutMs: 10000 });
      applyCoords(pos.latitude, pos.longitude, pos.accuracy);
    } catch (err) {
      gpsStatus.textContent = `Error: ${err.message || 'No se pudo obtener ubicación.'}`;
      gpsStatus.className = 'nap-gps-status error';
    } finally {
      gpsBtn.disabled = false;
      gpsBtn.textContent = 'Usar mi ubicación';
    }
  });

  // Ingreso manual: reconsultar al cambiar lat o lng.
  function onManualCoords() {
    const lat = parseFloat(latInput.value);
    const lng = parseFloat(lngInput.value);
    if (!isFinite(lat) || !isFinite(lng)) return;
    _napPanelState.coords = { latitude: lat, longitude: lng, accuracy: null };
    gpsStatus.textContent = 'Coordenadas ingresadas manualmente.';
    gpsStatus.className = 'nap-gps-status ok';
    _napFetchAndRender(scope);
  }
  latInput.addEventListener('change', onManualCoords);
  lngInput.addEventListener('change', onManualCoords);
}

function _wireNapCardButtons(scope, naps) {
  // "Ver puertos"
  wireNapPortsButtons(scope);

  // "Seleccionar para GPON"
  scope.querySelectorAll('[data-action="select-gpon"]').forEach(btn => {
    // Evitar duplicar listeners: clonar el nodo.
    const fresh = btn.cloneNode(true);
    btn.parentNode.replaceChild(fresh, btn);
    fresh.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      _napPanelState.selectedNap = fresh.dataset.nap;
      _renderNapCards(naps, scope);
      _wireNapCardButtons(scope, naps);
      await _renderGponSummary(scope);
    });
  });
}

// Renderiza el panel NAP completo (devuelve HTML string + activa lógica tras inserción).
// Las NAPs no se piden aquí: se consultan cuando hay coordenada (ver _napFetchAndRender).
function renderNapPanel() {
  // Generar taskId una sola vez por apertura (si ya hay uno no lo regeneramos).
  if (!_napPanelState.taskId) {
    _napPanelState.taskId = _napGenTaskId();
    _napPanelState.openedAt = new Date().toISOString();
  }

  const taskId = _napPanelState.taskId;
  const fechaHora = formatDate(_napPanelState.openedAt);

  return `
    <div class="nap-panel" data-panel="nap-gpon">

      <!-- 1) Cabecera de tarea -->
      <div class="nap-task-header">
        <span class="nap-task-badge">${escapeHtml(taskId)}</span>
        <span class="nap-task-date">${escapeHtml(fechaHora)}</span>
      </div>

      <!-- 2) Coordenada de la tarea -->
      <div class="nap-gps-section">
        <button class="add-row-btn nap-gps-btn" type="button" data-action="nap-gps"
          aria-label="Obtener ubicación GPS">
          Usar mi ubicacion
        </button>
        <div class="nap-coords-row">
          <label class="nap-coord-label">
            <span>Latitud</span>
            <input type="number" step="any" data-field="nap-lat" class="nap-coord-input"
              placeholder="-0.1800" aria-label="Latitud"
              value="${_napPanelState.coords ? _napPanelState.coords.latitude : ''}">
          </label>
          <label class="nap-coord-label">
            <span>Longitud</span>
            <input type="number" step="any" data-field="nap-lng" class="nap-coord-input"
              placeholder="-78.4680" aria-label="Longitud"
              value="${_napPanelState.coords ? _napPanelState.coords.longitude : ''}">
          </label>
        </div>
        <div class="nap-gps-status${_napPanelState.coords ? ' ok' : ''}" data-slot="nap-gps-status">
          ${_napPanelState.coords
            ? `Ubicacion capturada (precision ±${_napPanelState.coords.accuracy != null ? _napPanelState.coords.accuracy.toFixed(0) : '?'}m)`
            : 'Sin ubicacion — toca el boton o ingresa lat/lng manualmente.'}
        </div>
      </div>

      <!-- 3) Tarjetas de NAPs -->
      <div class="nap-section-title">NAPs disponibles en el sector</div>
      <div data-slot="nap-cards">
        <div class="detail-empty">Captura tu ubicación (GPS o lat/lng manual) para buscar las NAPs del sector.</div>
      </div>

      <!-- 4) Bloque resumen GPON -->
      <div data-slot="gpon-summary" hidden></div>

    </div>`;
}

// Wrapper que arma el panel completo (usado en SERVICIO_ITEMS.load).
// La consulta a la operadora ocurre cuando el técnico captura la coordenada.
async function loadNapPanel() {
  // Resetear selección y resultados al abrir (se mantienen coords y taskId).
  _napPanelState.selectedNap = null;
  _napPanelState.naps = [];
  return renderNapPanel();
}

// Al terminar de insertar el HTML del panel, activa la lógica interactiva.
// Llamado desde openDatosServicio después de body.innerHTML = html.
function _bootNapPanel(body) {
  const panel = body.querySelector('[data-panel="nap-gpon"]');
  if (!panel) return;
  _wireNapPanel(panel);
  // Si ya había una coordenada de una apertura anterior, se reconsulta sola.
  if (_napPanelState.coords) _napFetchAndRender(panel);
}

function renderPortsTable(napPorts) {
  // La API de operadora aún no expone el detalle cliente por cliente:
  // en ese caso se muestra el aviso en vez de una rejilla vacía.
  if (!napPorts.ports || napPorts.ports.length === 0) {
    const note = napPorts.note || 'No hay detalle de puertos para esta NAP.';
    return `<div class="detail-empty port-note">${escapeHtml(note)}</div>`;
  }
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

// ============================================================================
// ISP Monitor (campos 9-13) — estado del equipo/red, señal a ruido, FEC y
// caídas de las últimas 24 horas.
//
// La API de operadora indexa por SERIAL GPON (fibra) o MAC del cablemódem
// (HFC), no por número de cuenta: el técnico escanea o escribe el identificador
// del equipo y desde ahí se consultan los 7 endpoints en una sola llamada al
// backend (/terminals/:id/diagnostics).
// ============================================================================

// Estado del panel por cuenta abierta.
let _ispState = { id: null, data: null };

/** Clave de localStorage donde se recuerda el equipo consultado por cuenta. */
function _ispStorageKey(cuenta) {
  return `wifix_terminal_id:${cuenta}`;
}
function _ispRememberId(cuenta, id) {
  try { localStorage.setItem(_ispStorageKey(cuenta), id); } catch (_) { /* bloqueado */ }
}
function _ispRecallId(cuenta) {
  try { return localStorage.getItem(_ispStorageKey(cuenta)) || ''; } catch (_) { return ''; }
}

// --- Formato ---------------------------------------------------------------

/** Número con como máximo `dec` decimales y sin ceros sobrantes. */
function _fmtNum(v, dec = 2) {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  return String(Math.round(v * Math.pow(10, dec)) / Math.pow(10, dec));
}

/** "HH:mm" de un instante ISO; cadena vacía si no se puede parsear. */
function _fmtHour(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso).slice(0, 5);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Etiqueta legible para el nombre de serie que devuelva la operadora. */
const _ISP_KEY_LABELS = {
  online: 'En línea', estado: 'Estado', status: 'Estado', up: 'En línea',
  snrdown: 'Downstream', down: 'Downstream', downstream: 'Downstream',
  snrup: 'Upstream', upstream: 'Upstream',
  snr: 'SNR', mer: 'MER',
  terminalsonline: 'Equipos en línea',
  corrected: 'Corregidos', corregidos: 'Corregidos',
  errors: 'Errores',
  uncorrected: 'Sin corregir', uncorrectables: 'Sin corregir', sincorregir: 'Sin corregir',
};
function _ispKeyLabel(key) {
  const flat = String(key).replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (_ISP_KEY_LABELS[flat]) return _ISP_KEY_LABELS[flat];
  // camelCase / snake_case → "Camel case"
  const words = String(key).replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

// --- Identificador del equipo ---------------------------------------------

// La etiqueta de un ONT trae varios códigos y solo dos sirven para ISP
// Monitor: el SERIAL GPON (4 letras + 8 hex, p. ej. ZTEGD52E1A9B) y la MAC
// (12 hex). El D-SN y el EN que también vienen impresos los rechaza la API
// con "Invalid serial number".
const _ISP_GPON_SN_RE = /^[A-Z]{4}[0-9A-F]{8}$/;
const _ISP_MAC_RE = /^[0-9A-F]{12}$/;

// Etiquetas impresas que preceden al código y hay que quitar antes de validar.
const _ISP_LABEL_RE = /^(GPON\s*[- ]?\s*SN|PON\s*[- ]?\s*SN|HOST\s*[- ]?\s*SN|D\s*[- ]?\s*SN|MAC(\s*ADDRESS)?|EN|S\/?N|SN)\s*[:=]?\s*/;

/** Limpia un código leído: mayúsculas, sin etiqueta, sin separadores. */
function _ispCleanCode(raw) {
  return String(raw || '')
    .toUpperCase()
    .trim()
    .replace(_ISP_LABEL_RE, '')
    .replace(/[\s:_-]/g, '');
}

/**
 * Elige, entre los códigos leídos de una etiqueta, el que ISP Monitor acepta.
 * Prioriza el serial GPON sobre la MAC (la mayoría del parque es fibra).
 * Devuelve null si ninguno tiene forma válida.
 */
function _ispPickTerminalId(rawValues) {
  const cleaned = (rawValues || []).map(_ispCleanCode).filter(Boolean);
  const gpon = cleaned.find(c => _ISP_GPON_SN_RE.test(c));
  if (gpon) return { id: gpon, kind: 'GPON' };
  const mac = cleaned.find(c => _ISP_MAC_RE.test(c));
  if (mac) return { id: mac, kind: 'MAC' };
  return null;
}

/** true si el texto ya tiene forma de serial GPON o de MAC. */
function _ispIdLooksValid(value) {
  const c = _ispCleanCode(value);
  return _ISP_GPON_SN_RE.test(c) || _ISP_MAC_RE.test(c);
}

/** Paleta por posición de serie, coherente con el resto de la app. */
const _ISP_COLORS = ['#00e0ff', '#7aa2ff', '#ffb020', '#ff5c7a', '#37d67a'];

// --- Gráficos SVG ----------------------------------------------------------

let _chartIdSeq = 0;

/**
 * Gráfico de líneas con área, sin dependencias.
 * `series` = [{ label, color, points: [{ t, v }] }]
 */
function renderLineChart(series, opts = {}) {
  const usable = (series || []).filter(s => s.points.some(p => isFinite(p.v)));
  if (usable.length === 0) {
    return `<div class="detail-empty">Sin datos para graficar.</div>`;
  }

  const W = 320, H = 118;
  const padL = 36, padR = 10, padT = 12, padB = 22;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  let min = Infinity, max = -Infinity, maxLen = 0;
  usable.forEach(s => {
    maxLen = Math.max(maxLen, s.points.length);
    s.points.forEach(p => {
      if (!isFinite(p.v)) return;
      if (p.v < min) min = p.v;
      if (p.v > max) max = p.v;
    });
  });
  if (opts.minZero && min > 0) min = 0;
  // Margen del 8 % arriba y abajo; si la serie es plana se abre un rango mínimo.
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  min -= span * 0.08;
  max += span * 0.08;

  const x = i => padL + (maxLen <= 1 ? plotW / 2 : (i / (maxLen - 1)) * plotW);
  const y = v => padT + plotH - ((v - min) / (max - min)) * plotH;

  const gridY = [0, 0.5, 1].map(f => padT + plotH * f);
  const grid = gridY.map(gy =>
    `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${W - padR}" y2="${gy.toFixed(1)}" class="chart-grid"/>`
  ).join('');

  const yLabels = [
    { v: max, gy: gridY[0] },
    { v: (max + min) / 2, gy: gridY[1] },
    { v: min, gy: gridY[2] },
  ].map(l =>
    `<text x="${padL - 5}" y="${(l.gy + 3).toFixed(1)}" class="chart-axis" text-anchor="end">${escapeHtml(_fmtNum(l.v, 1))}</text>`
  ).join('');

  const paths = usable.map((s, si) => {
    const color = s.color || _ISP_COLORS[si % _ISP_COLORS.length];
    const gradId = `chartGrad${++_chartIdSeq}`;
    const pts = s.points
      .map((p, i) => (isFinite(p.v) ? `${x(i).toFixed(1)},${y(p.v).toFixed(1)}` : null))
      .filter(Boolean);
    if (pts.length === 0) return '';
    const area = `${padL},${padT + plotH} ${pts.join(' ')} ${x(s.points.length - 1).toFixed(1)},${padT + plotH}`;
    return `
      <defs>
        <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.28"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <polygon points="${area}" fill="url(#${gradId})"/>
      <polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1.8"
        stroke-linejoin="round" stroke-linecap="round"/>`;
  }).join('');

  // Eje X: primera, media y última muestra con hora.
  const stamps = usable[0].points;
  const xTicks = [0, Math.floor((stamps.length - 1) / 2), stamps.length - 1]
    .filter((v, i, arr) => arr.indexOf(v) === i && v >= 0)
    .map(i => {
      const label = _fmtHour(stamps[i] && stamps[i].t);
      if (!label) return '';
      const anchor = i === 0 ? 'start' : i === stamps.length - 1 ? 'end' : 'middle';
      return `<text x="${x(i).toFixed(1)}" y="${H - 6}" class="chart-axis" text-anchor="${anchor}">${escapeHtml(label)}</text>`;
    }).join('');

  const legend = usable.map((s, si) => `
    <span class="chart-legend-item">
      <span class="chart-legend-dot" style="background:${s.color || _ISP_COLORS[si % _ISP_COLORS.length]}"></span>
      ${escapeHtml(s.label)}
    </span>`).join('');

  return `
    <div class="chart-block">
      ${opts.unit ? `<div class="chart-unit">${escapeHtml(opts.unit)}</div>` : ''}
      <svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img"
        aria-label="${escapeHtml(opts.ariaLabel || 'Gráfico de las últimas 24 horas')}">
        ${grid}${yLabels}${paths}${xTicks}
      </svg>
      <div class="chart-legend">${legend}</div>
    </div>`;
}

/**
 * Agrupa las muestras en `buckets` celdas. ISP Monitor manda 288 muestras
 * (una cada 5 min): pintadas de a una quedarían de 1 px en el celular.
 * Un bucket se marca "caído" si CUALQUIER muestra suya lo estuvo — nunca se
 * esconde una caída corta.
 */
function _ispBucketStatus(points, key, buckets) {
  if (points.length <= buckets) {
    return points.map(p => {
      const v = p.values ? p.values[key] : undefined;
      return {
        state: v === undefined ? 'unknown' : v > 0 ? 'up' : 'down',
        from: p.t,
        to: p.t,
      };
    });
  }
  const size = Math.ceil(points.length / buckets);
  const out = [];
  for (let i = 0; i < points.length; i += size) {
    const slice = points.slice(i, i + size);
    let anyDown = false, anyUp = false;
    slice.forEach(p => {
      const v = p.values ? p.values[key] : undefined;
      if (v === undefined) return;
      if (v > 0) anyUp = true; else anyDown = true;
    });
    out.push({
      state: anyDown ? 'down' : anyUp ? 'up' : 'unknown',
      from: slice[0].t,
      to: slice[slice.length - 1].t,
    });
  }
  return out;
}

/**
 * Barra de disponibilidad: una celda por tramo (verde = en línea,
 * rojo = alguna caída). Más legible que una línea para una serie 0/1.
 */
function renderStatusBand(series, label) {
  const points = (series && series.points) || [];
  if (points.length === 0) return `<div class="detail-empty">Sin datos de estado.</div>`;
  const key = (series.keys && series.keys[0]) || 'online';

  const buckets = _ispBucketStatus(points, key, 48);
  const cells = buckets.map(b => {
    const stateText = b.state === 'up' ? 'En línea' : b.state === 'down' ? 'Caído' : 'Sin dato';
    const range = b.from === b.to
      ? _fmtHour(b.from)
      : `${_fmtHour(b.from)}–${_fmtHour(b.to)}`;
    return `<span class="band-cell ${b.state}" title="${escapeHtml(range)} · ${stateText}"></span>`;
  }).join('');

  return `
    <div class="band-block">
      <div class="band-label">${escapeHtml(label)}</div>
      <div class="band-track">${cells}</div>
      <div class="band-axis">
        <span>${escapeHtml(_fmtHour(points[0].t))}</span>
        <span>${escapeHtml(_fmtHour(points[points.length - 1].t))}</span>
      </div>
    </div>`;
}

// --- Lectura de las series -------------------------------------------------

/** Convierte una serie normalizada del backend al formato del gráfico. */
function _ispSeriesToChart(series, keys) {
  if (!series || !series.points || series.points.length === 0) return [];
  const useKeys = keys && keys.length ? keys : series.keys || [];
  return useKeys.map((key, i) => ({
    label: _ispKeyLabel(key),
    color: _ISP_COLORS[i % _ISP_COLORS.length],
    points: series.points.map(p => ({ t: p.t, v: p.values ? p.values[key] : undefined })),
  }));
}

/**
 * Nombre corto de un canal DOCSIS. La operadora manda
 * "Logical Upstream Channel 0/1.1/0" y el nodo por separado ("2G-2 v").
 */
function _ispChannelLabel(channel) {
  const desc = String(channel.label || '')
    .replace(/^Logical\s+Upstream\s+Channel\s*/i, 'Canal up ')
    .replace(/^Logical\s+Downstream\s+Channel\s*/i, 'Canal down ')
    .trim();
  const name = desc || (channel.ifIndex !== null ? `ifIndex ${channel.ifIndex}` : 'Canal');
  return channel.network ? `${name} · ${channel.network}` : name;
}

/** Tarjeta con título y gráfico. */
function _ispChartCard(title, lines, opts) {
  if (!lines || lines.length === 0) return '';
  return `
    <div class="isp-chart-card">
      <div class="isp-chart-title">${escapeHtml(title)}</div>
      ${renderLineChart(lines, opts)}
    </div>`;
}

/**
 * Tarjetas de una serie, contemplando el formato multicanal de DOCSIS.
 *
 * - Canal con UNA métrica (SNR) → un solo gráfico con una línea por canal:
 *   comparar canales entre sí es justamente lo que hace el técnico.
 * - Canal con VARIAS métricas (FEC corregidos / sin corregir) → un gráfico por
 *   canal, porque mezclar 2 métricas × N canales en uno solo no se lee.
 */
function _ispSeriesCards(series, scopeTitle, opts) {
  if (!series) return '';
  const channels = series.channels || [];

  if (channels.length === 0) {
    return _ispChartCard(scopeTitle, _ispSeriesToChart(series), opts);
  }

  const keyCount = (channels[0].keys || []).length;

  if (keyCount <= 1) {
    const lines = channels.map((channel, i) => {
      const key = (channel.keys || [])[0];
      return {
        label: _ispChannelLabel(channel),
        color: _ISP_COLORS[i % _ISP_COLORS.length],
        points: (channel.points || []).map(p => ({ t: p.t, v: key && p.values ? p.values[key] : undefined })),
      };
    }).filter(line => line.points.length > 0);
    return _ispChartCard(scopeTitle, lines, opts);
  }

  return channels.map(channel => {
    const lines = (channel.keys || []).map((key, i) => ({
      label: _ispKeyLabel(key),
      color: _ISP_COLORS[i % _ISP_COLORS.length],
      points: (channel.points || []).map(p => ({ t: p.t, v: p.values ? p.values[key] : undefined })),
    }));
    return _ispChartCard(`${scopeTitle} · ${_ispChannelLabel(channel)}`, lines, opts);
  }).join('');
}

/** Caídas (transiciones a 0), muestras fuera de línea y % de uptime. */
function _ispOutageStats(series) {
  const points = (series && series.points) || [];
  const key = (series && series.keys && series.keys[0]) || 'online';
  let outages = 0, downSamples = 0, known = 0, previous = null;
  points.forEach(p => {
    const v = p.values ? p.values[key] : undefined;
    if (v === undefined) return;
    known++;
    if (v <= 0) downSamples++;
    if (previous !== null && previous > 0 && v <= 0) outages++;
    previous = v;
  });
  return {
    outages,
    downSamples,
    totalSamples: points.length,
    uptimePercent: known === 0 ? 0 : ((known - downSamples) / known) * 100,
  };
}

// --- Render del resultado --------------------------------------------------

function _ispBadge(value, okText, failText) {
  if (value === null || value === undefined) {
    return `<span class="isp-badge unknown">Sin dato</span>`;
  }
  return value
    ? `<span class="isp-badge ok">${escapeHtml(okText)}</span>`
    : `<span class="isp-badge fail">${escapeHtml(failText)}</span>`;
}

/** Nombre legible de los períodos del historial que devuelve la operadora. */
const _ISP_PERIOD_LABELS = {
  lasthour: 'Última hora',
  lastday: 'Último día',
  lastweek: 'Última semana',
  lastmonth: 'Último mes',
};
const _ISP_PERIOD_ORDER = ['lasthour', 'lastday', 'lastweek', 'lastmonth'];

function _ispPeriodKey(period) {
  return String(period || '').replace(/[^a-z]/gi, '').toLowerCase();
}

/**
 * Historial de equipos que pasaron por el puerto (`terminals[]` de la API).
 * Le dice al técnico si el equipo anterior del domicilio venía cayéndose.
 */
function renderIspHistory(history) {
  if (!history || history.length === 0) return '';
  const sorted = [...history].sort(
    (a, b) => _ISP_PERIOD_ORDER.indexOf(_ispPeriodKey(a.period)) - _ISP_PERIOD_ORDER.indexOf(_ispPeriodKey(b.period)),
  );
  const rows = sorted.map(entry => {
    const label = _ISP_PERIOD_LABELS[_ispPeriodKey(entry.period)] || entry.period;
    const equipos = (entry.ids || []).map((id, i) => {
      const status = (entry.statuses || [])[i];
      const up = String(status || '').toLowerCase() === 'up';
      const cls = status === undefined ? 'unknown' : up ? 'ok' : 'fail';
      const text = status === undefined ? '—' : up ? 'en línea' : 'caído';
      return `<span class="isp-hist-eq"><span class="mono">${escapeHtml(id)}</span>
        <span class="isp-badge ${cls}">${escapeHtml(text)}</span></span>`;
    }).join('');
    const extra = [entry.drop, entry.events].filter(Boolean).join(' · ');
    return `
      <div class="isp-hist-row">
        <span class="isp-hist-period">${escapeHtml(label)}</span>
        <div class="isp-hist-equipos">${equipos || '<span class="isp-hist-empty">Sin equipos</span>'}</div>
        ${extra ? `<span class="isp-hist-extra">${escapeHtml(extra)}</span>` : ''}
      </div>`;
  }).join('');
  return `
    <div class="isp-section-title">Equipos en este puerto</div>
    <div class="isp-hist">${rows}</div>`;
}

function renderIspTerminalCard(terminal) {
  if (!terminal || !terminal.found) {
    return `
      <div class="detail-empty port-note">
        ISP Monitor no tiene datos para <strong>${escapeHtml(terminal ? terminal.id : '—')}</strong>.
        El formato es válido, así que o el equipo no está aprovisionado, o el código
        no es el que corresponde: en un ONT ZTE hay que usar el <strong>GPON SN</strong>,
        no el D-SN ni el EN.
      </div>`;
  }

  const event = terminal.event;
  const eventRow = event && event.active
    ? `<div class="isp-event alert">
         <span class="isp-event-title">Evento asociado</span>
         <span class="isp-event-desc">${escapeHtml(event.description || 'Evento activo en la red')}</span>
       </div>`
    : `<div class="isp-event">
         <span class="isp-event-title">Evento asociado</span>
         <span class="isp-event-desc">Sin eventos activos</span>
       </div>`;

  const nodo = (terminal.networkIds || []).join(', ');
  const extra = (terminal.fields || [])
    .filter(f => f.value !== null && f.value !== '')
    .map(f => `
      <div class="mini-row">
        <span class="mr-label">${escapeHtml(_ispKeyLabel(f.key))}</span>
        <span class="mr-value">${escapeHtml(String(f.value))}</span>
      </div>`).join('');

  return `
    <div class="isp-status-row">
      <div class="isp-status-cell">
        <span class="isp-status-label">Equipo</span>
        ${_ispBadge(terminal.online, 'En línea', 'Caído')}
      </div>
      <div class="isp-status-cell">
        <span class="isp-status-label">Tecnología</span>
        <span class="isp-badge tech">${escapeHtml(terminal.technology || '—')}</span>
      </div>
      <div class="isp-status-cell">
        <span class="isp-status-label">Ciudad</span>
        <span class="isp-badge tech">${escapeHtml(terminal.city || '—')}</span>
      </div>
    </div>
    ${eventRow}
    ${nodo ? `<div class="mini-row"><span class="mr-label">Nodo</span><span class="mr-value">${escapeHtml(nodo)}</span></div>` : ''}
    ${extra}`;
}

/**
 * Métricas DOCSIS (SNR y FEC) que la operadora solo publica para HFC.
 * En fibra devuelve 204, así que se explica en vez de dejar el hueco.
 */
function _ispDocsisNote(technology) {
  return `
    <div class="detail-empty port-note">
      ${technology === 'GPON'
        ? 'Métrica DOCSIS: la operadora solo la publica para equipos HFC (cablemódem). Este equipo es GPON.'
        : 'La operadora no devolvió datos de esta métrica para este equipo.'}
    </div>`;
}

/** Series de una métrica en ambos ámbitos, o la nota si no hay datos. */
function _ispMetricSection(title, data, technology, chartOpts) {
  const cards = ['terminal', 'network'].map(scope => _ispSeriesCards(
    data && data[scope],
    scope === 'terminal' ? 'Equipo del cliente' : 'Red / nodo',
    chartOpts,
  )).join('');

  return `
    <div class="isp-section-title">${escapeHtml(title)}</div>
    ${cards || _ispDocsisNote(technology)}`;
}

function renderIspDiagnostics(data) {
  const terminal = data.terminal || {};
  const statusTerminal = data.status && data.status.terminal;
  const statusNetwork = data.status && data.status.network;
  const stats = _ispOutageStats(statusTerminal);

  // El endpoint de red devuelve cuántos equipos del nodo están en línea:
  // se grafica como cantidad, no como barra de disponibilidad.
  const networkChart = _ispSeriesToChart(statusNetwork);
  const networkNow = statusNetwork && statusNetwork.points.length
    ? statusNetwork.points[statusNetwork.points.length - 1].values[statusNetwork.keys[0]]
    : null;

  const errors = (data.errors || []).length
    ? `<div class="isp-partial">Endpoints sin respuesta: ${
        data.errors.map(e => escapeHtml(e.endpoint)).join(', ')
      }. El resto de los datos sí se consultó.</div>`
    : '';

  const availability = statusTerminal && statusTerminal.points.length
    ? `
      <div class="isp-stats">
        <div class="isp-stat">
          <span class="isp-stat-value">${stats.outages}</span>
          <span class="isp-stat-label">caídas del equipo</span>
        </div>
        <div class="isp-stat">
          <span class="isp-stat-value">${_fmtNum(stats.uptimePercent, 1)}%</span>
          <span class="isp-stat-label">en línea</span>
        </div>
        <div class="isp-stat">
          <span class="isp-stat-value">${networkNow === null || networkNow === undefined ? '—' : networkNow}</span>
          <span class="isp-stat-label">equipos en línea en el nodo</span>
        </div>
      </div>
      ${renderStatusBand(statusTerminal, 'Equipo del cliente')}
      ${_ispChartCard('Equipos en línea en el nodo', networkChart,
        { minZero: true, ariaLabel: 'Equipos en línea en el nodo, últimas 24 horas' })}`
    : `<div class="detail-empty">La operadora no devolvió el histórico de estado de este equipo.</div>`;

  return `
    <div class="isp-results">
      ${renderIspTerminalCard(terminal)}
      ${errors}

      ${terminal.found ? `<div class="isp-section-title">Disponibilidad — últimas 24 h</div>${availability}` : ''}

      ${terminal.found ? _ispMetricSection('Señal a ruido — 24 h (DOCSIS)', data.snr, terminal.technology,
        { unit: 'dB', ariaLabel: 'Señal a ruido de las últimas 24 horas' }) : ''}

      ${terminal.found ? _ispMetricSection('Errores FEC corregidos y sin corregir — 24 h (DOCSIS)', data.codewords, terminal.technology,
        { minZero: true, ariaLabel: 'Errores FEC de las últimas 24 horas' }) : ''}

      ${terminal.found ? renderIspHistory(terminal.history) : ''}

      <div class="isp-footnote">Consultado ${escapeHtml(formatDate(data.fetchedAt))} · ISP Monitor</div>
      <div class="isp-footnote">Tráfico del cliente (campo 13): pendiente de endpoint en la API de operadora.</div>
    </div>`;
}

// --- Panel -----------------------------------------------------------------

function renderIspPanel(cuenta) {
  const remembered = _ispRecallId(cuenta);
  const canScan = serialScannerAvailable();
  return `
    <div class="isp-panel" data-panel="isp-monitor">
      <p class="isp-hint">
        ISP Monitor consulta por <strong>serial GPON</strong> (fibra) o
        <strong>MAC del cablemódem</strong> (HFC), no por número de cuenta.
      </p>
      <details class="isp-labels">
        <summary>¿Cuál de los códigos de la etiqueta?</summary>
        <ul>
          <li><strong>ONT ZTE</strong> (todas) — GPON SN</li>
          <li><strong>ONT Huawei OptiXstar</strong>, ONU B2000, decos, MTA — SN</li>
          <li><strong>ONU300G / ONU HUR</strong> — PON SN</li>
          <li><strong>Decodificador HD</strong> — HOST SN</li>
          <li><strong>Cablemódem HFC</strong> — MAC</li>
        </ul>
        <p>El <strong>D-SN</strong> y el <strong>EN</strong> que también vienen impresos no sirven acá: la operadora los rechaza.</p>
      </details>
      <label class="form-row">
        <span class="form-label">Serial GPON o MAC del cablemódem</span>
        <input type="text" data-field="terminalId" class="isp-input" inputmode="latin"
          autocapitalize="characters" autocomplete="off" spellcheck="false"
          placeholder="ZTEGC1234567 · A4B87E112233" value="${escapeHtml(remembered)}">
      </label>
      <div class="isp-actions">
        ${canScan ? `<button type="button" class="add-row-btn" data-action="isp-scan">Escanear</button>` : ''}
        <button type="button" class="save-btn isp-consult-btn" data-action="isp-consult">Consultar</button>
      </div>
      <div class="isp-feedback" data-slot="isp-feedback" role="alert" aria-live="polite"></div>
      <div data-slot="isp-results"></div>
    </div>`;
}

/** Activa el panel de ISP Monitor una vez insertado en el DOM. */
function _bootIspPanel(body, cuenta) {
  const panel = body.querySelector('[data-panel="isp-monitor"]');
  if (!panel) return;

  const input = panel.querySelector('[data-field="terminalId"]');
  const feedback = panel.querySelector('[data-slot="isp-feedback"]');
  const results = panel.querySelector('[data-slot="isp-results"]');
  const consultBtn = panel.querySelector('[data-action="isp-consult"]');
  const scanBtn = panel.querySelector('[data-action="isp-scan"]');

  function setFeedback(message, kind) {
    feedback.textContent = message || '';
    feedback.className = `isp-feedback${kind ? ' ' + kind : ''}`;
  }

  async function consult() {
    const id = (input.value || '').trim();
    if (!id) {
      setFeedback('Ingresá o escaneá el serial GPON o la MAC del cablemódem.', 'error');
      input.focus();
      return;
    }
    consultBtn.disabled = true;
    consultBtn.textContent = 'Consultando…';
    setFeedback('');
    results.innerHTML = `<div class="detail-loading">Consultando ISP Monitor…</div>`;
    try {
      const data = await WifixAPI.getTerminalDiagnostics(id);
      _ispState = { id: id, data: data };
      _ispRememberId(cuenta, id);
      results.innerHTML = renderIspDiagnostics(data);
    } catch (err) {
      console.error('[Wifix] ISP Monitor', err);
      results.innerHTML = '';
      setFeedback(err.message || 'No se pudo consultar ISP Monitor.', 'error');
    } finally {
      consultBtn.disabled = false;
      consultBtn.textContent = 'Consultar';
    }
  }

  // Aviso no bloqueante: la validación de verdad la hace la operadora, acá
  // solo se adelanta el caso típico de haber escaneado el D-SN.
  function checkIdShape() {
    const value = (input.value || '').trim();
    if (!value || _ispIdLooksValid(value)) {
      if (feedback.classList.contains('shape-hint')) setFeedback('');
      return;
    }
    setFeedback(
      'Ese código no parece un serial GPON (4 letras + 8 caracteres) ni una MAC. ¿Estás usando el D-SN?',
      'warn',
    );
    feedback.classList.add('shape-hint');
  }

  consultBtn.addEventListener('click', consult);
  input.addEventListener('input', checkIdShape);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); consult(); }
  });
  checkIdShape();

  if (scanBtn) {
    scanBtn.addEventListener('click', async () => {
      scanBtn.disabled = true;
      scanBtn.textContent = 'Leyendo…';
      setFeedback('');
      try {
        const rawValues = await window.WifixNative.serialScanner.scanBarcodes();
        if (!rawValues || rawValues.length === 0) {
          setFeedback('No se detectó ningún código. Probá de nuevo o escribilo a mano.', 'warn');
        } else {
          // La etiqueta trae varios códigos (GPON SN, MAC, D-SN, EN): se elige
          // el único que ISP Monitor acepta.
          const picked = _ispPickTerminalId(rawValues);
          if (picked) {
            input.value = picked.id;
            checkIdShape();
            setFeedback(
              picked.kind === 'GPON'
                ? `Serial GPON detectado: ${picked.id}`
                : `MAC detectada: ${picked.id}`,
              'ok',
            );
          } else {
            // Mejor esfuerzo con el extractor genérico, para no dejar al
            // técnico sin nada si la etiqueta usa otro formato.
            const result = extractSerial(rawValues, '');
            if (result.serial) {
              input.value = result.serial;
              checkIdShape();
              setFeedback(
                `Se leyó ${result.serial}, pero no tiene forma de serial GPON ni de MAC. ` +
                  'Revisá que no sea el D-SN ni el EN.',
                'warn',
              );
            } else {
              setFeedback('No se pudo interpretar el código leído.', 'warn');
            }
          }
        }
      } catch (err) {
        console.error('[Wifix] isp scanBarcodes', err);
        setFeedback('Error al escanear.', 'error');
      } finally {
        scanBtn.disabled = false;
        scanBtn.textContent = 'Escanear';
      }
    });
  }

  // Si ya se consultó este equipo en esta sesión, se repinta sin volver a pedir.
  if (_ispState.data && _ispState.id === (input.value || '').trim()) {
    results.innerHTML = renderIspDiagnostics(_ispState.data);
  }
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
  { id: 'naps',    icon: SERVICIO_ICONS.nap,     title: 'NAPs cercanas y seleccion GPON Xtreme',
    load: () => loadNapPanel() },
  { id: 'status',  icon: SERVICIO_ICONS.user,    title: 'Status del cliente por contrato/cuenta',
    load: (cuenta) => WifixAPI.getContractStatus(cuenta).then(c => renderStatusFromContract(c, cuenta)) },
  { id: 'isp',     icon: SERVICIO_ICONS.metrics, title: 'ISP Monitor — señal, SNR, FEC y caídas 24 h',
    load: (cuenta) => renderIspPanel(cuenta) },
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
        // Al abrir el panel NAP por primera vez, asegurar que el taskId
        // se genere fresco (renderNapPanel lo crea si es null).
        if (id === 'naps') {
          _napPanelState.taskId = null;
          _napPanelState.openedAt = null;
        }
        body.innerHTML = `<div class="detail-loading">Cargando…</div>`;
        try {
          body.innerHTML = await item.load(cuenta);
          body.dataset.loaded = '1';
          if (id === 'naps') {
            _bootNapPanel(body);
          } else if (id === 'isp') {
            _bootIspPanel(body, cuenta);
          } else {
            wireNapPortsButtons(body);
          }
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

// --- Ping en vivo (consola CMD) -----------------------------------------------
function pingLiveHtml() {
  return `
    <div class="tool-form" data-tool="ping-live">
      <label class="form-row">
        <span class="form-label">Destino</span>
        <input type="text" data-field="liveHost" value="8.8.8.8"
               placeholder="8.8.8.8" autocomplete="off" spellcheck="false"
               aria-label="Dirección IP o nombre de host para ping en vivo">
      </label>
      <div class="live-console-toolbar" role="group" aria-label="Controles de ping en vivo">
        <button class="live-btn live-btn-start" data-action="live-start"
                type="button" aria-label="Iniciar ping continuo">
          Iniciar ping
        </button>
        <button class="live-btn live-btn-stop" data-action="live-stop"
                type="button" disabled aria-label="Detener ping">
          Detener
        </button>
        <button class="live-btn live-btn-clear" data-action="live-clear"
                type="button" aria-label="Limpiar consola">
          Limpiar
        </button>
        <button class="live-btn live-btn-expand" data-action="live-fullscreen"
                type="button" aria-label="Pantalla completa" aria-pressed="false">
          Pantalla completa
        </button>
      </div>
      <div class="live-stats" data-slot="stats" aria-live="polite" aria-atomic="true"></div>
      <div class="live-console" data-slot="console"
           role="log" aria-label="Salida del ping" aria-live="polite"></div>
    </div>`;
}

// --- Traceroute en vivo (consola CMD) -----------------------------------------
function tracerouteLiveHtml() {
  return `
    <div class="tool-form" data-tool="traceroute-live">
      <div class="form-grid-2">
        <label class="form-row">
          <span class="form-label">Destino</span>
          <input type="text" data-field="liveHost" value="8.8.8.8"
                 placeholder="8.8.8.8" autocomplete="off" spellcheck="false"
                 aria-label="Dirección IP o nombre de host para traceroute en vivo">
        </label>
        <label class="form-row">
          <span class="form-label">Max. saltos (20-30)</span>
          <input type="number" data-field="liveMaxHops" value="30" min="20" max="30" step="1"
                 aria-label="Número máximo de saltos">
        </label>
      </div>
      <div class="live-console-toolbar" role="group" aria-label="Controles de traceroute en vivo">
        <button class="live-btn live-btn-start" data-action="live-start"
                type="button" aria-label="Iniciar traceroute">
          Iniciar traceroute
        </button>
        <button class="live-btn live-btn-stop" data-action="live-stop"
                type="button" disabled aria-label="Detener traceroute">
          Detener
        </button>
        <button class="live-btn live-btn-clear" data-action="live-clear"
                type="button" aria-label="Limpiar consola">
          Limpiar
        </button>
        <button class="live-btn live-btn-expand" data-action="live-fullscreen"
                type="button" aria-label="Pantalla completa" aria-pressed="false">
          Pantalla completa
        </button>
      </div>
      <div class="live-console" data-slot="console"
           role="log" aria-label="Salida del traceroute" aria-live="polite"></div>
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

const HERRAMIENTAS_ITEMS = [
  { id: 'speedtest', title: 'Test de Velocidad', icon: TOOL_ICONS.speed,
    render: speedtestFormHtml, collect: collectSpeedtest,
    save: (acct, payload) => WifixAPI.createSpeedtest(acct, payload) },
  { id: 'heatmap', title: 'Medición de Señal WiFi', icon: TOOL_ICONS.heatmap,
    render: heatmapFormHtml, collect: collectHeatmap,
    save: (acct, payload) => WifixAPI.createWifiHeatmap(acct, payload) },
  // Herramientas de diagnóstico en vivo — solo pantalla, sin guardado en backend.
  { id: 'ping-live', title: 'Ping en Vivo (CMD)', icon: TOOL_ICONS.terminal,
    render: pingLiveHtml },
  { id: 'traceroute-live', title: 'Traceroute en Vivo (CMD)', icon: TOOL_ICONS.terminal,
    render: tracerouteLiveHtml },
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

  const saveBtn = formEl.querySelector('[data-action="save"]');
  if (!saveBtn) return;   // Herramientas solo-diagnóstico (sin guardado en backend)
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
// Equipos Retirados — detección automática de serial por cámara/OCR
// ============================================================================

/** Patrones de serial por nombre de modelo (key = nombre exacto de la API). */
const SERIAL_PATTERNS = {
  'Decodificadores':       { re: /^[A-Z0-9]{12}$/,        len: 12 },
  'Decodificadores HD':    { re: /^[A-Z0-9]{12}$/,        len: 12 },
  'MTA':                   { re: /^[A-Z0-9]{15}$/,        len: 15 },
  'ONU B2000':             { re: /^XPON[A-Z0-9]{8}$/,     len: 12 },
  'ONT Huawei OptiXstar':  { re: /^HWTC[0-9A-F]{8}$/i,    len: 12 },
  'Router Huawei':         { re: /^[A-Z0-9]{16}$/,        len: 16 },
  'ONU300G':               { re: /^STGU[A-Z0-9]{8}$/,     len: 12 },
  'ONU HUR':               { re: /^STGU[A-Z0-9]{8}$/,     len: 12 },
  'ONT ZTE (todas)':       { re: /^ZTEG[0-9A-F]{8}$/i,    len: 12 },
  'Router ZTE':            { re: /^ZTEL[A-Z0-9]{12}$/,    len: 16 },
};

/** Patrón laxo cuando el modelo no tiene entrada en SERIAL_PATTERNS. */
const SERIAL_PATTERN_FALLBACK = { re: /^[A-Z0-9]{6,20}$/, len: 10 };

/**
 * Devuelve true si el modelo tiene un patrón DISTINTIVO (prefijo literal fijo
 * al inicio del regex, ej. XPON, HWTC, STGU, ZTEG, ZTEL).
 * Los patrones puramente genéricos (solo-largo, ej. ^[A-Z0-9]{12}$) devuelven false.
 * Se detecta comprobando si la source del regex contiene al menos una letra A-Z
 * literal al inicio (antes de cualquier cuantificador o clase de caracteres).
 *
 * @param {string} modelName
 * @returns {boolean}
 */
function isDistinctivePattern(modelName) {
  const entry = SERIAL_PATTERNS[modelName];
  if (!entry) return false;
  // La source empieza con "^" y luego letras literales concretas (no "[")
  return /^\^[A-Z]{2,}/.test(entry.re.source);
}

/**
 * Dado un array de candidatos YA limpios (upper/trim/sin labels/sin espacios),
 * devuelve los nombres de modelo cuyos patrones DISTINTIVOS matchean algún candidato.
 * Ignora patrones genéricos (solo-largo) para no generar falsos positivos.
 *
 * @param {string[]} cleanedCandidates
 * @returns {string[]} nombres de modelo únicos detectados
 */
function detectModelsFromCandidates(cleanedCandidates) {
  const detected = [];
  for (const [name] of Object.entries(SERIAL_PATTERNS)) {
    if (!isDistinctivePattern(name)) continue;
    const { re } = SERIAL_PATTERNS[name];
    if (cleanedCandidates.some(c => re.test(c))) {
      detected.push(name);
    }
  }
  // Deduplicar (puede haber modelos con el mismo patrón, ej. ONU300G y ONU HUR)
  return [...new Set(detected)];
}

/** Rótulos a quitar del inicio de cada candidato (orden largo a corto). */
const SERIAL_LABELS = ['HOST SN', 'GPON SN', 'PON SN', 'D-SN', 'S/N', 'SN'];
const _LABEL_RE = new RegExp(
  '^(' + SERIAL_LABELS.map(l => l.replace(/[/\\]/g, '\\$&')).join('|') + ')\\s*:?\\s*',
  'i'
);

/**
 * Convierte un dataURL (p.ej. "data:image/jpeg;base64,....") a un objeto File.
 * Usado para subir la foto tomada con WifixNative.takePhoto() como evidencia.
 *
 * @param {string} dataUrl  - dataURL con prefijo "data:<mime>;base64,<datos>"
 * @param {string} filename - nombre de archivo resultante (ej. "serial.jpg")
 * @returns {File}
 */
function dataUrlToFile(dataUrl, filename) {
  const [header, data] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)[1];
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new File([bytes], filename, { type: mime });
}

/**
 * Dado un array de strings crudos (barcode rawValues o líneas de OCR) y el
 * nombre del modelo seleccionado, devuelve el mejor serial posible.
 *
 * Retorna:
 *   {
 *     serial:         string,
 *     confidence:     'ok' | 'warn' | 'mismatch',
 *     candidates:     string[],   // los que matchean el patrón (o mejor esfuerzo si warn)
 *     cleaned:        string[],   // todos los candidatos limpios (para reuso)
 *     detectedModels: string[],   // modelos detectados por patrones distintivos
 *   }
 *
 * confidence:
 *   'ok'       → al menos un candidato matchea el patrón del modelo seleccionado.
 *   'warn'     → ningún candidato matchea; se devuelve mejor esfuerzo por longitud.
 *                Se usa cuando el modelo es genérico/fallback (sin prefijo distintivo),
 *                o cuando no se detectó ningún modelo con patrón distintivo.
 *   'mismatch' → el modelo seleccionado tiene patrón DISTINTIVO, no hay match, pero
 *                sí se detectó al menos un modelo DIFERENTE en los candidatos limpios.
 *                Indica que la foto/código es de otro equipo.
 */
function extractSerial(rawCandidates, modelName) {
  const pattern = SERIAL_PATTERNS[modelName] || SERIAL_PATTERN_FALLBACK;

  const cleaned = rawCandidates
    .map(r => r.toUpperCase().trim())
    .map(r => r.replace(_LABEL_RE, ''))
    .map(r => r.replace(/\s+/g, ''));

  const matches = [...new Set(cleaned.filter(c => pattern.re.test(c)))];

  if (matches.length >= 1) {
    return {
      serial: matches[0],
      confidence: 'ok',
      candidates: matches,
      cleaned,
      detectedModels: [],
    };
  }

  // Sin match exacto: calcular mejor esfuerzo y detectar modelos alternativos
  const bestEffort = cleaned
    .filter(c => c.length >= 4)
    .sort((a, b) => Math.abs(a.length - pattern.len) - Math.abs(b.length - pattern.len));

  const best = bestEffort[0] || '';
  const detectedModels = detectModelsFromCandidates(cleaned);

  // Determinar si hay mismatch claro:
  //   - El modelo seleccionado tiene patrón distintivo (o no hay modelo y se detectó uno)
  //   - Se detectó al menos un modelo diferente al seleccionado
  const isMismatch =
    (isDistinctivePattern(modelName) && detectedModels.length > 0 &&
      detectedModels.some(d => d !== modelName)) ||
    (!modelName && detectedModels.length === 1);

  if (isMismatch) {
    return {
      serial: best,            // valor de "mejor esfuerzo" disponible pero NO autorellenar
      confidence: 'mismatch',
      candidates: bestEffort.slice(0, 5),
      cleaned,
      detectedModels,
    };
  }

  return {
    serial: best,
    confidence: 'warn',
    candidates: bestEffort.slice(0, 5),
    cleaned,
    detectedModels,
  };
}

/** Devuelve true si el puente nativo de escaneo está disponible. */
function serialScannerAvailable() {
  return !!(
    window.WifixNative &&
    window.WifixNative.serialScanner &&
    typeof window.WifixNative.serialScanner.available === 'function' &&
    window.WifixNative.serialScanner.available()
  );
}

async function openRetirados() {
  const cuenta = currentAccount() || `WX-${randInt(100000, 999999)}`;
  retiradosChip.textContent = cuenta;

  const nativeAvailable = serialScannerAvailable();

  retiradosForm.innerHTML = `
    <div class="tool-form" data-form="retired">

      <label class="form-row"><span class="form-label">Modelo del equipo *</span>
        <select data-field="equipmentModelId"><option value="">Cargando...</option></select></label>

      <label class="form-row"><span class="form-label">Motivo de retiro *</span>
        <select data-field="removalReasonCode"><option value="">Cargando...</option></select></label>

      <!-- Bloque de detección de serial -->
      <div class="serial-detect-block" data-slot="serialBlock">

        ${nativeAvailable ? `
        <p class="serial-browser-note">Escaneá el código o tomá una foto del serial (opcional)</p>
        <div class="serial-actions">
          <button type="button" class="serial-action-btn scan-serial-btn" data-action="scanSerial" disabled
            aria-label="Escanear serial con cámara">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3m0 4h4v-4m-7 4h3"/></svg>
            Escanear serial
          </button>
          <button type="button" class="serial-action-btn ocr-fallback-btn" data-action="ocrFallback" disabled
            aria-label="Tomar foto del serial para detectarlo con OCR">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
            Tomar foto
          </button>
        </div>
        ` : `
        <p class="serial-browser-note">Escaneo disponible solo en la app</p>
        <button type="button" class="serial-action-btn ocr-fallback-btn" data-action="ocrFallback"
          aria-label="Tomar foto del serial para detectarlo con OCR">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          Tomar foto
        </button>
        `}

        <input type="file" accept="image/*" capture="environment"
          data-slot="ocrFileInput" style="display:none" aria-hidden="true" tabindex="-1">

        <div class="serial-result-row" data-slot="serialResultRow" style="display:none">
          <span class="serial-confidence-badge" data-slot="serialBadge"></span>
          <select class="serial-candidates-select" data-slot="serialCandidatesSelect" style="display:none"
            aria-label="Candidatos de serial detectados"></select>
        </div>

        <label class="form-row">
          <span class="form-label" id="serialValueLabel">Número de serie *</span>
          <input type="text" data-field="serialValue" placeholder="${nativeAvailable ? 'Escanear para detectar' : '48575443A1B2C3D4'}"
            aria-labelledby="serialValueLabel" autocomplete="off" autocapitalize="characters" spellcheck="false">
        </label>

      </div>
      <!-- /Bloque de detección de serial -->

      <label class="form-row"><span class="form-label">Observaciones</span>
        <textarea data-field="observations" rows="3" placeholder="Detalles del retiro"></textarea></label>

      <label class="form-row"><span class="form-label">Foto de evidencia (opcional)</span>
        <input type="file" accept="image/jpeg,image/png" data-field="barcodePhoto"></label>
      <div class="barcode-status" data-slot="barcodeStatus"></div>

      <button class="save-btn" data-action="save">Guardar retiro</button>
    </div>`;

  const formEl     = retiradosForm.querySelector('[data-form="retired"]');
  const modelSel   = formEl.querySelector('[data-field="equipmentModelId"]');
  const reasonSel  = formEl.querySelector('[data-field="removalReasonCode"]');
  const serialInput  = formEl.querySelector('[data-field="serialValue"]');
  const scanBtn      = formEl.querySelector('[data-action="scanSerial"]');
  const ocrBtn       = formEl.querySelector('[data-action="ocrFallback"]');
  // HTML de reposo del botón fallback (ícono + texto); se reutiliza en todos los resets
  const OCR_BTN_IDLE_HTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg> Tomar foto`;
  const ocrFileInput = formEl.querySelector('[data-slot="ocrFileInput"]');
  const serialResultRow      = formEl.querySelector('[data-slot="serialResultRow"]');
  const serialBadge          = formEl.querySelector('[data-slot="serialBadge"]');
  const serialCandidatesSel  = formEl.querySelector('[data-slot="serialCandidatesSelect"]');
  const fileInput     = formEl.querySelector('[data-field="barcodePhoto"]');
  const barcodeStatus = formEl.querySelector('[data-slot="barcodeStatus"]');
  const saveBtn       = formEl.querySelector('[data-action="save"]');

  // Mapa id->nombre para el algoritmo de extracción
  const modelNameById = {};

  // ---- Carga de catálogos --------------------------------------------------
  try {
    const [models, reasons] = await Promise.all([
      WifixAPI.listEquipmentModels(),
      WifixAPI.listRemovalReasons(),
    ]);
    models.filter(m => m.active).forEach(m => { modelNameById[m.id] = m.name; });
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

  // ---- Habilitar botones de captura cuando hay modelo elegido ---------------
  modelSel.addEventListener('change', () => {
    if (scanBtn) scanBtn.disabled = !modelSel.value;
    if (ocrBtn)  ocrBtn.disabled  = !modelSel.value;
  });

  // ---- Slot de sugerencia de modelo (mismatch) — se crea una sola vez ------
  let mismatchHint = serialResultRow.querySelector('[data-slot="mismatchHint"]');
  if (!mismatchHint) {
    mismatchHint = document.createElement('div');
    mismatchHint.setAttribute('data-slot', 'mismatchHint');
    mismatchHint.setAttribute('role', 'alert');
    mismatchHint.setAttribute('aria-live', 'polite');
    mismatchHint.className = 'serial-mismatch-hint';
    mismatchHint.style.display = 'none';
    serialResultRow.appendChild(mismatchHint);
  }

  // ---- Aplica resultado de extracción al formulario -----------------------
  function applySerialResult(result) {
    serialResultRow.style.display = '';

    // Limpiar sugerencia de mismatch de ejecuciones previas
    mismatchHint.style.display = 'none';
    mismatchHint.innerHTML = '';

    if (result.confidence === 'ok') {
      serialBadge.textContent = '✓ Detectado';
      serialBadge.className = 'serial-confidence-badge ok';
    } else if (result.confidence === 'mismatch') {
      serialBadge.textContent = '⚠ Tu modelo no coincide con la foto. Elegí el modelo correcto.';
      serialBadge.className = 'serial-confidence-badge warn';
    } else {
      // 'warn'
      serialBadge.textContent = '⚠ Verificá el serial';
      serialBadge.className = 'serial-confidence-badge warn';
    }

    if (result.confidence === 'mismatch') {
      // NO autorellenar el input con el valor dudoso
      serialCandidatesSel.style.display = 'none';

      // Mostrar sugerencia si hay modelo detectado
      if (result.detectedModels && result.detectedModels.length >= 1) {
        const suggestedName = result.detectedModels[0];

        // Buscar el id del modelo sugerido en el select
        let suggestedId = '';
        for (const [id, name] of Object.entries(modelNameById)) {
          if (name === suggestedName) { suggestedId = id; break; }
        }

        const nameEsc = escapeHtml(suggestedName);
        mismatchHint.innerHTML =
          `<span class="serial-mismatch-hint__text">Parece un ${nameEsc}</span>` +
          (suggestedId
            ? `<button type="button" class="serial-mismatch-hint__btn"
                 data-suggested-id="${escapeHtml(suggestedId)}"
                 data-suggested-name="${nameEsc}">Usar ${nameEsc}</button>`
            : '');
        mismatchHint.style.display = 'flex';

        // Listener del botón "Usar {modelo}"
        const usarBtn = mismatchHint.querySelector('[data-suggested-id]');
        if (usarBtn) {
          usarBtn.addEventListener('click', () => {
            const newId   = usarBtn.dataset.suggestedId;
            const newName = usarBtn.dataset.suggestedName;

            // (a) Setear el modelo en el select
            modelSel.value = newId;
            // (b) Disparar change para re-habilitar el botón de escanear
            modelSel.dispatchEvent(new Event('change'));
            // (c) Re-evaluar con el modelo correcto usando los candidatos limpios
            applySerialResult(extractSerial(result.cleaned, newName));
          }, { once: true });
        }
      }

      serialInput.focus();
      return;
    }

    // confidence 'ok' o 'warn': comportamiento original
    if (result.candidates.length > 1) {
      serialCandidatesSel.style.display = '';
      serialCandidatesSel.innerHTML = result.candidates
        .map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
      serialCandidatesSel.value = result.serial;
      serialInput.value = result.serial;
      serialCandidatesSel.addEventListener('change', () => {
        serialInput.value = serialCandidatesSel.value;
      }, { once: false });
    } else {
      serialCandidatesSel.style.display = 'none';
      serialInput.value = result.serial;
    }

    serialInput.focus();
  }

  // ---- Botón "Escanear serial" (nativo) ------------------------------------
  if (scanBtn) {
    scanBtn.addEventListener('click', async () => {
      const modelName = modelNameById[modelSel.value] || '';
      scanBtn.disabled = true;
      scanBtn.textContent = 'Leyendo...';
      try {
        const rawValues = await window.WifixNative.serialScanner.scanBarcodes();
        if (!rawValues || rawValues.length === 0) {
          serialBadge.className = 'serial-confidence-badge warn';
          serialBadge.textContent = '⚠ No se detectó código';
          serialResultRow.style.display = '';
        } else {
          applySerialResult(extractSerial(rawValues, modelName));
        }
      } catch (err) {
        console.error('[Wifix] scanBarcodes:', err);
        serialBadge.className = 'serial-confidence-badge warn';
        serialBadge.textContent = '⚠ Error al escanear';
        serialResultRow.style.display = '';
      } finally {
        scanBtn.disabled = !modelSel.value;
        scanBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3m0 4h4v-4m-7 4h3"/></svg> Escanear serial`;
      }
    });
  }

  // ---- Fallback OCR: "No se pudo leer — usar foto" -------------------------
  //
  // APK + WifixNative.takePhoto disponible:
  //   → llama takePhoto() para abrir la cámara nativa, pide permiso en el momento,
  //     corre OCR sobre el dataURL devuelto y sube la misma foto como evidencia.
  //
  // Navegador (o APK sin takePhoto):
  //   → comportamiento original con <input type="file" capture="environment">.
  //
  const useNativeCamera = nativeAvailable && typeof window.WifixNative?.takePhoto === 'function';

  if (ocrBtn) {
    if (useNativeCamera) {
      // ----- Ruta APK: cámara nativa ----------------------------------------
      ocrBtn.addEventListener('click', async () => {
        const modelName = modelNameById[modelSel.value] || '';

        ocrBtn.disabled = true;
        ocrBtn.textContent = 'Abriendo cámara...';

        let dataUrl = null;
        try {
          dataUrl = await window.WifixNative.takePhoto();
        } catch (err) {
          console.error('[Wifix] takePhoto:', err);
          serialBadge.className = 'serial-confidence-badge warn';
          serialBadge.textContent = '⚠ Error al acceder a la cámara';
          serialResultRow.style.display = '';
          ocrBtn.disabled = false;
          ocrBtn.innerHTML = OCR_BTN_IDLE_HTML;
          return;
        }

        if (!dataUrl) {
          // Cancelado por el usuario o permiso denegado
          serialBadge.className = 'serial-confidence-badge warn';
          serialBadge.textContent = '⚠ No se tomó ninguna foto';
          serialResultRow.style.display = '';
          ocrBtn.disabled = false;
          ocrBtn.innerHTML = OCR_BTN_IDLE_HTML;
          return;
        }

        ocrBtn.textContent = 'Procesando foto...';

        try {
          // a) OCR: la API espera base64 sin prefijo de dataURL
          const base64 = dataUrl.split(',').pop();
          const lines = await window.WifixNative.serialScanner.ocrFromImageBase64(base64);
          if (!lines || lines.length === 0) {
            serialBadge.className = 'serial-confidence-badge warn';
            serialBadge.textContent = '⚠ No se encontró texto en la foto';
            serialResultRow.style.display = '';
          } else {
            applySerialResult(extractSerial(lines, modelName));
          }

          // b) Subir la misma foto como evidencia (barcodePhotoId)
          ocrBtn.textContent = 'Subiendo foto...';
          try {
            const photoFile = dataUrlToFile(dataUrl, 'serial.jpg');
            const media = await WifixAPI.uploadMedia(photoFile);
            uploadedPhotoId = media.id;
            barcodeStatus.textContent = '✓ Foto tomada y subida';
            barcodeStatus.className = 'barcode-status ok';
          } catch (uploadErr) {
            console.error('[Wifix] upload takePhoto:', uploadErr);
            barcodeStatus.textContent = '⚠ Foto procesada pero no se pudo subir';
            barcodeStatus.className = 'barcode-status';
          }
        } catch (err) {
          console.error('[Wifix] ocrFromImageBase64 (takePhoto):', err);
          serialBadge.className = 'serial-confidence-badge warn';
          serialBadge.textContent = '⚠ Error al procesar la foto';
          serialResultRow.style.display = '';
        } finally {
          ocrBtn.disabled = false;
          ocrBtn.innerHTML = OCR_BTN_IDLE_HTML;
        }
      });

    } else if (ocrFileInput) {
      // ----- Ruta navegador: <input type="file" capture="environment"> -------
      ocrBtn.addEventListener('click', () => { ocrFileInput.click(); });

      ocrFileInput.addEventListener('change', async () => {
        const file = ocrFileInput.files && ocrFileInput.files[0];
        if (!file) return;
        const modelName = modelNameById[modelSel.value] || '';

        ocrBtn.disabled = true;
        ocrBtn.textContent = 'Procesando foto...';

        try {
          const base64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              // Quitar prefijo "data:image/...;base64," si lo hay
              const result = reader.result;
              resolve(typeof result === 'string' ? result.split(',').pop() : '');
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });

          const lines = await window.WifixNative.serialScanner.ocrFromImageBase64(base64);
          if (!lines || lines.length === 0) {
            serialBadge.className = 'serial-confidence-badge warn';
            serialBadge.textContent = '⚠ No se encontró texto en la foto';
            serialResultRow.style.display = '';
          } else {
            applySerialResult(extractSerial(lines, modelName));
          }
        } catch (err) {
          console.error('[Wifix] ocrFromImageBase64:', err);
          serialBadge.className = 'serial-confidence-badge warn';
          serialBadge.textContent = '⚠ Error al procesar la foto';
          serialResultRow.style.display = '';
        } finally {
          ocrBtn.disabled = false;
          ocrBtn.innerHTML = OCR_BTN_IDLE_HTML;
          ocrFileInput.value = '';
        }
      });
    }
  }

  // ---- Foto de evidencia (upload al servidor) ------------------------------
  let uploadedPhotoId = null;
  fileInput.addEventListener('change', async () => {
    uploadedPhotoId = null;
    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      barcodeStatus.textContent = '';
      return;
    }
    barcodeStatus.textContent = 'Subiendo foto...';
    barcodeStatus.className = 'barcode-status';
    try {
      const media = await WifixAPI.uploadMedia(file);
      uploadedPhotoId = media.id;
      barcodeStatus.textContent = `✓ Foto cargada (${Math.round((media.sizeBytes || file.size) / 1024)} KB)`;
      barcodeStatus.classList.add('ok');
    } catch (err) {
      console.error('[Wifix] upload media:', err);
      barcodeStatus.textContent = `✗ ${err.message || 'No se pudo subir la foto.'}`;
      barcodeStatus.classList.add('fail');
    }
  });

  // ---- Guardar retiro ------------------------------------------------------
  saveBtn.addEventListener('click', async () => {
    const acct = currentAccount();
    if (!acct) {
      showSaveFeedback(saveBtn, 'Falta nº de cuenta', false);
      return;
    }
    const serial   = nonEmpty(serialInput.value);
    const modelId  = modelSel.value;
    const reasonCode = reasonSel.value;
    if (!serial || !modelId || !reasonCode) {
      showSaveFeedback(saveBtn, 'Completa serie, modelo y motivo', false);
      return;
    }

    // Guard: si el modelo tiene patrón DISTINTIVO, el serial debe matchearlo.
    // Evita guardar un serial de otro equipo cuando el backend no valida el formato.
    const modelName = modelNameById[modelId] || '';
    if (isDistinctivePattern(modelName)) {
      const cleanedSerial = serial.toUpperCase().replace(/\s+/g, '');
      if (!SERIAL_PATTERNS[modelName].re.test(cleanedSerial)) {
        showSaveFeedback(saveBtn, 'Tu modelo no coincide con la foto. Elegí el modelo correcto.', false);
        return;
      }
    }
    const payload = {
      serialValue:        serial,
      equipmentModelId:   modelId,
      removalReasonCode:  reasonCode,
      observations:       nonEmpty(formEl.querySelector('[data-field="observations"]').value),
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
