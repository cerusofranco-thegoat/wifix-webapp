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

// Módulos del menú principal: cada uno decide qué secciones ve el técnico.
// - cards: sub-tarjetas visibles (data-sub del #subscreen).
// - servicio: ids de SERVICIO_ITEMS que se muestran en Datos del Servicio;
//   null = todos. Si la tarjeta 'servicio' no está en cards, no se usa.
// Instalaciones y Migraciones comparten secciones: en la migración el técnico
// instala lo nuevo y retira el equipo anterior (Equipos Retirados es clave).
// 'equipo' = Equipo a instalar (validación de capacidad vs plan contratado).
const INSTALL_SECTIONS = Object.freeze({
  cards: Object.freeze(['personales', 'servicio', 'equipo', 'herramientas', 'retirados']),
  servicio: Object.freeze(['naps', 'events']),
});

const MODULES = {
  instalaciones: {
    eyebrow: 'Categoría', title: 'Instalaciones', label: 'Instalaciones',
    ...INSTALL_SECTIONS,
  },
  migraciones: {
    eyebrow: 'Categoría', title: 'Migraciones', label: 'Migraciones',
    ...INSTALL_SECTIONS,
    // Además de lo de Instalaciones: el contexto de la orden (como en FSM).
    servicio: Object.freeze(['order', 'naps', 'events']),
  },
  visitas: {
    eyebrow: 'Categoría', title: 'Visitas técnicas', label: 'Visita técnica',
    cards: ['personales', 'servicio', 'equipo', 'red', 'herramientas', 'retirados'],
    servicio: null,
  },
  cancelaciones: {
    eyebrow: 'Categoría', title: 'Cancelación de servicio', label: 'Cancelación',
    cards: ['personales', 'retirados'],
    servicio: [],
  },
};

let currentCategory = 'instalaciones';

function currentModule() {
  return MODULES[currentCategory] || MODULES.instalaciones;
}

// Nombre corto del módulo principal escogido. Es el eyebrow de TODAS las
// pantallas internas (Datos personales, Datos del servicio, Red interna,
// Herramientas, Equipos retirados): un solo punto de verdad, nada hardcodeado.
function moduleLabel(category = currentCategory) {
  const meta = MODULES[category] || MODULES.instalaciones;
  return meta.label || meta.title;
}

// Pinta el nombre del módulo en todos los [data-module-eyebrow] del DOM.
function applyModuleLabels() {
  const label = moduleLabel();
  document.querySelectorAll('[data-module-eyebrow]').forEach((el) => {
    el.textContent = label;
  });
  return label;
}

function moduleHasCard(sub) {
  return currentModule().cards.includes(sub);
}

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
    // Una sola llamada por sesión: el health es local del backend.
    loadFsmHealth().then(warnIfNoBrandAvailable);
  } catch (err) {
    console.error('[Wifix] login error:', err);
    loginError.textContent = err.message || 'No se pudo iniciar sesión.';
  } finally {
    loginSubmit.disabled = false;
    loginSubmit.textContent = 'Ingresar';
  }
});

// --- Puerta de servicio: URL del backend ------------------------------------
// 7 taps seguidos sobre el logo del login abren un prompt con la URL efectiva y
// permiten reemplazarla (se guarda en localStorage['wifix.backend.url']).
// Dejar el campo vacío borra el override y vuelve a la resolución automática.
// Sin UI propia a propósito: es para soporte/demo, no para el técnico.
const loginLogo = loginScreen.querySelector('.logo');
if (loginLogo) {
  const TAPS_REQUERIDOS = 7;
  const PAUSA_MAX_MS = 1200; // pausa máxima entre taps antes de reiniciar la cuenta
  let taps = 0;
  let ultimoTap = 0;
  loginLogo.addEventListener('click', () => {
    const ahora = Date.now();
    if (ahora - ultimoTap > PAUSA_MAX_MS) taps = 0;
    ultimoTap = ahora;
    taps += 1;
    if (taps < TAPS_REQUERIDOS) return;
    taps = 0;
    const actual = WifixAPI.getBaseUrl();
    const override = WifixAPI.getBaseUrlOverride();
    const entrada = window.prompt(
      `Backend actual:\n${actual}\n${override ? '(override manual)' : '(automático)'}\n\n` +
      'Escribí otra URL (http/https) o dejá vacío para usar la automática.',
      override || actual,
    );
    if (entrada === null) return; // Cancelar: no toca nada.
    const guardada = WifixAPI.setBaseUrl(entrada);
    if (entrada.trim() && !guardada) {
      // URL inválida: el override anterior sigue vigente a propósito.
      loginError.textContent = 'URL inválida: tiene que empezar con http:// o https://';
      window.alert('URL inválida. Se mantiene el backend anterior:\n' + WifixAPI.getBaseUrl());
      return;
    }
    loginError.textContent = '';
    window.alert('Backend en uso:\n' + WifixAPI.getBaseUrl());
  });
}

logoutBtn.addEventListener('click', () => {
  WifixAPI.logout();
  _fsmHealth = null;
  // La orden de trabajo es de la sesión del técnico: no pasa a otra sesión.
  _orderSession.clear();
  _visitTasks.clear();
  renderIntegrationWarning(null);
  // Cerrar todas las detail screens y el subscreen al cerrar sesión.
  document.querySelectorAll('.detailscreen, .subscreen').forEach((el) => {
    el.classList.remove('open');
    el.setAttribute('aria-hidden', 'true');
  });
  showLogin();
});

// Solo el 401 del JWT propio de Wifix llega acá. Los fallos de la integración
// con la operadora viajan como UPSTREAM_AUTH_ERROR (503) y NO cierran sesión.
window.addEventListener('wifix:unauthorized', () => {
  console.warn('[Wifix] sesión expirada, volviendo a login.');
  _fsmHealth = null;
  document.querySelectorAll('.detailscreen, .subscreen').forEach((el) => {
    el.classList.remove('open');
    el.setAttribute('aria-hidden', 'true');
  });
  showLogin();
  loginError.textContent = 'Tu sesión expiró. Vuelve a ingresar.';
});

// === Integración con la operadora (FSM) =====================================
// Disponibilidad de la integración. `health` es local del backend: NO consulta
// a la operadora, así que se pide una sola vez por sesión y se cachea en
// memoria. La marca (realm) no se muestra en la UI: api.js usa la que el
// backend tenga por defecto.
let _fsmHealth = null;
let _fsmHealthLoading = null;

// Sin selector de marca en la UI, una marca elegida en una versión anterior
// quedaría fija en localStorage sin que el técnico pueda verla ni cambiarla.
// Se limpia al arrancar para que siempre aplique la default del backend.
if (WifixAPI.getBrand()) WifixAPI.setBrand(null);

async function loadFsmHealth() {
  if (_fsmHealth) return _fsmHealth;
  if (_fsmHealthLoading) return _fsmHealthLoading;
  _fsmHealthLoading = (async () => {
    try {
      _fsmHealth = await WifixAPI.getFsmHealth();
    } catch (err) {
      // No bloquea nada: sin health no se avisa y el resto de la app
      // (Herramientas, Equipos Retirados) sigue igual.
      console.warn('[Wifix] fsm health:', err);
      _fsmHealth = null;
    } finally {
      _fsmHealthLoading = null;
    }
    return _fsmHealth;
  })();
  return _fsmHealthLoading;
}

// Banner de integración no disponible. No bloquea, no cierra sesión, no
// recarga: solo informa. El mensaje ya viene redactado en español del backend.
function renderIntegrationWarning(message) {
  document.querySelectorAll('[data-slot="integration-warning"]').forEach((slot) => {
    if (!message) {
      slot.innerHTML = '';
      slot.hidden = true;
      return;
    }
    slot.hidden = false;
    slot.innerHTML = `<div class="detail-warning" role="status">${escapeHtml(message)}</div>`;
  });
}

window.addEventListener('wifix:integration-unavailable', (ev) => {
  const detail = (ev && ev.detail) || {};
  console.warn('[Wifix] integración no disponible:', detail);
  renderIntegrationWarning(detail.message || 'La integración con la operadora no está disponible.');
});

// ¿Hay que avisar que la operadora no responde? `brands[].available` habla SOLO
// del token del conector: en modo mock/fixture el backend devuelve
// `requiresToken: false` y los datos fluyen igual, así que ahí NO se avisa.
// Si el campo no viene (backend viejo) se mantiene el comportamiento anterior.
function fsmHealthNeedsWarning(health) {
  if (!health) return false;
  if (health.requiresToken === false) return false;
  const brands = Array.isArray(health.brands) ? health.brands : [];
  return brands.filter(b => b && b.available === true).length === 0;
}

// Si al arrancar ninguna marca está disponible, se avisa una sola vez en el
// panel (nunca un modal: el técnico tiene que poder seguir trabajando).
function warnIfNoBrandAvailable() {
  if (!fsmHealthNeedsWarning(_fsmHealth)) return;
  const razones = (_fsmHealth.brands || []).map(b => b && b.reason).filter(Boolean);
  const detalle = razones.length ? ` (${razones.join(', ')})` : '';
  renderIntegrationWarning(
    'Los datos de la operadora no están disponibles en este momento' + detalle +
    '. El resto de la app funciona con normalidad.',
  );
}

// Sesión ya abierta al cargar la app: se pide el health una sola vez.
if (WifixAPI.isAuthenticated()) {
  loadFsmHealth().then(warnIfNoBrandAvailable);
}

// === Categorías =============================================================
function selectModule(type) {
  if (!MODULES[type]) return false;

  // Cambiar de módulo descarta la cuenta confirmada: el técnico vuelve a
  // confirmarla para no arrastrar el estado de otra gestión.
  if (type !== currentCategory) invalidateAccountCache();
  currentCategory = type;

  const meta = currentModule();
  subEyebrow.textContent = meta.eyebrow;
  subHeading.textContent = meta.title;
  applyModuleLabels();
  applyModuleVisibility();
  renderVisitTaskGate();
  return true;
}

cards.forEach(card => {
  card.addEventListener('click', () => {
    if (!selectModule(card.dataset.type)) return;
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
// Línea de la whitelist de Xtrim bajo el feedback de Confirmar cuenta.
const confirmAccountWhitelist = document.getElementById('confirmAccountWhitelist');

// Cache del perfil validado. Se invalida al cambiar el número de cuenta.
let validatedProfile = null;
let validatedAccount = null;

function invalidateAccountCache() {
  validatedProfile = null;
  validatedAccount = null;
  const subGrid = subscreen.querySelector('.sub-grid');
  if (subGrid) {
    subGrid.classList.remove('account-confirmed');
    subGrid.classList.remove('account-limited');
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
  clearWhitelistLine();
  // Línea de la orden (se lee del DOM: esta función corre antes de que se
  // declaren las constantes de la sección de orden).
  const orderLine = document.getElementById('accountOrderLine');
  if (orderLine) {
    orderLine.innerHTML = '';
    orderLine.hidden = true;
  }
  // Tarjeta del Nº de task (Visita técnica): sin cuenta confirmada no se ve.
  const taskGate = document.getElementById('visitTaskGate');
  if (taskGate) {
    taskGate.innerHTML = '';
    taskGate.hidden = true;
  }
  accountInput.removeAttribute('aria-invalid');
  accountInput.removeAttribute('aria-describedby');
  // Sin cuenta confirmada no se muestra estado de equipo (el estado por
  // cuenta se conserva: al reconfirmar la misma cuenta el bloqueo vuelve).
  devRefreshIndicators();
}

function clearWhitelistLine() {
  if (!confirmAccountWhitelist) return;
  confirmAccountWhitelist.innerHTML = '';
  confirmAccountWhitelist.className = 'confirm-account-whitelist';
  confirmAccountWhitelist.hidden = true;
}

// Solo se habilitan las tarjetas del módulo actual: las ocultas siguen
// deshabilitadas y fuera del orden de tabulación.
function enableSubCards() {
  const subGrid = subscreen.querySelector('.sub-grid');
  if (!subGrid) return;
  subGrid.querySelectorAll('.sub-card').forEach((c) => {
    if (!moduleHasCard(c.dataset.sub)) return;
    c.removeAttribute('aria-disabled');
    c.removeAttribute('tabindex');
  });
}

// Muestra solo las sub-tarjetas que pertenecen al módulo actual.
function applyModuleVisibility() {
  subscreen.querySelectorAll('.sub-card').forEach((c) => {
    const visible = moduleHasCard(c.dataset.sub);
    c.hidden = !visible;
    if (visible) {
      c.removeAttribute('aria-hidden');
    } else {
      c.setAttribute('aria-hidden', 'true');
    }
  });
}

accountInput.addEventListener('input', () => {
  inputWrap.classList.toggle('has-value', accountInput.value.length > 0);
  invalidateAccountCache();
  clearLookupResults();
});
clearAccount.addEventListener('click', () => {
  accountInput.value = '';
  inputWrap.classList.remove('has-value');
  invalidateAccountCache();
  clearLookupResults();
  accountInput.focus();
});

// Las tarjetas arrancan deshabilitadas para a11y; se habilitan al confirmar cuenta.
invalidateAccountCache();
applyModuleVisibility();

// === Confirmar cuenta ========================================================
const confirmAccountBtn = document.getElementById('confirmAccount');
const confirmAccountFeedback = document.getElementById('confirmAccountFeedback');

confirmAccountBtn.addEventListener('click', () => {
  if (accountEntryMode === 'document') lookupByDocumentFlow();
  else if (accountEntryMode === 'order') lookupByOrderFlow();
  else confirmAccountFlow();
});

// === Ingresar por: Nº de cuenta / Cédula-RUC / Nº de orden ===================
// Por cédula se buscan las cuentas del titular (POST /accounts/lookup) y la
// elegida sigue EXACTAMENTE el flujo de Confirmar cuenta (whitelist, regla de
// Cancelaciones, modo limitado ante 503). El documento nunca se guarda: al
// elegir la cuenta el campo pasa a mostrar el nº de cuenta.
// Por nº de orden (POST /accounts/lookup { order }, TYTAN simulado) la orden
// trae exactamente una cuenta, que sigue el mismo flujo; el workOrder queda
// en la sesión de esa cuenta para el contexto de orden y la task de la visita.
const entryModeGroup = document.getElementById('entryMode');
const accountFieldHint = document.getElementById('accountFieldHint');
const accountLookupResults = document.getElementById('accountLookupResults');
const accountOrderLine = document.getElementById('accountOrderLine');

const ENTRY_MODES = Object.freeze({
  account: Object.freeze({ hint: 'Nº de cuenta', placeholder: 'Ingresa el número de cuenta',
    maxlength: 20, inputmode: 'numeric', button: 'Confirmar cuenta' }),
  document: Object.freeze({ hint: 'Cédula o RUC del titular', placeholder: 'Cédula (10 dígitos) o RUC (13)',
    maxlength: 32, inputmode: 'numeric', button: 'Buscar cuentas' }),
  order: Object.freeze({ hint: 'Nº de orden de trabajo', placeholder: 'ORDER/463158/2026 o 463158',
    maxlength: 32, inputmode: 'text', button: 'Buscar orden' }),
});

// === Orden de trabajo de la sesión (TYTAN simulado) ==========================
// cuenta → { workOrder, source: 'lookup' | 'module' }. Vive mientras dure la
// sesión: cambiar de módulo NO la borra (la orden sigue siendo de esa cuenta);
// el técnico puede cambiarla dentro de Visita técnica / Migraciones.
const _orderSession = new Map();

function sessionWorkOrder(cuenta) {
  const hit = cuenta ? _orderSession.get(String(cuenta).trim()) : null;
  return hit ? hit.workOrder : null;
}

function setSessionWorkOrder(cuenta, workOrder, source) {
  const c = String(cuenta || '').trim();
  if (!c) return;
  if (!workOrder) _orderSession.delete(c);
  else _orderSession.set(c, { workOrder: String(workOrder), source: source || 'module' });
  renderAccountOrderLine(c);
  // La task validada es de la orden: si la orden cambió, se vuelve a pedir.
  if (validatedAccount === c) renderVisitTaskGate();
}

/** Línea "Orden ORDER/… · TYTAN (simulado)" bajo Confirmar cuenta. */
function renderAccountOrderLine(cuenta) {
  if (!accountOrderLine) return;
  const confirmada = validatedAccount && validatedAccount === String(cuenta || '').trim();
  const wo = confirmada ? sessionWorkOrder(cuenta) : null;
  if (!wo) {
    accountOrderLine.innerHTML = '';
    accountOrderLine.hidden = true;
    return;
  }
  accountOrderLine.innerHTML = `<span class="order-line-key">Orden</span>` +
    `<span class="order-line-value mono">${escapeHtml(wo)}</span>` +
    `<span class="sim-badge" title="Integración TYTAN simulada">TYTAN simulado</span>`;
  accountOrderLine.hidden = false;
}

let accountEntryMode = 'account';

function entryModeButtons() {
  return entryModeGroup ? Array.from(entryModeGroup.querySelectorAll('[data-mode]')) : [];
}

function clearLookupResults() {
  if (!accountLookupResults) return;
  accountLookupResults.innerHTML = '';
  accountLookupResults.hidden = true;
}

// Cambia el modo de ingreso. Siempre limpia el campo y la cuenta confirmada:
// una cédula nunca debe quedar interpretada como nº de cuenta (ni al revés).
function setEntryMode(mode) {
  if (!ENTRY_MODES[mode]) return;
  accountEntryMode = mode;
  const cfg = ENTRY_MODES[mode];
  entryModeButtons().forEach((b) => {
    const on = b.dataset.mode === mode;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
    b.setAttribute('tabindex', on ? '0' : '-1');
  });
  if (accountFieldHint) accountFieldHint.textContent = cfg.hint;
  accountInput.setAttribute('placeholder', cfg.placeholder);
  accountInput.setAttribute('maxlength', String(cfg.maxlength));
  accountInput.setAttribute('inputmode', cfg.inputmode);
  // ORDER/… se escribe en mayúsculas; cuenta y cédula son solo dígitos.
  accountInput.setAttribute('autocapitalize', mode === 'order' ? 'characters' : 'off');
  accountInput.value = '';
  inputWrap.classList.remove('has-value');
  confirmAccountBtn.textContent = cfg.button;
  invalidateAccountCache();
  clearLookupResults();
}

if (entryModeGroup) {
  entryModeGroup.addEventListener('click', (ev) => {
    const btn = ev.target && ev.target.closest ? ev.target.closest('[data-mode]') : null;
    if (!btn) return;
    if (btn.getAttribute('aria-disabled') === 'true') return;
    if (btn.dataset.mode !== accountEntryMode) setEntryMode(btn.dataset.mode);
    accountInput.focus();
  });
  // Radiogroup: flechas entre las opciones habilitadas.
  entryModeGroup.addEventListener('keydown', (ev) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(ev.key)) return;
    const enabled = entryModeButtons().filter(b => b.getAttribute('aria-disabled') !== 'true');
    const i = enabled.findIndex(b => b.dataset.mode === accountEntryMode);
    if (i < 0 || enabled.length < 2) return;
    ev.preventDefault();
    const step = ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 1;
    const next = enabled[(i + step + enabled.length) % enabled.length];
    setEntryMode(next.dataset.mode);
    next.focus();
  });
}

/** Documento sin espacios, puntos ni guiones (el backend normaliza igual). */
function normalizeDocumentInput(raw) {
  return String(raw || '').replace(/[\s.\-]/g, '');
}

// Traduce la respuesta del lookup. Pura (sin DOM) para el smoke.
//   single   → 1 cuenta: sigue el flujo normal de confirmar
//   multiple → varias: el técnico elige
//   none     → 0 cuentas (mensaje distinto en Cancelaciones)
//   empty-db → la base de clientes nunca se importó
function lookupOutcome(res, category) {
  const matches = res && Array.isArray(res.matches) ? res.matches.filter(m => m && m.accountNumber) : [];
  if (res && res.reason === 'WHITELIST_EMPTY') {
    return { kind: 'empty-db', matches: [],
      message: 'La base de clientes de Xtrim no está cargada: no se puede buscar por cédula. Ingresa con el número de cuenta.' };
  }
  if (matches.length === 1) return { kind: 'single', matches, match: matches[0] };
  if (matches.length > 1) return { kind: 'multiple', matches, truncated: !!(res && res.truncated) };
  const message = category === 'cancelaciones'
    ? 'No hay cuentas activas con ese documento. Los clientes cancelados salen de la base de Xtrim: en una cancelación ingresa con el número de cuenta.'
    : 'No hay cuentas con ese documento en la base de clientes de Xtrim. Verifica el número o ingresa con el número de cuenta.';
  return { kind: 'none', matches: [], message };
}

// Lista para elegir la cuenta (sin DOM, para el smoke). El documento no se
// muestra: solo lo que devuelve el backend.
function lookupResultsHtml(outcome) {
  const items = outcome.matches.map((m) => {
    const grupo = clientStatusGroup(m.status);
    const tipo = [m.businessType, m.accountType].filter(Boolean).join(' · ');
    const mora = whitelistMora(m);
    return `
      <li>
        <button type="button" class="lookup-item" data-account="${escapeHtml(m.accountNumber)}"
          aria-label="Elegir cuenta ${escapeHtml(m.accountNumber)}, ${escapeHtml(grupo.label)}${m.city ? ', ' + escapeHtml(m.city) : ''}">
          <span class="lookup-item-head">
            <span class="lookup-item-account">${escapeHtml(m.accountNumber)}</span>
            <span class="wl-chip ${grupo.tile}">${escapeHtml(grupo.label)}</span>
          </span>
          ${m.fullName ? `<span class="lookup-item-name">${escapeHtml(m.fullName)}</span>` : ''}
          <span class="lookup-item-meta">${escapeHtml([m.city, tipo].filter(Boolean).join(' · ') || 'Sin ciudad ni tipo')}${mora ? ` · <span class="wl-mora">${escapeHtml(mora)}</span>` : ''}</span>
        </button>
      </li>`;
  }).join('');
  return `
    <p class="lookup-title" id="lookupTitle">${outcome.matches.length} cuentas con ese documento. Elige la de esta visita:</p>
    <ul class="lookup-list" aria-labelledby="lookupTitle">${items}</ul>
    ${outcome.truncated ? '<p class="lookup-note">Hay más de 50 cuentas con ese documento: se muestran las primeras 50.</p>' : ''}`;
}

// El técnico eligió (o hubo una sola): pasa a modo nº de cuenta y confirma.
function selectLookupAccount(accountNumber) {
  setEntryMode('account');
  accountInput.value = String(accountNumber);
  inputWrap.classList.add('has-value');
  return confirmAccountFlow();
}

async function lookupByDocumentFlow() {
  const raw = (accountInput.value || '').trim();
  const doc = normalizeDocumentInput(raw);
  clearLookupResults();
  if (doc.length < 6) {
    confirmAccountFeedback.textContent = 'Ingresa la cédula (10 dígitos) o el RUC (13 dígitos) del titular.';
    confirmAccountFeedback.className = 'confirm-account-feedback error';
    return;
  }
  const category = currentCategory;
  confirmAccountBtn.disabled = true;
  confirmAccountBtn.textContent = 'Buscando…';
  confirmAccountFeedback.textContent = '';
  confirmAccountFeedback.className = 'confirm-account-feedback';
  let outcome = null;
  try {
    const res = await WifixAPI.lookupAccountsByDocument(doc);
    outcome = lookupOutcome(res, category);
  } catch (err) {
    console.error('[Wifix] lookup por documento:', err);
    confirmAccountFeedback.textContent = isUpstreamOrNetworkFailure(err)
      ? `No se pudo buscar por cédula en este momento (${err.message || 'sin conexión'}). Ingresa con el número de cuenta.`
      : (err.message || 'No se pudo buscar por cédula.');
    confirmAccountFeedback.className = `confirm-account-feedback ${isUpstreamOrNetworkFailure(err) ? 'warning' : 'error'}`;
  } finally {
    confirmAccountBtn.disabled = false;
    confirmAccountBtn.textContent = ENTRY_MODES[accountEntryMode].button;
  }
  if (!outcome) return;

  if (outcome.kind === 'single') {
    await selectLookupAccount(outcome.match.accountNumber);
    return;
  }
  if (outcome.kind === 'multiple') {
    if (!accountLookupResults) return;
    accountLookupResults.innerHTML = lookupResultsHtml(outcome);
    accountLookupResults.hidden = false;
    accountLookupResults.querySelectorAll('[data-account]').forEach((b) => {
      b.addEventListener('click', () => { selectLookupAccount(b.dataset.account); });
    });
    const first = accountLookupResults.querySelector('[data-account]');
    if (first && first.focus) first.focus();
    return;
  }
  confirmAccountFeedback.textContent = outcome.message;
  confirmAccountFeedback.className = 'confirm-account-feedback error';
}

// Ingreso por nº de orden (TYTAN simulado). Acepta ORDER/463158/2026 o solo
// los dígitos. La orden trae UNA cuenta: se guarda el workOrder en la sesión de
// esa cuenta y se sigue exactamente el flujo de Confirmar cuenta.
async function lookupByOrderFlow() {
  const raw = (accountInput.value || '').trim();
  clearLookupResults();
  const normalizada = WifixAPI.normalizeOrderNumber(raw);
  if (!normalizada) {
    confirmAccountFeedback.textContent = 'Ingresa el nº de orden: ORDER/463158/2026 o solo el número (463158).';
    confirmAccountFeedback.className = 'confirm-account-feedback error';
    accountInput.setAttribute('aria-invalid', 'true');
    accountInput.setAttribute('aria-describedby', 'confirmAccountFeedback');
    accountInput.focus({ preventScroll: true });
    return;
  }
  accountInput.removeAttribute('aria-invalid');
  accountInput.removeAttribute('aria-describedby');
  confirmAccountBtn.disabled = true;
  confirmAccountBtn.textContent = 'Buscando…';
  confirmAccountFeedback.textContent = '';
  confirmAccountFeedback.className = 'confirm-account-feedback';
  let res = null;
  try {
    res = await WifixAPI.lookupAccountsByOrder(raw);
  } catch (err) {
    console.error('[Wifix] lookup por orden:', err);
    const infra = isUpstreamOrNetworkFailure(err);
    confirmAccountFeedback.textContent = infra
      ? `No se pudo buscar la orden en este momento (${err.message || 'sin conexión'}). Ingresa con el número de cuenta.`
      : (err.code === 'VALIDATION_ERROR'
        ? 'Formato de orden inválido. Usa ORDER/463158/2026 o solo el número.'
        : (err.message || 'No se pudo buscar la orden.'));
    confirmAccountFeedback.className = `confirm-account-feedback ${infra ? 'warning' : 'error'}`;
  } finally {
    confirmAccountBtn.disabled = false;
    confirmAccountBtn.textContent = ENTRY_MODES[accountEntryMode].button;
  }
  if (!res) return;
  const match = Array.isArray(res.matches) ? res.matches.find(m => m && m.accountNumber) : null;
  if (!match) {
    confirmAccountFeedback.textContent = `No se encontró la cuenta de la orden ${normalizada}. Verifica el número o ingresa con el número de cuenta.`;
    confirmAccountFeedback.className = 'confirm-account-feedback error';
    return;
  }
  setSessionWorkOrder(match.accountNumber, res.workOrder || normalizada, 'lookup');
  await selectLookupAccount(match.accountNumber);
}

// Confirma la cuenta: perfil de la operadora + whitelist de Xtrim EN PARALELO.
// La whitelist se resuelve primero (es local del backend, rápida); si bloquea,
// no se espera al perfil. Si no bloquea, el flujo sigue exactamente como antes
// (incluido el modo limitado ante 503/red) y se agrega la línea de whitelist.
async function confirmAccountFlow() {
  const cuenta = currentAccount();
  if (!cuenta) {
    confirmAccountFeedback.textContent = 'Ingresá el número de cuenta.';
    confirmAccountFeedback.className = 'confirm-account-feedback error';
    return;
  }
  const category = currentCategory;

  confirmAccountBtn.disabled = true;
  confirmAccountBtn.textContent = 'Validando…';
  confirmAccountFeedback.textContent = '';
  confirmAccountFeedback.className = 'confirm-account-feedback';
  clearWhitelistLine();
  accountInput.removeAttribute('aria-invalid');
  accountInput.removeAttribute('aria-describedby');

  const whitelistPromise = fetchWhitelist(cuenta);
  const profilePromise = WifixAPI.getClientProfile(cuenta);
  // Si la whitelist bloquea, nadie espera al perfil: que su rechazo no quede
  // como "unhandled rejection" en consola.
  profilePromise.catch(() => {});

  try {
    const wl = whitelistOutcome(await whitelistPromise, category);
    if (wl.block) {
      blockAccountConfirmation(cuenta, wl.body);
      return;
    }

    try {
      const profile = await profilePromise;
      validatedProfile = profile;
      validatedAccount = cuenta;

      const subGrid = subscreen.querySelector('.sub-grid');
      if (subGrid) subGrid.classList.add('account-confirmed');
      enableSubCards();
      devRefreshIndicators();
      // Bloqueo vigente del servidor (no se esquiva reconfirmando ni recargando).
      devSyncFromServer(cuenta, category);

      confirmAccountFeedback.textContent = `Cuenta confirmada — ${profileDisplayName(profile)}`;
      confirmAccountFeedback.className = 'confirm-account-feedback success';
      renderWhitelistLine(wl, cuenta);
      renderAccountOrderLine(cuenta);
      visitTaskOnAccountConfirmed(cuenta);

      // Estado del cliente: UNA sola llamada adicional. Si falla no invalida la
      // confirmación — el técnico ya tiene el nombre y puede seguir trabajando.
      try {
        const contract = await WifixAPI.getContractStatus(cuenta);
        const accounts = (contract && Array.isArray(contract.accounts)) ? contract.accounts : [];
        const own = accounts.find(a => a.accountNumber === cuenta) || accounts[0] || null;
        const estado = own && own.status ? own.status : '—';
        confirmAccountFeedback.textContent =
          `Cuenta confirmada — ${profileDisplayName(profile)} · ${estado}`;
      } catch (statusErr) {
        console.warn('[Wifix] contract-status en confirmación:', statusErr);
        confirmAccountFeedback.textContent =
          `Cuenta confirmada — ${profileDisplayName(profile)} · —`;
      }
    } catch (err) {
      console.error('[Wifix] confirm-account:', err);
      if (isUpstreamOrNetworkFailure(err)) {
        // La operadora (o la red) no responde, pero eso NO es culpa de la cuenta:
        // Herramientas y Equipos Retirados no dependen de la operadora y tienen
        // que funcionar igual. Se confirma en modo limitado y se avisa en amarillo.
        confirmAccountInLimitedMode(cuenta, err);
        renderWhitelistLine(wl, cuenta);
        renderAccountOrderLine(cuenta);
        visitTaskOnAccountConfirmed(cuenta);
      } else {
        // 404 / cuenta inexistente / credenciales: sí es un error real, no se
        // habilita nada.
        invalidateAccountCache();
        confirmAccountFeedback.textContent = err.message || 'No se pudo validar la cuenta.';
        confirmAccountFeedback.className = 'confirm-account-feedback error';
      }
    }
  } finally {
    confirmAccountBtn.disabled = false;
    confirmAccountBtn.textContent = ENTRY_MODES[accountEntryMode].button;
  }
}

// === Whitelist de clientes Xtrim =============================================
// GET /accounts/:n/whitelist. Cache por cuenta durante la sesión: re-renderizar
// o re-confirmar la misma cuenta no repite la llamada (se guarda la promesa, así
// dos clics seguidos tampoco duplican). Solo se cachea una respuesta con
// veredicto (listed true/false): un error, un 404 de backend viejo o la lista
// vacía (listed:null) se descartan para poder reintentar en la próxima.
const WHITELIST_CACHE_TTL_MS = 15 * 60 * 1000;
const whitelistCache = new Map();

function fetchWhitelist(cuenta) {
  const hit = whitelistCache.get(cuenta);
  if (hit && Date.now() - hit.at < WHITELIST_CACHE_TTL_MS) return hit.promise;

  const promise = Promise.resolve()
    .then(() => WifixAPI.checkWhitelist(cuenta))
    .then((body) => {
      const data = body || {};
      if (data.listed !== true && data.listed !== false) whitelistCache.delete(cuenta);
      return { ok: true, body: data };
    })
    .catch((err) => {
      console.warn('[Wifix] whitelist:', err);
      whitelistCache.delete(cuenta);
      return { ok: false, error: err };
    });
  whitelistCache.set(cuenta, { promise, at: Date.now() });
  return promise;
}

// Traduce la respuesta a lo que ve el técnico. Pura (sin DOM) para el smoke.
//   listed            → chip "Cliente Xtrim · <estado>", continúa
//   blocked           → no está y enforce:true: NO se confirma
//   not-listed        → no está y enforce:false: aviso, continúa
//   not-listed-cancel → no está, pero en Cancelaciones es lo esperable: info
//   unknown           → lista vacía / 404 / 5xx / red: aviso discreto, continúa
function whitelistOutcome(result, category) {
  if (!result || !result.ok) return { kind: 'unknown', block: false, body: null };
  const b = result.body || {};
  if (b.listed === true) return { kind: 'listed', block: false, body: b };
  if (b.listed === false) {
    // Los clientes cancelados salen de la base: en Cancelaciones NUNCA se bloquea.
    if (category === 'cancelaciones') return { kind: 'not-listed-cancel', block: false, body: b };
    if (b.enforce === true) return { kind: 'blocked', block: true, body: b };
    return { kind: 'not-listed', block: false, body: b };
  }
  return { kind: 'unknown', block: false, body: b };
}

// Fecha/hora de Ecuador continental (UTC-5 fijo, sin horario de verano). Se
// calcula a mano para no depender de los datos de zona horaria del WebView.
function formatDateEcuador(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const ec = new Date(d.getTime() - 5 * 3600000);
  return `${pad(ec.getUTCDate())}/${pad(ec.getUTCMonth() + 1)}/${ec.getUTCFullYear()} ` +
    `${pad(ec.getUTCHours())}:${pad(ec.getUTCMinutes())}`;
}

function whitelistNotListedMessage(cuenta, body) {
  const fecha = formatDateEcuador(body && body.importedAt);
  const actualizada = fecha ? ` (actualizada al ${fecha})` : '';
  return `La cuenta ${cuenta} no está en la base de clientes de Xtrim${actualizada}. Verifica el número.`;
}

// 'Mora Dia 31', 'MORA 60'… El resto de tipos de acceso no se muestra.
function whitelistMora(body) {
  const acc = body && body.accessType ? String(body.accessType).trim() : '';
  return /^mora/i.test(acc) ? acc : '';
}

// HTML de la línea de whitelist (sin DOM, para el smoke).
function whitelistLineHtml(wl, cuenta) {
  if (wl.kind === 'listed') {
    const b = wl.body;
    const grupo = clientStatusGroup(b.status);
    // ORDENADO/PENDIENTE cuentan como Activo: se conserva el matiz entre paréntesis.
    const literal = String(b.status || '').trim().toUpperCase();
    const matiz = (literal === 'ORDENADO' || literal === 'PENDIENTE')
      ? ` (${literal.charAt(0)}${literal.slice(1).toLowerCase()})` : '';
    const mora = whitelistMora(b);
    const partes = [
      `<span class="wl-chip ${grupo.tile}">Cliente Xtrim · ${escapeHtml(grupo.label + matiz)}</span>`,
    ];
    if (b.city) partes.push(`<span class="wl-meta">${escapeHtml(b.city)}</span>`);
    if (mora) partes.push(`<span class="wl-mora">${escapeHtml(mora)}</span>`);
    return partes.join('');
  }
  if (wl.kind === 'not-listed') {
    return `<span class="wl-text">${escapeHtml(whitelistNotListedMessage(cuenta, wl.body))}</span>`;
  }
  if (wl.kind === 'not-listed-cancel') {
    return `<span class="wl-text">La cuenta ${escapeHtml(cuenta)} no figura en la base de clientes activos de Xtrim — es lo esperable en una cancelación.</span>`;
  }
  return '<span class="wl-text">No se pudo validar contra la base de clientes.</span>';
}

const WHITELIST_LINE_CLASS = {
  listed: 'is-listed',
  'not-listed': 'is-warning',
  'not-listed-cancel': 'is-info',
  unknown: 'is-muted',
};

function renderWhitelistLine(wl, cuenta) {
  if (!confirmAccountWhitelist || !wl || wl.block) return;
  confirmAccountWhitelist.innerHTML = whitelistLineHtml(wl, cuenta);
  confirmAccountWhitelist.className =
    `confirm-account-whitelist ${WHITELIST_LINE_CLASS[wl.kind] || 'is-muted'}`;
  confirmAccountWhitelist.hidden = false;
}

// La cuenta no está en la base de Xtrim y el backend exige la lista: no se
// confirma nada. El mensaje va en el feedback (role="alert") y el foco se
// queda en el campo de cuenta, marcado como inválido, para corregir el número.
function blockAccountConfirmation(cuenta, body) {
  invalidateAccountCache();
  confirmAccountFeedback.textContent = whitelistNotListedMessage(cuenta, body);
  confirmAccountFeedback.className = 'confirm-account-feedback error';
  accountInput.setAttribute('aria-invalid', 'true');
  accountInput.setAttribute('aria-describedby', 'confirmAccountFeedback');
  // preventScroll: el campo ya está a la vista; que el foco no desplace el marco.
  accountInput.focus({ preventScroll: true });
}

// ¿El fallo es de la integración/infra (operadora caída, backend caído, sin red)
// y no de la cuenta? En ese caso la app sigue usable en modo limitado.
function isUpstreamOrNetworkFailure(err) {
  if (!err) return false;
  const code = err.code || '';
  if (code === 'UPSTREAM_AUTH_ERROR' || code === 'NETWORK_ERROR') return true;
  if (code === 'HTTP_503' || code === 'HTTP_502' || code === 'HTTP_504') return true;
  if (err.status === 503 || err.status === 502 || err.status === 504) return true;
  // Red cruda por si algún fetch fuera de fetchJson no pasó por networkError().
  if (err instanceof TypeError) return true;
  return false;
}

// Confirma la cuenta sin perfil de la operadora: habilita las tarjetas y deja
// el aviso de degradación. validatedProfile queda null a propósito — los
// paneles que dependen del perfil ya tienen su propio estado degradado.
function confirmAccountInLimitedMode(cuenta, err) {
  validatedProfile = null;
  validatedAccount = cuenta;

  const subGrid = subscreen.querySelector('.sub-grid');
  if (subGrid) {
    subGrid.classList.add('account-confirmed');
    subGrid.classList.add('account-limited');
  }
  enableSubCards();
  devRefreshIndicators();
  devSyncFromServer(cuenta, currentCategory);

  confirmAccountFeedback.textContent =
    `Cuenta ${cuenta} — modo limitado: los datos de la operadora no están disponibles.`;
  confirmAccountFeedback.className = 'confirm-account-feedback warning';

  const detalle = (err && err.message) ? ` (${err.message})` : '';
  renderIntegrationWarning(
    'Los datos de la operadora no están disponibles en este momento' + detalle +
    '. Herramientas y Equipos Retirados funcionan con normalidad.',
  );
}

// === Sub categorías =========================================================
subCards.forEach(card => {
  card.addEventListener('click', () => {
    const sub = card.dataset.sub;
    // Una sección que no es del módulo actual no se abre aunque llegue el click.
    if (!moduleHasCard(sub)) return;
    if (sub === 'personales') openDatosPersonales();
    if (sub === 'servicio') openDatosServicio();
    if (sub === 'equipo') openEquipo();
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

// Error de panel. UPSTREAM_AUTH_ERROR (503) no es una falla del técnico ni de
// su sesión: es un problema administrativo del token de la operadora. Se pinta
// como aviso, no como error rojo, y el resto de la app sigue funcionando.
function renderPanelError(err, fallback) {
  const msg = (err && err.message) || fallback || 'Error al cargar.';
  if (err && err.code === 'UPSTREAM_AUTH_ERROR') {
    return `<div class="detail-warning" role="status">${escapeHtml(msg)}</div>`;
  }
  return `<div class="detail-error" role="alert">${escapeHtml(msg)}</div>`;
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
// FECHA/HORA COMÚN — zona America/Guayaquil
// ----------------------------------------------------------------------------
// Ecuador continental es UTC-5 fijo (sin horario de verano), así que se
// calcula a mano: no depende de los datos de zona horaria del WebView ni de la
// zona configurada en el teléfono del técnico. Formato largo:
//   "lun 29 sep 2026, 14:32:05"  +  relativo "hace 3 h".
// Usar en caídas, eventos e historial (ISP Monitor y eventos de red).
// ============================================================================
const EC_TIMEZONE = 'America/Guayaquil';
const EC_UTC_OFFSET_MS = -5 * 3600000;
const EC_WEEKDAYS = Object.freeze(['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']);
const EC_MONTHS = Object.freeze(['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']);

/** Date válido o null (acepta ISO, epoch ms o Date). */
function toValidDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Partes de calendario/hora en hora de Ecuador. */
function _ecParts(d) {
  const e = new Date(d.getTime() + EC_UTC_OFFSET_MS);
  return {
    weekday: EC_WEEKDAYS[e.getUTCDay()],
    day: e.getUTCDate(),
    month: EC_MONTHS[e.getUTCMonth()],
    year: e.getUTCFullYear(),
    hh: pad(e.getUTCHours()),
    mm: pad(e.getUTCMinutes()),
    ss: pad(e.getUTCSeconds()),
  };
}

/**
 * "lun 29 sep 2026, 14:32:05" en hora de Ecuador.
 * opts: { seconds = true, weekday = true, year = true }.
 * null/vacío → '—'; texto no parseable → se devuelve tal cual.
 */
function fmtDateTimeEc(value, opts = {}) {
  const d = toValidDate(value);
  if (!d) return value === null || value === undefined || value === '' ? '—' : String(value);
  const p = _ecParts(d);
  const date = `${opts.weekday === false ? '' : p.weekday + ' '}${p.day} ${p.month}${opts.year === false ? '' : ' ' + p.year}`;
  const time = opts.seconds === false ? `${p.hh}:${p.mm}` : `${p.hh}:${p.mm}:${p.ss}`;
  return `${date}, ${time}`;
}

/** Solo la hora de Ecuador: "14:32" o "14:32:05". '' si no se puede leer. */
function fmtTimeEc(value, opts = {}) {
  const d = toValidDate(value);
  if (!d) return '';
  const p = _ecParts(d);
  return opts.seconds ? `${p.hh}:${p.mm}:${p.ss}` : `${p.hh}:${p.mm}`;
}

/** Duración legible: "45 s", "12 min", "1 h 05 min", "2 d 3 h". */
function fmtDuration(ms) {
  if (ms === null || ms === undefined || !isFinite(ms) || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rm = min % 60;
  if (h < 24) return rm ? `${h} h ${pad(rm)} min` : `${h} h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d} d ${rh} h` : `${d} d`;
}

/** Relativo: "hace unos segundos", "hace 12 min", "hace 1 h 20 min", "hace 3 h", "hace 2 d". */
function fmtRelative(value, now = Date.now()) {
  const d = toValidDate(value);
  if (!d) return '';
  const diff = now - d.getTime();
  const future = diff < 0;
  const abs = Math.abs(diff);
  const wrap = (txt) => (future ? `en ${txt}` : `hace ${txt}`);
  if (abs < 45000) return future ? 'en unos segundos' : 'hace unos segundos';
  const min = Math.round(abs / 60000);
  if (min < 60) return wrap(`${min} min`);
  const h = Math.floor(min / 60);
  if (h < 3) return wrap(min % 60 ? `${h} h ${min % 60} min` : `${h} h`);
  if (h < 24) return wrap(`${h} h`);
  const days = Math.floor(h / 24);
  if (days < 30) return wrap(`${days} d`);
  const months = Math.floor(days / 30);
  return wrap(`${months} ${months === 1 ? 'mes' : 'meses'}`);
}

/**
 * <time> con la fecha absoluta (hora de Ecuador) y, por defecto, el relativo.
 * opts: los de fmtDateTimeEc + { relative = true, now }.
 */
function dateTimeHtml(value, opts = {}) {
  const d = toValidDate(value);
  const abs = fmtDateTimeEc(value, opts);
  if (!d) return `<span class="dt-abs">${escapeHtml(abs)}</span>`;
  const rel = opts.relative === false ? '' : fmtRelative(d, opts.now);
  return `<time class="dt-abs" datetime="${escapeHtml(d.toISOString())}">${escapeHtml(abs)}</time>` +
    (rel ? ` <span class="dt-rel">(${escapeHtml(rel)})</span>` : '');
}

// ============================================================================
// ICONOS
// ============================================================================
const SERVICIO_ICONS = {
  nap:   '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s7-7.5 7-13a7 7 0 1 0-14 0c0 5.5 7 13 7 13z"/><circle cx="12" cy="9" r="2"/></svg>',
  user:  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>',
  ports: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M19 10h.01M7 14h.01M11 14h.01M15 14h.01M19 14h.01"/></svg>',
  alert: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.7L2 18a2 2 0 0 0 1.7 3h16.6A2 2 0 0 0 22 18L13.7 3.7a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
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
  mail: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 7l8.5 6 8.5-6"/></svg>',
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
  applyModuleLabels();

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
    detailList.innerHTML = renderPanelError(err, 'No se pudo cargar el perfil.');
    return;
  }

  renderClientProfile(profile, cuenta);
}

// Marca discreta para los campos que todavía NO vienen de la operadora.
// `sources[campo]` puede ser 'FSM' | 'MOCK' | 'COMARCH' | 'WHITELIST' | 'NONE'
// (contrato §3). WHITELIST = FSM no trajo el dato y se tomó de la base Xtrim.
function sourceBadge(profile, field) {
  const src = profile && profile.sources ? profile.sources[field] : null;
  if (src === 'WHITELIST') {
    return ' <span class="source-badge whitelist" title="Tomado de la base de clientes Xtrim: FSM no lo tiene">Base Xtrim</span>';
  }
  if (src !== 'MOCK') return '';
  return ' <span class="source-badge" title="Dato simulado: la operadora todavía no lo expone">simulado</span>';
}

// Identidad del cliente con FSM en vivo: fullName/address/phones/email/lat/lng
// pueden llegar null. Un null se muestra como "Sin datos en FSM" (gris), nunca
// como guion vacío ni 'undefined'.
const NO_FSM_DATA_TEXT = 'Sin datos en FSM';

function profileFieldText(value) {
  const s = value === null || value === undefined ? '' : String(value).trim();
  return s || null;
}

function profileFieldHtml(value) {
  const s = profileFieldText(value);
  return s ? escapeHtml(s) : `<span class="no-fsm-data">${NO_FSM_DATA_TEXT}</span>`;
}

function profilePhonesHtml(phones) {
  const list = Array.isArray(phones) ? phones.map(profileFieldText).filter(Boolean) : [];
  return list.length ? list.map(escapeHtml).join('<br/>') : profileFieldHtml(null);
}

// Nombre para textos planos (feedback de Confirmar cuenta).
function profileDisplayName(profile) {
  return profileFieldText(profile && profile.fullName) || NO_FSM_DATA_TEXT;
}

// Coordenada del domicilio, solo si ambas son números reales. null/undefined
// NO se convierten en 0,0 (isFinite(null) === true: no alcanza con isFinite).
function profileHomeCoords(profile) {
  if (!profile) return null;
  const lat = profile.latitude;
  const lng = profile.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { latitude: lat, longitude: lng };
}

// Aviso de degradación del perfil (p. ej. reason FSM_NO_DATA): informativo,
// no error — el técnico puede seguir con la cuenta.
function profileDegradedNote(profile) {
  const d = profile && profile.degraded;
  if (!d || !d.message) return '';
  return `<div class="profile-degraded-note" role="status">${escapeHtml(d.message)}</div>`;
}

// Mismo criterio que sourceBadge(), pero a nivel de pantalla o panel completo:
// Red Interna (campos 19-21) y Daños en la red de acceso (campo 14) todavía se
// alimentan de datos simulados porque la integración con la operadora no existe.
// Aviso discreto (chip), nunca un banner que tape la pantalla.
function mockNotice(extraClass = '', text = 'Datos simulados — integración pendiente') {
  const cls = extraClass ? ` ${extraClass}` : '';
  return `<span class="mock-notice${cls}" role="note"` +
    ` title="Estos datos no son una medición real">` +
    `${escapeHtml(text)}</span>`;
}

/**
 * Velocidad contratada { down, up, simulated } en Mbps (null si no hay dato).
 * Regla de Franco: un plan SIMULADO es siempre simétrico (subida = bajada).
 * El backend ya lo entrega así; si un backend viejo manda una subida distinta
 * con fuente MOCK, aquí se corrige para que el técnico nunca vea 1000/500.
 */
function contractedPlanMbps(profile) {
  const n = (v) => {
    const x = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    return typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : null;
  };
  if (!profile) return { down: null, up: null, simulated: false };
  const src = profile.sources || {};
  const simulated = src.contractedDownloadMbps === 'MOCK' || src.contractedUploadMbps === 'MOCK';
  const down = n(profile.contractedDownloadMbps);
  const up = simulated ? down : n(profile.contractedUploadMbps);
  return { down, up, simulated };
}

function renderClientProfile(profile, cuenta) {
  const phonesHtml = profilePhonesHtml(profile.phones);
  const plan = contractedPlanMbps(profile);
  const down = plan.down ?? '—';
  const up = plan.up ?? '—';
  const speedTxt = `${escapeHtml(down)} ↓ / ${escapeHtml(up)} ↑ Mbps`;
  // Plan y velocidad siguen simulados hasta que exista la API de Comarch: se
  // rotulan como tales para que el técnico no los lea como datos reales.
  const badgePlan = sourceBadge(profile, 'planName');
  const badgeVel = sourceBadge(profile, 'contractedDownloadMbps') || sourceBadge(profile, 'contractedUploadMbps');

  detailList.innerHTML = [
    profileDegradedNote(profile),
    renderDetailRow(ICONS.user,  'Nombres y Apellidos' + sourceBadge(profile, 'fullName'), profileFieldHtml(profile.fullName)),
    renderDetailRow(ICONS.pin,   'Dirección' + sourceBadge(profile, 'address'), profileFieldHtml(profile.address)),
    renderDetailRow(ICONS.phone, 'Teléfonos' + sourceBadge(profile, 'phones'), phonesHtml),
    renderDetailRow(ICONS.mail,  'Correo' + sourceBadge(profile, 'email'), profileFieldHtml(profile.email)),
    renderDetailRow(ICONS.plan,  'Plan Contratado' + badgePlan, escapeHtml(profile.planName || '—'), { highlight: true }),
    renderDetailRow(ICONS.speed, 'Velocidad Contratada' + badgeVel, speedTxt, { highlight: true }),
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
      <label class="form-row"><span class="form-label">Dirección</span>
        <textarea data-field="address" rows="2">${escapeHtml(profile.address || '')}</textarea></label>
      <label class="form-row"><span class="form-label">Teléfonos (uno por línea)</span>
        <textarea data-field="phones" rows="3">${escapeHtml((profile.phones || []).join('\n'))}</textarea></label>
      <button class="save-btn" data-action="save-profile">Guardar cambios</button>
      <p class="form-note">Los cambios se guardan solo en Wifix; no se envían al sistema de la operadora.</p>
    </div>`;

  const formEl = slot.querySelector('[data-form="profile-edit"]');
  const saveBtn = formEl.querySelector('[data-action="save-profile"]');
  saveBtn.addEventListener('click', async () => {
    // Nombre y apellido NO forman parte de este formulario (dato del titular,
    // no editable desde Wifix): el payload solo lleva dirección y teléfonos.
    // El nombre se sigue mostrando en el resumen de la cuenta.
    const address = nonEmpty(formEl.querySelector('[data-field="address"]').value);
    const phonesRaw = formEl.querySelector('[data-field="phones"]').value || '';
    const phones = phonesRaw.split('\n').map(s => s.trim()).filter(Boolean);
    const update = {};
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
// Estados que devuelve la operadora (contrato §4): códigos A/S/T/O/P o nombres
// ACTIVA/SUSPENDIDA/TERMINADA/ORDENADA/PENDIENTE/DESCONOCIDA. En pantalla solo
// se muestran TRES grupos (decisión de Franco): Activo / Suspendido / Cancelado.
// ORDENADA y PENDIENTE cuentan como Activo. Lo no previsto cae en "Sin dato".
const CLIENT_STATUS_GROUPS = {
  activo:       { key: 'activo',     label: 'Activo',     short: 'ACT', tile: 'ok' },
  suspendido:   { key: 'suspendido', label: 'Suspendido', short: 'SUS', tile: 'warn' },
  cancelado:    { key: 'cancelado',  label: 'Cancelado',  short: 'CAN', tile: 'fail' },
  'sin-dato':   { key: 'sin-dato',   label: 'Sin dato',   short: '?',   tile: 'muted' },
};
const CLIENT_STATUS_TO_GROUP = {
  A: 'activo', O: 'activo', P: 'activo',
  ACTIVA: 'activo', ORDENADA: 'activo', PENDIENTE: 'activo',
  // La whitelist de Xtrim (GET /accounts/:n/whitelist) usa el masculino.
  ACTIVO: 'activo', ORDENADO: 'activo',
  S: 'suspendido', SUSPENDIDA: 'suspendido', SUSPENDIDO: 'suspendido',
  T: 'cancelado', TERMINADA: 'cancelado',
};

// Acepta código (A/S/T/O/P) o nombre (ACTIVA/…); devuelve { key, label, short, tile }.
function clientStatusGroup(codeOrName) {
  const k = String(codeOrName === null || codeOrName === undefined ? '' : codeOrName).trim().toUpperCase();
  return CLIENT_STATUS_GROUPS[CLIENT_STATUS_TO_GROUP[k] || 'sin-dato'];
}

function statusTileClass(status) {
  return clientStatusGroup(status).tile;
}

function renderStatusFromContract(contract, account) {
  const accounts = (contract && Array.isArray(contract.accounts)) ? contract.accounts : [];
  const own = accounts.find(a => a.accountNumber === account) || accounts[0] || null;
  const status = own && own.status ? own.status : 'DESCONOCIDA';
  const grupo = clientStatusGroup(status);
  const statusClass = grupo.tile;
  // Texto literal de la operadora bajo el grupo (p. ej. "Ordenada" bajo Activo),
  // para que el técnico no pierda el matiz. Si no hay descripción, el estado crudo.
  // Los nombres canónicos (ACTIVA/SUSPENDIDA/TERMINADA/DESCONOCIDA) no aportan
  // nada bajo su grupo; ORDENADA/PENDIENTE sí (son "Activo" con matiz).
  const canonico = ['ACTIVA', 'SUSPENDIDA', 'TERMINADA', 'DESCONOCIDA'].includes(String(status).toUpperCase());
  const literal = (own && own.statusDescription) || (canonico ? '' : status);
  const descripcion = literal && literal.toUpperCase() !== grupo.label.toUpperCase()
    ? `<span class="st-sub">${escapeHtml(literal)}</span>`
    : '';
  const lastWo = own && own.lastWorkOrder
    ? `<div class="mini-row">
        <span class="mr-label">Última orden</span>
        <span class="mr-value">${escapeHtml(own.lastWorkOrder)}</span>
      </div>`
    : '';
  // FSM entrega una sola cuenta por contrato: la lista se ve bien con 1 fila.
  const filas = accounts.map(a => `
      <div class="mini-row">
        <span class="mr-label">${escapeHtml(a.accountNumber)}</span>
        <span class="mr-value">${escapeHtml(a.contractId || '—')} · ${escapeHtml(clientStatusGroup(a.status).label)}</span>
      </div>`).join('');

  return `
    <div class="status-grid">
      <div class="status-tile ${statusClass}">
        <span class="st-label">Estado</span>
        <span class="st-value">${escapeHtml(grupo.label)}</span>
        ${descripcion}
      </div>
      <div class="status-tile">
        <span class="st-label">Cliente</span>
        <span class="st-value">${escapeHtml((contract && contract.clientName) || '—')}</span>
      </div>
    </div>
    ${filas || '<div class="detail-empty">Sin cuentas asociadas.</div>'}
    ${lastWo}`;
}

// ---------------------------------------------------------------------------
// Panel NAP / GPON Xtreme — estado de módulo por apertura
// ---------------------------------------------------------------------------
// El taskId se genera una vez por apertura del panel y se mantiene estable
// mientras el panel esté abierto. Se resetea en null al cerrar.
// Radios de búsqueda de NAPs (decisión de Franco): SOLO dos.
//   280 m → radio establecido para poder hacer la instalación (default).
//   500 m → rango extendido, para cuando todas las cercanas están ocupadas.
//           Las NAP entre 280 y 500 m se marcan "Fuera de radio de instalación".
const NAP_INSTALL_RADIUS_M = 280;
const NAP_EXTENDED_RADIUS_M = 500;
const NAP_RADIUS_OPTIONS = Object.freeze([
  Object.freeze({ meters: NAP_INSTALL_RADIUS_M, tag: 'Instalación',
    help: 'Radio de instalación (280 m): NAPs a las que se puede conectar al cliente.' }),
  Object.freeze({ meters: NAP_EXTENDED_RADIUS_M, tag: 'Extendido',
    help: 'Rango extendido (500 m): incluye NAPs fuera del radio de instalación. Úsalo cuando todas las cercanas están ocupadas.' }),
]);

function _napRadiusOption(meters) {
  return NAP_RADIUS_OPTIONS.find(o => o.meters === meters) || NAP_RADIUS_OPTIONS[0];
}

let _napPanelState = {
  taskId: null,
  openedAt: null,
  coords: null,      // { latitude, longitude, accuracy } cuando hay GPS
  selectedNap: null, // napRef seleccionado para GPON (napId o napCode)
  selectedPort: null, // puerto elegido dentro de la NAP GPON (libre o cancelado)
  naps: [],          // array de NAPs cargadas (se guarda al cargar el panel)
  meters: NAP_INSTALL_RADIUS_M, // radio: 280 (instalación) / 500 (extendido)
  maxRows: 5,        // cuántas NAPs mostrar (5 / 10 / 20)
  degraded: null,    // aviso de degradación de la última consulta
  homeCoords: null,  // coordenada del domicilio que trae la orden (si existe)
  // --- Visita técnica / Migración: NAP contratada del cliente
  // (GET /accounts/:n/current-nap). Se consulta UNA vez por apertura del panel
  // (loadNapPanel); los re-render leen de aquí y nunca vuelven a llamar.
  account: null,         // cuenta del panel abierto (para "Reintentar")
  currentNap: null,      // respuesta de current-nap (found true/false) o null
  currentNapError: null, // Error si la consulta falló (red, 502, 503)
  // Ubicación "Casa cliente" (GET/POST /accounts/:n/client-location).
  clientLoc: _clientLocEmptyState(),
};

// Visita técnica y Migraciones: el cliente YA tiene una NAP contratada
// asignada. El panel muestra solo esa NAP (sin buscador por radio ni
// "Cambiar NAP"). Instalaciones sigue con la búsqueda de NAPs cercanas.
const NAP_CONTRACTED_MODULES = Object.freeze(['visitas', 'migraciones']);
function _napUsesContractedNap(category = currentCategory) {
  return NAP_CONTRACTED_MODULES.includes(category);
}

// Módulos donde se puede guardar la ubicación "Casa cliente" (mismo
// componente y mismo POST client-location; el backend no distingue módulo).
// En Visita técnica / Migración va dentro de la tarjeta de la NAP del
// cliente; en Instalaciones, al final del panel (debajo del resumen GPON).
const CLIENT_LOC_MODULES = Object.freeze(['instalaciones', 'visitas', 'migraciones']);
function _napUsesClientLoc(category = currentCategory) {
  return CLIENT_LOC_MODULES.includes(category);
}

// ¿Hay NAP del cliente para pintar (current-nap con found y nap)?
function _napHasClientNap() {
  const cur = _napPanelState.currentNap;
  return !!(cur && cur.found && cur.nap);
}

// La NAP viene simulada (conector de demo): el backend marca simulated:true /
// source:'SIMULATED' en la respuesta (se acepta también dentro de `nap`).
function _napIsSimulated(cur) {
  if (!cur) return false;
  const n = cur.nap || {};
  return cur.simulated === true || cur.source === 'SIMULATED' || n.simulated === true || n.source === 'SIMULATED';
}

// napRef de la NAP del cliente (o '' si no hay).
function _napCurrentRef() {
  return _napHasClientNap() ? _napRef(_napPanelState.currentNap.nap) : '';
}

// Referencia de la NAP para el backend: napId numérico de FSM cuando existe,
// si no el código de NAP (camino TEC). Contrato §6.
function _napRef(nap) {
  if (!nap) return '';
  return nap.napId !== null && nap.napId !== undefined ? String(nap.napId) : String(nap.napCode || '');
}

// Caché de puertos por panel (scope): la carga automática, "Ver puertos" y
// la selección GPON leen la MISMA respuesta. Vive mientras dure la pantalla
// (cada apertura del panel crea un scope nuevo), así que repetir la búsqueda
// con otro radio no vuelve a pedir las NAPs ya consultadas. Las consultas en
// curso también se comparten (_napPortsInflight): tocar "Ver puertos"
// mientras la carga automática espera no duplica la llamada.
async function _napPortsCached(scope, napRef) {
  if (!scope._napPortsCache) scope._napPortsCache = {};
  if (!scope._napPortsInflight) scope._napPortsInflight = {};
  if (scope._napPortsCache[napRef]) return scope._napPortsCache[napRef];
  if (scope._napPortsInflight[napRef]) return scope._napPortsInflight[napRef];
  const p = WifixAPI.getNapPorts(napRef).then((data) => {
    _napMarkClientPort(napRef, data);
    scope._napPortsCache[napRef] = data;
    return data;
  });
  scope._napPortsInflight[napRef] = p;
  try {
    return await p;
  } finally {
    delete scope._napPortsInflight[napRef];
  }
}

// ---------------------------------------------------------------------------
// Carga AUTOMÁTICA de puertos (paso 1 del campo 8: GET /naps/{ref}/ports)
// ---------------------------------------------------------------------------
// Al pintar la lista de NAPs (Instalaciones) o la tarjeta "NAP del cliente"
// (Visita técnica / Migración) se piden los puertos en segundo plano, de a
// pocas NAPs a la vez y empezando por la más cercana. Cada tarjeta se
// actualiza sola (ocupación, color binario, reutilizables) con su propio
// estado de carga/error; la lista nunca se bloquea.
// No existe endpoint de lote de puertos: es una llamada por NAP.
// Los ESTADOS de los clientes (status-batch) NO se piden aquí: la operadora
// pidió que solo se consulten por un gesto explícito del técnico.
const NAP_PORTS_AUTO_CONCURRENCY = 2;

// ¿Se pueden pedir los puertos de esta NAP de la lista? Una NAP simulada
// (o sin referencia) nunca llama a /naps/{ref}/ports.
function _napPortsEligible(nap) {
  if (!nap || !_napRef(nap)) return false;
  return !(nap.simulated === true || nap.source === 'SIMULATED');
}

// Ordena por distancia ascendente (sin distancia, al final). Misma regla que
// las tarjetas: la carga automática empieza por la NAP más cercana.
function _napSortByDistance(naps) {
  return [...(naps || [])].sort((a, b) => {
    const da = _napDistanceToNap(a);
    const db = _napDistanceToNap(b);
    if (da === null && db === null) return 0;
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  });
}

// Vuelca el conteo de la respuesta de puertos sobre el objeto NAP (es el dato
// más fresco). Si la operadora no da detalle por puerto (camino TEC,
// detailAvailable:false) se respeta el conteo del listado.
function _napApplyPortsCounts(nap, data) {
  if (!nap || !data || data.detailAvailable === false) return;
  const total = Number(data.totalPorts);
  if (!Number.isFinite(total) || total <= 0) return;
  let occ = Number(data.occupiedPorts);
  if (!Number.isFinite(occ) && Array.isArray(data.ports)) occ = data.ports.filter(p => p && p.occupied).length;
  if (!Number.isFinite(occ)) return;
  nap.totalPorts = total;
  nap.occupiedPorts = occ;
  nap.freePorts = Math.max(0, total - occ);
}

// Estado de la carga por NAP: 'queued' | 'loading' | 'ok' | 'error'.
function _napPortsStateOf(scope, napRef) {
  const st = scope && scope._napPortsState ? scope._napPortsState[napRef] : null;
  return st || null;
}

// Línea de estado de puertos de una tarjeta (cargando / en cola / error).
function _napPortsStatusHtml(scope, napRef) {
  const st = _napPortsStateOf(scope, napRef);
  if (!st) return '';
  if (st.state === 'queued') return '<span class="nap-ports-auto is-loading">Puertos en cola…</span>';
  if (st.state === 'loading') return '<span class="nap-ports-auto is-loading">Consultando puertos…</span>';
  if (st.state === 'error') {
    const msg = st.error && st.error.message ? `: ${st.error.message}` : '';
    return `<span class="nap-ports-auto is-error">No se pudieron consultar los puertos${escapeHtml(msg)}.</span>
      <button type="button" class="link-btn nap-ports-retry" data-action="nap-ports-retry" data-nap="${escapeHtml(napRef)}"
        aria-label="Reintentar la consulta de puertos de la NAP">Reintentar</button>`;
  }
  return '';
}

function _napSetPortsState(scope, napRef, state, error) {
  if (!scope._napPortsState) scope._napPortsState = {};
  scope._napPortsState[napRef] = { state, error: error || null };
}

// Actualiza en el lugar la(s) tarjeta(s) de una NAP: color, badge, barra de
// ocupación, reutilizables y estado de la carga. No regenera la tarjeta (no
// se pierde la grilla abierta ni el foco).
function _napUpdateCardPorts(scope, napRef, nap) {
  if (!scope || !scope.querySelectorAll) return;
  const st = _napPortsStateOf(scope, napRef);
  const cargando = !!st && (st.state === 'loading' || st.state === 'queued');
  const color = _napColorClass(nap);
  const n = _napReusablePorts(scope, napRef).length;
  scope.querySelectorAll('.nap-card').forEach((card) => {
    if (!card.dataset || card.dataset.nap !== napRef) return;
    if (card.classList) {
      ['free', 'full', 'unknown'].forEach(c => card.classList.remove('nap-state-' + c));
      card.classList.add('nap-state-' + color);
    }
    if (cargando) card.setAttribute('aria-busy', 'true');
    else card.removeAttribute('aria-busy');
    const badge = card.querySelector('.nap-state-badge');
    if (badge) {
      badge.className = 'nap-state-badge ' + color;
      badge.textContent = _napColorLabel(nap);
    }
    const occ = card.querySelector('[data-slot="nap-occ"]');
    if (occ) occ.innerHTML = _napOccupancyBar(nap);
    const note = card.querySelector('[data-slot="nap-reuse"]');
    if (note) {
      note.textContent = _napReuseText(n);
      note.hidden = n === 0;
    }
    const status = card.querySelector('[data-slot="nap-ports-status"]');
    if (status) status.innerHTML = _napPortsStatusHtml(scope, napRef);
  });
}

// Pide (o toma de la caché) los puertos de UNA NAP y actualiza su tarjeta.
// gen: generación de la búsqueda; si el técnico lanzó otra, no se pinta.
async function _napLoadPortsForCard(scope, nap, gen) {
  const ref = _napRef(nap);
  _napSetPortsState(scope, ref, 'loading');
  _napUpdateCardPorts(scope, ref, nap);
  try {
    const data = await _napPortsCached(scope, ref);
    if (scope._napPortsGen !== gen) return false;
    _napApplyPortsCounts(nap, data);
    _napSetPortsState(scope, ref, 'ok');
    _napUpdateCardPorts(scope, ref, nap);
    if (_napPanelState.selectedNap === ref) _renderGponSummary(scope);
    return true;
  } catch (err) {
    if (scope._napPortsGen !== gen) return false;
    console.error('[Wifix] puertos NAP (automático)', ref, err);
    _napSetPortsState(scope, ref, 'error', err);
    _napUpdateCardPorts(scope, ref, nap);
    return false;
  }
}

// Texto del progreso (una sola región aria-live para toda la lista: evita
// que el lector de pantalla anuncie cada tarjeta por separado).
function _napPortsProgress(scope, txt) {
  const el = scope && scope.querySelector ? scope.querySelector('[data-slot="nap-ports-progress"]') : null;
  if (!el) return;
  el.textContent = txt || '';
  el.hidden = !txt;
}

// Lanza la carga automática de puertos de una lista de NAPs con concurrencia
// limitada. Las ya consultadas salen de la caché sin llamar. Devuelve una
// promesa que nunca rechaza (corre en segundo plano).
async function _napAutoLoadPorts(scope, naps, opts = {}) {
  if (!scope) return;
  const gen = (scope._napPortsGen || 0) + 1;
  scope._napPortsGen = gen;
  const cache = scope._napPortsCache || {};
  const elegibles = _napSortByDistance(naps).filter(_napPortsEligible);
  // Las ya cacheadas se aplican al instante (sin llamada).
  elegibles.forEach((n) => {
    const ref = _napRef(n);
    if (!cache[ref]) return;
    _napApplyPortsCounts(n, cache[ref]);
    _napSetPortsState(scope, ref, 'ok');
    _napUpdateCardPorts(scope, ref, n);
  });
  const cola = elegibles.filter(n => !cache[_napRef(n)]);
  if (cola.length === 0) {
    _napPortsProgress(scope, '');
    if (opts.onDone) opts.onDone();
    return;
  }
  cola.forEach((n) => {
    _napSetPortsState(scope, _napRef(n), 'queued');
    _napUpdateCardPorts(scope, _napRef(n), n);
  });
  let hechas = 0;
  let fallidas = 0;
  const total = cola.length;
  _napPortsProgress(scope, `Consultando puertos de ${total} NAP${total === 1 ? '' : 's'}…`);
  let i = 0;
  const worker = async () => {
    while (i < cola.length) {
      if (scope._napPortsGen !== gen) return;
      const nap = cola[i++];
      const ok = await _napLoadPortsForCard(scope, nap, gen);
      if (scope._napPortsGen !== gen) return;
      hechas++;
      if (!ok) fallidas++;
      if (hechas < total) _napPortsProgress(scope, `Consultando puertos… ${hechas}/${total}`);
    }
  };
  const n = Math.min(NAP_PORTS_AUTO_CONCURRENCY, cola.length);
  await Promise.all(Array.from({ length: n }, worker));
  if (scope._napPortsGen !== gen) return;
  _napPortsProgress(scope, fallidas > 0
    ? `Puertos actualizados: ${total - fallidas} de ${total} NAP${total === 1 ? '' : 's'}; ${fallidas} con error (puedes reintentar en la tarjeta).`
    : `Puertos actualizados en ${total} NAP${total === 1 ? '' : 's'}.`);
  if (opts.onDone) opts.onDone();
}

// "Reintentar" de una tarjeta: vuelve a pedir SOLO esa NAP.
async function _napRetryPorts(scope, napRef, onDone) {
  const naps = _napUsesContractedNap()
    ? (_napHasClientNap() ? [_napPanelState.currentNap.nap] : [])
    : (_napPanelState.naps || []);
  const nap = naps.find(n => _napRef(n) === napRef);
  if (!nap || !_napPortsEligible(nap)) return;
  const ok = await _napLoadPortsForCard(scope, nap, scope._napPortsGen);
  if (ok && onDone) onDone();
}

// Marca en los datos de puertos cuál es el puerto del cliente de la visita
// (p.isClientPort). Va en el objeto y no en el DOM para que sobreviva a los
// repintados de celda de _applyPortStatuses.
function _napMarkClientPort(napRef, data) {
  if (!data || !Array.isArray(data.ports) || !_napHasClientNap()) return;
  if (String(napRef) !== _napCurrentRef()) return;
  const puerto = _napPanelState.currentNap.portNumber;
  data.ports.forEach((p) => {
    p.isClientPort = puerto !== null && puerto !== undefined && String(p.portNumber) === String(puerto);
  });
}

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

// ¿La NAP está más allá del radio de instalación (280 m)? Solo aparece con
// el rango extendido. Sin distancia conocida no se afirma nada (false).
function _napIsOutOfInstallRadius(nap) {
  const d = _napDistanceToNap(nap);
  return d !== null && d > NAP_INSTALL_RADIUS_M;
}

// Badge "Fuera de radio de instalación" (ícono + texto, no solo color). No
// toca el color binario verde/rojo de la NAP: es una marca aparte.
function _napOutOfRadiusBadgeHtml(nap) {
  if (!_napIsOutOfInstallRadius(nap)) return '';
  return `<span class="nap-out-radius-badge" title="A más de ${NAP_INSTALL_RADIUS_M} m: fuera del radio establecido para la instalación">` +
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M10.3 3.7L2 18a2 2 0 0 0 1.7 3h16.6A2 2 0 0 0 22 18L13.7 3.7a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>' +
    'Fuera de radio de instalación</span>';
}

// Texto de distancia para mostrar en la tarjeta.
function _napDistanceText(nap) {
  const d = _napDistanceToNap(nap);
  if (d === null) return '— (captura tu ubicación)';
  return `${d.toFixed(1)} m`;
}

// Puertos libres de la NAP según el conteo de la operadora. Se prefiere
// freePorts; si no viene, total - ocupados. null = no hay total conocido.
function _napFreePorts(nap) {
  if (!nap) return null;
  if (nap.freePorts !== undefined && nap.freePorts !== null && isFinite(nap.freePorts)) {
    return Math.max(0, Number(nap.freePorts));
  }
  if (!nap.totalPorts || !isFinite(nap.totalPorts)) return null;
  return Math.max(0, Number(nap.totalPorts) - (Number(nap.occupiedPorts) || 0));
}

// Color de la NAP — regla BINARIA de Franco, basada solo en el conteo:
//   'free'    (verde) si hay ≥1 puerto libre  → 7/8 es verde
//   'full'    (rojo)  si está llena           → 8/8 es rojo, aunque tenga
//                                               clientes cancelados reutilizables
//   'unknown' (gris)  si la operadora no dio total ni libres
// Reutilizable por tarjeta, resumen GPON y (a futuro) marcadores del mapa.
function _napColorClass(nap) {
  const free = _napFreePorts(nap);
  if (free === null) return 'unknown';
  return free > 0 ? 'free' : 'full';
}

// Texto corto del estado de la NAP (badge de la tarjeta).
function _napColorLabel(nap) {
  const cls = _napColorClass(nap);
  if (cls === 'free') return 'Con puertos libres';
  if (cls === 'full') return 'Llena';
  return 'Sin dato de puertos';
}

// Texto "x/y ocupados · n libres" (sin porcentaje).
function _napOccupancyText(nap) {
  const free = _napFreePorts(nap);
  if (free === null) return 'Ocupación no disponible';
  const occ = Number(nap.occupiedPorts) || 0;
  const total = Number(nap.totalPorts) || (occ + free);
  return `${occ}/${total} ocupados · ${free} libre${free === 1 ? '' : 's'}`;
}

// Renderiza la barra visual de ocupación. El ancho es la proporción ocupada;
// el color es binario (_napColorClass), no escala por porcentaje.
function _napOccupancyBar(nap) {
  const cls = _napColorClass(nap);
  const texto = _napOccupancyText(nap);
  const total = Number(nap.totalPorts) || 0;
  const occ = Number(nap.occupiedPorts) || 0;
  const width = total > 0 ? Math.min(100, Math.round((occ / total) * 100)) : 0;
  const aria = total > 0
    ? `role="progressbar" aria-valuenow="${occ}" aria-valuemin="0" aria-valuemax="${total}" aria-valuetext="${escapeHtml(texto)}"`
    : 'aria-hidden="true"';
  return `
    <div class="nap-occ-bar-wrap" ${aria}>
      <div class="nap-occ-bar ${cls}" style="width:${width}%"></div>
    </div>
    <span class="nap-occ-label">${escapeHtml(texto)}</span>`;
}

// Estado de un puerto para la grilla y la selección GPON:
//   'libre'         → sin cliente
//   'cancelado'     → cliente con status Cancelado (T): se puede reutilizar
//   'ocupado'       → cliente Activo/Suspendido (o status no reconocido)
//   'sin-consultar' → ocupado y todavía sin status (se pide solo por tap)
function _portState(p) {
  if (!p || !p.occupied) return 'libre';
  if (!p.clientStatus) return 'sin-consultar';
  return clientStatusGroup(p.clientStatus).key === 'cancelado' ? 'cancelado' : 'ocupado';
}

// Puertos reutilizables (cliente cancelado) de una NAP ya consultada. Solo
// mira la caché: nunca dispara llamadas a la operadora.
function _napReusablePorts(scope, napRef) {
  const data = scope && scope._napPortsCache ? scope._napPortsCache[napRef] : null;
  if (!data || !Array.isArray(data.ports)) return [];
  return data.ports.filter(p => _portState(p) === 'cancelado');
}

// "N puerto(s) reutilizable(s) (cliente cancelado)". Texto plano.
function _napReuseText(n) {
  if (!n) return '';
  return `${n} puerto${n === 1 ? '' : 's'} reutilizable${n === 1 ? '' : 's'} (cliente cancelado)`;
}

// ¿La NAP trae una coordenada utilizable (mapa y "Cómo llegar")?
function _napHasCoords(nap) {
  return !!nap && nap.latitude !== null && nap.longitude !== null &&
    nap.latitude !== undefined && nap.longitude !== undefined &&
    isFinite(nap.latitude) && isFinite(nap.longitude);
}

// Código de la NAP. Si tiene coordenada es un botón que centra el mapa en
// ella (acceso por teclado al marcador); si no, texto plano.
function _napNameHtml(nap, ref) {
  const code = escapeHtml(nap.napCode || '—');
  if (!_napHasCoords(nap)) return `<span class="nap-name">${code}</span>`;
  return `<button type="button" class="nap-name nap-name-btn" data-action="nap-focus" data-nap="${escapeHtml(ref)}"
            aria-label="Ver ${code} en el mapa">${code}</button>`;
}

// Botón "Cómo llegar" (Google Maps a pie). Solo si la NAP tiene coordenada.
function _napDirectionsBtnHtml(nap) {
  if (!_napHasCoords(nap)) return '';
  return `<button class="add-row-btn nap-directions-btn" type="button" data-action="nap-directions"
            data-lat="${escapeHtml(nap.latitude)}" data-lng="${escapeHtml(nap.longitude)}"
            aria-label="Cómo llegar a ${escapeHtml(nap.napCode || 'la NAP')} (abre Google Maps)">Cómo llegar</button>`;
}

// Renderiza la lista de tarjetas NAP.
function _renderNapCards(naps, scope) {
  // Orden por distancia ascendente. La API ya las devuelve ordenadas, pero se
  // reordena por si la distancia se calculó localmente (Haversine).
  const sorted = _napSortByDistance(naps);

  const slot = scope.querySelector('[data-slot="nap-cards"]');
  if (!slot) return;
  slot.innerHTML = sorted.map(n => {
    const ref = _napRef(n);
    const isSelected = _napPanelState.selectedNap === ref;
    const color = _napColorClass(n);
    const reutilizables = _napReusablePorts(scope, ref).length;
    // "Red de acceso", nunca "nodo": es el puerto de OLT / la tarjeta de CMTS.
    const red = n.networkName
      ? `<span class="nap-network-name"><span class="nap-network-key">Red de acceso</span>${escapeHtml(n.networkName)}</span>`
      : '';
    const esDelCliente = !!ref && ref === _napCurrentRef();
    const fueraRadio = _napIsOutOfInstallRadius(n);
    const pst = _napPortsStateOf(scope, ref);
    const ocupada = !!pst && (pst.state === 'loading' || pst.state === 'queued');
    return `
      <div class="nap-card nap-state-${color}${isSelected ? ' nap-selected' : ''}${fueraRadio ? ' nap-out-of-radius' : ''}" data-nap="${escapeHtml(ref)}"${ocupada ? ' aria-busy="true"' : ''}>
        <div class="nap-head">
          ${_napNameHtml(n, ref)}
          <span class="nap-badges">
            <span class="nap-state-badge ${color}">${escapeHtml(_napColorLabel(n))}</span>
            ${esDelCliente ? '<span class="nap-client-badge">NAP del cliente</span>' : ''}
            ${_napOutOfRadiusBadgeHtml(n)}
            ${isSelected ? '<span class="nap-selected-badge">GPON seleccionada</span>' : ''}
          </span>
        </div>
        <span class="nap-distance">${_napDistanceText(n)}</span>
        ${red}
        <div class="nap-occ" data-slot="nap-occ">${_napOccupancyBar(n)}</div>
        <div class="nap-ports-auto-slot" data-slot="nap-ports-status">${_napPortsStatusHtml(scope, ref)}</div>
        <div class="nap-reuse-note" data-slot="nap-reuse" role="status"${reutilizables ? '' : ' hidden'}>${escapeHtml(_napReuseText(reutilizables))}</div>
        <div class="nap-actions">
          <button class="add-row-btn nap-ports-btn" type="button" data-action="view-ports" data-nap="${escapeHtml(ref)}">Ver puertos</button>
          <button class="add-row-btn nap-gpon-btn" type="button" data-action="select-gpon" data-nap="${escapeHtml(ref)}"
            aria-pressed="${isSelected}">
            ${isSelected ? 'Seleccionada' : 'Seleccionar para GPON'}
          </button>
          ${_napDirectionsBtnHtml(n)}
        </div>
        <div class="nap-ports-slot" data-ports-for="${escapeHtml(ref)}" data-slot="ports-${escapeHtml(ref)}"></div>
      </div>`;
  }).join('');
}

// Texto de un puerto elegible para GPON.
function _gponPortText(p) {
  return _portState(p) === 'cancelado'
    ? `Puerto ${pad(p.portNumber)} (reutilizable, cliente cancelado)`
    : `Puerto ${pad(p.portNumber)} (libre)`;
}

// Actualiza el bloque resumen de la NAP seleccionada para GPON.
// Puerto sugerido: el primer libre; si no hay libres y ya se consultaron los
// status, el primer puerto con cliente Cancelado (reutilizable). El técnico
// puede elegir cualquier puerto libre o cancelado (_napPanelState.selectedPort).
async function _renderGponSummary(scope) {
  const summarySlot = scope.querySelector('[data-slot="gpon-summary"]');
  if (!summarySlot) return;
  const napRef = _napPanelState.selectedNap;
  if (!napRef) {
    summarySlot.innerHTML = '';
    summarySlot.hidden = true;
    return;
  }
  summarySlot.hidden = false;
  // Con caché el repintado es inmediato: no se muestra "cargando" (evita
  // parpadeo y pérdida de foco al elegir puerto).
  const enCache = !!(scope._napPortsCache && scope._napPortsCache[napRef]);
  if (!enCache) summarySlot.innerHTML = `<div class="detail-loading">Obteniendo puerto sugerido…</div>`;

  try {
    const data = await _napPortsCached(scope, napRef);
    const naps = scope._napData || [];
    const nap = naps.find(n => _napRef(n) === napRef) || null;
    const napCode = (nap && nap.napCode) || (data && data.napCode) || napRef;
    const dist = nap ? _napDistanceToNap(nap) : null;
    const distTxt = dist !== null ? `${dist.toFixed(1)} m` : '—';
    const occ = nap ? _napOccupancyText(nap) : '—';
    const color = nap ? _napColorClass(nap) : 'unknown';

    const ports = (data && Array.isArray(data.ports)) ? data.ports : [];
    const libres = ports.filter(p => _portState(p) === 'libre');
    const reutilizables = ports.filter(p => _portState(p) === 'cancelado');
    const sinConsultar = ports.filter(p => _portState(p) === 'sin-consultar').length;
    const elegibles = libres.concat(reutilizables)
      .sort((a, b) => Number(a.portNumber) - Number(b.portNumber));
    const sugerido = libres[0] || reutilizables[0] || null;

    // Puerto elegido: el que marcó el técnico si sigue siendo elegible; si no,
    // el sugerido.
    let elegido = elegibles.find(p => String(p.portNumber) === String(_napPanelState.selectedPort)) || null;
    if (!elegido) elegido = sugerido;
    _napPanelState.selectedPort = elegido ? elegido.portNumber : null;

    // Si la operadora no expone el detalle puerto a puerto, se informa el
    // número de puertos libres que sí viene en el listado de NAPs.
    let freeTxt;
    if (sugerido) {
      freeTxt = _gponPortText(sugerido);
    } else if (data.detailAvailable === false) {
      const n = nap ? _napFreePorts(nap) : null;
      freeTxt = n === null
        ? 'Detalle por puerto no disponible'
        : `${n} puerto${n === 1 ? '' : 's'} libre${n === 1 ? '' : 's'} (sin detalle por puerto)`;
    } else if (sinConsultar > 0) {
      freeTxt = 'Sin puertos libres. Consulta el estado de los clientes en «Ver puertos» para buscar puertos reutilizables.';
    } else {
      freeTxt = 'Sin puertos libres ni reutilizables';
    }
    const sugeridoCls = !sugerido ? ' is-none' : (_portState(sugerido) === 'cancelado' ? ' is-reusable' : '');

    const reuseRow = reutilizables.length ? `
        <div class="nap-gpon-summary-row">
          <span class="nap-gpon-key">Reutilizables</span>
          <span class="nap-gpon-val nap-gpon-reuse">${escapeHtml(_napReuseText(reutilizables.length))}</span>
        </div>` : '';

    // Selector de puerto: radios nativos (teclado y lector de pantalla gratis).
    const picker = elegibles.length ? `
        <fieldset class="nap-port-picker">
          <legend class="nap-gpon-key">Elegir puerto</legend>
          <div class="nap-port-options">
            ${elegibles.map((p) => {
              const reuse = _portState(p) === 'cancelado';
              const checked = !!elegido && String(elegido.portNumber) === String(p.portNumber);
              return `
            <label class="nap-port-opt ${reuse ? 'reusable' : 'free'}${checked ? ' is-checked' : ''}">
              <input type="radio" name="gpon-port" value="${escapeHtml(p.portNumber)}"
                data-action="gpon-port"${checked ? ' checked' : ''}
                aria-label="${escapeHtml(_gponPortText(p))}">
              <span class="nap-port-opt-num" aria-hidden="true">${pad(p.portNumber)}</span>
              <small aria-hidden="true">${reuse ? 'Cancelado' : 'Libre'}</small>
            </label>`;
            }).join('')}
          </div>
        </fieldset>` : '';

    // Solo se muestra si el técnico eligió un puerto distinto del sugerido.
    const elegidoRow = (elegido && elegido !== sugerido) ? `
        <div class="nap-gpon-summary-row">
          <span class="nap-gpon-key">Puerto elegido</span>
          <span class="nap-gpon-val nap-gpon-free-port${_portState(elegido) === 'cancelado' ? ' is-reusable' : ''}">${escapeHtml(_gponPortText(elegido))}</span>
        </div>` : '';

    // TODO: a futuro -> enviar selección (NAP + puerto) a API GPON Xtreme (POST .../assign-nap)

    summarySlot.innerHTML = `
      <div class="nap-gpon-summary">
        <div class="nap-gpon-summary-title">NAP seleccionada para GPON Xtreme</div>
        <div class="nap-gpon-summary-row">
          <span class="nap-gpon-key">NAP</span>
          <span class="nap-gpon-val nap-name">${escapeHtml(napCode)}</span>
        </div>
        ${(nap && nap.networkName) ? `
        <div class="nap-gpon-summary-row">
          <span class="nap-gpon-key">Red de acceso</span>
          <span class="nap-gpon-val">${escapeHtml(nap.networkName)}</span>
        </div>` : ''}
        <div class="nap-gpon-summary-row">
          <span class="nap-gpon-key">Distancia</span>
          <span class="nap-gpon-val">${escapeHtml(distTxt)}</span>
        </div>
        <div class="nap-gpon-summary-row">
          <span class="nap-gpon-key">Puertos</span>
          <span class="nap-gpon-val"><span class="nap-state-badge ${color}">${escapeHtml(nap ? _napColorLabel(nap) : 'Sin dato de puertos')}</span> ${escapeHtml(occ)}</span>
        </div>
        ${reuseRow}
        <div class="nap-gpon-summary-row">
          <span class="nap-gpon-key">Puerto sugerido</span>
          <span class="nap-gpon-val nap-gpon-free-port${sugeridoCls}">${escapeHtml(freeTxt)}</span>
        </div>
        ${elegidoRow}
        ${picker}
      </div>`;

    summarySlot.querySelectorAll('[data-action="gpon-port"]').forEach((radio) => {
      radio.addEventListener('change', async () => {
        if (!radio.checked) return;
        _napPanelState.selectedPort = radio.value;
        // Solo repinta desde la caché: elegir puerto no llama a la operadora.
        await _renderGponSummary(scope);
        const again = Array.from(summarySlot.querySelectorAll('[data-action="gpon-port"]'))
          .find(r => r.value === radio.value);
        if (again) again.focus();
      });
    });
  } catch (err) {
    summarySlot.innerHTML = `<div class="detail-error">${escapeHtml(err.message || 'Error al cargar puertos')}</div>`;
  }
}

// Tras consultar status en la grilla de una NAP: actualiza el aviso de
// reutilizables de su tarjeta (SIN cambiar el color: la regla es por conteo)
// y, si es la NAP elegida para GPON, recalcula el puerto sugerido.
function _napAfterStatuses(slot) {
  if (!slot || !slot.closest) return;
  const scope = slot.closest('[data-panel="nap-gpon"]');
  const napRef = slot.dataset ? slot.dataset.portsFor : null;
  if (!scope || !napRef) return;
  const n = _napReusablePorts(scope, napRef).length;
  const cards = scope.querySelectorAll ? scope.querySelectorAll('.nap-card') : [];
  cards.forEach((card) => {
    if (card.dataset.nap !== napRef) return;
    const note = card.querySelector('[data-slot="nap-reuse"]');
    if (!note) return;
    note.textContent = _napReuseText(n);
    note.hidden = n === 0;
  });
  if (_napPanelState.selectedNap === napRef) _renderGponSummary(scope);
}

// Consulta las NAPs cercanas a la coordenada capturada y pinta las tarjetas.
// La API de operadora (TEC) indexa por lat/lng, así que sin coordenada no hay
// nada que pedir: se muestra el aviso en vez de una lista vacía.
async function _napFetchAndRender(scope) {
  const slot = scope.querySelector('[data-slot="nap-cards"]');
  if (!slot) return;
  const coords = _napPanelState.coords;

  _napRenderDegradedNote(scope, null);
  // Búsqueda nueva: la carga automática de puertos de la anterior deja de
  // pintar (lo que ya trajo queda en la caché del panel).
  scope._napPortsGen = (scope._napPortsGen || 0) + 1;
  _napPortsProgress(scope, '');

  if (!coords) {
    slot.innerHTML = `<div class="detail-empty">Captura tu ubicación (GPS o lat/lng manual) para buscar las NAPs del sector.</div>`;
    _napRenderMap(scope);
    return;
  }

  slot.innerHTML = `<div class="detail-loading">Buscando NAPs cercanas…</div>`;
  try {
    const res = await WifixAPI.getNearbyNaps(coords, {
      meters: _napPanelState.meters,
      maxRows: _napPanelState.maxRows,
    });
    const naps = (res && Array.isArray(res.naps)) ? res.naps : [];
    _napPanelState.naps = naps;
    _napPanelState.degraded = (res && res.degraded) || null;
    scope._napData = _napPanelState.naps;

    // El aviso de degradación va ENCIMA de las tarjetas y no oculta resultados.
    _napRenderDegradedNote(scope, _napPanelState.degraded);

    if (_napPanelState.naps.length === 0) {
      slot.innerHTML = `<div class="detail-empty">${escapeHtml(_napEmptyText())}</div>`;
      _napRenderMap(scope);
      return;
    }
    // Si la NAP seleccionada ya no está en el resultado, se limpia la selección.
    if (_napPanelState.selectedNap &&
        !_napPanelState.naps.some(n => _napRef(n) === _napPanelState.selectedNap)) {
      _napPanelState.selectedNap = null;
      _napPanelState.selectedPort = null;
      await _renderGponSummary(scope);
      _clientLocRefresh(scope);
    }
    _renderNapCards(_napPanelState.naps, scope);
    _napRenderAllFullHint(scope);
    _wireNapCardButtons(scope, _napPanelState.naps);
    _napRenderMap(scope);
    // Puertos de cada NAP en segundo plano (no se espera: la lista ya está).
    const lista = _napPanelState.naps;
    _napAutoLoadPorts(scope, lista, {
      onDone: () => {
        if (_napPanelState.naps !== lista) return;
        _napRenderAllFullHint(scope);
        _napRenderMap(scope);
      },
    }).catch((err) => console.error('[Wifix] carga automática de puertos', err));
  } catch (err) {
    console.error('[Wifix] NAPs cercanas', err);
    slot.innerHTML = renderPanelError(err, 'No se pudieron consultar las NAPs.');
    _napPanelState.naps = [];
    _napRenderMap(scope);
  }
}

// Lista vacía según el radio elegido.
function _napEmptyText() {
  if (_napPanelState.meters >= NAP_EXTENDED_RADIUS_M) {
    return `No hay NAPs registradas a ${NAP_EXTENDED_RADIUS_M} m (rango extendido) de esta coordenada.`;
  }
  return `No hay NAPs a ${NAP_INSTALL_RADIUS_M} m (radio de instalación). Prueba el rango extendido de ${NAP_EXTENDED_RADIUS_M} m.`;
}

// Con el radio de instalación, si TODAS las NAPs encontradas están llenas se
// sugiere el rango extendido. Se antepone a las tarjetas (no las oculta).
function _napRenderAllFullHint(scope) {
  const slot = scope.querySelector('[data-slot="nap-cards"]');
  if (!slot) return;
  // Se recalcula tras la carga de puertos: primero se quita el aviso previo.
  const previo = slot.querySelector ? slot.querySelector('.nap-radius-hint') : null;
  if (previo && previo.remove) previo.remove();
  if (_napPanelState.meters >= NAP_EXTENDED_RADIUS_M) return;
  const naps = _napPanelState.naps || [];
  if (!naps.length || !naps.every(n => _napColorClass(n) === 'full')) return;
  slot.insertAdjacentHTML('afterbegin',
    `<div class="nap-radius-hint" role="status">Todas las NAPs del radio de instalación (${NAP_INSTALL_RADIUS_M} m) están llenas. ` +
    `Prueba el rango extendido de ${NAP_EXTENDED_RADIUS_M} m.</div>`);
}

// Aviso discreto de resultado degradado (fuente alternativa, lista recortada…).
function _napRenderDegradedNote(scope, degraded) {
  const slot = scope.querySelector('[data-slot="nap-degraded"]');
  if (!slot) return;
  if (!degraded || !degraded.message) {
    slot.innerHTML = '';
    slot.hidden = true;
    return;
  }
  slot.hidden = false;
  slot.innerHTML = `<div class="nap-degraded-note" role="status">${escapeHtml(degraded.message)}</div>`;
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

  // Toma lo que haya en los inputs (incluida la coordenada precargada de la
  // orden) sin disparar la consulta: la dispara siempre un gesto del técnico.
  function adoptInputCoords() {
    const lat = parseFloat(latInput.value);
    const lng = parseFloat(lngInput.value);
    if (!isFinite(lat) || !isFinite(lng)) return false;
    const cur = _napPanelState.coords;
    if (!cur || cur.latitude !== lat || cur.longitude !== lng) {
      _napPanelState.coords = { latitude: lat, longitude: lng, accuracy: null };
    }
    return true;
  }

  // Ingreso manual: se usa `change` y no `input` para no lanzar una consulta
  // a la operadora por cada tecla.
  function onManualCoords() {
    if (!adoptInputCoords()) return;
    gpsStatus.textContent = 'Coordenadas ingresadas manualmente.';
    gpsStatus.className = 'nap-gps-status ok';
    _napFetchAndRender(scope);
  }
  latInput.addEventListener('change', onManualCoords);
  lngInput.addEventListener('change', onManualCoords);

  // --- Radio de búsqueda y cantidad de filas ------------------------------
  // Una consulta por cambio explícito: nada automático, nada por scroll.
  const radiusBtns = scope.querySelectorAll('[data-action="nap-meters"]');
  radiusBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const meters = parseInt(btn.dataset.meters, 10);
      if (!isFinite(meters)) return;
      _napPanelState.meters = meters;
      radiusBtns.forEach((b) => {
        const on = b === btn;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      const help = scope.querySelector('[data-slot="nap-radius-help"]');
      if (help) {
        help.textContent = _napRadiusOption(meters).help;
        help.classList.toggle('is-extended', meters >= NAP_EXTENDED_RADIUS_M);
      }
      adoptInputCoords();
      _napFetchAndRender(scope);
    });
  });

  const rowsSelect = scope.querySelector('[data-field="nap-maxrows"]');
  if (rowsSelect) {
    rowsSelect.addEventListener('change', () => {
      const rows = parseInt(rowsSelect.value, 10);
      if (!isFinite(rows)) return;
      _napPanelState.maxRows = rows;
      adoptInputCoords();
      _napFetchAndRender(scope);
    });
  }

  const searchBtn = scope.querySelector('[data-action="nap-search"]');
  if (searchBtn) {
    searchBtn.addEventListener('click', () => {
      if (!adoptInputCoords()) {
        gpsStatus.textContent = 'Ingresa una latitud y longitud válidas o usa el GPS.';
        gpsStatus.className = 'nap-gps-status error';
        return;
      }
      _napFetchAndRender(scope);
    });
  }

  // --- Delegación: "Cómo llegar" y centrar mapa desde la tarjeta -----------
  // Las tarjetas se regeneran con innerHTML: un solo listener en el panel.
  scope.addEventListener('click', (ev) => {
    const t = ev.target;
    if (!t || !t.closest) return;
    const dir = t.closest('[data-action="nap-directions"]');
    if (dir) {
      ev.stopPropagation();
      _napOpenDirections(dir.dataset.lat, dir.dataset.lng, dir);
      return;
    }
    const foco = t.closest('[data-action="nap-focus"]');
    if (foco) {
      _napMapFocus(foco.dataset.nap, true);
      return;
    }
    const retryPorts = t.closest('[data-action="nap-ports-retry"]');
    if (retryPorts) {
      ev.stopPropagation();
      _napRetryPorts(scope, retryPorts.dataset.nap, () => {
        _napRenderAllFullHint(scope);
        _napRenderMap(scope);
      });
      return;
    }
    // Tap en la zona "neutra" de la tarjeta (no en botones ni en la grilla).
    const card = t.closest('.nap-card');
    if (card && !t.closest('button, a, input, select, label, .nap-ports-slot')) {
      _napMapFocus(card.dataset.nap, true);
    }
  });
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
      if (_napPanelState.selectedNap !== fresh.dataset.nap) _napPanelState.selectedPort = null;
      _napPanelState.selectedNap = fresh.dataset.nap;
      _renderNapCards(naps, scope);
      _wireNapCardButtons(scope, naps);
      _napMapFocus(fresh.dataset.nap, false);
      await _renderGponSummary(scope);
      // Casa cliente: la distancia se mide contra la NAP elegida para GPON.
      _clientLocRefresh(scope);
    });
  });
}

// ---------------------------------------------------------------------------
// Visita técnica — NAP actual del cliente (GET /accounts/:n/current-nap)
// ---------------------------------------------------------------------------

// Texto del aviso cuando no se encontró la NAP del cliente o la consulta falló.
// Devuelve '' si no corresponde aviso (no hubo consulta o se encontró).
function _napCurrentNoticeText() {
  const err = _napPanelState.currentNapError;
  if (err) {
    if (err.code === 'NETWORK_ERROR') {
      return 'Sin conexión con el servidor: no se pudo consultar la NAP del cliente.';
    }
    return `No se pudo consultar la NAP del cliente (${err.message || 'error de la operadora'}).`;
  }
  const cur = _napPanelState.currentNap;
  if (!cur || cur.found) return '';
  if (cur.reason === 'NO_COORDS') return 'El cliente no tiene coordenadas registradas: no se pudo ubicar su NAP.';
  if (cur.reason === 'NOT_SUPPORTED') return 'La fuente de NAPs de esta operadora no soporta esta consulta.';
  return 'No se encontró la NAP contratada del cliente.';
}

// En Visita técnica / Migración no hay búsqueda de NAPs de respaldo: el aviso
// va solo y, si fue un error de consulta, con "Reintentar".
function _napCurrentNoticeHtml() {
  const txt = _napCurrentNoticeText();
  if (!txt) return '';
  const retry = _napPanelState.currentNapError
    ? '<button type="button" class="add-row-btn nap-retry-btn" data-action="nap-current-retry">Reintentar</button>'
    : '';
  return `<div class="nap-current-note" role="status">${escapeHtml(txt)}</div>${retry}`;
}

// Motivo de la NAP simulada (simulationReason del backend), en español.
const NAP_SIMULATION_REASON_TEXT = Object.freeze({
  NOT_FOUND: 'la operadora no identificó la NAP de esta cuenta',
  NO_COORDS: 'el cliente no tiene coordenadas registradas',
  NOT_SUPPORTED: 'la fuente de NAPs de la operadora no soporta esta consulta',
  UPSTREAM_AUTH_ERROR: 'el acceso a FSM no está disponible',
  UPSTREAM_UNAVAILABLE: 'FSM no está respondiendo',
});

// ¿Se pueden pedir los puertos de la NAP del cliente? Una NAP simulada trae
// napId null y un código inventado: NUNCA se consulta /naps/{ref}/ports.
function _napCanLoadPorts(cur) {
  return !!(cur && cur.nap) && !_napIsSimulated(cur);
}

// Aviso de la NAP simulada. Si el backend ya manda `degraded` (FSM caído) su
// mensaje lo explica: no se repite.
function _napSimulationNoteHtml(cur) {
  if (!_napIsSimulated(cur) || (cur.degraded && cur.degraded.message)) return '';
  const motivo = NAP_SIMULATION_REASON_TEXT[cur.simulationReason];
  return `<div class="nap-degraded-note" role="status">NAP asignada simulada${motivo ? `: ${escapeHtml(motivo)}` : ''}. ` +
    'Son datos de prueba; el detalle de puertos no está disponible.</div>';
}

// Aviso de degradación: objeto { reason, message } o solo el código.
function _napDegradedText(degraded) {
  if (!degraded) return '';
  if (typeof degraded === 'string') {
    if (degraded === 'FSM_AUTH') return 'El acceso a FSM no está disponible: se muestra la NAP asignada de forma simulada.';
    if (degraded === 'FSM_UNAVAILABLE') return 'FSM no está respondiendo: se muestra la NAP asignada de forma simulada.';
    return '';
  }
  return degraded.message || '';
}

// Badges de la NAP del cliente: "Contratada" (assignment) y "Simulado".
function _napClientBadgesHtml(cur) {
  const asignada = cur && (cur.assignment || (cur.nap && cur.nap.assignment));
  const contratada = asignada === 'CONTRACTED'
    ? '<span class="nap-client-badge">Contratada</span>' : '';
  const simulada = _napIsSimulated(cur)
    ? '<span class="sim-badge" title="Dato simulado: la operadora aún no expone la NAP de esta cuenta">Simulado</span>' : '';
  return contratada + simulada;
}

// Tarjeta única "NAP del cliente" (Visita técnica / Migración).
function _renderCurrentNapCard() {
  if (!_napHasClientNap()) return _napCurrentNoticeHtml();
  const cur = _napPanelState.currentNap;
  const n = cur.nap;
  const ref = _napRef(n);
  const color = _napColorClass(n);
  const red = n.networkName
    ? `<span class="nap-network-name"><span class="nap-network-key">Red de acceso</span>${escapeHtml(n.networkName)}</span>`
    : '';
  const tienePuerto = cur.portNumber !== null && cur.portNumber !== undefined;
  const puerto = tienePuerto
    ? `<div class="nap-client-port"><span class="nap-client-port-num">Puerto ${escapeHtml(pad(cur.portNumber))}</span> del cliente</div>`
    : '<div class="nap-client-port is-unknown">Puerto del cliente no informado</div>';
  const st = cur.clientStatus;
  const grupo = clientStatusGroup(st ? (st.code || st.name) : null);
  // Texto literal de la operadora: si ya empieza con el grupo ("Activo
  // (simulado)") va solo; si aporta otra cosa ("Suspendido por mora"), entre
  // paréntesis tras el grupo.
  const desc = st && st.description ? String(st.description) : '';
  const extiende = !!desc && desc.toUpperCase().startsWith(grupo.label.toUpperCase());
  const estadoTxt = extiende ? desc : grupo.label;
  const literal = desc && !extiende
    ? ` <span class="nap-client-status-sub">(${escapeHtml(desc)})</span>` : '';
  const degTxt = _napDegradedText(cur.degraded);
  const degraded = (degTxt ? `<div class="nap-degraded-note" role="status">${escapeHtml(degTxt)}</div>` : '')
    + _napSimulationNoteHtml(cur);
  const puertos = _napCanLoadPorts(cur) ? `
        <button class="add-row-btn nap-ports-btn" type="button" data-action="view-ports" data-nap="${escapeHtml(ref)}"
          aria-expanded="false">Ver puertos</button>` : '';
  const equipo = cur.equipmentId ? `
        <span class="nap-client-equipment">
          <span class="nap-client-key">Equipo</span><span class="mono">${escapeHtml(cur.equipmentId)}</span>
        </span>` : '';
  return `
    ${degraded}
    <div class="nap-card nap-current nap-state-${color}" data-nap="${escapeHtml(ref)}">
      <div class="nap-head">
        ${_napNameHtml(n, ref)}
        <span class="nap-badges">
          ${_napClientBadgesHtml(cur)}
          <span class="nap-state-badge ${color}">${escapeHtml(_napColorLabel(n))}</span>
        </span>
      </div>
      ${red}
      <div class="nap-occ" data-slot="nap-occ">${_napOccupancyBar(n)}</div>
      ${_napCanLoadPorts(cur) ? `<div class="nap-ports-auto-slot" data-slot="nap-ports-status"></div>
      <div class="nap-reuse-note" data-slot="nap-reuse" role="status" hidden></div>` : ''}
      ${puerto}
      <div class="nap-client-meta">
        <span class="nap-client-status ${escapeHtml(grupo.tile)}">
          <span class="nap-client-key">Cliente</span>${escapeHtml(estadoTxt)}${literal}
        </span>${equipo}
      </div>
      <div class="nap-actions">${puertos}
        ${_napDirectionsBtnHtml(n)}
      </div>
      ${_napCanLoadPorts(cur) ? `<div class="nap-ports-slot" data-ports-for="${escapeHtml(ref)}" data-slot="ports-${escapeHtml(ref)}"></div>` : ''}
      ${_renderClientLocSection()}
    </div>`;
}

// "Ver puertos" de la tarjeta del cliente (misma grilla que la lista). Con la
// NAP simulada no hay botón ni se conecta nada.
function _wireNapCurrentCard(scope) {
  if (!_napHasClientNap() || !_napCanLoadPorts(_napPanelState.currentNap)) return;
  wireNapPortsButtons(scope);
}

// ---------------------------------------------------------------------------
// Ubicación "Casa cliente" (Visita técnica / Migración / Instalaciones)
// GET/POST /accounts/:accountNumber/client-location. Append-only: cada captura
// es un registro nuevo; nunca se edita la anterior.
// ---------------------------------------------------------------------------
const CLIENT_LOC_LABEL = 'CASA_CLIENTE';
// Por encima de esta precisión (m) el GPS se marca "baja" (texto, no solo color).
const CLIENT_LOC_LOW_ACCURACY_M = 30;
const CLIENT_LOC_NOTES_MAX = 500;

function _clientLocEmptyState() {
  return {
    account: null,
    loading: false,
    error: null,              // Error del GET (la captura sigue disponible)
    latest: null,             // última captura guardada (forma de la respuesta 201)
    items: [],                // historial de capturas (más reciente primero)
    registeredLocation: null, // ubicación registrada de la operadora o null
    draft: null,              // { latitude, longitude, accuracyMeters, source, capturedAt }
    saving: false,
  };
}

// Normaliza GET .../client-location → { latest, items, registeredLocation }.
function _clientLocApplyList(st, r) {
  const body = r || {};
  st.items = Array.isArray(body.items) ? body.items : [];
  st.latest = body.latest || st.items[0] || null;
  st.registeredLocation = body.registeredLocation
    || (st.latest && st.latest.registeredLocation) || null;
}

function _clientLocValidCoords(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(lat === 0 && lng === 0);
}

function _isNum(v) {
  return v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
}

function _fmtCoord(v) {
  return _isNum(v) ? Number(v).toFixed(6) : '—';
}

function _fmtMeters(m) {
  if (!_isNum(m)) return null;
  const v = Number(m);
  return v >= 1000 ? `${(v / 1000).toFixed(2)} km` : `${v.toFixed(v < 10 ? 1 : 0)} m`;
}

// Texto de precisión: GPS con ±m (y aviso si es baja) o "ingresada a mano".
function _clientLocAccuracyHtml(source, acc) {
  if (source === 'MANUAL') return 'Ingresada manualmente (sin precisión GPS)';
  if (!_isNum(acc)) return 'GPS · precisión no informada';
  const v = Math.round(Number(acc));
  if (v > CLIENT_LOC_LOW_ACCURACY_M) {
    return `GPS · ±${v} m <span class="client-loc-warn">(precisión baja: acércate a la casa o espera mejor señal)</span>`;
  }
  return `GPS · ±${v} m`;
}

// Distancia de un punto a la NAP del cliente (Haversine local).
// NAP de referencia de la captura Casa cliente:
//   Visita técnica / Migración → la NAP contratada (current-nap) y su puerto.
//   Instalaciones              → la NAP elegida para GPON y el puerto elegido.
// { nap: null, port: null } si todavía no hay NAP.
function _clientLocRefNap() {
  if (_napUsesContractedNap()) {
    const cur = _napPanelState.currentNap;
    return {
      nap: _napHasClientNap() ? cur.nap : null,
      port: cur ? cur.portNumber : null,
    };
  }
  const ref = _napPanelState.selectedNap;
  const nap = ref ? (_napPanelState.naps || []).find(n => _napRef(n) === ref) || null : null;
  return { nap, port: nap ? _napPanelState.selectedPort : null };
}

function _clientLocDistToNap(pt) {
  const n = _clientLocRefNap().nap;
  if (!pt || !n || !_napHasCoords(n)) return null;
  return _napHaversineMeters(Number(pt.latitude), Number(pt.longitude), Number(n.latitude), Number(n.longitude));
}

function _clientLocDistToRegistered(pt, reg) {
  if (!pt || !reg || !_isNum(reg.latitude) || !_isNum(reg.longitude)) return null;
  return _napHaversineMeters(Number(pt.latitude), Number(pt.longitude), Number(reg.latitude), Number(reg.longitude));
}

// Filas "Distancia a la NAP" y "Ubicación registrada". Usa las distancias del
// backend si vienen (captura guardada); si no (sin guardar), las calcula aquí.
function _clientLocComparisonHtml(pt, fromBackend) {
  const st = _napPanelState.clientLoc;
  const reg = (fromBackend && fromBackend.registeredLocation) || st.registeredLocation || null;
  const refNap = _clientLocRefNap().nap;
  // La captura guardada trae su propio napCode (la NAP de ese momento).
  const napCode = (fromBackend && fromBackend.napCode) || (refNap ? (refNap.napCode || 'NAP') : null);
  // El backend solo calcula la distancia contra la NAP de current-nap. En
  // Instalaciones la NAP elegida suele ser otra: si la captura guardada es de
  // esa misma NAP, la distancia se calcula aquí.
  const mismaNap = !!(fromBackend && refNap && fromBackend.napCode && refNap.napCode
    && String(fromBackend.napCode).trim().toUpperCase() === String(refNap.napCode).trim().toUpperCase());
  let dNap;
  if (fromBackend && _isNum(fromBackend.distanceToNapMeters)) dNap = Number(fromBackend.distanceToNapMeters);
  else if (!fromBackend || mismaNap || _napUsesContractedNap()) dNap = _clientLocDistToNap(pt);
  else dNap = null;
  const dReg = fromBackend && _isNum(fromBackend.distanceToRegisteredMeters)
    ? Number(fromBackend.distanceToRegisteredMeters) : _clientLocDistToRegistered(pt, reg);
  let napTxt;
  if (dNap !== null) napTxt = `${escapeHtml(_fmtMeters(dNap))}${napCode ? ` de la NAP ${escapeHtml(napCode)}` : ''}`;
  else if (!refNap && !_napUsesContractedNap()) napTxt = 'Elige una NAP para GPON para calcular la distancia';
  else napTxt = 'Sin coordenada de la NAP para calcular';
  const dePrueba = reg && reg.source === 'MOCK' ? ' (de prueba)' : '';
  let regTxt;
  if (!reg) regTxt = 'Sin ubicación registrada de la operadora para comparar';
  else if (dReg !== null) regTxt = `A ${escapeHtml(_fmtMeters(dReg))} de la ubicación registrada del cliente${dePrueba}`;
  else regTxt = `La ubicación registrada${dePrueba} no trae una coordenada válida`;
  return `
          <div><dt>Distancia a la NAP</dt><dd data-field="client-loc-dist-nap">${napTxt}</dd></div>
          <div><dt>Ubicación registrada</dt><dd data-field="client-loc-dist-reg">${regTxt}</dd></div>`;
}

// Última captura guardada (o vacío / cargando / error del GET).
function _clientLocSavedHtml() {
  const st = _napPanelState.clientLoc;
  if (st.loading) return '<div class="detail-loading">Cargando ubicación guardada…</div>';
  const errHtml = st.error
    ? `<div class="client-loc-error" role="alert">No se pudo cargar la ubicación guardada: ${escapeHtml(st.error.message || 'error del servidor')}.
          <button type="button" class="link-btn" data-action="client-loc-reload">Reintentar</button></div>`
    : '';
  const l = st.latest;
  if (!l) {
    return errHtml || '<p class="client-loc-empty">Aún no hay ubicación de la casa del cliente guardada.</p>';
  }
  const quien = l.capturedBy && l.capturedBy.email ? escapeHtml(l.capturedBy.email) : 'técnico no informado';
  const total = st.items.length > 1
    ? `<p class="client-loc-count">${escapeHtml(String(st.items.length))} capturas guardadas; se muestra la más reciente.</p>` : '';
  return `
      ${errHtml}
      <div class="client-loc-saved">
        <p class="client-loc-saved-head">Casa cliente guardada el ${dateTimeHtml(l.capturedAt || l.createdAt, { seconds: false, relative: false })} por ${quien}</p>
        <dl class="client-loc-facts">
          <div><dt>Coordenadas</dt><dd class="mono">${escapeHtml(_fmtCoord(l.latitude))}, ${escapeHtml(_fmtCoord(l.longitude))}</dd></div>
          <div><dt>Precisión</dt><dd>${_clientLocAccuracyHtml(l.source, l.accuracyMeters)}</dd></div>
          ${_clientLocComparisonHtml(l, l)}
        </dl>
        ${total}
      </div>`;
}

// Captura nueva aún sin guardar.
function _clientLocDraftHtml() {
  const d = _napPanelState.clientLoc.draft;
  if (!d) return '';
  return `
      <div class="client-loc-draft">
        <p class="client-loc-draft-head">Nueva captura (sin guardar)</p>
        <dl class="client-loc-facts">
          <div><dt>Coordenadas</dt><dd class="mono">${escapeHtml(_fmtCoord(d.latitude))}, ${escapeHtml(_fmtCoord(d.longitude))}</dd></div>
          <div><dt>Precisión</dt><dd>${_clientLocAccuracyHtml(d.source, d.accuracyMeters)}</dd></div>
          ${_clientLocComparisonHtml(d, null)}
        </dl>
      </div>`;
}

function _clientLocGpsLabel() {
  return _napPanelState.clientLoc.latest ? 'Recapturar ubicación · Casa cliente' : 'Capturar ubicación · Casa cliente';
}

// Sección completa dentro de la tarjeta de la NAP del cliente.
function _renderClientLocSection() {
  const st = _napPanelState.clientLoc;
  return `
      <section class="client-loc" data-slot="client-loc" aria-labelledby="clientLocTitle">
        <h4 class="client-loc-title" id="clientLocTitle">Ubicación · Casa cliente</h4>
        <div data-slot="client-loc-saved" aria-live="polite">${_clientLocSavedHtml()}</div>
        <div class="client-loc-controls">
          <button type="button" class="add-row-btn client-loc-gps-btn" data-action="client-loc-gps">${_clientLocGpsLabel()}</button>
          <button type="button" class="link-btn client-loc-manual-toggle" data-action="client-loc-manual"
            aria-expanded="false" aria-controls="clientLocManual">Ingresar coordenadas manualmente</button>
        </div>
        <div class="client-loc-manual" id="clientLocManual" data-slot="client-loc-manual" hidden>
          <div class="nap-coords-row">
            <label class="nap-coord-label" for="clientLocLat">
              <span>Latitud</span>
              <input type="number" step="any" inputmode="decimal" id="clientLocLat" data-field="client-loc-lat"
                class="nap-coord-input" placeholder="-2.170000" aria-describedby="clientLocManualError">
            </label>
            <label class="nap-coord-label" for="clientLocLng">
              <span>Longitud</span>
              <input type="number" step="any" inputmode="decimal" id="clientLocLng" data-field="client-loc-lng"
                class="nap-coord-input" placeholder="-79.900000" aria-describedby="clientLocManualError">
            </label>
          </div>
          <p class="client-loc-field-error" id="clientLocManualError" data-slot="client-loc-manual-error" role="alert"></p>
          <button type="button" class="add-row-btn" data-action="client-loc-manual-use">Usar estas coordenadas</button>
        </div>
        <div data-slot="client-loc-draft">${_clientLocDraftHtml()}</div>
        <label class="client-loc-notes-label" for="clientLocNotes">Notas (opcional)</label>
        <textarea class="client-loc-notes" id="clientLocNotes" data-field="client-loc-notes" rows="2"
          maxlength="${CLIENT_LOC_NOTES_MAX}" placeholder="Ej.: casa esquinera, portón verde"></textarea>
        <button type="button" class="save-btn client-loc-save-btn" data-action="client-loc-save"
          ${st.draft ? '' : 'disabled'} aria-describedby="clientLocStatus">Guardar ubicación</button>
        <p class="client-loc-status" id="clientLocStatus" data-slot="client-loc-status" role="status">${
          st.draft ? '' : 'Captura la ubicación para poder guardarla.'}</p>
      </section>`;
}

/**
 * Cuerpo del POST .../client-location a partir de la captura.
 * ctx = { napCode, napPort, taskId, notes }. Lo que no hay se OMITE (el
 * backend valida accuracyMeters como número >= 0 opcional: null da 400), así
 * que una coordenada manual va sin accuracyMeters. capturedAt nunca en el
 * futuro (el backend responde 400): si el reloj se adelantó, se usa "ahora".
 */
function buildClientLocationPayload(draft, ctx = {}) {
  const ahora = Date.now();
  const t = toValidDate(draft.capturedAt);
  const body = {
    latitude: Number(draft.latitude),
    longitude: Number(draft.longitude),
    label: CLIENT_LOC_LABEL,
    source: draft.source === 'MANUAL' ? 'MANUAL' : 'GPS',
    capturedAt: t && t.getTime() <= ahora ? t.toISOString() : new Date(ahora).toISOString(),
  };
  if (body.source === 'GPS' && _isNum(draft.accuracyMeters) && Number(draft.accuracyMeters) >= 0) {
    body.accuracyMeters = Math.round(Number(draft.accuracyMeters) * 10) / 10;
  }
  if (ctx.napCode) body.napCode = String(ctx.napCode);
  if (_isNum(ctx.napPort)) body.napPort = Number(ctx.napPort);
  if (ctx.taskId && String(ctx.taskId).trim()) body.taskId = String(ctx.taskId).trim();
  const notes = ctx.notes ? String(ctx.notes).trim().slice(0, CLIENT_LOC_NOTES_MAX) : '';
  if (notes) body.notes = notes;
  return body;
}

// Repinta las partes que dependen del estado (sin tocar inputs ni notas).
function _clientLocRefresh(scope) {
  if (!scope || !scope.querySelector) return;
  const st = _napPanelState.clientLoc;
  const saved = scope.querySelector('[data-slot="client-loc-saved"]');
  if (saved) saved.innerHTML = _clientLocSavedHtml();
  const draft = scope.querySelector('[data-slot="client-loc-draft"]');
  if (draft) draft.innerHTML = _clientLocDraftHtml();
  const save = scope.querySelector('[data-action="client-loc-save"]');
  if (save) save.disabled = !st.draft || st.saving;
  const gps = scope.querySelector('[data-action="client-loc-gps"]');
  if (gps && !gps.disabled) gps.textContent = _clientLocGpsLabel();
}

function _clientLocStatus(scope, msg, kind) {
  const el = scope && scope.querySelector ? scope.querySelector('[data-slot="client-loc-status"]') : null;
  if (!el) return;
  // Errores: se anuncian de inmediato (alert); el resto, cortés (status).
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.className = 'client-loc-status' + (kind ? ' ' + kind : '');
  el.textContent = msg || '';
}

function _clientLocSetDraft(scope, draft) {
  _napPanelState.clientLoc.draft = draft;
  _clientLocRefresh(scope);
  _napRenderMap(scope);
}

async function _clientLocCaptureGps(scope, btn) {
  const st = _napPanelState.clientLoc;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  btn.textContent = 'Obteniendo GPS…';
  _clientLocStatus(scope, 'Solicitando ubicación GPS…', '');
  try {
    if (typeof WifixNative === 'undefined' || !WifixNative || !WifixNative.getCurrentPosition) {
      throw new Error('GPS no disponible en este dispositivo');
    }
    const pos = await WifixNative.getCurrentPosition({ timeoutMs: 15000 });
    if (_napPanelState.clientLoc !== st) return; // el panel cambió de cuenta
    const lat = Number(pos && pos.latitude);
    const lng = Number(pos && pos.longitude);
    if (!_clientLocValidCoords(lat, lng)) throw new Error('el GPS devolvió una coordenada inválida');
    const acc = _isNum(pos.accuracy) ? Number(pos.accuracy) : null;
    _clientLocSetDraft(scope, { latitude: lat, longitude: lng, accuracyMeters: acc, source: 'GPS', capturedAt: new Date().toISOString() });
    _clientLocStatus(scope,
      `Ubicación capturada${acc !== null ? ` (precisión ±${Math.round(acc)} m)` : ''}. Revisa y toca «Guardar ubicación».`, 'ok');
  } catch (err) {
    if (_napPanelState.clientLoc !== st) return;
    console.error('[Wifix] GPS casa cliente', err);
    _clientLocStatus(scope,
      `No se pudo obtener el GPS: ${err && err.message ? err.message : 'error desconocido'}. Puedes ingresar las coordenadas manualmente.`,
      'error');
    _clientLocToggleManual(scope, true);
  } finally {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    btn.textContent = _clientLocGpsLabel();
  }
}

function _clientLocToggleManual(scope, forceOpen) {
  const wrap = scope.querySelector('[data-slot="client-loc-manual"]');
  const toggle = scope.querySelector('[data-action="client-loc-manual"]');
  if (!wrap || !toggle) return;
  const abrir = forceOpen === true ? true : !!wrap.hidden;
  wrap.hidden = !abrir;
  toggle.setAttribute('aria-expanded', abrir ? 'true' : 'false');
  toggle.textContent = abrir ? 'Ocultar ingreso manual' : 'Ingresar coordenadas manualmente';
}

// Valida lat/lng manuales. Devuelve el draft o null (y marca el error).
function _clientLocUseManual(scope) {
  const latIn = scope.querySelector('[data-field="client-loc-lat"]');
  const lngIn = scope.querySelector('[data-field="client-loc-lng"]');
  const errEl = scope.querySelector('[data-slot="client-loc-manual-error"]');
  if (!latIn || !lngIn) return null;
  const lat = parseFloat(String(latIn.value).replace(',', '.'));
  const lng = parseFloat(String(lngIn.value).replace(',', '.'));
  const latOk = Number.isFinite(lat) && lat >= -90 && lat <= 90;
  const lngOk = Number.isFinite(lng) && lng >= -180 && lng <= 180;
  if (!latOk || !lngOk || !_clientLocValidCoords(lat, lng)) {
    if (!latOk) latIn.setAttribute('aria-invalid', 'true'); else latIn.removeAttribute('aria-invalid');
    if (!lngOk) lngIn.setAttribute('aria-invalid', 'true'); else lngIn.removeAttribute('aria-invalid');
    if (errEl) errEl.textContent = 'Ingresa una latitud (-90 a 90) y una longitud (-180 a 180) válidas.';
    (latOk ? lngIn : latIn).focus();
    return null;
  }
  latIn.removeAttribute('aria-invalid');
  lngIn.removeAttribute('aria-invalid');
  if (errEl) errEl.textContent = '';
  const draft = { latitude: lat, longitude: lng, accuracyMeters: null, source: 'MANUAL', capturedAt: new Date().toISOString() };
  _clientLocSetDraft(scope, draft);
  _clientLocStatus(scope, 'Coordenadas ingresadas manualmente. Revisa y toca «Guardar ubicación».', 'ok');
  return draft;
}

async function _clientLocSave(scope, btn) {
  const st = _napPanelState.clientLoc;
  if (!st.draft || st.saving || !st.account) return null;
  st.saving = true;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  btn.textContent = 'Guardando…';
  _clientLocStatus(scope, 'Guardando ubicación de la casa del cliente…', '');
  const notesEl = scope.querySelector('[data-field="client-loc-notes"]');
  let saved = null;
  try {
    // Mismo taskId que el resto de registros: workOrder/fsmTaskId de la
    // visita PENDIENTE de la cuenta (null → no se envía).
    const taskId = await resolveCurrentVisitTaskId(st.account);
    // NAP de referencia según el módulo (contratada o la elegida para GPON).
    // El contrato del POST no lleva campo de módulo/origen: no se envía.
    const ref = _clientLocRefNap();
    const payload = buildClientLocationPayload(st.draft, {
      napCode: ref.nap ? ref.nap.napCode : null,
      napPort: ref.port,
      taskId,
      notes: notesEl ? notesEl.value : '',
    });
    saved = await WifixAPI.createClientLocation(st.account, payload);
    if (_napPanelState.clientLoc !== st) return null;
    st.latest = saved;
    st.items = [saved].concat(st.items.filter((x) => x && x.id !== saved.id));
    if (saved && saved.registeredLocation !== undefined) st.registeredLocation = saved.registeredLocation;
    st.draft = null;
    st.error = null;
    if (notesEl) notesEl.value = '';
    _clientLocStatus(scope, 'Ubicación de la casa del cliente guardada.', 'ok');
  } catch (err) {
    console.error('[Wifix] guardar casa cliente', err);
    if (_napPanelState.clientLoc === st) {
      _clientLocStatus(scope,
        `No se pudo guardar la ubicación: ${err && err.message ? err.message : 'error desconocido'}. La captura sigue aquí; vuelve a intentarlo.`,
        'error');
    }
  } finally {
    st.saving = false;
    btn.removeAttribute('aria-busy');
    btn.textContent = 'Guardar ubicación';
    if (_napPanelState.clientLoc === st) {
      _clientLocRefresh(scope);
      _napRenderMap(scope);
    }
  }
  return saved;
}

async function _clientLocReload(scope) {
  const st = _napPanelState.clientLoc;
  if (!st.account) return;
  st.loading = true;
  st.error = null;
  _clientLocRefresh(scope);
  try {
    const r = await WifixAPI.getClientLocation(st.account);
    if (_napPanelState.clientLoc !== st) return;
    _clientLocApplyList(st, r);
  } catch (err) {
    if (_napPanelState.clientLoc !== st) return;
    st.error = err;
  }
  st.loading = false;
  _clientLocRefresh(scope);
  _napRenderMap(scope);
}

// Conecta la sección Casa cliente (delegación: su contenido se repinta).
function _wireClientLoc(scope) {
  const sec = scope && scope.querySelector ? scope.querySelector('[data-slot="client-loc"]') : null;
  if (!sec || !sec.addEventListener) return;
  sec.addEventListener('click', (ev) => {
    const t = ev.target;
    const btn = t && t.closest ? t.closest('[data-action]') : null;
    if (!btn || !/^client-loc-/.test(btn.dataset.action || '')) return;
    ev.stopPropagation();
    const action = btn.dataset.action;
    if (action === 'client-loc-gps') _clientLocCaptureGps(scope, btn);
    else if (action === 'client-loc-manual') _clientLocToggleManual(scope);
    else if (action === 'client-loc-manual-use') _clientLocUseManual(scope);
    else if (action === 'client-loc-save') _clientLocSave(scope, btn);
    else if (action === 'client-loc-reload') _clientLocReload(scope);
  });
}

// Registro "Ubicación casa cliente" en las tarjetas de visitas anteriores.
function _recClientLocationHtml(c) {
  const dNap = _fmtMeters(c.distanceToNapMeters);
  const dReg = _fmtMeters(c.distanceToRegisteredMeters);
  let acc;
  if (c.source === 'MANUAL') acc = 'ingresada manualmente';
  else acc = _isNum(c.accuracyMeters) ? `GPS ±${Math.round(Number(c.accuracyMeters))} m` : 'GPS, precisión no informada';
  let reg = '';
  const dePrueba = c.registeredLocation && c.registeredLocation.source === 'MOCK' ? ' (de prueba)' : '';
  if (dReg) reg = `a <strong>${escapeHtml(dReg)}</strong> de la ubicación registrada${dePrueba}`;
  else if (c.registeredLocation === null) reg = 'sin ubicación registrada de la operadora para comparar';
  const distancias = [
    dNap ? `a <strong>${escapeHtml(dNap)}</strong> de la NAP${c.napCode ? ' ' + escapeHtml(c.napCode) : ''}` : '',
    reg,
  ].filter(Boolean).join(' · ');
  return `
    <li class="rec-item">
      <div class="rec-head"><span class="rec-title">Ubicación casa cliente</span></div>
      <div class="rec-values"><span class="mono">${escapeHtml(_fmtCoord(c.latitude))}, ${escapeHtml(_fmtCoord(c.longitude))}</span> · ${escapeHtml(acc)}</div>
      ${distancias ? `<div class="rec-values">${distancias}</div>` : ''}
      <div class="rec-meta">${_recordWhen(c, 'capturedAt')}${_recordLinkHint(c)}</div>
    </li>`;
}

// "Cómo llegar": abre Google Maps fuera de la app (ver WifixNative.openDirections).
async function _napOpenDirections(lat, lng, btn) {
  try {
    if (typeof WifixNative !== 'undefined' && WifixNative && WifixNative.openDirections) {
      await WifixNative.openDirections(lat, lng);
      return;
    }
    const url = `https://www.google.com/maps/dir/?api=1&destination=${Number(lat)},${Number(lng)}&travelmode=walking`;
    window.open(url, '_blank', 'noopener');
  } catch (err) {
    console.error('[Wifix] Cómo llegar', err);
    if (btn) btn.setAttribute('title', err.message || 'No se pudo abrir la ruta.');
    alert(err.message || 'No se pudo abrir la ruta.');
  }
}

// ---------------------------------------------------------------------------
// Mapa de NAPs (Leaflet 1.9.4 vendorizado en vendor/leaflet/)
// ---------------------------------------------------------------------------
// Tiles públicos de OpenStreetMap: aptos para uso bajo (política de uso de OSM).
// Si crece el tráfico, cambiar a un proveedor con clave (MapTiler, Carto…):
// basta con esta URL y la atribución.
const NAP_MAP_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const NAP_MAP_ATTRIBUTION = '© OpenStreetMap';
const NAP_MAP_UNAVAILABLE = 'Mapa no disponible sin conexión';
// Tiles fallidos (sin ninguno cargado) para dar el mapa por caído.
const NAP_MAP_MAX_TILE_ERRORS = 4;

function _napMapEmptyState() {
  return {
    map: null, el: null, layer: null, markers: {}, ro: null,
    tileErrors: 0, tileLoads: 0, failed: false, scope: null,
  };
}

// Una sola instancia por panel. Si el panel se regenera (se reabre Datos del
// Servicio), el contenedor viejo queda desconectado y la instancia se destruye.
let _napMap = _napMapEmptyState();

function _napMapDestroy() {
  try { if (_napMap.ro) _napMap.ro.disconnect(); } catch (_) { /* ignore */ }
  try { if (_napMap.map) _napMap.map.remove(); } catch (_) { /* ignore */ }
  _napMap = _napMapEmptyState();
}

function _napMapLeafletReady() {
  return typeof L !== 'undefined' && !!L && typeof L.map === 'function';
}

// Aviso en lugar del mapa. La lista de NAPs sigue funcionando.
// `failedScope`: recuerda que los tiles de ESTE panel no cargan, para no
// reintentar en cada repintado.
function _napMapShowUnavailable(slot, failedScope) {
  _napMapDestroy();
  if (failedScope) {
    _napMap.failed = true;
    _napMap.scope = failedScope;
  }
  if (slot) slot.innerHTML = `<div class="nap-map-unavailable" role="status">${NAP_MAP_UNAVAILABLE}</div>`;
}

// NAPs a pintar: en Visita técnica / Migración, solo la NAP contratada del
// cliente; en Instalaciones, las cercanas. Sin coordenada se omiten.
function _napMapNaps() {
  const out = [];
  const vistos = {};
  const add = (n) => {
    if (!_napHasCoords(n)) return;
    const ref = _napRef(n);
    if (vistos[ref]) return;
    vistos[ref] = true;
    out.push(n);
  };
  if (_napUsesContractedNap()) {
    if (_napHasClientNap()) add(_napPanelState.currentNap.nap);
    return out;
  }
  (_napPanelState.naps || []).forEach(add);
  return out;
}

// Puntos extra del mapa:
//   casa: captura "Casa cliente" (la nueva sin guardar manda sobre la guardada)
//         — Instalaciones, Visita técnica y Migración.
//   registered: ubicación registrada de la operadora (del GET client-location;
//   mientras no llega, la coordenada del domicilio del perfil) — solo Visita
//   técnica / Migración (Instalaciones ya pinta el domicilio del perfil).
function _napMapClientPoints() {
  if (!_napUsesClientLoc()) return { casa: null, registered: null, napFallback: null };
  const st = _napPanelState.clientLoc;
  const valid = (p) => !!p && _isNum(p.latitude) && _isNum(p.longitude);
  let casa = null;
  if (valid(st.draft)) casa = { latitude: Number(st.draft.latitude), longitude: Number(st.draft.longitude), unsaved: true };
  else if (valid(st.latest)) casa = { latitude: Number(st.latest.latitude), longitude: Number(st.latest.longitude), unsaved: false };
  if (!_napUsesContractedNap()) return { casa, registered: null, napFallback: null };
  let reg = st.registeredLocation;
  if (!reg && (st.loading || st.error)) reg = _napPanelState.homeCoords;
  const registered = valid(reg)
    ? { latitude: Number(reg.latitude), longitude: Number(reg.longitude), mock: reg.source === 'MOCK' } : null;
  // Sin NAP de current-nap (error de consulta): la posición de la NAP que
  // guardó el backend con la última captura (napLocation), si la hay.
  const nl = st.latest && st.latest.napLocation;
  const napFallback = !_napHasClientNap() && valid(nl)
    ? { latitude: Number(nl.latitude), longitude: Number(nl.longitude), simulated: nl.simulated === true } : null;
  return { casa, registered, napFallback };
}

const _NAP_MAP_HOME_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">' +
  '<path fill="currentColor" d="M12 3 2 12h3v8h5v-5h4v5h5v-8h3z"/></svg>';

// Contenido del popup de una NAP (todo el texto pasa por escapeHtml).
function _napMapPopupHtml(n) {
  const esCliente = _napRef(n) === _napCurrentRef();
  return `
    <div class="nap-map-popup">
      <strong class="nap-map-popup-code">${escapeHtml(n.napCode || '—')}</strong>
      ${esCliente ? '<span class="nap-client-badge">NAP del cliente</span>' : ''}
      ${_napOutOfRadiusBadgeHtml(n)}
      <span class="nap-map-popup-occ">${escapeHtml(_napOccupancyText(n))}</span>
      ${_napDirectionsBtnHtml(n)}
    </div>`;
}

// Pinta (o repinta) el mapa del panel. Reutiliza la instancia si el
// contenedor sigue en el DOM; si no, la destruye y crea una nueva.
function _napRenderMap(scope) {
  if (!scope || !scope.querySelector) return;
  const slot = scope.querySelector('[data-slot="nap-map"]');
  if (!slot) return;

  const offline = typeof navigator !== 'undefined' && !!navigator && navigator.onLine === false;
  if (!_napMapLeafletReady() || offline || (_napMap.failed && _napMap.scope === scope)) {
    // Se recuerda el panel para reintentar cuando vuelva la red (_napMapRetry).
    _napMapShowUnavailable(slot, scope);
    return;
  }

  // Visita técnica / Migración: sin el punto del técnico; el domicilio es la
  // ubicación registrada y se suma la captura "Casa cliente".
  const contratada = _napUsesContractedNap();
  const tech = contratada ? null : _napPanelState.coords;
  const extra = _napMapClientPoints();
  const home = contratada ? extra.registered : _napPanelState.homeCoords;
  const casa = extra.casa;
  const napFallback = contratada ? extra.napFallback : null;
  const naps = _napMapNaps();
  if (!tech && !home && !casa && !napFallback && naps.length === 0) {
    _napMapDestroy();
    slot.innerHTML = contratada
      ? '<div class="nap-map-empty">Sin coordenadas para el mapa: captura la ubicación de la casa del cliente.</div>'
      : '<div class="nap-map-empty">El mapa aparece al capturar tu ubicación o al buscar NAPs.</div>';
    return;
  }

  // ¿Sigue viva la instancia en este mismo contenedor?
  const viva = !!(_napMap.map && _napMap.el && _napMap.el.isConnected && slot.contains(_napMap.el));
  if (!viva && !_napMapCreate(scope, slot)) return;

  // Marcadores (se regeneran en cada repintado; la instancia se reutiliza).
  _napMap.layer.clearLayers();
  _napMap.markers = {};
  if (home) {
    const homeTxt = contratada
      ? `Ubicación registrada del cliente${home.mock ? ' (de prueba)' : ''}` : 'Domicilio del cliente';
    L.marker([home.latitude, home.longitude], {
      icon: L.divIcon({ className: 'nap-map-home', html: _NAP_MAP_HOME_SVG, iconSize: [28, 28], iconAnchor: [14, 14] }),
      title: homeTxt, alt: homeTxt, keyboard: false,
    }).bindTooltip(homeTxt).addTo(_napMap.layer);
  }
  if (casa) {
    const casaTxt = casa.unsaved ? 'Casa cliente (captura sin guardar)' : 'Casa cliente (capturada)';
    L.marker([casa.latitude, casa.longitude], {
      icon: L.divIcon({ className: `nap-map-casa${casa.unsaved ? ' is-unsaved' : ''}`, html: _NAP_MAP_HOME_SVG, iconSize: [30, 30], iconAnchor: [15, 15] }),
      title: casaTxt, alt: casaTxt, keyboard: false, zIndexOffset: 600,
    }).bindTooltip(casaTxt).addTo(_napMap.layer);
  }
  if (napFallback) {
    const nfTxt = `NAP del cliente (según la última captura${napFallback.simulated ? ', simulada' : ''})`;
    L.marker([napFallback.latitude, napFallback.longitude], {
      icon: L.divIcon({ className: 'nap-map-pin unknown is-client', html: '<span></span>', iconSize: [28, 28], iconAnchor: [14, 14] }),
      title: nfTxt, alt: nfTxt, keyboard: false,
    }).bindTooltip(nfTxt).addTo(_napMap.layer);
  }
  const clienteRef = _napCurrentRef();
  naps.forEach((n) => {
    const ref = _napRef(n);
    const color = _napColorClass(n);
    const esCliente = !!clienteRef && ref === clienteRef;
    const seleccionada = ref === _napPanelState.selectedNap;
    const size = esCliente ? 28 : 22;
    const etiqueta = `${n.napCode || 'NAP'} · ${_napColorLabel(n)}${esCliente ? ' · NAP del cliente' : ''}`;
    const m = L.marker([Number(n.latitude), Number(n.longitude)], {
      icon: L.divIcon({
        className: `nap-map-pin ${color}${esCliente ? ' is-client' : ''}${seleccionada ? ' is-selected' : ''}`,
        html: '<span></span>',
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
        popupAnchor: [0, -size / 2],
      }),
      title: etiqueta,
      alt: etiqueta,
      riseOnHover: true,
      zIndexOffset: esCliente ? 500 : 0,
    });
    m.bindPopup(_napMapPopupHtml(n), { closeButton: true, autoPanPadding: [16, 16] });
    m.on('click', () => _napFocusCard(scope, ref));
    m.addTo(_napMap.layer);
    _napMap.markers[ref] = m;
  });
  if (tech) {
    L.circleMarker([tech.latitude, tech.longitude], {
      radius: 8, color: '#FFFFFF', weight: 3, fillColor: '#1A73E8', fillOpacity: 1,
    }).bindTooltip('Tu ubicación').addTo(_napMap.layer);
  }

  _napMap.map.invalidateSize();
  _napMapFit();
}

// Crea la instancia L.map dentro del slot. false si no se pudo.
function _napMapCreate(scope, slot) {
  _napMapDestroy();
  slot.innerHTML = _napUsesContractedNap() ? `
    <div class="nap-map" role="region" aria-label="Mapa: casa del cliente, NAP del cliente y ubicación registrada"></div>
    <ul class="nap-map-legend" aria-label="Leyenda del mapa">
      <li><span class="nap-map-dot casa" aria-hidden="true"></span>Casa cliente (capturada)</li>
      <li><span class="nap-map-dot client" aria-hidden="true"></span>NAP del cliente</li>
      <li><span class="nap-map-dot home" aria-hidden="true"></span>Ubicación registrada</li>
    </ul>` : `
    <div class="nap-map" role="region" aria-label="Mapa de NAPs: tu ubicación, domicilio del cliente y NAPs"></div>
    <div class="nap-map-legend" aria-hidden="true">
      <span><span class="nap-map-dot tech"></span>Tú</span>
      <span><span class="nap-map-dot home"></span>Domicilio</span>
      <span><span class="nap-map-dot casa"></span>Casa cliente</span>
      <span><span class="nap-map-dot free"></span>Con libres</span>
      <span><span class="nap-map-dot full"></span>Llena</span>
      <span><span class="nap-map-dot unknown"></span>Sin dato</span>
    </div>`;
  const el = slot.querySelector('.nap-map');
  let map;
  try {
    map = L.map(el, { zoomControl: true, attributionControl: true });
  } catch (err) {
    console.error('[Wifix] mapa NAP', err);
    _napMapShowUnavailable(slot, null);
    return false;
  }
  // Sin el prefijo "Leaflet | " (el crédito obligatorio es el de OSM; Leaflet
  // queda en vendor/leaflet/LICENSE).
  if (map.attributionControl && map.attributionControl.setPrefix) map.attributionControl.setPrefix(false);
  const tiles = L.tileLayer(NAP_MAP_TILE_URL, { maxZoom: 19, attribution: NAP_MAP_ATTRIBUTION });
  tiles.on('tileload', () => { _napMap.tileLoads++; });
  tiles.on('tileerror', () => {
    _napMap.tileErrors++;
    // Solo se da por caído si NINGÚN tile cargó: un tile suelto que falla
    // no justifica esconder el mapa.
    if (_napMap.tileLoads === 0 && _napMap.tileErrors >= NAP_MAP_MAX_TILE_ERRORS && !_napMap.failed) {
      _napMap.failed = true;
      // Diferido: destruir el mapa dentro de su propio evento de tile deja
      // a Leaflet operando sobre una instancia ya removida.
      setTimeout(() => _napMapShowUnavailable(slot, scope), 0);
    }
  });
  tiles.addTo(map);
  // "Cómo llegar" del popup: Leaflet corta la propagación del click dentro
  // del popup (la delegación del panel no lo ve), así que se conecta al abrir.
  map.on('popupopen', (e) => {
    const root = e.popup && e.popup.getElement ? e.popup.getElement() : null;
    const btn = root ? root.querySelector('[data-action="nap-directions"]') : null;
    if (btn && !btn.dataset.wired) {
      btn.dataset.wired = '1';
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        _napOpenDirections(btn.dataset.lat, btn.dataset.lng, btn);
      });
    }
  });
  _napMap.map = map;
  _napMap.el = el;
  _napMap.scope = scope;
  _napMap.layer = L.layerGroup().addTo(map);
  // Contenedor oculto/colapsado al crearse (tamaño 0) o que cambia de ancho
  // (rotación): cuando toma tamaño real se recalcula y se reencuadra.
  if (typeof ResizeObserver !== 'undefined') {
    let ultimo = el.clientWidth + 'x' + el.clientHeight;
    _napMap.ro = new ResizeObserver(() => {
      const ahora = el.clientWidth + 'x' + el.clientHeight;
      if (ahora === ultimo) return;
      const eraCero = /^0x|x0$/.test(ultimo);
      ultimo = ahora;
      _napMapInvalidate(eraCero);
    });
    _napMap.ro.observe(el);
  }
  return true;
}

// Encuadra todos los puntos (técnico, domicilio y NAPs).
function _napMapFit() {
  const map = _napMap.map;
  if (!map || !_napMap.layer) return;
  const pts = [];
  _napMap.layer.eachLayer((ly) => { if (ly.getLatLng) pts.push(ly.getLatLng()); });
  if (pts.length === 0) return;
  if (pts.length === 1) {
    map.setView(pts[0], 18);
    return;
  }
  map.fitBounds(L.latLngBounds(pts), { padding: [28, 28], maxZoom: 18 });
}

// Recalcula el tamaño (panel recién abierto/expandido). `refit` reencuadra.
function _napMapInvalidate(refit) {
  if (_napMap.failed) {
    _napMapRetry();
    return;
  }
  if (!_napMap.map || !_napMap.el || !_napMap.el.isConnected) return;
  try {
    _napMap.map.invalidateSize();
    if (refit) _napMapFit();
  } catch (_) { /* contenedor aún sin tamaño */ }
}

// Reintenta el mapa caído (tiles fallidos / sin red / sin Leaflet) si el panel
// sigue en pantalla y hay red. Lo disparan el evento `online` y reabrir el panel.
function _napMapRetry() {
  const sc = _napMap.scope;
  if (!_napMap.failed || !sc || !sc.isConnected) return;
  if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) return;
  _napMap.failed = false;
  _napRenderMap(sc);
}
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('online', () => _napMapRetry());
}

// Tarjeta → mapa: centra en la NAP y (opcional) abre su popup.
function _napMapFocus(ref, openPopup) {
  const m = _napMap.markers ? _napMap.markers[ref] : null;
  if (!m || !_napMap.map) return;
  _napMap.map.setView(m.getLatLng(), Math.max(_napMap.map.getZoom() || 0, 17));
  if (openPopup) m.openPopup();
}

// Mapa → tarjeta: resalta la tarjeta de la NAP y la trae a la vista. Si la
// NAP está dos veces (tarjeta del cliente y lista), gana la primera visible.
function _napFocusCard(scope, ref) {
  if (!scope || !scope.querySelectorAll) return;
  let objetivo = null;
  scope.querySelectorAll('.nap-card').forEach((card) => {
    const es = !objetivo && card.dataset.nap === ref && !card.closest('[hidden]');
    card.classList.toggle('nap-map-focus', es);
    if (es) objetivo = card;
  });
  if (objetivo && objetivo.scrollIntoView) {
    objetivo.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// Renderiza el panel NAP completo (devuelve HTML string + activa lógica tras inserción).
// Las NAPs no se piden aquí: se consultan cuando hay coordenada (ver _napFetchAndRender).
function renderNapPanel() {
  // Generar taskId una sola vez por apertura (si ya hay uno no lo regeneramos).
  if (!_napPanelState.taskId) {
    _napPanelState.taskId = _napGenTaskId();
    _napPanelState.openedAt = new Date().toISOString();
  }

  // Visita técnica: la cabecera muestra la task validada de la visita (la que
  // viaja en los registros), no el identificador local del panel.
  const enVisita = visitTaskUsesModule();
  const taskVisita = enVisita ? visitTaskIdFor(_napPanelState.account) : null;
  const taskId = enVisita ? (taskVisita || 'Task sin validar') : _napPanelState.taskId;
  const fechaHora = formatDate(_napPanelState.openedAt);
  const cabecera = `
      <!-- 1) Cabecera de tarea -->
      <div class="nap-task-header">
        <span class="nap-task-badge${enVisita && !taskVisita ? ' is-missing' : ''}">${escapeHtml(taskId)}</span>
        <span class="nap-task-date">${escapeHtml(fechaHora)}</span>
      </div>`;

  // Visita técnica / Migración: el cliente ya tiene su NAP contratada. Solo
  // esa NAP (con la ubicación "Casa cliente"), sin buscador por radio.
  if (_napUsesContractedNap()) {
    return `
    <div class="nap-panel" data-panel="nap-gpon">
      ${cabecera}
      <div class="nap-section-title">NAP del cliente</div>
      <p class="nap-contracted-hint">NAP contratada asignada al cliente: no hace falta buscar NAPs cercanas.</p>
      <div data-slot="nap-map" class="nap-map-slot"></div>
      <p class="nap-ports-progress" data-slot="nap-ports-progress" role="status" aria-live="polite" hidden></p>
      <div data-slot="nap-current">${_renderCurrentNapCard()}</div>
    </div>`;
  }

  // Precarga: si la orden trae la coordenada del domicilio, se ofrece como
  // valor inicial. NO dispara la consulta sola: sigue haciendo falta un gesto
  // (botón "Buscar NAPs", cambio de radio, GPS o edición manual).
  const home = _napPanelState.homeCoords;
  const shown = _napPanelState.coords || home || null;
  const usandoDomicilio = !_napPanelState.coords && !!home;
  const latValue = shown ? shown.latitude : '';
  const lngValue = shown ? shown.longitude : '';

  let gpsStatusTxt;
  let gpsStatusCls;
  if (_napPanelState.coords) {
    gpsStatusTxt = `Ubicacion capturada (precision ±${_napPanelState.coords.accuracy != null ? _napPanelState.coords.accuracy.toFixed(0) : '?'}m)`;
    gpsStatusCls = ' ok';
  } else if (usandoDomicilio) {
    gpsStatusTxt = 'Coordenada del domicilio (de la orden). Toca "Buscar NAPs" o cámbiala si estás en otro punto.';
    gpsStatusCls = '';
  } else {
    gpsStatusTxt = 'Sin ubicacion — toca el boton o ingresa lat/lng manualmente.';
    gpsStatusCls = '';
  }

  return `
    <div class="nap-panel" data-panel="nap-gpon">
      ${cabecera}

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
              value="${escapeHtml(latValue)}">
          </label>
          <label class="nap-coord-label">
            <span>Longitud</span>
            <input type="number" step="any" data-field="nap-lng" class="nap-coord-input"
              placeholder="-78.4680" aria-label="Longitud"
              value="${escapeHtml(lngValue)}">
          </label>
        </div>
        <div class="nap-gps-status${gpsStatusCls}" data-slot="nap-gps-status">
          ${escapeHtml(gpsStatusTxt)}
        </div>
      </div>

      <div class="nap-nearby" data-slot="nap-nearby">
      <!-- 4) Radio de búsqueda y cantidad de resultados -->
      <div class="nap-radius-control">
        <div class="nap-radius-group" role="group" aria-label="Radio de búsqueda" aria-describedby="napRadiusHelp">
          <span class="nap-radius-label">Radio</span>
          ${NAP_RADIUS_OPTIONS.map((o) => {
            const ext = o.meters >= NAP_EXTENDED_RADIUS_M;
            const on = _napPanelState.meters === o.meters;
            return `
            <button type="button" class="nap-radius-btn${ext ? ' is-extended' : ''}${on ? ' is-active' : ''}"
              data-action="nap-meters" data-meters="${o.meters}"
              aria-label="${o.meters} metros, ${ext ? 'rango extendido, fuera del radio de instalación' : 'radio de instalación'}"
              aria-pressed="${on ? 'true' : 'false'}">
              <span class="nap-radius-m">${o.meters} m</span>
              <span class="nap-radius-tag">${o.tag}</span>
            </button>`;
          }).join('')}
        </div>
        <div class="nap-radius-group">
          <label class="nap-rows-label" for="napMaxRows">Mostrar</label>
          <select class="nap-rows-select" id="napMaxRows" data-field="nap-maxrows">
            ${[5, 10, 20].map((r) => `
              <option value="${r}"${_napPanelState.maxRows === r ? ' selected' : ''}>${r}</option>`).join('')}
          </select>
          <button type="button" class="add-row-btn nap-search-btn" data-action="nap-search">Buscar NAPs</button>
        </div>
        <p class="nap-radius-help${_napPanelState.meters >= NAP_EXTENDED_RADIUS_M ? ' is-extended' : ''}" id="napRadiusHelp"
          data-slot="nap-radius-help" aria-live="polite">${escapeHtml(_napRadiusOption(_napPanelState.meters).help)}</p>
      </div>

      <!-- 5) Mapa + tarjetas de NAPs -->
      <div data-slot="nap-map" class="nap-map-slot"></div>
      <div class="nap-section-title">NAPs disponibles en el sector</div>
      <div data-slot="nap-degraded" hidden></div>
      <p class="nap-ports-progress" data-slot="nap-ports-progress" role="status" aria-live="polite" hidden></p>
      <div data-slot="nap-cards">
        <div class="detail-empty">${usandoDomicilio
          ? 'Toca «Buscar NAPs» para consultar el sector de la coordenada del domicilio.'
          : 'Captura tu ubicación (GPS o lat/lng manual) para buscar las NAPs del sector.'}</div>
      </div>
      </div>

      <!-- 6) Bloque resumen GPON -->
      <div data-slot="gpon-summary" hidden></div>

      <!-- 7) Ubicación Casa cliente (mismo componente que Visita técnica) -->
      ${_napUsesClientLoc() ? _renderClientLocSection() : ''}

    </div>`;
}

// Wrapper que arma el panel completo (usado en SERVICIO_ITEMS.load).
// La consulta a la operadora ocurre cuando el técnico captura la coordenada.
// Secuencia de aperturas del panel NAP: una respuesta tardía de current-nap
// (p. ej. de la cuenta anterior) no debe pisar el estado del panel vigente.
let _napLoadSeq = 0;

// Devuelve el HTML del panel, o null si la apertura quedó obsoleta (otra
// apertura empezó mientras se esperaba la respuesta): el llamador no pinta.
async function loadNapPanel(cuenta) {
  const seq = ++_napLoadSeq;
  // Resetear selección y resultados al abrir (se mantienen coords y taskId).
  _napPanelState.selectedNap = null;
  _napPanelState.selectedPort = null;
  _napPanelState.naps = [];
  _napPanelState.degraded = null;
  _napPanelState.account = cuenta || null;
  _napPanelState.currentNap = null;
  _napPanelState.currentNapError = null;
  _napPanelState.clientLoc = _clientLocEmptyState();
  // Coordenada del domicilio: sale del perfil que ya se cargó al confirmar la
  // cuenta. NO se pide de nuevo: cero llamadas extra a la operadora.
  _napPanelState.homeCoords = null;
  // Sin lat/lng (null con FSM sin datos) no hay casa en el mapa ni coords
  // inventadas: current-nap responde NO_COORDS y se muestra su aviso.
  const home = validatedProfile && validatedAccount === cuenta
    ? profileHomeCoords(validatedProfile) : null;
  if (home) {
    _napPanelState.homeCoords = { latitude: home.latitude, longitude: home.longitude, accuracy: null };
  }
  // Ubicación "Casa cliente" guardada (Instalaciones, Visita técnica y
  // Migración): una sola llamada por apertura del panel; los re-render leen
  // el estado.
  let locP = null;
  if (_napUsesClientLoc() && cuenta) {
    const cl = _napPanelState.clientLoc;
    cl.account = cuenta;
    cl.loading = true;
    locP = WifixAPI.getClientLocation(cuenta).then(
      (r) => { if (_napPanelState.clientLoc === cl) _clientLocApplyList(cl, r); },
      (err) => {
        console.error('[Wifix] casa cliente (GET)', err);
        if (_napPanelState.clientLoc === cl) cl.error = err;
      },
    ).then(() => { cl.loading = false; });
  }
  // Visita técnica / Migración: además, la NAP contratada del cliente (en
  // paralelo con la ubicación guardada).
  if (_napUsesContractedNap() && cuenta) {
    try {
      // Sin coordenada del domicilio, el backend no puede ubicar la NAP: si el
      // técnico ya tiene GPS de una apertura anterior, se usa como centro.
      const centro = !_napPanelState.homeCoords && _napPanelState.coords ? _napPanelState.coords : null;
      const res = await WifixAPI.getCurrentNap(cuenta, centro);
      if (seq !== _napLoadSeq) return null;
      _napPanelState.currentNap = res;
    } catch (err) {
      if (seq !== _napLoadSeq) return null;
      console.error('[Wifix] NAP del cliente', err);
      _napPanelState.currentNapError = err;
    }
  }
  if (locP) {
    await locP;
    if (seq !== _napLoadSeq) return null;
  }
  return renderNapPanel();
}

// Al terminar de insertar el HTML del panel, activa la lógica interactiva.
// Llamado desde openDatosServicio después de body.innerHTML = html.
function _bootNapPanel(body) {
  const panel = body.querySelector('[data-panel="nap-gpon"]');
  if (!panel) return;
  if (_napUsesContractedNap()) {
    _wireNapContractedPanel(panel, body);
    _napRenderMap(panel);
    // Puertos de la NAP del cliente en segundo plano. NAP simulada: nada que
    // pedir (ya muestra usados/total simulados en la tarjeta).
    if (_napHasClientNap() && _napCanLoadPorts(_napPanelState.currentNap)) {
      _napAutoLoadPorts(panel, [_napPanelState.currentNap.nap], { onDone: () => _napRenderMap(panel) })
        .catch((err) => console.error('[Wifix] carga automática de puertos', err));
    }
    return;
  }
  _wireNapPanel(panel);
  _wireClientLoc(panel);
  // Si ya había una coordenada de una apertura anterior, se reconsulta sola.
  if (_napPanelState.coords) {
    _napFetchAndRender(panel);
  } else {
    _napRenderMap(panel);
  }
}

// Visita técnica / Migración: "Ver puertos", "Cómo llegar", centrar el mapa,
// "Reintentar" la NAP del cliente y la sección Casa cliente.
function _wireNapContractedPanel(panel, body) {
  _wireNapCurrentCard(panel);
  _wireClientLoc(panel);
  if (!panel.addEventListener) return;
  panel.addEventListener('click', (ev) => {
    const t = ev.target;
    if (!t || !t.closest) return;
    const dir = t.closest('[data-action="nap-directions"]');
    if (dir) {
      ev.stopPropagation();
      _napOpenDirections(dir.dataset.lat, dir.dataset.lng, dir);
      return;
    }
    const retry = t.closest('[data-action="nap-current-retry"]');
    if (retry) {
      _napRetryCurrent(body, retry);
      return;
    }
    const retryPorts = t.closest('[data-action="nap-ports-retry"]');
    if (retryPorts) {
      ev.stopPropagation();
      _napRetryPorts(panel, retryPorts.dataset.nap, () => _napRenderMap(panel));
      return;
    }
    const foco = t.closest('[data-action="nap-focus"]');
    if (foco) {
      _napMapFocus(foco.dataset.nap, true);
      return;
    }
    const card = t.closest('.nap-card');
    if (card && !t.closest('button, a, input, select, textarea, label, .nap-ports-slot, .client-loc')) {
      _napMapFocus(card.dataset.nap, true);
    }
  });
}

// "Reintentar" tras un error de current-nap: vuelve a cargar el panel entero.
async function _napRetryCurrent(body, btn) {
  const cuenta = _napPanelState.account;
  if (!cuenta || !body) return;
  btn.disabled = true;
  btn.textContent = 'Consultando…';
  const html = await loadNapPanel(cuenta);
  if (html === null || body.isConnected === false) return;
  body.innerHTML = html;
  _bootNapPanel(body);
}

// Celda de puerto. Cuatro estados visuales (ver _portState):
//   libre (verde) · cancelado (verde, "reutilizable") · ocupado activo o
//   suspendido (rojo) · ocupado sin consultar (gris punteado).
// El estado del cliente NO llega en este paso (contrato §6): los ocupados
// vienen con clientStatus null + statusPending true hasta que el técnico pida
// la consulta explícitamente.
function _renderPortCell(p) {
  const estado = _portState(p);
  const cuenta = p.clientAccountNumber ? String(p.clientAccountNumber) : '';
  const grupo = p.clientStatus ? clientStatusGroup(p.clientStatus) : null;
  const base = 'Puerto ' + pad(p.portNumber);
  let cls;
  let title;
  let marca;
  if (estado === 'libre') {
    cls = 'free';
    title = base + ' · libre';
    marca = '';
  } else if (estado === 'sin-consultar') {
    cls = 'busy pending';
    title = base + ' · ' + (cuenta || 'ocupado') + ' · estado sin consultar';
    if (p.statusError) title += ' · ' + p.statusError;
    marca = '<small aria-hidden="true">·</small>';
  } else if (estado === 'cancelado') {
    cls = 'free reusable';
    title = base + ' · ' + (cuenta || 'ocupado') + ' · Cancelado · reutilizable';
    marca = '<small aria-hidden="true">' + escapeHtml(grupo.short) + '</small>';
  } else {
    cls = 'busy status-' + grupo.key;
    title = base + ' · ' + (cuenta || 'ocupado') + ' · ' + grupo.label;
    marca = '<small aria-hidden="true">' + escapeHtml(grupo.short) + '</small>';
  }
  // Visita técnica: el puerto del cliente se resalta (marco) sin perder su color.
  if (p.isClientPort) {
    cls += ' client-port';
    title += ' · puerto del cliente';
  }
  // Texto literal de la operadora (p. ej. "Ordenada" dentro de Activo).
  if (grupo && p.clientStatusDescription &&
      String(p.clientStatusDescription).toUpperCase() !== grupo.label.toUpperCase()) {
    title += ' (' + p.clientStatusDescription + ')';
  }
  // El color por sí solo no comunica: el estado va también en el texto
  // accesible de la celda para lectores de pantalla.
  return `
        <div class="port-cell ${cls}" role="listitem" data-port="${escapeHtml(p.portNumber)}"
          ${cuenta ? `data-account="${escapeHtml(cuenta)}"` : ''}
          ${p.equipmentId ? `data-equipment="${escapeHtml(p.equipmentId)}"` : ''}
          title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">
          <span aria-hidden="true">${pad(p.portNumber)}</span>${marca}
        </div>`;
}

// Cuentas distintas con status aún sin consultar. Se calcula desde los puertos
// (no desde statusFanOut.pendingAccounts) porque la grilla se re-pinta desde la
// caché y ese contador del servidor queda desactualizado tras consultar.
function _portsPendingAccounts(ports) {
  const vistas = {};
  (ports || []).forEach((p) => {
    if (p && p.occupied && p.statusPending !== false && !p.clientStatus && p.clientAccountNumber) {
      vistas[String(p.clientAccountNumber)] = true;
    }
  });
  return Object.keys(vistas).length;
}

function renderPortsTable(napPorts) {
  // La API de operadora aún no expone el detalle cliente por cliente en el
  // camino heredado: en ese caso se muestra el aviso en vez de una rejilla.
  if (!napPorts || !napPorts.ports || napPorts.ports.length === 0) {
    const note = (napPorts && napPorts.note) || 'No hay detalle de puertos para esta NAP.';
    return `<div class="detail-empty port-note">${escapeHtml(note)}</div>`;
  }
  const fanOut = napPorts.statusFanOut || { supported: false, pendingAccounts: 0, batchLimit: 12 };
  const pendientes = _portsPendingAccounts(napPorts.ports);
  // El botón es la ÚNICA vía para consultar estados: nunca se dispara solo.
  const accionEstados = (fanOut.supported && pendientes > 0)
    ? `
    <div class="port-status-actions" data-slot="port-status">
      <button type="button" class="port-status-btn" data-action="port-status">
        Consultar estado de ${pendientes} cliente${pendientes === 1 ? '' : 's'}
      </button>
      <div class="port-status-note" data-slot="port-status-note" role="status" aria-live="polite"></div>
    </div>`
    : '';

  return `
    <div class="port-grid" role="list" aria-label="Puertos de la NAP">
      ${napPorts.ports.map(_renderPortCell).join('')}
    </div>
    <div class="port-legend">
      <span><span class="dot free"></span>Libre</span>
      <span><span class="dot reusable"></span>Cancelado (reutilizable)</span>
      <span><span class="dot busy"></span>Ocupado (activo o suspendido)</span>
      <span><span class="dot pending"></span>Sin consultar</span>
      ${napPorts.ports.some(p => p.isClientPort) ? '<span><span class="dot client"></span>Puerto del cliente</span>' : ''}
    </div>
    ${accionEstados}`;
}

// Repinta las celdas con el estado que devolvió la operadora. Las cuentas que
// fallaron quedan en el estado neutro con el mensaje de error en el title.
// Primero se actualiza el objeto en memoria (es el mismo de la caché de
// puertos) y luego cada celda se vuelve a generar con _renderPortCell, así la
// grilla y el resumen GPON leen siempre la misma fuente.
function _applyPortStatuses(slot, items, portsData) {
  const ports = (portsData && Array.isArray(portsData.ports)) ? portsData.ports : [];
  (items || []).forEach((item) => {
    if (!item || !item.accountNumber) return;
    const cuenta = String(item.accountNumber);
    ports.forEach((p) => {
      if (!p.clientAccountNumber || String(p.clientAccountNumber) !== cuenta) return;
      if (item.error) {
        p.statusError = item.error;
        return;
      }
      p.clientStatus = item.statusCode || item.status || null;
      p.clientStatusDescription = item.statusDescription || null;
      p.statusError = null;
      p.statusPending = false;
    });
    const celdas = slot.querySelectorAll('.port-cell[data-account]');
    celdas.forEach((cell) => {
      if (cell.dataset.account !== cuenta) return;
      const p = ports.find(x => String(x.portNumber) === String(cell.dataset.port));
      if (p) {
        cell.outerHTML = _renderPortCell(p);
        return;
      }
      // Sin objeto en memoria (no debería pasar): solo se anota el error/estado.
      const numero = cell.dataset.port || '';
      const txt = item.error || clientStatusGroup(item.statusCode || item.status).label;
      cell.title = `Puerto ${pad(numero)} · ${cuenta} · ${txt}`;
      cell.setAttribute('aria-label', cell.title);
    });
  });
  _napSyncTwinGrids(slot, portsData);
}

// La misma NAP puede estar abierta dos veces (tarjeta "NAP del cliente" y la
// lista de "Cambiar NAP"): las demás grillas cargadas de esa NAP se regeneran
// desde el mismo objeto de puertos para que no queden desactualizadas.
function _napSyncTwinGrids(slot, portsData) {
  if (!slot || !slot.closest || !slot.dataset) return;
  const scope = slot.closest('[data-panel="nap-gpon"]');
  const napRef = slot.dataset.portsFor;
  if (!scope || !napRef || !scope.querySelectorAll) return;
  scope.querySelectorAll('.nap-ports-slot').forEach((other) => {
    if (other === slot || other.dataset.portsFor !== napRef || other.dataset.loaded !== '1') return;
    other.innerHTML = renderPortsTable(portsData);
    _wirePortStatusButton(other, portsData);
  });
}

// Consulta de estados bajo demanda (campo 8, paso 2). Se ejecuta SOLO desde el
// botón: nada de intervalos, scroll, hover ni precarga al abrir el panel.
// Los lotes van secuenciales para no saturar a la operadora (todo producción).
function _wirePortStatusButton(slot, portsData) {
  const btn = slot.querySelector('[data-action="port-status"]');
  if (!btn) return;
  const note = slot.querySelector('[data-slot="port-status-note"]');
  btn.addEventListener('click', async () => {
    const cuentas = [];
    const vistas = {};
    (portsData.ports || []).forEach((p) => {
      if (!p.statusPending || !p.clientAccountNumber) return;
      const c = String(p.clientAccountNumber);
      if (vistas[c]) return;
      vistas[c] = true;
      cuentas.push(c);
    });
    if (cuentas.length === 0) {
      if (note) note.textContent = 'No quedan clientes por consultar.';
      return;
    }
    const limite = Number(portsData.statusFanOut && portsData.statusFanOut.batchLimit) || 12;
    const original = btn.textContent;
    btn.disabled = true;
    let resueltas = 0;
    let fallidas = 0;
    try {
      for (let i = 0; i < cuentas.length; i += limite) {
        const lote = cuentas.slice(i, i + limite);
        btn.textContent = `Consultando ${Math.min(i + lote.length, cuentas.length)}/${cuentas.length}…`;
        const res = await WifixAPI.getAccountsStatusBatch(lote);
        _applyPortStatuses(slot, (res && res.items) || [], portsData);
        resueltas += Number(res && res.resolved) || 0;
        fallidas += Number(res && res.failed) || 0;
      }
      // Aviso de reutilizables en la tarjeta + recálculo del sugerido GPON.
      _napAfterStatuses(slot);
      btn.remove();
      if (note) {
        note.textContent = fallidas > 0
          ? `${resueltas} estado(s) consultado(s), ${fallidas} sin respuesta de la operadora.`
          : `${resueltas} estado(s) consultado(s).`;
        note.className = fallidas > 0 ? 'port-status-note warn' : 'port-status-note ok';
      }
    } catch (err) {
      console.error('[Wifix] status-batch', err);
      btn.disabled = false;
      btn.textContent = original;
      if (note) {
        note.textContent = err.message || 'No se pudieron consultar los estados.';
        note.className = 'port-status-note error';
      }
    }
  });
}

// ============================================================================
// ISP Monitor (campos 9-13) — estado del equipo/red, señal a ruido, FEC y
// caídas de las últimas 24 horas.
//
// La API de operadora indexa por SERIAL GPON (fibra) o MAC del cablemódem
// (HFC), no por número de cuenta: el técnico escanea o escribe el identificador
// del equipo y desde ahí el backend consulta la operadora en una sola llamada
// (/terminals/:id/diagnostics).
//
// El backend NO consulta todo siempre: pide la ficha, y según la tecnología
// decide qué series valen la pena (en GPON no hay DOCSIS). Lo que no consultó
// llega en `skipped` y se explica en pantalla. La operadora pidió expresamente
// no consultar de más y no existe ambiente de pruebas: todo es producción.
//
// "Red de acceso" y no "nodo": la operadora aclaró que no existe el concepto de
// nodo en estos datos. Se toman de una tarjeta de CMTS (HFC — puede cubrir un
// ramal, un nodo o una combinación) o de un puerto de OLT (GPON — un hilo de
// fibra).
// ============================================================================

// Estado del panel por cuenta abierta.
let _ispState = { id: null, data: null, tech: '' };

// Pista de tecnología para ISP Monitor (?technology=): la que eligió el
// técnico; en automático, GPON si el identificador es un serial de ONT
// (4 letras + 8 hex). Una MAC puede ser de cablemódem o de ONT: sin pista.
function _ispTechHint(id, selected) {
  if (selected === 'GPON' || selected === 'HFC') return selected;
  const clean = _ispCleanCode(id);
  return _ISP_GPON_SN_RE.test(clean) ? 'GPON' : null;
}

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

/** "HH:mm" (hora de Ecuador) de un instante ISO; '' si viene vacío. */
function _fmtHour(iso) {
  if (!iso) return '';
  return fmtTimeEc(iso) || String(iso).slice(0, 5);
}

/** Etiqueta legible para el nombre de serie que devuelva la operadora. */
const _ISP_KEY_LABELS = {
  online: 'En línea', estado: 'Estado', status: 'Estado', up: 'En línea',
  snrdown: 'Downstream', down: 'Downstream', downstream: 'Downstream',
  snrup: 'Upstream', upstream: 'Upstream',
  snr: 'SNR', mer: 'MER',
  terminalsonline: 'Equipos en línea en la red',
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

// --- Lectura por foto (OCR) ------------------------------------------------
//
// El OCR devuelve LÍNEAS de texto, no valores limpios como el barcode: puede
// venir "GPON SN: ZTEGD4B47E30", la etiqueta sola con el valor en el renglón
// siguiente, o dos códigos en la misma línea. Por eso no se puede pasar la
// línea entera por _ispCleanCode (juntaría dos códigos en uno): primero se
// parte en tokens y se prioriza el que viene detrás de su etiqueta impresa.

/** Etiqueta impresa buscada en cualquier parte del texto, no solo al inicio. */
const _ISP_LABEL_ANYWHERE_RE =
  /(GPON\s*[- ]?\s*SN|PON\s*[- ]?\s*SN|HOST\s*[- ]?\s*SN|D\s*[- ]?\s*SN|MAC(?:\s*ADDRESS)?|EN|S\/?N|SN)\s*[:=]?\s*/g;

/** Etiquetas cuyo valor NO sirve para ISP Monitor: la operadora los rechaza. */
const _ISP_LABEL_REJECTED = /^(D\s*[- ]?\s*SN|EN)$/;

/** Token candidato dentro de una línea: alfanumérico con separadores típicos. */
const _ISP_TOKEN_RE = /[0-9A-Z][0-9A-Z:_-]{8,}[0-9A-Z]/g;

/**
 * Corrige confusiones típicas del OCR en la parte hexadecimal de un serial
 * GPON (O→0, I/L→1, S→5, Z→2, G→6, Q→0). Solo se aplica cuando el token no
 * validó tal cual; el resultado se marca para que el técnico lo verifique.
 *
 * Se remapean ÚNICAMENTE letras que no son hex válido. B es un dígito hex
 * legítimo, así que aunque el OCR confunda 8 con B no se toca: corregirlo
 * rompería seriales correctos como ZTEGD4B47E30.
 */
function _ispRepairHexTail(code) {
  if (!/^[A-Z]{4}.{8}$/.test(code)) return null;
  const map = { O: '0', Q: '0', I: '1', L: '1', S: '5', Z: '2', G: '6' };
  const tail = code.slice(4).replace(/[OQILSZG]/g, (ch) => map[ch]);
  const repaired = code.slice(0, 4) + tail;
  return _ISP_GPON_SN_RE.test(repaired) ? repaired : null;
}

/**
 * Extrae de las líneas del OCR el código que ISP Monitor acepta.
 *
 * Prioridad: valor detrás de su etiqueta (GPON SN / PON SN / SN / MAC) por
 * encima de un token suelto con la forma correcta, porque el "EN" de 12
 * dígitos tiene la misma forma que una MAC y solo la etiqueta los distingue.
 *
 * @param {string[]} lines Líneas devueltas por ocrFromImageBase64.
 * @returns {{id: string, kind: 'GPON'|'MAC', labeled: boolean, repaired: boolean}|null}
 */
function _ispPickTerminalIdFromText(lines) {
  const text = (lines || []).map((l) => String(l || '').toUpperCase()).join('\n');
  if (!text.trim()) return null;

  const labeled = []; // { label, code }
  const loose = []; // code

  // (a) Valores precedidos por su etiqueta. El valor puede estar en la misma
  //     línea o en la siguiente, cuando la etiqueta quedó sola en un renglón.
  _ISP_LABEL_ANYWHERE_RE.lastIndex = 0;
  let m;
  while ((m = _ISP_LABEL_ANYWHERE_RE.exec(text)) !== null) {
    const label = m[1].replace(/\s+/g, ' ').trim();
    const rest = text.slice(m.index + m[0].length);
    const value = /^[\s\n]*([0-9A-Z][0-9A-Z:_-]{8,})/.exec(rest);
    if (value) labeled.push({ label: label, code: _ispCleanCode(value[1]) });
  }

  // (b) Todos los tokens sueltos, por si la etiqueta no se leyó.
  for (const line of text.split('\n')) {
    _ISP_TOKEN_RE.lastIndex = 0;
    let t;
    while ((t = _ISP_TOKEN_RE.exec(line)) !== null) {
      const code = _ispCleanCode(t[0]);
      if (code) loose.push(code);
    }
  }

  const usable = labeled.filter((x) => !_ISP_LABEL_REJECTED.test(x.label));

  // Un código leído detrás de D-SN o EN queda descartado también como token
  // suelto: si no, el EN (12 dígitos) se colaría con forma de MAC.
  const rejected = new Set(
    labeled.filter((x) => _ISP_LABEL_REJECTED.test(x.label)).map((x) => x.code),
  );
  const freeCodes = loose.filter((c) => !rejected.has(c));

  // 1) GPON con etiqueta · 2) GPON suelto · 3) MAC con etiqueta · 4) MAC suelta
  const gponLabeled = usable.find((x) => _ISP_GPON_SN_RE.test(x.code));
  if (gponLabeled) return { id: gponLabeled.code, kind: 'GPON', labeled: true, repaired: false };

  const gponLoose = freeCodes.find((c) => _ISP_GPON_SN_RE.test(c));
  if (gponLoose) return { id: gponLoose, kind: 'GPON', labeled: false, repaired: false };

  const macLabeled = usable.find((x) => _ISP_MAC_RE.test(x.code));
  if (macLabeled) return { id: macLabeled.code, kind: 'MAC', labeled: true, repaired: false };

  const macLoose = freeCodes.find((c) => _ISP_MAC_RE.test(c));
  if (macLoose) return { id: macLoose, kind: 'MAC', labeled: false, repaired: false };

  // 5) Último recurso: reparar confusiones del OCR sobre un token con forma de
  //    serial GPON. Se devuelve marcado para avisar que hay que verificarlo.
  for (const c of usable.map((x) => x.code).concat(freeCodes)) {
    const repaired = _ispRepairHexTail(c);
    if (repaired) return { id: repaired, kind: 'GPON', labeled: false, repaired: true };
  }

  return null;
}

/**
 * Cómo se llama la red a la que cuelga el equipo, según la tecnología.
 * No es un "nodo": la operadora aclaró que esos datos salen de una tarjeta de
 * CMTS (HFC) o de un puerto de OLT (GPON).
 */
function _ispNetworkLabel(technology) {
  if (technology === 'GPON') return 'Puerto de OLT (hilo de fibra)';
  if (technology === 'HFC') return 'Tarjeta de CMTS (ramal o nodo)';
  return 'Red de acceso';
}

/**
 * Paleta por posición de serie (identidad Xtrim, tema claro).
 * La serie principal es el morado de marca; el resto son colores con al menos
 * 3:1 de contraste sobre la card blanca. El amarillo y el verde de marca NO se
 * usan como serie: sobre fondo claro no se distinguen.
 */
const _ISP_COLORS = ['#783484', '#582C63', '#B45309', '#C81E26', '#364153'];

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
  const downCount = buckets.filter(b => b.state === 'down').length;
  const first = points[0].t;
  const last = points[points.length - 1].t;
  const axisOpts = { seconds: false, year: false };
  const summary = `${label}: ${downCount ? `${downCount} de ${buckets.length} tramos con alguna caída` : 'en línea en todos los tramos'}, ` +
    `del ${fmtDateTimeEc(first, axisOpts)} al ${fmtDateTimeEc(last, axisOpts)}. El detalle de cada caída está en la lista.`;

  // La barra es de apoyo visual: el significado va en la leyenda con texto y
  // en la lista de caídas (nunca solo el color).
  return `
    <div class="band-block">
      <div class="band-label">${escapeHtml(label)}</div>
      <div class="band-track" role="img" aria-label="${escapeHtml(summary)}">${cells}</div>
      <div class="band-axis">
        <span>${escapeHtml(fmtDateTimeEc(first, axisOpts))}</span>
        <span>${escapeHtml(fmtDateTimeEc(last, axisOpts))}</span>
      </div>
      <div class="band-legend" aria-hidden="true">
        <span class="band-legend-item"><span class="band-swatch up"></span>En línea</span>
        <span class="band-legend-item"><span class="band-swatch down"></span>Caído (al menos una muestra)</span>
        <span class="band-legend-item"><span class="band-swatch unknown"></span>Sin dato</span>
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

/**
 * Caídas (transiciones a 0), muestras fuera de línea y % de uptime.
 *
 * La ventana es siempre de 24 h, pero la cantidad de muestras varía según el
 * equipo (la operadora devolvió entre 122 y 292 en las pruebas). Contar
 * muestras sesgaría el porcentaje cuando el muestreo es irregular, así que cada
 * muestra pesa lo que dura: desde su instante hasta el de la siguiente. Si los
 * instantes no se pueden leer, se cae al conteo por muestra.
 */
function _ispOutageStats(series) {
  const points = (series && series.points) || [];
  const key = (series && series.keys && series.keys[0]) || 'online';

  const stamps = points.map(p => new Date(p.t).getTime());
  const gaps = [];
  for (let i = 1; i < stamps.length; i++) {
    const gap = stamps[i] - stamps[i - 1];
    if (isFinite(gap) && gap > 0) gaps.push(gap);
  }
  // La última muestra no tiene siguiente: se le da la duración típica.
  const sorted = [...gaps].sort((a, b) => a - b);
  const typicalGap = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const weighted = typicalGap > 0;

  let outages = 0, downSamples = 0, known = 0, previous = null;
  let knownMs = 0, downMs = 0;
  points.forEach((p, i) => {
    const v = p.values ? p.values[key] : undefined;
    if (v === undefined) return;
    known++;
    const span = i + 1 < stamps.length ? stamps[i + 1] - stamps[i] : typicalGap;
    const weight = isFinite(span) && span > 0 ? span : typicalGap;
    knownMs += weight;
    if (v <= 0) { downSamples++; downMs += weight; }
    if (previous !== null && previous > 0 && v <= 0) outages++;
    previous = v;
  });

  const uptimePercent = weighted && knownMs > 0
    ? ((knownMs - downMs) / knownMs) * 100
    : known === 0 ? 0 : ((known - downSamples) / known) * 100;

  return { outages, downSamples, totalSamples: points.length, uptimePercent };
}

/** Intervalo típico (mediana) entre muestras de una serie, en ms. 0 si no se sabe. */
function _ispSampleStepMs(series) {
  const points = (series && series.points) || [];
  const gaps = [];
  for (let i = 1; i < points.length; i++) {
    const a = toValidDate(points[i - 1].t);
    const b = toValidDate(points[i].t);
    if (a && b && b > a) gaps.push(b - a);
  }
  if (!gaps.length) return 0;
  gaps.sort((x, y) => x - y);
  return gaps[Math.floor(gaps.length / 2)];
}

/**
 * Caídas del equipo como eventos, de la más antigua a la más reciente:
 *   { start, end, lastDown, lastSeenOnline, ongoing, startedBeforeWindow,
 *     samples, durationMs }
 *
 * La operadora muestrea cada ~5 min, así que el instante exacto no se conoce:
 * la caída empezó entre `lastSeenOnline` (última muestra en línea) y `start`
 * (primera muestra sin conexión), y se recuperó en `end` (primera muestra en
 * línea de nuevo). `durationMs` = end − start; si sigue caído, lastDown − start
 * (es un mínimo). Muestras sin valor no cortan ni abren caídas.
 */
function _ispOutageEvents(series) {
  const points = (series && series.points) || [];
  const key = (series && series.keys && series.keys[0]) || 'online';
  const events = [];
  let cur = null;
  let lastUp = null;
  let sawKnown = false;
  points.forEach(p => {
    const v = p.values ? p.values[key] : undefined;
    if (v === undefined || v === null || !isFinite(v)) return;
    if (v <= 0) {
      if (!cur) {
        cur = { start: p.t, end: null, lastDown: p.t, lastSeenOnline: lastUp,
          ongoing: false, startedBeforeWindow: !sawKnown, samples: 0 };
      }
      cur.lastDown = p.t;
      cur.samples++;
    } else {
      if (cur) { cur.end = p.t; events.push(cur); cur = null; }
      lastUp = p.t;
    }
    sawKnown = true;
  });
  if (cur) { cur.ongoing = true; events.push(cur); }
  events.forEach(e => {
    const s = toValidDate(e.start);
    const f = toValidDate(e.ongoing ? e.lastDown : e.end);
    e.durationMs = s && f ? Math.max(0, f - s) : null;
  });
  return events;
}

const _ISP_OUTAGE_ICONS = {
  down: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
  up: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/></svg>',
};

// Máximo de caídas visibles sin expandir (un equipo intermitente puede tener
// decenas en 24 h; el resto queda en un <details>).
const _ISP_OUTAGES_VISIBLE = 6;

function _ispOutageItemHtml(e) {
  const ongoing = e.ongoing;
  const tipo = ongoing ? 'Caída en curso' : 'Caída del equipo';
  const estado = ongoing
    ? `<span class="isp-outage-state down">${_ISP_OUTAGE_ICONS.down}Sigue sin conexión</span>`
    : `<span class="isp-outage-state up">${_ISP_OUTAGE_ICONS.up}Recuperado</span>`;
  const dur = e.durationMs === null || e.durationMs === undefined ? '—'
    : ongoing ? `al menos ${fmtDuration(e.durationMs)}` : `≈ ${fmtDuration(e.durationMs)}`;
  const inicioNota = e.startedBeforeWindow
    ? '<span class="isp-outage-note">Ya estaba caído al inicio de la ventana de 24 h.</span>'
    : '';
  const fin = !ongoing
    ? dateTimeHtml(e.end)
    : e.lastDown
      ? `<span class="isp-outage-pending">Sin recuperar: la última muestra (${escapeHtml(fmtDateTimeEc(e.lastDown))}) sigue sin conexión.</span>`
      : '<span class="isp-outage-pending">Sin recuperar al momento de la consulta.</span>';
  const causa = e.causeLabel
    ? `<div class="isp-outage-row"><dt>Causa</dt><dd>${escapeHtml(e.causeLabel)}${e.causeSimulated ? ' <span class="sim-badge">Simulado</span>' : ''}</dd></div>`
    : '';
  return `
    <li class="isp-outage ${ongoing ? 'is-ongoing' : 'is-recovered'}">
      <div class="isp-outage-head">
        <span class="isp-outage-type">${tipo}</span>
        ${estado}
      </div>
      <dl class="isp-outage-times">
        <div class="isp-outage-row"><dt>Se cayó</dt><dd>${dateTimeHtml(e.start)}${inicioNota}</dd></div>
        ${e.lastSeenOnline ? `<div class="isp-outage-row"><dt>Última vez en línea</dt><dd>${dateTimeHtml(e.lastSeenOnline, { relative: false })}</dd></div>` : ''}
        <div class="isp-outage-row"><dt>Volvió en línea</dt><dd>${fin}</dd></div>
        <div class="isp-outage-row"><dt>Duración</dt><dd><strong>${escapeHtml(dur)}</strong></dd></div>
        ${causa}
      </dl>
    </li>`;
}

/**
 * Caídas que calcula el backend (OutageSummary, 2026-09-30) al formato de
 * evento del panel, de la más antigua a la más reciente (el backend las manda
 * al revés). Instantes en UTC (`startedAt`/`endedAt`): el formateador común
 * los muestra en hora de Ecuador.
 */
function _ispOutageEventsFromApi(outages) {
  const items = outages && Array.isArray(outages.items) ? outages.items : [];
  const causeSimulated = !!(outages && (outages.causeSource === 'SIMULATED'));
  return items.map(o => ({
    start: o.startedAt,
    end: o.endedAt || null,
    lastDown: null,
    lastSeenOnline: null,
    ongoing: !!o.ongoing,
    startedBeforeWindow: false,
    durationMs: Number.isFinite(Number(o.durationSeconds)) ? Number(o.durationSeconds) * 1000 : null,
    cause: o.cause || null,
    causeLabel: o.causeLabel || null,
    causeSimulated: causeSimulated || o.simulated === true,
  })).reverse();
}

function _ispNoOutagesHtml() {
  return `
    <div class="isp-outage-none" role="status">
      <span class="isp-outage-state up">${_ISP_OUTAGE_ICONS.up}Sin caídas</span>
      <span>El equipo respondió en línea en todas las muestras de las últimas 24 h.</span>
    </div>`;
}

/**
 * Lista de caídas (más reciente primero) con hora de caída, de recuperación,
 * duración y causa si se conoce (ícono + texto, no solo color).
 * `events` va de la más antigua a la más reciente.
 */
function _ispOutageTimelineHtml(events, stepMs, opts = {}) {
  if (!events.length) return _ispNoOutagesHtml();
  const recientes = [...events].reverse();
  const visibles = recientes.slice(0, _ISP_OUTAGES_VISIBLE).map(_ispOutageItemHtml).join('');
  const resto = recientes.slice(_ISP_OUTAGES_VISIBLE);
  const stepTxt = stepMs ? `cada ${fmtDuration(stepMs)}` : 'a intervalos';
  const inicio = opts.fromSeries
    ? 'así que el corte real empezó entre «Última vez en línea» y esa hora'
    : 'así que el corte real pudo empezar hasta un intervalo antes';
  return `
    <ol class="isp-outages" aria-label="Caídas del equipo, de la más reciente a la más antigua">${visibles}</ol>
    ${resto.length ? `
    <details class="isp-outages-more">
      <summary>Ver ${resto.length} caída${resto.length === 1 ? '' : 's'} más antigua${resto.length === 1 ? '' : 's'}</summary>
      <ol class="isp-outages">${resto.map(_ispOutageItemHtml).join('')}</ol>
    </details>` : ''}
    <p class="isp-hint">
      Horas de Ecuador (UTC-5). ISP Monitor toma una muestra ${escapeHtml(stepTxt)}: «Se cayó» es la
      primera muestra sin conexión, ${inicio}.
      La duración es aproximada (± un intervalo de muestreo).
    </p>`;
}

/** Caídas calculadas en la app a partir de la serie de estado (payload sin `outages`). */
function renderIspOutageTimeline(series) {
  return _ispOutageTimelineHtml(_ispOutageEvents(series), _ispSampleStepMs(series), { fromSeries: true });
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
    const extra = [
      entry.drop ? `Caída: ${_ispMaybeDateText(entry.drop)}` : '',
      entry.events ? `Eventos: ${_ispMaybeDateText(entry.events)}` : '',
    ].filter(Boolean).join(' · ');
    return `
      <div class="isp-hist-row">
        <span class="isp-hist-period">${escapeHtml(label)}</span>
        <div class="isp-hist-equipos">${equipos || '<span class="isp-hist-empty">Sin equipos</span>'}</div>
        ${extra ? `<span class="isp-hist-extra">${escapeHtml(extra)}</span>` : ''}
      </div>`;
  }).join('');
  return `
    <div class="isp-section-title">Equipos en este puerto</div>
    <p class="isp-hint">
      Serial o MAC de cada equipo que ISP Monitor vio en este puerto por período, con su
      estado en ese período. Sirve para saber si el equipo anterior del domicilio venía cayéndose.
    </p>
    <div class="isp-hist">${rows}</div>`;
}

/** Si el valor es un instante ISO lo pasa al formato común; si no, texto tal cual. */
function _ispMaybeDateText(value) {
  const s = String(value);
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) && toValidDate(s)
    ? `${fmtDateTimeEc(s)} (${fmtRelative(s)})`
    : s;
}

// `tech`: tecnología resuelta (data.technology del backend, o la de la ficha
// en payloads anteriores). null → "No identificada".
function renderIspTerminalCard(terminal, tech) {
  const technology = tech === undefined ? (terminal && terminal.technology) : tech;
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

  // `drop`: el monitoreo de la operadora detectó una caída de red. Es el único
  // campo extra de la ficha que la operadora confirmó relevante.
  const drop = terminal.drop || { detected: false, description: null };
  const dropRow = drop.detected
    ? `<div class="isp-event alert">
         <span class="isp-event-title">Caída de red detectada</span>
         <span class="isp-event-desc">${escapeHtml(drop.description || 'El monitoreo registró una caída.')}</span>
         <span class="isp-event-meta">ISP Monitor no informa la hora de este aviso: las horas exactas están en «Caídas del equipo».</span>
       </div>`
    : '';

  const red = (terminal.networkIds || []).join(', ');
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
        <span class="isp-badge ${technology ? 'tech' : 'unknown'}">${escapeHtml(technology || 'No identificada')}</span>
      </div>
      <div class="isp-status-cell">
        <span class="isp-status-label">Ciudad</span>
        <span class="isp-badge tech">${escapeHtml(terminal.city || '—')}</span>
      </div>
    </div>
    ${eventRow}
    ${dropRow}
    ${red ? `<div class="mini-row"><span class="mr-label">${escapeHtml(_ispNetworkLabel(technology))}</span><span class="mr-value">${escapeHtml(red)}</span></div>` : ''}
    ${extra}`;
}

/**
 * Nota para una métrica sin gráfico. Si el backend decidió NO consultarla
 * (`skipped`), se muestra su motivo: es una decisión deliberada para no
 * castigar la API de la operadora, no un dato faltante.
 */
function _ispEmptyMetricNote(metric, technology, skipped) {
  const reason = (skipped || [])
    .filter(s => String(s.endpoint || '').endsWith('/' + metric))
    .map(s => s.reason)
    .find(Boolean);
  if (reason) {
    return `<div class="detail-empty port-note">${escapeHtml(reason)} No se consultó.</div>`;
  }
  return `
    <div class="detail-empty port-note">
      ${technology === 'GPON'
        ? 'Métrica DOCSIS: la operadora solo la publica para equipos HFC (cablemódem). Este equipo es GPON.'
        : 'La operadora no devolvió datos de esta métrica para este equipo.'}
    </div>`;
}

/** Series de una métrica en ambos ámbitos, o la nota si no hay datos. */
function _ispMetricSection(title, metric, data, terminal, skipped, chartOpts, hint) {
  const cards = ['terminal', 'network'].map(scope => _ispSeriesCards(
    data && data[scope],
    scope === 'terminal' ? 'Equipo del cliente' : _ispNetworkLabel(terminal.technology),
    chartOpts,
  )).join('');

  // La explicación solo tiene sentido si hay gráfico que leer.
  return `
    <div class="isp-section-title">${escapeHtml(title)}</div>
    ${cards && hint ? `<p class="isp-hint">${hint}</p>` : ''}
    ${cards || _ispEmptyMetricNote(metric, terminal.technology, skipped)}`;
}

// --- Tecnología (HFC / GPON) -------------------------------------------------

/** Tecnología resuelta: la del backend (2026-09-30) o, en payloads previos, la de la ficha. */
function _ispTechnology(data) {
  if (data && Object.prototype.hasOwnProperty.call(data, 'technology')) {
    return data.technology === 'HFC' || data.technology === 'GPON' ? data.technology : null;
  }
  const t = data && data.terminal ? data.terminal.technology : null;
  return t === 'HFC' || t === 'GPON' ? t : null;
}

const _ISP_TECH_SOURCE_TEXT = Object.freeze({
  ISP_MONITOR: 'según ISP Monitor',
  HINT: 'según el tipo de equipo indicado',
  ID_FORMAT: 'por el formato del identificador',
});

/** ¿El bloque (o alguno de sus orígenes) es simulado? */
function _ispBlockSimulated(block) {
  if (!block) return false;
  if (block.simulated === true) return true;
  const src = block.sources || {};
  return Object.keys(src).some(k => src[k] === 'SIMULATED');
}

function _ispSimBadge(on, title) {
  return on
    ? `<span class="sim-badge" title="${escapeHtml(title || 'Valores simulados: la operadora no los publica todavía')}">Simulado</span>`
    : '';
}

const _ISP_RANGE_ICONS = {
  ok: _ISP_OUTAGE_ICONS.up,
  warn: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M10.3 3.7L2 18a2 2 0 0 0 1.7 3h16.6A2 2 0 0 0 22 18L13.7 3.7a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
  bad: _ISP_OUTAGE_ICONS.down,
  unknown: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>',
};
const _ISP_RANGE_TEXT = { ok: 'En rango', warn: 'Al límite', bad: 'Fuera de rango', unknown: 'Sin dato' };

/**
 * Evalúa un valor contra su rango: { min?, max?, warnBelow?, warnAbove? }.
 * Devuelve 'ok' | 'warn' | 'bad' | 'unknown'.
 */
function _ispRangeState(value, range) {
  if (value === null || value === undefined || !isFinite(value)) return 'unknown';
  if (!range) return 'unknown';
  const v = Number(value);
  if ((range.min !== undefined && v < range.min) || (range.max !== undefined && v > range.max)) return 'bad';
  if ((range.warnBelow !== undefined && v < range.warnBelow) || (range.warnAbove !== undefined && v > range.warnAbove)) return 'warn';
  return 'ok';
}

/** Texto del rango OK: "−27 a −8 dBm", "≥ 27 dB", "≤ 0.1 %". */
function _ispRangeText(range, unit) {
  if (!range) return '';
  const u = unit ? ` ${unit}` : '';
  const f = (n) => _fmtNum(n, 2);
  let base = '';
  if (range.min !== undefined && range.max !== undefined) base = `${f(range.min)} a ${f(range.max)}${u}`;
  else if (range.min !== undefined) base = `≥ ${f(range.min)}${u}`;
  else if (range.max !== undefined) base = `≤ ${f(range.max)}${u}`;
  if (range.warnBelow !== undefined) base += ` (alerta bajo ${f(range.warnBelow)}${u})`;
  return base;
}

function _ispStatePill(state) {
  return `<span class="isp-range ${state}">${_ISP_RANGE_ICONS[state]}${_ISP_RANGE_TEXT[state]}</span>`;
}

/** Fila de métrica: nombre + qué significa, valor con unidad, rango OK y estado. */
function _ispMetricRow({ label, help, value, unit, dec = 2, range, simulated }) {
  const has = value !== null && value !== undefined && isFinite(value);
  const state = _ispRangeState(value, range);
  const rango = _ispRangeText(range, unit);
  return `
    <div class="isp-metric">
      <div class="isp-metric-head">
        <span class="isp-metric-label">${escapeHtml(label)}${simulated ? ' <span class="isp-sim-mark" title="Valor simulado">*</span>' : ''}</span>
        ${range ? _ispStatePill(state) : ''}
      </div>
      <div class="isp-metric-value">${has ? `<strong>${escapeHtml(_fmtNum(value, dec))}</strong> ${escapeHtml(unit || '')}` : '<span class="no-fsm-data">Sin dato</span>'}</div>
      ${rango ? `<div class="isp-metric-range">Rango OK: ${escapeHtml(rango)}</div>` : ''}
      ${help ? `<div class="isp-metric-help">${escapeHtml(help)}</div>` : ''}
    </div>`;
}

const _ISP_HEALTH = Object.freeze({
  OK: { cls: 'ok', text: 'Señal en rango' },
  WARNING: { cls: 'warn', text: 'Señal al límite' },
  CRITICAL: { cls: 'bad', text: 'Señal crítica' },
  UNKNOWN: { cls: 'unknown', text: 'Sin evaluación' },
});
function _ispHealthPill(health) {
  const h = _ISP_HEALTH[health] || _ISP_HEALTH.UNKNOWN;
  return `<span class="isp-range ${h.cls}">${_ISP_RANGE_ICONS[h.cls]}${h.text}</span>`;
}

const _ISP_ONU_STATE = Object.freeze({
  ONLINE: { cls: 'ok', text: 'En línea' },
  OFFLINE: { cls: 'bad', text: 'Fuera de línea' },
  LOS: { cls: 'bad', text: 'Pérdida de señal óptica (LOS)' },
  DYING_GASP: { cls: 'bad', text: 'Corte de energía (dying gasp)' },
  UNKNOWN: { cls: 'unknown', text: 'Desconocido' },
});

/** Sección "Señal óptica (GPON)": solo para ONT/ONU. Nada DOCSIS aquí. */
function renderIspGponSection(gpon) {
  if (!gpon) {
    return `<div class="isp-section-title">Señal óptica (GPON)</div>
      <div class="detail-empty port-note">La operadora no devolvió datos ópticos de este equipo.</div>`;
  }
  const src = gpon.sources || {};
  const th = gpon.thresholds || {};
  const opt = gpon.optical || {};
  const onu = gpon.onu || {};
  const olt = gpon.olt || {};
  const opticalSim = src.optical === 'SIMULATED';
  const st = _ISP_ONU_STATE[onu.state] || _ISP_ONU_STATE.UNKNOWN;
  const onuText = onu.stateLabel || st.text;
  const distKm = gpon.distanceMeters !== null && gpon.distanceMeters !== undefined && isFinite(gpon.distanceMeters)
    ? gpon.distanceMeters / 1000 : null;
  const topoSim = src.oltTopology === 'SIMULATED';
  return `
    <div class="isp-section-title isp-section-with-badge">Señal óptica (GPON) ${_ispSimBadge(_ispBlockSimulated(gpon))}</div>
    <div class="isp-tech-summary">
      <span class="isp-range ${st.cls}">${_ISP_RANGE_ICONS[st.cls]}ONU: ${escapeHtml(onuText)}</span>
      ${_ispHealthPill(gpon.health)}
      ${src.onuState === 'SIMULATED' ? '<span class="isp-sim-note">estado simulado</span>' : ''}
    </div>
    <p class="isp-hint">Potencias en <strong>dBm</strong> (clase B+, ITU-T G.984.2): cuanto más cerca de 0, más luz llega. Si la Rx del ONT cae bajo el rango, revisa conectores, empalmes y dobleces de la fibra.</p>
    <div class="isp-metric-grid">
      ${_ispMetricRow({ label: 'Potencia recibida en el ONT (Rx)', value: opt.rxPowerDbm, unit: 'dBm', range: th.rxPowerDbm, simulated: opticalSim,
        help: 'Luz que llega de la OLT al equipo del cliente.' })}
      ${_ispMetricRow({ label: 'Potencia transmitida por el ONT (Tx)', value: opt.txPowerDbm, unit: 'dBm', range: th.txPowerDbm, simulated: opticalSim,
        help: 'Luz que emite el equipo hacia la OLT.' })}
      ${_ispMetricRow({ label: 'Potencia del ONT recibida en la OLT', value: opt.oltRxPowerDbm, unit: 'dBm', range: th.oltRxPowerDbm, simulated: opticalSim,
        help: 'Luz del cliente que llega a la central.' })}
      ${_ispMetricRow({ label: 'Distancia OLT → ONT', value: distKm, unit: 'km', dec: 2, simulated: opticalSim,
        help: 'Largo del tramo de fibra medido por la OLT (ranging).' })}
      ${_ispMetricRow({ label: 'Temperatura del ONT', value: gpon.temperatureC, unit: '°C', dec: 1,
        range: th.temperatureCMax !== undefined ? { max: th.temperatureCMax } : null, simulated: opticalSim })}
      ${_ispMetricRow({ label: 'Voltaje del ONT', value: gpon.voltageV, unit: 'V', range: th.voltageV, simulated: opticalSim })}
      ${_ispMetricRow({ label: 'Corriente de bias del láser', value: gpon.biasCurrentMa, unit: 'mA', dec: 1, simulated: opticalSim })}
    </div>
    <dl class="isp-topology">
      <div><dt>OLT${topoSim ? ' <span class="isp-sim-mark" title="Valor simulado">*</span>' : ''}</dt><dd>${escapeHtml(olt.name || '—')}</dd></div>
      <div><dt>Puerto PON</dt><dd>${escapeHtml(olt.ponPort || '—')}</dd></div>
      <div><dt>ONU id</dt><dd>${onu.onuId !== undefined && onu.onuId !== null ? escapeHtml(String(onu.onuId)) : '—'}</dd></div>
      <div><dt>Red de acceso</dt><dd>${escapeHtml((olt.accessNetworkIds || []).join(', ') || '—')}</dd></div>
    </dl>
    ${opticalSim || topoSim ? '<p class="isp-sim-legend"><span class="isp-sim-mark">*</span> Valor simulado: ISP Monitor no publica la capa óptica todavía.</p>' : ''}
    ${gpon.measuredAt ? `<p class="isp-consulted">Medido: ${dateTimeHtml(gpon.measuredAt)}</p>` : ''}`;
}

/** Tabla de canales DOCSIS; los campos simulados de cada canal llevan *. */
function _ispDocsisChannelsHtml(title, channels) {
  if (!Array.isArray(channels) || channels.length === 0) return '';
  const sim = (c, k) => (Array.isArray(c.simulatedFields) && c.simulatedFields.includes(k) ? '<span class="isp-sim-mark">*</span>' : '');
  const num = (v, dec) => (v === null || v === undefined || !isFinite(v) ? '—' : escapeHtml(_fmtNum(v, dec)));
  const filas = channels.map(c => `
    <tr>
      <th scope="row">${escapeHtml(_ispChannelLabel({ label: c.label, ifIndex: c.channelId, network: null }))}</th>
      <td>${num(c.frequencyMHz, 1)}${sim(c, 'frequencyMHz')}</td>
      <td>${num(c.powerDbmv, 1)}${sim(c, 'powerDbmv')}</td>
      <td>${num(c.snrDb, 1)}${sim(c, 'snrDb')}</td>
      <td>${escapeHtml(c.modulation || '—')}${sim(c, 'modulation')}</td>
    </tr>`).join('');
  return `
    <details class="isp-channels">
      <summary>${escapeHtml(title)} (${channels.length} canal${channels.length === 1 ? '' : 'es'})</summary>
      <div class="isp-table-wrap">
        <table class="isp-table">
          <thead><tr><th scope="col">Canal</th><th scope="col">Frec. (MHz)</th><th scope="col">Potencia (dBmV)</th><th scope="col">SNR (dB)</th><th scope="col">Modulación</th></tr></thead>
          <tbody>${filas}</tbody>
        </table>
      </div>
    </details>`;
}

/** Sección DOCSIS (solo HFC): potencias, SNR, FEC y canales, contra umbrales. */
function renderIspDocsisSection(docsis) {
  if (!docsis) return '';
  const src = docsis.sources || {};
  const th = docsis.thresholds || {};
  const ds = docsis.downstream || {};
  const us = docsis.upstream || {};
  const cw = docsis.codewords || {};
  const powerSim = src.power === 'SIMULATED';
  return `
    <div class="isp-section-title isp-section-with-badge">Señal del cablemódem (DOCSIS) ${_ispSimBadge(_ispBlockSimulated(docsis))}</div>
    <div class="isp-tech-summary">${_ispHealthPill(docsis.health)}</div>
    <p class="isp-hint"><strong>Potencia</strong> en dBmV (nivel de la señal) y <strong>SNR</strong> en dB (señal sobre ruido: más alto es mejor). Downstream = de la red al módem; upstream = del módem a la red.</p>
    <div class="isp-metric-grid">
      ${_ispMetricRow({ label: 'Potencia downstream', value: ds.powerDbmv, unit: 'dBmV', dec: 1, range: th.downstreamPowerDbmv, simulated: powerSim })}
      ${_ispMetricRow({ label: 'SNR downstream', value: ds.snrDb, unit: 'dB', dec: 1,
        range: th.downstreamSnrDbMin !== undefined ? { min: th.downstreamSnrDbMin } : null, simulated: src.snrDownstream === 'SIMULATED' })}
      ${_ispMetricRow({ label: 'Potencia upstream', value: us.powerDbmv, unit: 'dBmV', dec: 1, range: th.upstreamPowerDbmv, simulated: powerSim })}
      ${_ispMetricRow({ label: 'SNR upstream', value: us.snrDb, unit: 'dB', dec: 1,
        range: th.upstreamSnrDbMin !== undefined ? { min: th.upstreamSnrDbMin } : null, simulated: src.snrUpstream === 'SIMULATED' })}
      ${_ispMetricRow({ label: 'FEC corregidos', value: cw.correctedPercent, unit: '%', dec: 2, simulated: src.codewords === 'SIMULATED',
        help: 'Errores que el módem reparó: en poca cantidad es normal.' })}
      ${_ispMetricRow({ label: 'FEC sin corregir', value: cw.uncorrectedPercent, unit: '%', dec: 3,
        range: th.uncorrectedPercentMax !== undefined ? { max: th.uncorrectedPercentMax } : null, simulated: src.codewords === 'SIMULATED',
        help: 'Datos perdidos (peor canal): si sube, hay un problema de señal.' })}
    </div>
    ${_ispDocsisChannelsHtml('Canales downstream', ds.channels)}
    ${_ispDocsisChannelsHtml('Canales upstream', us.channels)}
    ${_ispBlockSimulated(docsis) ? '<p class="isp-sim-legend"><span class="isp-sim-mark">*</span> Valor simulado: ISP Monitor no publica potencias ni el downstream todavía.</p>' : ''}
    ${docsis.measuredAt ? `<p class="isp-consulted">Medido: ${dateTimeHtml(docsis.measuredAt)}</p>` : ''}`;
}

/** Tecnología no identificada: el técnico elige HFC o GPON y se reconsulta. */
function renderIspTechChooser() {
  return `
    <div class="isp-section-title">Tecnología no identificada</div>
    <div class="isp-tech-chooser" role="group" aria-labelledby="ispTechChooserText">
      <p id="ispTechChooserText">ISP Monitor no informó si este equipo es de fibra o de cable. Elige el tipo de equipo para ver sus métricas:</p>
      <div class="isp-tech-chooser-btns">
        <button type="button" class="add-row-btn" data-action="isp-tech" data-tech="GPON">Fibra (GPON) — ONT / ONU</button>
        <button type="button" class="add-row-btn" data-action="isp-tech" data-tech="HFC">Cable (HFC) — cablemódem</button>
      </div>
    </div>`;
}

/** "En línea desde…" a partir de `uptime` (backend). */
function _ispUptimeHtml(uptime, lastOutage) {
  if (!uptime) return '';
  if (uptime.seconds === null || uptime.seconds === undefined) {
    return lastOutage && lastOutage.ongoing
      ? '<p class="isp-uptime is-down">Caído en este momento: sin tiempo en línea que mostrar.</p>'
      : '';
  }
  if (uptime.lowerBound) {
    return `<p class="isp-uptime">En línea al menos <strong>${escapeHtml(fmtDuration(uptime.seconds * 1000))}</strong> (sin caídas en la ventana de 24 h).</p>`;
  }
  return `<p class="isp-uptime">En línea desde ${uptime.since ? dateTimeHtml(uptime.since, { relative: false }) : '—'} · <strong>${escapeHtml(fmtDuration(uptime.seconds * 1000))}</strong> sin caídas.</p>`;
}

function renderIspDiagnostics(data) {
  const terminal = data.terminal || {};
  const tech = _ispTechnology(data);
  const statusTerminal = data.status && data.status.terminal;
  const statusNetwork = data.status && data.status.network;
  const stats = _ispOutageStats(statusTerminal);

  const skipped = data.skipped || [];
  const redLabel = _ispNetworkLabel(tech);

  // El endpoint de red devuelve cuántos equipos de esa red están en línea: se
  // grafica como cantidad, no como porcentaje. La operadora no expone el total
  // de la red, así que un "% de la red en línea" no se puede calcular; lo que
  // sirve al técnico es el escalón (si cae de golpe, el problema no es del
  // domicilio).
  const networkChart = _ispSeriesToChart(statusNetwork);
  const networkNow = statusNetwork && statusNetwork.points && statusNetwork.points.length
    ? statusNetwork.points[statusNetwork.points.length - 1].values[statusNetwork.keys[0]]
    : null;

  const errors = (data.errors || []).length
    ? `<div class="isp-partial">Endpoints sin respuesta: ${
        data.errors.map(e => escapeHtml(e.endpoint)).join(', ')
      }. El resto de los datos sí se consultó.</div>`
    : '';

  // Caídas: si el backend manda `outages` (hora exacta y causa) se usan esas;
  // si no (payload anterior), se calculan de la serie de estado. El conteo
  // sale siempre de la misma lista que se muestra.
  const apiOutages = data.outages && Array.isArray(data.outages.items) ? data.outages : null;
  const outageEvents = apiOutages ? _ispOutageEventsFromApi(apiOutages) : _ispOutageEvents(statusTerminal);
  const lastOutage = outageEvents.length ? outageEvents[outageEvents.length - 1] : null;
  const lastOutageValue = lastOutage
    ? (lastOutage.ongoing ? 'Ahora' : escapeHtml(fmtRelative(lastOutage.start)))
    : '—';
  const lastOutageLabel = lastOutage
    ? (lastOutage.ongoing ? 'caído en este momento' : `última caída · ${escapeHtml(fmtDateTimeEc(lastOutage.start, { seconds: false, year: false }))}`)
    : 'sin caídas en 24 h';
  const hasSeries = !!(statusTerminal && statusTerminal.points && statusTerminal.points.length);
  // % en línea: de la serie si está; si no, del total caído que informa el backend.
  const windowSec = apiOutages && apiOutages.window && apiOutages.window.hours ? apiOutages.window.hours * 3600 : 86400;
  const uptimePercent = hasSeries
    ? stats.uptimePercent
    : apiOutages && isFinite(apiOutages.totalDownSeconds)
      ? Math.max(0, (1 - apiOutages.totalDownSeconds / windowSec) * 100)
      : null;
  const timeline = apiOutages
    ? _ispOutageTimelineHtml(outageEvents, (Number(outageEvents.length && apiOutages.items[0].precisionSeconds) || 0) * 1000)
    : renderIspOutageTimeline(statusTerminal);

  const availability = hasSeries || apiOutages
    ? `
      <div class="isp-stats">
        <div class="isp-stat">
          <span class="isp-stat-value">${outageEvents.length}</span>
          <span class="isp-stat-label">caídas del equipo (24 h)</span>
        </div>
        <div class="isp-stat">
          <span class="isp-stat-value">${uptimePercent === null ? '—' : _fmtNum(uptimePercent, 1) + '%'}</span>
          <span class="isp-stat-label">del tiempo en línea (24 h)</span>
        </div>
        <div class="isp-stat${lastOutage && lastOutage.ongoing ? ' is-alert' : ''}">
          <span class="isp-stat-value isp-stat-value-sm">${lastOutageValue}</span>
          <span class="isp-stat-label">${lastOutageLabel}</span>
        </div>
        <div class="isp-stat">
          <span class="isp-stat-value">${networkNow === null || networkNow === undefined ? '—' : escapeHtml(String(networkNow))}</span>
          <span class="isp-stat-label">equipos en línea en su red (última muestra)</span>
        </div>
      </div>
      ${_ispUptimeHtml(data.uptime, lastOutage)}
      ${hasSeries ? renderStatusBand(statusTerminal, 'Equipo del cliente') : ''}
      <div class="isp-subsection-title isp-section-with-badge">Caídas del equipo ${_ispSimBadge(!!(apiOutages && apiOutages.simulated), 'Caídas simuladas: conector de ISP Monitor en modo demo')}</div>
      ${timeline}
      ${networkChart.length ? `
      <div class="isp-subsection-title">Equipos en línea en la misma red</div>
      ${_ispChartCard(`Equipos en línea · ${redLabel}`, networkChart,
        { minZero: true, unit: 'equipos', ariaLabel: 'Equipos en línea en la misma red de acceso, últimas 24 horas' })}
      <p class="isp-hint">
        Es la cantidad de equipos en línea en ${escapeHtml(redLabel.toLowerCase())},
        no un porcentaje: la operadora no publica el total de la red. Lo que
        importa es el escalón — si cae de golpe, el problema no es del domicilio.
      </p>` : ''}`
    : `<div class="detail-empty">La operadora no devolvió el histórico de estado de este equipo.</div>`;

  const consultado = data.fetchedAt
    ? `<p class="isp-consulted">Consultado: ${dateTimeHtml(data.fetchedAt)} · hora de Ecuador</p>`
    : '';
  const techNote = terminal.found && tech && _ISP_TECH_SOURCE_TEXT[data.technologySource]
    ? `<p class="isp-tech-source">Tecnología ${escapeHtml(tech)} ${escapeHtml(_ISP_TECH_SOURCE_TEXT[data.technologySource])}.</p>`
    : '';

  // Por tecnología: GPON → capa óptica y NADA DOCSIS; HFC → bloque DOCSIS +
  // series SNR/FEC como antes; sin identificar → el técnico elige.
  let techSections = '';
  if (terminal.found && tech === 'GPON') {
    techSections = renderIspGponSection(data.gpon);
  } else if (terminal.found && tech === 'HFC') {
    techSections = `
      ${renderIspDocsisSection(data.docsis)}
      ${_ispMetricSection('Señal a ruido (SNR) — 24 h · DOCSIS', 'snr', data.snr, { technology: tech }, skipped,
        { unit: 'dB', ariaLabel: 'Señal a ruido de las últimas 24 horas' },
        'Calidad de la señal del cablemódem, en <strong>dB</strong>: más alto es mejor. Un valor bajo o una caída brusca indica ruido en la red coaxial.')}
      ${_ispMetricSection('Errores FEC — 24 h · DOCSIS', 'codewords', data.codewords, { technology: tech }, skipped,
        { minZero: true, ariaLabel: 'Errores FEC de las últimas 24 horas' },
        '<strong>Corregidos</strong>: errores que el módem reparó (en poca cantidad es normal). <strong>Sin corregir</strong>: datos perdidos; si suben, hay un problema de señal. Valores tal como los entrega ISP Monitor.')}`;
  } else if (terminal.found) {
    techSections = renderIspTechChooser();
  }

  return `
    <div class="isp-results" data-technology="${escapeHtml(tech || '')}">
      <div class="isp-section-title isp-section-first isp-section-with-badge">Estado actual del equipo ${_ispSimBadge(data.simulated === true, 'Todo el resultado es simulado: conector de ISP Monitor en modo demo')}</div>
      ${consultado}
      ${renderIspTerminalCard(terminal, tech)}
      ${techNote}
      ${errors}

      ${terminal.found ? `<div class="isp-section-title">Disponibilidad y caídas — últimas 24 h</div>${availability}` : ''}

      ${techSections}

      ${terminal.found ? renderIspHistory(terminal.history) : ''}

      <div class="isp-footnote">
        Consultado ${escapeHtml(fmtDateTimeEc(data.fetchedAt))} · ISP Monitor ·
        las series cubren las últimas 24 h contadas desde ese instante.
        Horas en hora de Ecuador (UTC-5).
      </div>
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
          <li><strong>ONT Huawei OptiXstar</strong>, ONU B2000 — SN</li>
          <li><strong>ONU300G / ONU HUR</strong> — PON SN</li>
          <li><strong>Cablemódem HFC</strong> — MAC</li>
        </ul>
        <p>El <strong>D-SN</strong> y el <strong>EN</strong> que también vienen impresos no sirven acá: la operadora los rechaza.</p>
        <p><strong>Decodificadores, decos HD y MTA:</strong> la operadora no confirmó si se consultan por estos mismos endpoints. Se puede probar con su SN o HOST-SN, pero si responde "sin datos" no es un error de la app.</p>
      </details>
      <label class="form-row">
        <span class="form-label">Serial GPON o MAC del cablemódem</span>
        <input type="text" data-field="terminalId" class="isp-input" inputmode="latin"
          autocapitalize="characters" autocomplete="off" spellcheck="false"
          placeholder="ZTEGC1234567 · A4B87E112233" value="${escapeHtml(remembered)}">
      </label>
      <label class="form-row">
        <span class="form-label">Tipo de equipo</span>
        <select data-field="isp-tech" class="isp-tech-select" aria-describedby="ispTechHelp">
          <option value=""${_ispState.tech ? '' : ' selected'}>Automático (por el serial o la MAC)</option>
          <option value="GPON"${_ispState.tech === 'GPON' ? ' selected' : ''}>Fibra (GPON) — ONT / ONU</option>
          <option value="HFC"${_ispState.tech === 'HFC' ? ' selected' : ''}>Cable (HFC) — cablemódem</option>
        </select>
        <span class="form-hint" id="ispTechHelp">Con un serial GPON la app ya avisa que es fibra. Elige a mano si ISP Monitor no lo identifica.</span>
      </label>
      <div class="isp-actions">
        ${canScan ? `<button type="button" class="add-row-btn" data-action="isp-scan">Escanear</button>` : ''}
        ${canScan ? `<button type="button" class="add-row-btn" data-action="isp-photo">Tomar foto</button>` : ''}
        <button type="button" class="save-btn isp-consult-btn" data-action="isp-consult">Consultar</button>
      </div>
      ${canScan ? `<input type="file" accept="image/*" capture="environment"
        data-slot="isp-photo-input" style="display:none" aria-hidden="true" tabindex="-1">` : ''}
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
  const photoBtn = panel.querySelector('[data-action="isp-photo"]');
  const photoInput = panel.querySelector('[data-slot="isp-photo-input"]');

  function setFeedback(message, kind) {
    feedback.textContent = message || '';
    feedback.className = `isp-feedback${kind ? ' ' + kind : ''}`;
  }

  const techSelect = panel.querySelector('[data-field="isp-tech"]');

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
      const tech = _ispTechHint(id, techSelect ? techSelect.value : '');
      const data = await WifixAPI.getTerminalDiagnostics(id, tech ? { technology: tech } : undefined);
      _ispState = { id: id, data: data, tech: techSelect ? techSelect.value : '' };
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
  // "Tecnología no identificada": el técnico elige HFC/GPON y se reconsulta.
  results.addEventListener('click', (ev) => {
    const btn = ev.target && ev.target.closest ? ev.target.closest('[data-action="isp-tech"]') : null;
    if (!btn || !techSelect) return;
    techSelect.value = btn.dataset.tech;
    consult();
  });
  input.addEventListener('input', checkIdShape);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); consult(); }
  });
  checkIdShape();

  // Aplica al input el código elegido, venga del barcode o de la foto.
  function applyPicked(picked, source) {
    input.value = picked.id;
    checkIdShape();
    const what = picked.kind === 'GPON' ? 'Serial GPON' : 'MAC';
    if (picked.repaired) {
      setFeedback(
        `${what} leído de la foto: ${picked.id}. El OCR corrigió caracteres dudosos ` +
          '(O/0, I/1, S/5): verificá contra la etiqueta antes de consultar.',
        'warn',
      );
    } else if (source === 'photo' && picked.labeled === false) {
      setFeedback(
        `${what} detectado: ${picked.id}. No se leyó la etiqueta que lo acompaña, ` +
          'así que revisá que no sea el D-SN ni el EN.',
        'warn',
      );
    } else {
      setFeedback(`${what} detectado: ${picked.id}`, 'ok');
    }
  }

  if (scanBtn) {
    scanBtn.addEventListener('click', async () => {
      scanBtn.disabled = true;
      scanBtn.textContent = 'Leyendo…';
      setFeedback('');
      try {
        const rawValues = await window.WifixNative.serialScanner.scanBarcodes();
        if (!rawValues || rawValues.length === 0) {
          setFeedback('No se detectó ningún código. Probá con "Tomar foto" o escribilo a mano.', 'warn');
        } else {
          // La etiqueta trae varios códigos (GPON SN, MAC, D-SN, EN): se elige
          // el único que ISP Monitor acepta.
          const picked = _ispPickTerminalId(rawValues);
          if (picked) {
            applyPicked(picked, 'barcode');
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

  // ---- "Tomar foto": OCR sobre la etiqueta ----------------------------------
  //
  // Misma idea que en Equipos Retirados: se saca una foto y ML Kit lee el texto
  // on-device. La diferencia es qué se busca en ese texto — acá solo sirven el
  // serial GPON y la MAC, así que se usa _ispPickTerminalIdFromText en vez de
  // extractSerial (que trabaja por modelo de equipo).
  //
  // En el APK se usa la cámara nativa; si no está, se cae al <input type="file"
  // capture="environment">, que en Android abre igual la cámara.
  if (photoBtn) {
    const useNativeCamera = !!(window.WifixNative && typeof window.WifixNative.takePhoto === 'function');

    async function readLabelFromBase64(base64) {
      photoBtn.textContent = 'Leyendo la foto…';
      const lines = await window.WifixNative.serialScanner.ocrFromImageBase64(base64);
      if (!lines || lines.length === 0) {
        setFeedback(
          'No se encontró texto en la foto. Acercá la cámara a la etiqueta, ' +
            'enfocá y evitá el reflejo del plástico.',
          'warn',
        );
        return;
      }
      const picked = _ispPickTerminalIdFromText(lines);
      if (!picked) {
        setFeedback(
          'Se leyó texto, pero ningún código con forma de serial GPON ni de MAC. ' +
            'Probá con "Escanear" o escribilo a mano.',
          'warn',
        );
        return;
      }
      applyPicked(picked, 'photo');
    }

    function resetPhotoBtn() {
      photoBtn.disabled = false;
      photoBtn.textContent = 'Tomar foto';
    }

    if (useNativeCamera) {
      photoBtn.addEventListener('click', async () => {
        photoBtn.disabled = true;
        photoBtn.textContent = 'Abriendo cámara…';
        setFeedback('');
        try {
          const dataUrl = await window.WifixNative.takePhoto();
          if (!dataUrl) {
            // Cancelado por el técnico o permiso denegado.
            setFeedback('No se tomó ninguna foto.', 'warn');
            return;
          }
          await readLabelFromBase64(dataUrl.split(',').pop());
        } catch (err) {
          console.error('[Wifix] isp takePhoto/OCR', err);
          setFeedback('No se pudo procesar la foto.', 'error');
        } finally {
          resetPhotoBtn();
        }
      });
    } else if (photoInput) {
      photoBtn.addEventListener('click', () => { photoInput.click(); });

      photoInput.addEventListener('change', async () => {
        const file = photoInput.files && photoInput.files[0];
        if (!file) return;
        photoBtn.disabled = true;
        setFeedback('');
        try {
          const base64 = await readFileAsBase64(file);
          await readLabelFromBase64(base64);
        } catch (err) {
          console.error('[Wifix] isp OCR desde archivo', err);
          setFeedback('No se pudo procesar la foto.', 'error');
        } finally {
          resetPhotoBtn();
          photoInput.value = '';
        }
      });
    }
  }

  // Si ya se consultó este equipo en esta sesión, se repinta sin volver a pedir.
  if (_ispState.data && _ispState.id === (input.value || '').trim()) {
    results.innerHTML = renderIspDiagnostics(_ispState.data);
  }
}

function renderEventsList(events) {
  // Campo 14: los eventos de la red de acceso siguen siendo simulados.
  const aviso = mockNotice();
  if (!events || events.length === 0) {
    return `${aviso}<div class="detail-empty">Sin eventos registrados.</div>`;
  }
  const badgeClass = s => s === 'RESUELTO' ? 'badge-resolved' : s === 'PENDIENTE' ? 'badge-pending' : 'badge-fail';
  // Ícono + texto del estado (nunca solo color).
  const badgeIcon = s => s === 'RESUELTO' ? _ISP_OUTAGE_ICONS.up : _ISP_OUTAGE_ICONS.down;
  // Más reciente primero; los que no traen fecha van al final.
  const sorted = [...events].sort((a, b) => {
    const da = toValidDate(a.occurredAt);
    const db = toValidDate(b.occurredAt);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return db - da;
  });
  return aviso + `<ol class="event-list" aria-label="Eventos de la red de acceso, del más reciente al más antiguo">` +
    sorted.map(e => `
    <li class="event-item event-item-net">
      <div class="event-body">
        <div class="event-head">
          <span class="event-title">${escapeHtml(e.type || 'Evento de red')}</span>
          <span class="event-badge event-badge-icon ${badgeClass(e.status)}">${badgeIcon(e.status)}${escapeHtml(e.status || 'Sin estado')}</span>
        </div>
        <span class="event-when"><span class="event-when-label">Ocurrió:</span> ${dateTimeHtml(e.occurredAt)}</span>
        ${e.description ? `<span class="event-desc">${escapeHtml(e.description)}</span>` : ''}
      </div>
    </li>`).join('') + '</ol>';
}

// Badge por resultado de la visita. REALIZADA y CANCELADA son neutras: la
// primera significa que la operadora no informó si fue satisfactoria. Un
// resultado desconocido también cae en neutro (nunca en rojo por defecto).
const VISIT_BADGE_CLASS = Object.freeze({
  SATISFACTORIA: 'badge-resolved',
  INSATISFACTORIA: 'badge-fail',
  PENDIENTE: 'badge-pending',
  CANCELADA: 'badge-neutral',
  REALIZADA: 'badge-neutral',
});

function visitBadgeClass(result) {
  return VISIT_BADGE_CLASS[result] || 'badge-neutral';
}

// Botón de notas bajo demanda: una expansión = una llamada. Nada de precargar.
function _visitNotesButtonHtml(t) {
  return (!t.notesLoaded && t.workOrder)
    ? `
      <button type="button" class="task-notes-btn" data-action="task-notes"
        data-workorder="${escapeHtml(t.workOrder)}" aria-expanded="false">Ver notas de cierre</button>
      <div class="task-notes-slot" data-slot="task-notes"></div>`
    : '';
}

// Visita pendiente (la próxima): se pinta como siempre, destacada arriba. Si
// ya tiene registros de esta visita, se agregan colapsados al final.
function renderVisitItem(t, extraClass) {
  // ⚠2 FSM no expone el técnico que cerró la tarea: llega null y se muestra
  // como "—". Queda pendiente pedirlo a la operadora.
  const tecnico = t.technician || '—';
  const notas = t.closingNotes ? escapeHtml(t.closingNotes) : '';
  const aviso = t.result === 'REALIZADA'
    ? '<span class="visit-hint">Resultado no verificado por la operadora</span>'
    : '';
  const registros = _visitHasRecords(t.records)
    ? `<details class="visit-records-inline">
         <summary>Registros de esta visita (${_visitDoneCount(t.records)} de ${_visitChecklist(t.records).length})</summary>
         ${renderVisitRecords(t.records)}
       </details>`
    : '';
  return `
    <div class="event-item${extraClass ? ' ' + extraClass : ''}" data-workorder="${escapeHtml(t.workOrder || '')}" data-result="${escapeHtml(t.result || '')}">
      <span class="event-date">${formatDatePill(t.occurredAt)}</span>
      <div class="event-body">
        <span class="event-badge ${visitBadgeClass(t.result)}">${escapeHtml(t.result || '—')}</span>
        <span class="event-title">${escapeHtml(t.taskId || t.workOrder || '—')} · ${escapeHtml(tecnico)}</span>
        <span class="event-desc"><strong>${escapeHtml(t.reason || '—')}</strong>${notas ? ' — ' + notas : ''}</span>
        ${aviso}
        ${_visitNotesButtonHtml(t)}
        ${registros}
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Registros de la app por visita (GET /accounts/{n}/visits?include=records)
// ---------------------------------------------------------------------------
const VISIT_LINKED_BY_TEXT = Object.freeze({
  TASK_ID: 'Registros vinculados por nº de tarea',
  TIME_WINDOW: 'Registros vinculados por horario de la visita',
  MIXED: 'Registros vinculados por nº de tarea y por horario',
});

const _VISIT_CHECK_ICONS = {
  done: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  missing: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

function _visitChecklist(records) {
  return records && Array.isArray(records.checklist) ? records.checklist : [];
}
function _visitDoneCount(records) {
  return _visitChecklist(records).filter(c => c && c.done).length;
}
function _visitHasRecords(records) {
  return _visitDoneCount(records) > 0;
}

/** "(por horario)" discreto en un registro que no vino por nº de tarea. */
function _recordLinkHint(rec) {
  return rec && rec.linkedBy === 'TIME_WINDOW'
    ? ' <span class="rec-link" title="Asociado a esta visita por la hora en que se tomó">· por horario</span>'
    : '';
}
function _recordWhen(rec, field) {
  const v = rec && (rec[field] || rec.measuredAt || rec.createdAt);
  return v ? `<span class="rec-when">${escapeHtml(fmtDateTimeEc(v, { seconds: false, year: false }))}</span>` : '';
}

function _recSpeedtestHtml(s) {
  const externo = s.source === 'external-device';
  const fuente = externo
    ? `Dispositivo externo${s.deviceName ? ' · ' + escapeHtml(s.deviceName) : ''}`
    : `App${s.serverName ? ' · ' + escapeHtml(s.serverName) : ''}`;
  const extras = [
    s.latencyMs !== undefined && s.latencyMs !== null ? `latencia ${escapeHtml(_fmtNum(s.latencyMs, 1))} ms` : '',
    s.jitterMs !== undefined && s.jitterMs !== null ? `jitter ${escapeHtml(_fmtNum(s.jitterMs, 1))} ms` : '',
  ].filter(Boolean).join(' · ');
  return `
    <li class="rec-item">
      <div class="rec-head"><span class="rec-title">Speedtest — ${fuente}</span>
        ${s.simulated ? '<span class="sim-badge">Simulado</span>' : ''}</div>
      <div class="rec-values"><strong>↓ ${escapeHtml(_fmtNum(s.downloadMbps, 1))}</strong> / <strong>↑ ${escapeHtml(_fmtNum(s.uploadMbps, 1))}</strong> Mbps${extras ? ' · ' + extras : ''}</div>
      <div class="rec-meta">${_recordWhen(s)}${_recordLinkHint(s)}</div>
    </li>`;
}

function _recPingHtml(p) {
  const sent = Number(p.packetsSent);
  const recv = Number(p.packetsReceived);
  let loss = p.packetLossPercent;
  if ((loss === undefined || loss === null) && sent > 0 && Number.isFinite(recv)) loss = ((sent - recv) / sent) * 100;
  const partes = [
    p.avgLatencyMs !== undefined && p.avgLatencyMs !== null ? `promedio <strong>${escapeHtml(_fmtNum(p.avgLatencyMs, 1))} ms</strong>` : '',
    loss !== undefined && loss !== null ? `pérdida <strong>${escapeHtml(_fmtNum(loss, 1))} %</strong>` : '',
    sent > 0 ? `${escapeHtml(String(Number.isFinite(recv) ? recv : '—'))}/${escapeHtml(String(sent))} paquetes` : '',
  ].filter(Boolean).join(' · ');
  return `
    <li class="rec-item">
      <div class="rec-head"><span class="rec-title">Ping a ${escapeHtml(p.target || '—')}${p.continuous ? ' (continuo)' : ''}</span></div>
      <div class="rec-values">${partes || 'Sin valores'}</div>
      <div class="rec-meta">${_recordWhen(p)}${_recordLinkHint(p)}</div>
    </li>`;
}

function _recTracerouteHtml(t) {
  const hops = Array.isArray(t.hops) ? t.hops : [];
  const filas = hops.map(h => `
    <li><span class="hop-n">${escapeHtml(String(h.hopNumber))}</span>
      <span class="hop-host">${h.host ? escapeHtml(h.host) : 'sin respuesta'}</span>
      <span class="hop-ms">${h.latencyMs !== undefined && h.latencyMs !== null ? escapeHtml(_fmtNum(h.latencyMs, 1)) + ' ms' : '—'}</span></li>`).join('');
  return `
    <li class="rec-item">
      <div class="rec-head"><span class="rec-title">Traceroute a ${escapeHtml(t.target || '—')}</span></div>
      <div class="rec-values">${hops.length} salto${hops.length === 1 ? '' : 's'}</div>
      ${hops.length ? `<details class="rec-hops"><summary>Ver saltos</summary><ol class="hop-list">${filas}</ol></details>` : ''}
      <div class="rec-meta">${_recordWhen(t)}${_recordLinkHint(t)}</div>
    </li>`;
}

// Mejor señal por habitación (multi-AP) o el signalDbm legacy.
function _roomBestSignal(room) {
  const ms = Array.isArray(room.measurements) ? room.measurements : [];
  const vals = ms.map(m => Number(m.signalDbm)).filter(Number.isFinite);
  if (vals.length) return Math.max(...vals);
  return Number.isFinite(Number(room.signalDbm)) ? Number(room.signalDbm) : null;
}

function _recWifiHtml(h) {
  const rooms = Array.isArray(h.rooms) ? h.rooms : [];
  const lista = rooms.map((r) => {
    const best = _roomBestSignal(r);
    return `<li>${escapeHtml(r.roomName || 'Habitación')}: <strong>${best === null ? '—' : escapeHtml(String(best)) + ' dBm'}</strong></li>`;
  }).join('');
  return `
    <li class="rec-item">
      <div class="rec-head"><span class="rec-title">Señal WiFi${h.label ? ' — ' + escapeHtml(h.label) : ''}</span></div>
      <div class="rec-values">${rooms.length} habitación${rooms.length === 1 ? '' : 'es'} medida${rooms.length === 1 ? '' : 's'} (mejor señal por habitación)</div>
      ${lista ? `<ul class="rec-rooms">${lista}</ul>` : ''}
      <div class="rec-meta">${_recordWhen(h, 'createdAt')}${_recordLinkHint(h)}</div>
    </li>`;
}

function _recDistanceHtml(d) {
  return `
    <li class="rec-item">
      <div class="rec-head"><span class="rec-title">Distancia medida</span></div>
      <div class="rec-values"><strong>${escapeHtml(_fmtNum(d.distanceMeters, 1))} m</strong></div>
      <div class="rec-meta">${_recordWhen(d)}${_recordLinkHint(d)}</div>
    </li>`;
}

function _recRetiredHtml(e) {
  return `
    <li class="rec-item">
      <div class="rec-head"><span class="rec-title">Equipo retirado</span></div>
      <div class="rec-values">Serial <strong class="mono">${escapeHtml(e.serialValue || '—')}</strong>${e.equipmentModelId ? ' · ' + escapeHtml(e.equipmentModelId) : ''}${e.removalReasonCode ? ' · motivo ' + escapeHtml(e.removalReasonCode) : ''}</div>
      <div class="rec-meta">${_recordWhen(e, 'retiredAt')}${_recordLinkHint(e)}</div>
    </li>`;
}

const _REC_DEVICE_RESULT = Object.freeze({
  ok: { cls: 'badge-resolved', text: 'Apto' },
  blocked: { cls: 'badge-fail', text: 'Bloqueado' },
  unknown_plan: { cls: 'badge-pending', text: 'Sin plan' },
});

/** Validación de equipo vs plan (registro por visita `deviceValidations`). */
function _recDeviceValidationHtml(v) {
  const r = _REC_DEVICE_RESULT[v.result] || { cls: 'badge-neutral', text: v.result || '—' };
  const modelo = v.device ? (v.device.displayName || v.device.model) : v.model;
  const plan = v.planMbps ? `plan ${escapeHtml(String(v.planMbps))} Mbps${v.planSource === 'simulated' ? ' (simulado)' : ''}` : 'plan sin dato';
  const tecnico = v.technician && (v.technician.name || v.technician.email);
  return `
    <li class="rec-item">
      <div class="rec-head"><span class="rec-title">Validación de equipo</span>
        <span class="event-badge ${r.cls}">${escapeHtml(r.text)}</span></div>
      <div class="rec-values">${modelo ? escapeHtml(modelo) + ' · ' : ''}Serial <strong class="mono">${escapeHtml(v.serial || '—')}</strong> · ${plan}</div>
      ${v.result === 'blocked' && v.message ? `<div class="rec-values">${escapeHtml(v.message)}</div>` : ''}
      <div class="rec-meta">${_recordWhen(v, 'createdAt')}${tecnico ? ` · ${escapeHtml(tecnico)}` : ''}${_recordLinkHint(v)}</div>
    </li>`;
}

/** Checklist (✓/✗ con texto, incluye 'clientLocation') + los datos de cada prueba. */
function renderVisitRecords(records) {
  if (!records) return '';
  const checklist = _visitChecklist(records);
  const items = checklist.map((c) => `
    <li class="visit-check ${c.done ? 'is-done' : 'is-missing'}">
      <span class="visit-check-icon" aria-hidden="true">${c.done ? _VISIT_CHECK_ICONS.done : _VISIT_CHECK_ICONS.missing}</span>
      <span class="visit-check-label">${escapeHtml(c.label || c.type)}</span>
      <span class="visit-check-state">${c.done ? `Hecho${c.count > 1 ? ` (${escapeHtml(String(c.count))})` : ''}` : 'No hecho'}</span>
    </li>`).join('');
  const arr = (k) => (Array.isArray(records[k]) ? records[k] : []);
  const detalle = [
    ...arr('speedtests').map(_recSpeedtestHtml),
    ...arr('pingTests').map(_recPingHtml),
    ...arr('tracerouteTests').map(_recTracerouteHtml),
    ...arr('wifiHeatmaps').map(_recWifiHtml),
    ...arr('distanceMeasurements').map(_recDistanceHtml),
    ...arr('clientLocations').map(_recClientLocationHtml),
    ...arr('retiredEquipment').map(_recRetiredHtml),
    ...arr('deviceValidations').map(_recDeviceValidationHtml),
  ].join('');
  const vinculo = VISIT_LINKED_BY_TEXT[records.linkedBy] || '';
  return `
    ${checklist.length ? `<ul class="visit-checklist" aria-label="Qué se hizo en la visita">${items}</ul>` : ''}
    ${detalle ? `<ul class="rec-list" aria-label="Datos de las pruebas">${detalle}</ul>` : ''}
    ${vinculo ? `<p class="visit-link-note">${escapeHtml(vinculo)}</p>` : ''}`;
}

/**
 * Visita anterior como tarjeta expandible (<details>): en el resumen, fecha,
 * resultado, orden y cuántas pruebas se hicieron; dentro, fechas completas,
 * notas, checklist y datos de cada prueba.
 */
function renderVisitCard(t) {
  const tecnico = t.technician || '—';
  const notas = t.closingNotes ? escapeHtml(t.closingNotes) : '';
  const checklist = _visitChecklist(t.records);
  const resumen = checklist.length
    ? `${_visitDoneCount(t.records)} de ${checklist.length} pruebas`
    : '';
  const fechaResumen = t.endedAt || t.occurredAt;
  const fsm = t.fsmTaskId && t.fsmTaskId !== t.workOrder ? `<div><dt>Tarea FSM</dt><dd>${escapeHtml(t.fsmTaskId)}</dd></div>` : '';
  return `
    <details class="visit-card" data-workorder="${escapeHtml(t.workOrder || '')}" data-result="${escapeHtml(t.result || '')}">
      <summary class="visit-card-summary">
        <span class="visit-card-date">${escapeHtml(fmtDateTimeEc(fechaResumen, { seconds: false }))}</span>
        <span class="visit-card-main">
          <span class="event-badge ${visitBadgeClass(t.result)}">${escapeHtml(t.result || '—')}</span>
          <span class="event-title">${escapeHtml(t.taskId || t.workOrder || '—')} · ${escapeHtml(tecnico)}</span>
          <span class="visit-card-reason">${escapeHtml(t.reason || '—')}${resumen ? ` · <span class="visit-card-count">${resumen}</span>` : ''}</span>
        </span>
        <span class="visit-card-chev" aria-hidden="true">${SERVICIO_ICONS.chev}</span>
      </summary>
      <div class="visit-card-body">
        <dl class="visit-card-dates">
          <div><dt>Orden</dt><dd>${escapeHtml(t.workOrder || '—')}</dd></div>
          ${fsm}
          <div><dt>Creada</dt><dd>${t.createdAt ? dateTimeHtml(t.createdAt) : '—'}</dd></div>
          <div><dt>Finalizada</dt><dd>${t.endedAt ? dateTimeHtml(t.endedAt) : (t.result === 'CANCELADA' ? 'Cancelada' : '—')}</dd></div>
        </dl>
        ${notas ? `<p class="visit-card-notes">${notas}</p>` : ''}
        ${t.result === 'REALIZADA' ? '<span class="visit-hint">Resultado no verificado por la operadora</span>' : ''}
        ${_visitNotesButtonHtml(t)}
        ${renderVisitRecords(t.records)}
      </div>
    </details>`;
}

// Panel único "Visitas pendientes y anteriores" (GET /accounts/{n}/visits
// ?include=records). `result` es { items, pendingCount, totalOrders, scanned,
// truncated, brand, degraded?, recordsSummary? }; se tolera el array desnudo.
// El backend ya ordena: la pendiente primero y el resto por fecha descendente.
// Sin visitas anteriores no se pinta esa sección (ni contadores en cero).
function renderVisitsList(result) {
  const items = Array.isArray(result) ? result : ((result && result.items) || []);
  const truncated = !Array.isArray(result) && result ? result.truncated === true : false;
  const degraded = (!Array.isArray(result) && result && result.degraded) || null;

  // El mensaje ya viene redactado en español desde el backend: no se reescribe.
  const nota = (truncated && degraded && degraded.message)
    ? `<div class="detail-note">${escapeHtml(degraded.message)}</div>`
    : '';

  if (items.length === 0) {
    return `${nota}<div class="detail-empty">Sin visitas registradas.</div>`;
  }

  const pendientes = items.filter(t => t && t.result === 'PENDIENTE');
  const anteriores = items.filter(t => t && t.result !== 'PENDIENTE');

  const bloquePendiente = pendientes.length
    ? `
    <section class="visits-group visits-upcoming" aria-label="Próxima visita (pendiente)">
      <h3 class="visits-heading">Próxima visita (pendiente)</h3>
      ${pendientes.map(t => renderVisitItem(t, 'visit-upcoming')).join('')}
    </section>`
    : '';
  const bloqueAnteriores = anteriores.length
    ? `
    <section class="visits-group" aria-label="Visitas anteriores">
      ${pendientes.length ? '<h3 class="visits-heading visits-heading-sep">Visitas anteriores</h3>' : ''}
      ${anteriores.map(renderVisitCard).join('')}
    </section>`
    : '';

  return nota + bloquePendiente + bloqueAnteriores;
}

// ---------------------------------------------------------------------------
// Visita en curso: taskId de los registros que se guardan
// ---------------------------------------------------------------------------
// Todos los POST de herramientas/equipos retirados mandan como `taskId` el
// workOrder (o fsmTaskId) de la visita PENDIENTE de la cuenta. Sin visita
// pendiente no se manda taskId y el backend asocia por horario. Nunca se usa
// el TASK/… que genera el panel NAP (es un identificador local, no de FSM).
// Se lee de lo que ya cargó el panel de visitas; si no se abrió, se consulta
// /visits una vez por cuenta y se recuerda (sin tocar la operadora de más).
const PENDING_VISIT_TTL_MS = 30 * 60 * 1000;
const PENDING_VISIT_FAIL_TTL_MS = 2 * 60 * 1000;
const _pendingVisitCache = new Map();   // cuenta → { taskId, promise?, at, ttl }

function pendingVisitTaskId(result) {
  const items = Array.isArray(result) ? result : ((result && result.items) || []);
  const p = items.find(t => t && t.result === 'PENDIENTE');
  return p ? (p.workOrder || p.fsmTaskId || null) : null;
}

function rememberVisits(cuenta, result) {
  if (!cuenta) return;
  _pendingVisitCache.set(cuenta, { taskId: pendingVisitTaskId(result), at: Date.now(), ttl: PENDING_VISIT_TTL_MS });
}

/** taskId ya conocido (sin red), o null. En Visita técnica: la task validada. */
function peekCurrentVisitTaskId(cuenta) {
  if (visitTaskUsesModule()) return visitTaskIdFor(cuenta);
  const hit = cuenta ? _pendingVisitCache.get(cuenta) : null;
  if (!hit || hit.promise || Date.now() - hit.at > hit.ttl) return null;
  return hit.taskId || null;
}

/**
 * taskId de la visita en curso. En Visita técnica es SIEMPRE la task que el
 * técnico validó (§4); en los demás módulos, la visita pendiente de /visits
 * (consulta una vez si hace falta).
 */
function resolveCurrentVisitTaskId(cuenta) {
  if (!cuenta) return Promise.resolve(null);
  if (visitTaskUsesModule()) return Promise.resolve(visitTaskIdFor(cuenta));
  const hit = _pendingVisitCache.get(cuenta);
  if (hit && Date.now() - hit.at <= hit.ttl) {
    return hit.promise || Promise.resolve(hit.taskId || null);
  }
  const promise = WifixAPI.getVisits(cuenta)
    .then((r) => { rememberVisits(cuenta, r); return pendingVisitTaskId(r); })
    .catch((err) => {
      console.warn('[Wifix] visita en curso (taskId):', err);
      _pendingVisitCache.set(cuenta, { taskId: null, at: Date.now(), ttl: PENDING_VISIT_FAIL_TTL_MS });
      return null;
    });
  _pendingVisitCache.set(cuenta, { promise, at: Date.now(), ttl: PENDING_VISIT_TTL_MS });
  return promise;
}

WifixAPI.setTaskIdResolver(resolveCurrentVisitTaskId);

// ---------------------------------------------------------------------------
// Visita técnica: Nº de task OBLIGATORIO (contrato 2026-10-06 §4)
// ---------------------------------------------------------------------------
// Al entrar a Visita técnica el técnico escribe el nº de task asignado a esta
// visita (TASK/549487/2026 o solo los dígitos) y se valida contra la orden con
// GET /orders/task-check. Se sugiere la tarea Pendiente de la orden, pero el
// técnico tiene que confirmarla. Sin task válida NINGÚN registro de la visita
// se guarda (guardia TASK_REQUIRED de api.js) y esa taskId es la que viaja como
// `taskId` en todos los registros (reemplaza al workOrder de la visita pendiente).
const VISIT_TASK_MODULE = 'visitas';
const VISIT_TASK_GUARD_MSG = 'Falta el Nº de task: valídalo arriba, en la pantalla de Visita técnica.';
const _visitTasks = new Map();   // cuenta → { taskId, workOrder, task, at }
// Estado de la tarjeta (por cuenta): borrador, error y "cambiando".
const _visitTaskUi = { account: null, draft: null, error: null, busy: false, changing: false, loadingCtx: false, ctxError: null };

function visitTaskUsesModule(category = currentCategory) {
  return category === VISIT_TASK_MODULE;
}

/** Task validada vigente de la cuenta (debe ser de la orden actual de la sesión). */
function visitTaskFor(cuenta) {
  const c = String(cuenta || '').trim();
  const hit = c ? _visitTasks.get(c) : null;
  if (!hit) return null;
  return hit.workOrder === sessionWorkOrder(c) ? hit : null;
}

function visitTaskIdFor(cuenta) {
  const t = visitTaskFor(cuenta);
  return t ? t.taskId : null;
}

/** Guardia de api.js: solo en Visita técnica, y solo si falta la task. */
function visitTaskGuard(accountNumber) {
  if (!visitTaskUsesModule()) return null;
  return visitTaskIdFor(accountNumber) ? null : VISIT_TASK_GUARD_MSG;
}
WifixAPI.setTaskGuard(visitTaskGuard);

/** Tarea sugerida: la Pendiente más reciente de la orden (el técnico la confirma). */
function suggestedVisitTask(context) {
  const pendientes = orderTasksSorted(context && context.tasks).filter(t => t.status === 'Pendiente');
  return pendientes[0] || null;
}

/** Valida la task contra la orden. { ok, entry } o { ok:false, error }. */
async function validateVisitTask(cuenta, raw) {
  const wo = sessionWorkOrder(cuenta);
  if (!wo) return { ok: false, error: 'Primero ingresa el Nº de orden de la visita.' };
  const tid = WifixAPI.normalizeTaskId(raw);
  if (!tid) return { ok: false, error: 'Formato inválido. Usa TASK/549487/2026 o solo el número (6 o 7 dígitos).' };
  let r;
  try {
    r = await WifixAPI.checkOrderTask(wo, tid);
  } catch (err) {
    console.error('[Wifix] task-check:', err);
    if (err && err.code === 'VALIDATION_ERROR') return { ok: false, error: 'Formato inválido. Usa TASK/549487/2026 o solo el número.' };
    return { ok: false, error: `No se pudo validar la task: ${(err && err.message) || 'error del servidor'}.` };
  }
  if (!r || r.valid !== true) {
    return { ok: false, error: `La task ${tid} no pertenece a la orden ${wo}. Revisa el número asignado a esta visita.` };
  }
  const entry = { taskId: r.taskId || tid, workOrder: wo, task: r.task || null, at: Date.now() };
  _visitTasks.set(String(cuenta).trim(), entry);
  return { ok: true, entry };
}

function _visitTaskUiReset(cuenta) {
  Object.assign(_visitTaskUi, { account: cuenta || null, draft: null, error: null, busy: false, changing: false, loadingCtx: false, ctxError: null });
}

/** Cabecera con la task validada (taskId + tipo + estado). Pura. */
function visitTaskValidHtml(entry) {
  const t = entry.task || {};
  return `
    <div class="visit-task-ok" role="status">
      <span class="visit-task-ok-label">Task de esta visita</span>
      <span class="visit-task-ok-main">
        <span class="visit-task-id mono">${escapeHtml(entry.taskId)}</span>
        ${t.status ? orderStatusChip(t.status) : ''}
      </span>
      ${t.taskType ? `<span class="visit-task-type">${escapeHtml(t.taskType)}</span>` : ''}
      <span class="visit-task-wo">Orden <span class="mono">${escapeHtml(entry.workOrder)}</span></span>
      <button type="button" class="link-btn" data-action="visit-task-change">Cambiar task</button>
    </div>`;
}

/** Formulario de la task (orden ya conocida). Pura. */
function visitTaskFormHtml(wo, opts = {}) {
  const sug = opts.suggested;
  let hint;
  if (opts.loadingCtx) hint = 'Buscando la tarea pendiente de la orden…';
  else if (sug) hint = `Sugerida: ${sug.taskId} (tarea Pendiente de la orden). Confírmala con el Nº que te asignaron.`;
  else if (opts.ctxError) hint = 'No se pudo cargar la orden para sugerir la task: escríbela a mano.';
  else hint = 'La orden no tiene una tarea pendiente: escribe el Nº de task asignado.';
  return `
    <form class="visit-task-form" data-form="visit-task" novalidate>
      <p class="visit-task-wo">Orden <span class="mono">${escapeHtml(wo)}</span>
        <button type="button" class="link-btn" data-action="visit-task-order-change">Cambiar orden</button></p>
      <label class="form-label" for="visitTaskInput">Nº de task de esta visita</label>
      <input type="text" id="visitTaskInput" class="order-input" data-field="visit-task"
        inputmode="text" autocapitalize="characters" autocomplete="off" maxlength="24"
        placeholder="TASK/549487/2026 o 549487" value="${escapeHtml(opts.value || '')}"
        aria-describedby="visitTaskHint visitTaskError" aria-required="true"${opts.error ? ' aria-invalid="true"' : ''}>
      <p class="visit-task-hint" id="visitTaskHint">${escapeHtml(hint)}</p>
      <p class="order-field-error" id="visitTaskError" role="alert">${escapeHtml(opts.error || '')}</p>
      <button type="submit" class="save-btn" ${opts.busy ? 'disabled aria-busy="true"' : ''}>${opts.busy ? 'Validando…' : 'Validar task'}</button>
    </form>`;
}

/** Pinta la tarjeta de la task bajo Confirmar cuenta (solo Visita técnica). */
function renderVisitTaskGate(focusSel) {
  const gate = document.getElementById('visitTaskGate');
  if (!gate) return;
  const cuenta = validatedAccount;
  if (!visitTaskUsesModule() || !cuenta) {
    gate.hidden = true;
    gate.innerHTML = '';
    return;
  }
  if (_visitTaskUi.account !== cuenta) _visitTaskUiReset(cuenta);
  const ui = _visitTaskUi;
  const wo = sessionWorkOrder(cuenta);
  const entry = visitTaskFor(cuenta);
  let body;
  if (entry && !ui.changing) {
    body = visitTaskValidHtml(entry);
  } else if (!wo || ui.changing === 'order') {
    body = orderPromptHtml({
      value: ui.changing === 'order' ? (wo || '') : '',
      intro: 'Ingresa el Nº de orden de esta visita para validar la task asignada.',
      error: ui.error,
      submitLabel: 'Cargar orden',
    });
  } else {
    const ctxData = peekOrderContext(wo);
    const sug = suggestedVisitTask(ctxData);
    const value = ui.draft !== null ? ui.draft : (sug ? sug.taskId : '');
    body = visitTaskFormHtml(wo, {
      value, suggested: sug, loadingCtx: ui.loadingCtx, ctxError: ui.ctxError, error: ui.error, busy: ui.busy,
    });
  }
  const falta = !entry
    ? '<p class="visit-task-required">Obligatorio: sin task validada no se puede registrar nada de esta visita.</p>'
    : '';
  gate.innerHTML = `
    <h3 class="visit-task-title" id="visitTaskGateTitle">Nº de task de la visita</h3>
    ${falta}
    ${body}`;
  gate.hidden = false;
  gate.classList.toggle('is-valid', !!entry && !ui.changing);
  if (focusSel) {
    const el = gate.querySelector(focusSel);
    if (el && el.focus) {
      if (!/^(INPUT|BUTTON|TEXTAREA|SELECT)$/.test(el.tagName || '')) el.setAttribute('tabindex', '-1');
      el.focus({ preventScroll: true });
    }
  }
}

/** Carga el contexto de la orden para sugerir la tarea Pendiente. */
async function _visitTaskPrefetchContext(cuenta) {
  const wo = sessionWorkOrder(cuenta);
  if (!wo || peekOrderContext(wo)) return;
  _visitTaskUi.loadingCtx = true;
  _visitTaskUi.ctxError = null;
  renderVisitTaskGate();
  try {
    await loadOrderContext(wo);
  } catch (err) {
    console.warn('[Wifix] contexto para sugerir task:', err);
    if (_visitTaskUi.account === cuenta) _visitTaskUi.ctxError = err;
  }
  if (_visitTaskUi.account !== cuenta) return;
  _visitTaskUi.loadingCtx = false;
  if (validatedAccount === cuenta) renderVisitTaskGate();
}

/** Llamado al confirmar la cuenta (y al entrar al módulo con cuenta confirmada). */
function visitTaskOnAccountConfirmed(cuenta) {
  if (!visitTaskUsesModule()) {
    renderVisitTaskGate();
    return;
  }
  if (_visitTaskUi.account !== cuenta) _visitTaskUiReset(cuenta);
  renderVisitTaskGate();
  _visitTaskPrefetchContext(cuenta);
}

(function wireVisitTaskGate() {
  const gate = document.getElementById('visitTaskGate');
  if (!gate || !gate.addEventListener) return;
  gate.addEventListener('click', (ev) => {
    const btn = ev.target && ev.target.closest ? ev.target.closest('[data-action]') : null;
    if (!btn) return;
    const cuenta = validatedAccount;
    if (btn.dataset.action === 'visit-task-change') {
      _visitTaskUi.changing = 'task';
      _visitTaskUi.error = null;
      _visitTaskUi.draft = visitTaskIdFor(cuenta) || null;
      renderVisitTaskGate('[data-field="visit-task"]');
    } else if (btn.dataset.action === 'visit-task-order-change') {
      _visitTaskUi.changing = 'order';
      _visitTaskUi.error = null;
      renderVisitTaskGate('[data-field="order-number"]');
    }
  });
  gate.addEventListener('input', (ev) => {
    if (ev.target && ev.target.dataset && ev.target.dataset.field === 'visit-task') {
      _visitTaskUi.draft = ev.target.value;
    }
  });
  gate.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const cuenta = validatedAccount;
    if (!cuenta || _visitTaskUi.busy) return;
    const form = ev.target;
    if (form.dataset.form === 'order-prompt') {
      const input = form.querySelector('[data-field="order-number"]');
      _visitTaskUi.busy = true;
      const btn = form.querySelector('button[type="submit"]');
      if (btn) { btn.disabled = true; btn.textContent = 'Consultando…'; }
      const r = await submitOrderNumber(cuenta, input ? input.value : '');
      _visitTaskUi.busy = false;
      if (!r.ok) {
        _visitTaskUi.error = r.error;
        renderVisitTaskGate('[data-field="order-number"]');
        return;
      }
      _visitTaskUi.changing = false;
      _visitTaskUi.error = null;
      _visitTaskUi.draft = null;
      renderVisitTaskGate('[data-field="visit-task"]');
      return;
    }
    if (form.dataset.form === 'visit-task') {
      const input = form.querySelector('[data-field="visit-task"]');
      _visitTaskUi.draft = input ? input.value : '';
      _visitTaskUi.busy = true;
      _visitTaskUi.error = null;
      renderVisitTaskGate();
      const r = await validateVisitTask(cuenta, _visitTaskUi.draft);
      _visitTaskUi.busy = false;
      if (!r.ok) {
        _visitTaskUi.error = r.error;
        renderVisitTaskGate('[data-field="visit-task"]');
        return;
      }
      _visitTaskUi.changing = false;
      _visitTaskUi.draft = null;
      renderVisitTaskGate('.visit-task-id');
    }
  });
})();

// Notas de cierre de una orden, cargadas solo cuando el técnico las pide.
function wireTaskNotesButtons(scope) {
  scope.querySelectorAll('[data-action="task-notes"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const workOrder = btn.dataset.workorder;
      const slot = btn.parentNode ? btn.parentNode.querySelector('[data-slot="task-notes"]') : null;
      if (!slot || !workOrder) return;
      if (slot.dataset.loaded === '1') {
        const oculto = slot.classList.toggle('hidden');
        btn.setAttribute('aria-expanded', oculto ? 'false' : 'true');
        btn.textContent = oculto ? 'Ver notas de cierre' : 'Ocultar notas de cierre';
        return;
      }
      btn.disabled = true;
      slot.innerHTML = `<div class="detail-loading">Cargando notas…</div>`;
      try {
        const data = await WifixAPI.getWorkOrderTasks(workOrder);
        slot.innerHTML = renderWorkOrderNotes(data);
        slot.dataset.loaded = '1';
        btn.setAttribute('aria-expanded', 'true');
        btn.textContent = 'Ocultar notas de cierre';
      } catch (err) {
        console.error('[Wifix] notas de orden', err);
        slot.innerHTML = renderPanelError(err, 'No se pudieron cargar las notas.');
      } finally {
        btn.disabled = false;
      }
    });
  });
}

function renderWorkOrderNotes(data) {
  const tasks = (data && Array.isArray(data.tasks)) ? data.tasks : [];
  const notas = [];
  tasks.forEach((task) => {
    (task.notes || []).forEach((n) => {
      notas.push({ createdAt: n.createdAt, content: n.content, result: task.result, status: task.status });
    });
  });
  if (notas.length === 0) {
    return `<div class="detail-empty">Esta orden no tiene notas de cierre.</div>`;
  }
  return `
    <ul class="task-notes-list">
      ${notas.map(n => `
        <li class="task-note">
          <span class="task-note-date">${escapeHtml(formatDate(n.createdAt))}</span>
          <span class="task-note-text">${escapeHtml(n.content || '—')}</span>
        </li>`).join('')}
    </ul>`;
}

// ============================================================================
// Contexto de la orden de trabajo (TYTAN simulado) — Visita técnica y
// Migraciones. GET /orders/context?workOrder=… (contrato 2026-10-06 §3).
// Como en FSM: tareas de la orden con su estado y su cierre (tap para
// desplegar), dispositivos instalados, dirección guardada y observaciones.
// Fechas en hora de Ecuador. Si el técnico entró por cuenta/cédula, se le pide
// el nº de orden dentro del módulo antes de mostrar nada.
// ============================================================================
const ORDER_CONTEXT_TTL_MS = 10 * 60 * 1000;
const _orderContextCache = new Map();   // workOrder → { data, at, promise }
let _orderUid = 0;

/** Contexto de la orden (cache por workOrder; una sola llamada en vuelo). */
function loadOrderContext(workOrder, force = false) {
  const wo = String(workOrder || '').trim();
  if (!wo) return Promise.reject(new Error('Falta el nº de orden.'));
  const hit = _orderContextCache.get(wo);
  if (!force && hit) {
    if (hit.promise) return hit.promise;
    if (Date.now() - hit.at < ORDER_CONTEXT_TTL_MS) return Promise.resolve(hit.data);
  }
  const promise = WifixAPI.getOrderContext(wo)
    .then((data) => {
      _orderContextCache.set(wo, { data, at: Date.now(), promise: null });
      return data;
    })
    .catch((err) => {
      _orderContextCache.delete(wo);
      throw err;
    });
  _orderContextCache.set(wo, { data: null, at: Date.now(), promise });
  return promise;
}

/** Contexto ya cargado (sin red) o null. */
function peekOrderContext(workOrder) {
  const hit = workOrder ? _orderContextCache.get(String(workOrder).trim()) : null;
  return hit && hit.data && Date.now() - hit.at < ORDER_CONTEXT_TTL_MS ? hit.data : null;
}

const ORDER_STATUS_BADGE = Object.freeze({
  Realizado: 'badge-resolved',
  Pendiente: 'badge-pending',
  'En curso': 'badge-pending',
  Cancelado: 'badge-neutral',
});
const ORDER_CLOSURE_BADGE = Object.freeze({ Satisfactoria: 'badge-resolved', Insatisfactoria: 'badge-fail' });

/** Chip de estado (texto + color, nunca solo color). */
function orderStatusChip(status) {
  return `<span class="event-badge order-chip ${ORDER_STATUS_BADGE[status] || 'badge-neutral'}">${escapeHtml(status || 'Sin estado')}</span>`;
}

/** "lun 6 oct 2026, 08:00 – 10:00" (mismo día) o las dos fechas completas, hora Ecuador. */
function fmtRangeEc(from, to) {
  const a = toValidDate(from);
  const b = toValidDate(to);
  if (!a && !b) return '—';
  if (a && !b) return `desde ${fmtDateTimeEc(a, { seconds: false })}`;
  if (!a) return `hasta ${fmtDateTimeEc(b, { seconds: false })}`;
  const pa = _ecParts(a);
  const pb = _ecParts(b);
  const mismoDia = pa.day === pb.day && pa.month === pb.month && pa.year === pb.year;
  return mismoDia
    ? `${fmtDateTimeEc(a, { seconds: false })} – ${pb.hh}:${pb.mm}`
    : `${fmtDateTimeEc(a, { seconds: false })} – ${fmtDateTimeEc(b, { seconds: false })}`;
}

/** MAC '400EF304BFB6' → '40:0E:F3:04:BF:B6' (si no son 12 hex, tal cual). */
function fmtMac(mac) {
  const s = String(mac || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
  return s.length === 12 ? s.match(/.{2}/g).join(':') : String(mac || '');
}

/** Tareas ordenadas por agenda, la más reciente primero. */
function orderTasksSorted(tasks) {
  const t = (x) => {
    const d = toValidDate(x && (x.scheduledFrom || x.doneFrom));
    return d ? d.getTime() : 0;
  };
  return [...(Array.isArray(tasks) ? tasks : [])].filter(Boolean).sort((a, b) => t(b) - t(a));
}

function orderMaterialsHtml(materials) {
  const list = Array.isArray(materials) ? materials.filter(Boolean) : [];
  if (!list.length) return '<p class="order-muted">Sin materiales registrados.</p>';
  return `
          <table class="order-materials">
            <caption>Materiales</caption>
            <thead><tr><th scope="col">Material</th><th scope="col">Tipo</th><th scope="col" class="num">Cant.</th></tr></thead>
            <tbody>${list.map(m => `
              <tr><td>${escapeHtml(m.name || '—')}</td><td>${escapeHtml(m.type || '—')}</td><td class="num">${escapeHtml(m.quantity ?? '—')}</td></tr>`).join('')}
            </tbody>
          </table>`;
}

function orderClosureHtml(t) {
  const c = t.closure;
  if (!c) {
    return `<p class="order-muted">${t.status === 'Pendiente'
      ? 'Tarea pendiente: todavía no tiene cierre.'
      : 'La orden no trae detalle de cierre para esta tarea.'}</p>`;
  }
  return `
        <div class="order-closure">
          <span class="event-badge order-chip ${ORDER_CLOSURE_BADGE[c.result] || 'badge-neutral'}">Terminado ${escapeHtml(c.result || 'sin resultado')}</span>
          <dl class="order-facts">
            <div><dt>Razón de cierre</dt><dd>${escapeHtml(c.reason || '—')}</dd></div>
            <div><dt>Notas</dt><dd class="order-notes">${c.notes ? escapeHtml(c.notes) : '—'}</dd></div>
          </dl>
          ${orderMaterialsHtml(c.materials)}
        </div>`;
}

/** Una tarea: resumen siempre visible; tap para desplegar el cierre. */
function orderTaskHtml(t, highlightTaskId) {
  const actual = !!highlightTaskId && t.taskId === highlightTaskId;
  const hecho = t.doneFrom || t.doneTo ? fmtRangeEc(t.doneFrom, t.doneTo) : '—';
  return `
    <li class="order-task${actual ? ' is-current' : ''}">
      <details>
        <summary class="order-task-summary">
          <span class="order-task-top">
            <span class="order-task-id mono">${escapeHtml(t.taskId || '—')}</span>
            ${orderStatusChip(t.status)}
            ${actual ? '<span class="order-current-badge">Task de esta visita</span>' : ''}
          </span>
          <span class="order-task-type">${escapeHtml(t.taskType || 'Tarea')}</span>
          <span class="order-task-line"><span class="order-key">Agendado</span> ${escapeHtml(fmtRangeEc(t.scheduledFrom, t.scheduledTo))}</span>
          <span class="order-task-line"><span class="order-key">Realizado</span> ${escapeHtml(hecho)}</span>
          <span class="order-task-line"><span class="order-key">Asignado a</span> ${escapeHtml(t.assignedTo || '—')}</span>
          <span class="order-task-toggle"><span class="order-task-toggle-txt">Ver cierre</span>${SERVICIO_ICONS.chev}</span>
        </summary>
        <div class="order-task-body">${orderClosureHtml(t)}</div>
      </details>
    </li>`;
}

const ORDER_DEVICE_BADGE = Object.freeze({ Aprovisionado: 'badge-resolved' });

function orderDeviceHtml(e) {
  const nombre = e.shortName || e.productName || 'Dispositivo';
  const producto = [e.productName && e.productName !== nombre ? e.productName : '', e.type].filter(Boolean).join(' · ');
  return `
    <li class="order-device">
      <div class="order-device-head">
        <span class="order-device-name">${escapeHtml(nombre)}</span>
        <span class="event-badge order-chip ${ORDER_DEVICE_BADGE[e.status] || 'badge-neutral'}">${escapeHtml(e.status || 'Sin estado')}</span>
      </div>
      ${producto ? `<span class="order-device-product">${escapeHtml(producto)}</span>` : ''}
      <dl class="order-facts compact">
        <div><dt>Modelo</dt><dd>${escapeHtml(e.model || '—')}</dd></div>
        <div><dt>Serial</dt><dd class="mono">${escapeHtml(e.serial || '—')}</dd></div>
        <div><dt>MAC</dt><dd class="mono">${escapeHtml(e.mac ? fmtMac(e.mac) : '—')}</dd></div>
        <div><dt>ID servicio</dt><dd class="mono">${escapeHtml(e.serviceId || '—')}</dd></div>
      </dl>
    </li>`;
}

/** Panel completo con el contexto de la orden. Pura (sin DOM) para el smoke. */
function orderContextHtml(data, cuenta, opts = {}) {
  const o = (data && data.order) || {};
  const cl = (data && data.client) || {};
  const tasks = orderTasksSorted(data && data.tasks);
  const equipos = Array.isArray(data && data.equipment) ? data.equipment.filter(Boolean) : [];
  const simulado = data && data.simulated
    ? '<span class="sim-badge" title="Integración TYTAN simulada: datos de prueba">TYTAN simulado</span>' : '';
  const otraCuenta = cl.accountNumber && cuenta && String(cl.accountNumber) !== String(cuenta)
    ? `<div class="detail-warning" role="status">Esta orden es de la cuenta ${escapeHtml(cl.accountNumber)}, no de la cuenta confirmada (${escapeHtml(cuenta)}). Verifica el nº de orden.</div>`
    : '';
  const dir = data && data.registeredAddress ? data.registeredAddress : cl.address;
  return `
    <div class="order-panel" data-panel="order">
      <div class="order-head">
        <div class="order-head-top">
          <span class="order-wo mono">${escapeHtml(o.workOrder || '—')}</span>
          ${orderStatusChip(o.status)}
          ${simulado}
        </div>
        <span class="order-head-type">${escapeHtml([o.orderType, o.technology].filter(Boolean).join(' · ') || 'Orden de trabajo')}</span>
        <dl class="order-facts compact">
          <div><dt>Creada</dt><dd>${escapeHtml(fmtDateTimeEc(o.createdAt, { seconds: false }))}</dd></div>
          <div><dt>SLA</dt><dd>${escapeHtml(fmtDateTimeEc(o.slaAt, { seconds: false }))}</dd></div>
          <div><dt>Cerrada</dt><dd>${o.closedAt ? escapeHtml(fmtDateTimeEc(o.closedAt, { seconds: false })) : 'Abierta'}</dd></div>
          ${o.externalId ? `<div><dt>ID ${escapeHtml(o.externalSystem || 'externo')}</dt><dd class="mono">${escapeHtml(o.externalId)}</dd></div>` : ''}
          ${o.signatureProcess ? `<div><dt>Proceso</dt><dd class="mono">${escapeHtml(o.signatureProcess)}</dd></div>` : ''}
        </dl>
        <button type="button" class="link-btn order-change-btn" data-action="order-change">Cambiar nº de orden</button>
      </div>
      ${otraCuenta}

      <section class="order-section" aria-labelledby="orderTasksTitle${opts.uid || ''}">
        <h4 class="order-section-title" id="orderTasksTitle${opts.uid || ''}">Tareas de la orden (${tasks.length})</h4>
        ${tasks.length
          ? `<ul class="order-task-list">${tasks.map(t => orderTaskHtml(t, opts.currentTaskId)).join('')}</ul>`
          : '<div class="detail-empty">La orden no trae tareas.</div>'}
      </section>

      <section class="order-section" aria-labelledby="orderDevicesTitle${opts.uid || ''}">
        <h4 class="order-section-title" id="orderDevicesTitle${opts.uid || ''}">Dispositivos instalados (${equipos.length})</h4>
        ${equipos.length
          ? `<ul class="order-device-list">${equipos.map(orderDeviceHtml).join('')}</ul>`
          : '<div class="detail-empty">La orden no trae dispositivos instalados.</div>'}
      </section>

      <section class="order-section" aria-labelledby="orderAddrTitle${opts.uid || ''}">
        <h4 class="order-section-title" id="orderAddrTitle${opts.uid || ''}">Dirección guardada</h4>
        <p class="order-text">${dir ? escapeHtml(dir) : '<span class="no-fsm-data">Sin dirección en la orden</span>'}</p>
        ${cl.napCode || cl.zoneCode ? `<p class="order-muted">${cl.napCode ? `NAP ${escapeHtml(cl.napCode)}` : ''}${cl.napCode && cl.zoneCode ? ' · ' : ''}${cl.zoneCode ? `Zona ${escapeHtml(cl.zoneCode)}` : ''}</p>` : ''}
      </section>

      <section class="order-section" aria-labelledby="orderObsTitle${opts.uid || ''}">
        <h4 class="order-section-title" id="orderObsTitle${opts.uid || ''}">Observaciones</h4>
        <p class="order-text">${data && data.observations ? escapeHtml(data.observations) : '<span class="order-muted">Sin observaciones.</span>'}</p>
      </section>
    </div>`;
}

/**
 * Formulario "Nº de orden" (cuando el técnico entró por cuenta o cédula, o
 * quiere cambiarla). opts = { value, error, intro, submitLabel }.
 */
function orderPromptHtml(opts = {}) {
  const uid = ++_orderUid;
  const errId = `orderPromptErr${uid}`;
  return `
    <form class="order-prompt" data-form="order-prompt" novalidate>
      ${opts.intro ? `<p class="order-prompt-intro">${escapeHtml(opts.intro)}</p>` : ''}
      <label class="form-label" for="orderPrompt${uid}">Nº de orden de trabajo</label>
      <input type="text" id="orderPrompt${uid}" class="order-input" data-field="order-number"
        inputmode="text" autocapitalize="characters" autocomplete="off" maxlength="32"
        placeholder="ORDER/463158/2026 o 463158" value="${escapeHtml(opts.value || '')}"
        aria-describedby="${errId}"${opts.error ? ' aria-invalid="true"' : ''}>
      <p class="order-field-error" id="${errId}" data-slot="order-prompt-error" role="alert">${escapeHtml(opts.error || '')}</p>
      <button type="submit" class="save-btn order-submit">${escapeHtml(opts.submitLabel || 'Cargar orden')}</button>
    </form>`;
}

/**
 * Valida y carga una orden escrita por el técnico. Devuelve { ok, workOrder,
 * data } o { ok:false, error }. Solo si el contexto carga se guarda en la sesión.
 */
async function submitOrderNumber(cuenta, raw) {
  const wo = WifixAPI.normalizeOrderNumber(raw);
  if (!wo) return { ok: false, error: 'Formato inválido. Usa ORDER/463158/2026 o solo el número (463158).' };
  try {
    const data = await loadOrderContext(wo, true);
    setSessionWorkOrder(cuenta, (data && data.order && data.order.workOrder) || wo, 'module');
    return { ok: true, workOrder: sessionWorkOrder(cuenta), data };
  } catch (err) {
    console.error('[Wifix] orden (módulo):', err);
    if (err && err.code === 'VALIDATION_ERROR') return { ok: false, error: 'Formato de orden inválido. Usa ORDER/463158/2026 o solo el número.' };
    if (err && (err.code === 'NOT_FOUND' || err.code === 'HTTP_404')) return { ok: false, error: `No existe la orden ${wo}.` };
    return { ok: false, error: `No se pudo consultar la orden: ${(err && err.message) || 'error del servidor'}.` };
  }
}

/** HTML del panel "Orden de trabajo" de Datos del Servicio. */
async function loadOrderPanel(cuenta, opts = {}) {
  const wo = sessionWorkOrder(cuenta);
  if (!wo || opts.change) {
    return `<div class="order-panel" data-panel="order">${orderPromptHtml({
      value: opts.change ? (wo || '') : '',
      intro: opts.change
        ? 'Escribe el nuevo nº de orden de esta visita.'
        : 'Ingresaste por cuenta o cédula: escribe el nº de orden de esta visita para ver sus tareas, cierres y equipos.',
    })}</div>`;
  }
  try {
    const data = await loadOrderContext(wo, !!opts.force);
    return orderContextHtml(data, cuenta, { uid: ++_orderUid, currentTaskId: opts.currentTaskId || null });
  } catch (err) {
    console.error('[Wifix] contexto de orden:', err);
    return `<div class="order-panel" data-panel="order">
      ${renderPanelError(err, 'No se pudo cargar el contexto de la orden.')}
      <div class="order-actions">
        <button type="button" class="add-row-btn" data-action="order-retry">Reintentar</button>
        <button type="button" class="link-btn" data-action="order-change">Cambiar nº de orden</button>
      </div>
    </div>`;
  }
}

/** Conecta el panel de orden (delegación: el contenido se repinta entero). */
function _bootOrderPanel(body, cuenta, opts = {}) {
  if (!body || body.dataset.orderWired === '1') return;
  body.dataset.orderWired = '1';
  const repaint = async (loadOpts) => {
    body.innerHTML = '<div class="detail-loading">Cargando orden…</div>';
    const html = await loadOrderPanel(cuenta, Object.assign({ currentTaskId: opts.currentTaskId ? opts.currentTaskId() : null }, loadOpts));
    if (!body.isConnected && body.isConnected !== undefined) return;
    body.innerHTML = html;
    const foco = body.querySelector('[data-field="order-number"]') || body.querySelector('.order-wo');
    if (foco && foco.focus) {
      if (!foco.matches || !foco.matches('input')) foco.setAttribute('tabindex', '-1');
      foco.focus({ preventScroll: true });
    }
  };
  body.addEventListener('click', (ev) => {
    const btn = ev.target && ev.target.closest ? ev.target.closest('[data-action]') : null;
    if (!btn) return;
    if (btn.dataset.action === 'order-change') { ev.stopPropagation(); repaint({ change: true }); }
    else if (btn.dataset.action === 'order-retry') { ev.stopPropagation(); repaint({ force: true }); }
  });
  body.addEventListener('submit', async (ev) => {
    const form = ev.target && ev.target.closest ? ev.target.closest('[data-form="order-prompt"]') : null;
    if (!form) return;
    ev.preventDefault();
    const input = form.querySelector('[data-field="order-number"]');
    const errEl = form.querySelector('[data-slot="order-prompt-error"]');
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.textContent = 'Consultando…';
    const r = await submitOrderNumber(cuenta, input.value);
    if (!r.ok) {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      btn.textContent = 'Cargar orden';
      input.setAttribute('aria-invalid', 'true');
      if (errEl) errEl.textContent = r.error;
      input.focus();
      return;
    }
    repaint({});
  });
}

const SERVICIO_ITEMS = [
  // Visita técnica / Migraciones: contexto de la orden (TYTAN simulado).
  { id: 'order',   icon: SERVICIO_ICONS.history, title: 'Orden de trabajo — tareas, cierres y equipos',
    load: (cuenta) => loadOrderPanel(cuenta, { currentTaskId: visitTaskIdFor(cuenta) }) },
  { id: 'naps',    icon: SERVICIO_ICONS.nap,     title: 'NAPs cercanas y seleccion GPON Xtreme',
    // Visita técnica / Migración: solo la NAP contratada (sin búsqueda).
    titleContracted: 'NAP del cliente (contratada)',
    load: (cuenta) => loadNapPanel(cuenta) },
  { id: 'status',  icon: SERVICIO_ICONS.user,    title: 'Status del cliente por contrato/cuenta',
    load: (cuenta) => WifixAPI.getContractStatus(cuenta).then(c => renderStatusFromContract(c, cuenta)) },
  { id: 'isp',     icon: SERVICIO_ICONS.metrics, title: 'ISP Monitor — señal (fibra o cable) y caídas 24 h',
    load: (cuenta) => renderIspPanel(cuenta) },
  // "Red de acceso" y no "nodo", igual que en el panel de ISP Monitor: la
  // operadora aclaró que ese concepto no existe (los datos salen de tarjetas de
  // CMTS o de puertos de OLT). El endpoint sigue llamándose `node-events`
  // porque es el contrato publicado; lo que cambia es lo que lee el técnico.
  { id: 'events',  icon: SERVICIO_ICONS.alert,   title: 'Daños (eventos) en la red de acceso',
    load: (cuenta) => WifixAPI.getNodeEvents(cuenta).then(renderEventsList) },
  // Una sola ruta para la visita pendiente y el historial (campos 15-16).
  { id: 'visits',  icon: SERVICIO_ICONS.history, title: 'Visitas pendientes y anteriores',
    // Con include=records cada visita trae qué se hizo y qué datos arrojó
    // (reemplaza al antiguo "Historial de la app"). La pendiente se recuerda
    // para vincular los registros que se guarden durante esta visita.
    load: (cuenta) => WifixAPI.getVisits(cuenta, { includeRecords: true }).then((r) => {
      rememberVisits(cuenta, r);
      return renderVisitsList(r);
    }) },
];

// Título del panel según el módulo (la NAP cambia en Visita técnica / Migración).
function servicioItemTitle(item) {
  return item.titleContracted && _napUsesContractedNap() ? item.titleContracted : item.title;
}

// Paneles de Datos del Servicio que corresponden al módulo actual.
function servicioItemsForModule() {
  const allowed = currentModule().servicio;
  if (allowed === null) return SERVICIO_ITEMS;
  return SERVICIO_ITEMS.filter(item => allowed.includes(item.id));
}

function openDatosServicio() {
  const cuenta = currentAccount();
  if (!cuenta) {
    alert('Ingresa primero el número de cuenta.');
    return;
  }
  servicioChip.textContent = cuenta;

  const items = servicioItemsForModule();
  servicioList.innerHTML = items.map(item => `
    <div class="servicio-item" data-id="${item.id}">
      <button class="servicio-head" type="button">
        <div class="servicio-icon">${item.icon}</div>
        <div class="servicio-title">${escapeHtml(servicioItemTitle(item))}</div>
        <div class="servicio-chev">${SERVICIO_ICONS.chev}</div>
      </button>
      <div class="servicio-body">
        <div class="servicio-body-inner" data-slot="body"><div class="detail-loading">Toca para cargar…</div></div>
      </div>
    </div>`).join('');

  servicioList.querySelectorAll('.servicio-item').forEach(node => {
    const id = node.dataset.id;
    const item = items.find(x => x.id === id);
    const head = node.querySelector('.servicio-head');
    const body = node.querySelector('[data-slot="body"]');

    head.addEventListener('click', async () => {
      const wasOpen = node.classList.contains('open');
      node.classList.toggle('open');
      // Reabrir el panel NAP ya cargado: el mapa estuvo dentro de un
      // contenedor colapsado; tras la transición (0.35s) se recalcula.
      if (!wasOpen && id === 'naps' && body.dataset.loaded) {
        setTimeout(() => _napMapInvalidate(true), 380);
      }
      // abrir→cerrar→abrir antes de que responda: no se lanza una 2ª carga.
      if (!wasOpen && !body.dataset.loaded && !body.dataset.loading) {
        // Al abrir el panel NAP por primera vez, asegurar que el taskId
        // se genere fresco (renderNapPanel lo crea si es null).
        if (id === 'naps') {
          _napPanelState.taskId = null;
          _napPanelState.openedAt = null;
        }
        body.innerHTML = `<div class="detail-loading">Cargando…</div>`;
        body.dataset.loading = '1';
        try {
          const html = await item.load(cuenta);
          // Respuesta obsoleta (loadNapPanel → null) o Datos del Servicio se
          // regeneró mientras tanto (body fuera del DOM): no se pinta ni se
          // arranca nada, así no se toca el estado ni el mapa del panel vivo.
          if (html === null || !body.isConnected) return;
          body.innerHTML = html;
          body.dataset.loaded = '1';
          if (id === 'naps') {
            _bootNapPanel(body);
          } else if (id === 'order') {
            _bootOrderPanel(body, cuenta, { currentTaskId: () => visitTaskIdFor(cuenta) });
          } else if (id === 'isp') {
            _bootIspPanel(body, cuenta);
          } else {
            wireNapPortsButtons(body);
            wireTaskNotesButtons(body);
          }
        } catch (err) {
          console.error('[Wifix] servicio', id, err);
          if (body.isConnected) body.innerHTML = renderPanelError(err, 'Error al cargar');
        } finally {
          delete body.dataset.loading;
        }
      }
    });
  });

  warnIfNoBrandAvailable();

  detailServicio.classList.add('open');
  detailServicio.setAttribute('aria-hidden', 'false');
}

// Localiza el hueco de puertos de una tarjeta sin depender de CSS.escape:
// el napRef puede ser numérico y escapar dígitos dentro de un selector de
// atributo es una fuente segura de errores.
function _findPortsSlot(scope, btn, napRef) {
  const card = btn.closest ? btn.closest('.nap-card') : null;
  if (card) {
    const inCard = card.querySelector('.nap-ports-slot');
    if (inCard) return inCard;
  }
  const todos = scope.querySelectorAll('.nap-ports-slot');
  for (let i = 0; i < todos.length; i++) {
    if (todos[i].dataset.portsFor === napRef) return todos[i];
  }
  return null;
}

function wireNapPortsButtons(scope) {
  scope.querySelectorAll('[data-action="view-ports"]').forEach((btn) => {
    // Idempotente: la tarjeta "NAP del cliente" sobrevive a cada búsqueda y
    // no debe acumular listeners (dos toggles = no se abre nunca).
    if (btn.dataset.wired === '1') return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const napRef = btn.dataset.nap;
      const slot = _findPortsSlot(scope, btn, napRef);
      if (!slot) return;
      // Una expansión = una llamada. Si ya se cargó, solo se muestra/oculta.
      if (slot.dataset.loaded === '1') {
        const oculto = slot.classList.toggle('hidden');
        btn.setAttribute('aria-expanded', oculto ? 'false' : 'true');
        return;
      }
      slot.innerHTML = `<div class="detail-loading">Cargando puertos…</div>`;
      try {
        const data = await _napPortsCached(scope, napRef);
        slot.innerHTML = renderPortsTable(data);
        slot.dataset.loaded = '1';
        btn.setAttribute('aria-expanded', 'true');
        _wirePortStatusButton(slot, data);
      } catch (err) {
        console.error('[Wifix] puertos NAP', err);
        slot.innerHTML = renderPanelError(err, 'No se pudieron cargar los puertos.');
      }
    });
  });
}

// ============================================================================
// Red Interna — módulos medidos (portados de Wifix Remote / wifi-monitor)
// ----------------------------------------------------------------------------
// Saturación de canal, Dispositivos conectados, Redes cercanas y Latencia.
// La lógica pura se porta LITERAL del origen (cada función cita su fuente);
// solo cambian los nombres de campo al contrato del plugin de Wifix
// Certificate (frequencyMhz, bssid, channelWidthMhz, signalDbm…). Lo que el
// origen hacía con net.Socket/dgram en Node lo hace el plugin nativo
// NetworkTools (WifixNative.*). Fuera del APK los wrappers devuelven datos
// simulados (simulated:true) y la UI lo avisa con mockNotice.
// ============================================================================

// ---- Módulo 1: Saturación de canal -----------------------------------------
// Origen: AfterScan.vue:1826-1854 (banda/canal/ancho) y 1941-2019
// (computeChannelSaturation).

// Banda a partir de la frecuencia (MHz).
// CORRECCIÓN CONSCIENTE DEL ORIGEN (bug 6 GHz): el origen no reconocía 6 GHz
// (bandFromFrequency devolvía null y channelFromFrequency también), así que
// una red 6 GHz quedaba sin canal y su saturación se comparaba contra TODAS
// las bandas. Aquí 5925-7125 MHz → '6GHz' con su numeración de canales.
function bandFromFrequency(freq) {
  const f = parseInt(freq, 10);
  if (isNaN(f)) return null;
  if (f >= 2400 && f <= 2500) return '2.4GHz';
  if (f >= 4900 && f <= 5900) return '5GHz';
  if (f >= 5925 && f <= 7125) return '6GHz';
  return null;
}

// Canal a partir de la frecuencia (MHz).
//   2.4GHz: canal = (freq - 2412) / 5 + 1   (canal 14 = 2484, caso especial)
//   5GHz:   canal = (freq - 5000) / 5        (hasta 5885 = canal 177)
//   6GHz:   canal = (freq - 5950) / 5        (5935 = canal 2, caso especial) [nuevo]
function channelFromFrequency(freq) {
  const f = parseInt(freq, 10);
  if (isNaN(f)) return null;
  if (f === 2484) return 14;
  if (f >= 2412 && f <= 2472) return Math.round((f - 2412) / 5) + 1;
  if (f >= 5000 && f <= 5900) return Math.round((f - 5000) / 5);
  if (f === 5935) return 2;
  if (f >= 5955 && f <= 7115) return Math.round((f - 5950) / 5);
  return null;
}

// Ancho de canal en MHz. El plugin nuevo ya entrega el número
// (channelWidthMhz); se conserva el parseo de texto del origen ("20MHZ",
// "80MHZ_PLUS_MHZ"…) por robustez, más 320 MHz (WiFi 7). Default 20.
function channelWidthMhz(channelWidth) {
  if (channelWidth == null) return 20;
  if (typeof channelWidth === 'number') return channelWidth > 0 ? channelWidth : 20;
  const s = String(channelWidth).toUpperCase();
  if (s.indexOf('320') !== -1) return 320;
  if (s.indexOf('160') !== -1) return 160;
  if (s.indexOf('80') !== -1) return 80;
  if (s.indexOf('40') !== -1) return 40;
  if (s.indexOf('20') !== -1) return 20;
  return 20;
}

// Canales candidatos a sugerir por banda. 2.4GHz: 1/6/11 (no solapados);
// 5GHz: los comunes del origen; 6GHz (nuevo): canales PSC.
const SATURATION_CANDIDATES = Object.freeze({
  '2.4GHz': [1, 6, 11],
  '5GHz': [36, 40, 44, 48, 149, 153, 157, 161],
  '6GHz': [5, 21, 37, 53, 69, 85, 101, 117, 133, 149, 165, 181, 197, 213, 229],
});

// Saturación del canal propio frente a las redes vecinas de la MISMA banda.
//   connInfo = { frequencyMhz, bssid, channelWidthMhz } de la red conectada
//   wifis    = lista normalizada (normalizeWifis)
// Devuelve { band, channel, channelWidth, sameChannelCount, overlappingCount,
// suggested, levelClass, levelLabel, perChannel } o { error }.
// perChannel se expone (el origen lo calculaba sin devolverlo) para el gráfico.
function computeChannelSaturation(connInfo, wifis) {
  try {
    const ci = connInfo || {};
    const ownFreq = ci.frequencyMhz != null ? parseInt(ci.frequencyMhz, 10) : null;
    if (ownFreq == null || isNaN(ownFreq)) {
      return { error: 'No se pudo determinar la frecuencia de su red.' };
    }
    const band = bandFromFrequency(ownFreq);
    const ownChannel = channelFromFrequency(ownFreq);
    const ownWidth = channelWidthMhz(ci.channelWidthMhz);
    const list = Array.isArray(wifis) ? wifis : [];

    // Dos redes solapan si la distancia entre centros es menor que la
    // semisuma de sus anchos. La propia (mismo BSSID) no se cuenta.
    const ownBssid = ci.bssid ? String(ci.bssid).toLowerCase() : null;
    let sameChannelCount = 0;
    let overlappingCount = 0;
    const perChannel = {};

    for (let i = 0; i < list.length; i++) {
      const w = list[i] || {};
      if (w.frequencyMhz == null) continue;
      const wFreq = parseInt(w.frequencyMhz, 10);
      if (isNaN(wFreq)) continue;
      const wBand = bandFromFrequency(wFreq);
      if (band && wBand && wBand !== band) continue; // distinta banda: no compite
      if (ownBssid && w.bssid && String(w.bssid).toLowerCase() === ownBssid) continue;

      const wChannel = channelFromFrequency(wFreq);
      if (wChannel != null) {
        perChannel[wChannel] = (perChannel[wChannel] || 0) + 1;
      }
      if (wChannel != null && ownChannel != null && wChannel === ownChannel) {
        sameChannelCount++;
      }
      const wWidth = channelWidthMhz(w.channelWidthMhz);
      const minGap = (ownWidth + wWidth) / 2;
      if (Math.abs(wFreq - ownFreq) < minGap) {
        overlappingCount++;
      }
    }

    const candidates = SATURATION_CANDIDATES[band] || SATURATION_CANDIDATES['2.4GHz'];
    const ranked = candidates.map((ch) => ({ ch, count: perChannel[ch] || 0 }))
      .sort((a, b) => a.count - b.count);
    const suggested = ranked
      .filter((r) => r.ch !== ownChannel)
      .slice(0, 3)
      .map((r) => r.ch);

    // Severidad: redes en el mismo canal pesan doble que los solapamientos.
    const score = sameChannelCount * 2 + overlappingCount;
    let levelClass, levelLabel;
    if (score <= 1) { levelClass = 'good'; levelLabel = 'Baja'; }
    else if (score <= 4) { levelClass = 'warn'; levelLabel = 'Media'; }
    else { levelClass = 'bad'; levelLabel = 'Alta'; }

    return {
      band,
      channel: ownChannel,
      channelWidth: ownWidth,
      sameChannelCount,
      overlappingCount,
      suggested,
      levelClass,
      levelLabel,
      perChannel,
      score,
    };
  } catch (e) {
    console.warn('[computeChannelSaturation] ignorado: ' + (e && (e.message || e)));
    return { error: 'No se pudo calcular la saturación de canal.' };
  }
}

// Datos de la red propia para la saturación (port de enrichConnectionInfo,
// AfterScan.vue:1862+): frecuencia de getWifiInfo y ancho de canal del AP
// conectado cruzando el BSSID con el scan. Desvío: se cruza con el scan CRUDO
// (no con la lista normalizada), porque la normalización puede descartar el
// BSSID propio si un repetidor del mismo SSID se oye más fuerte.
function ownConnInfo(wifiInfo, scan) {
  const wi = wifiInfo || {};
  const aps = (scan && Array.isArray(scan.accessPoints)) ? scan.accessPoints : [];
  // Sin permiso de ubicación Android entrega 02:00:00:00:00:00 y "<unknown ssid>".
  const realBssid = (v) => (v && String(v).toLowerCase() !== '02:00:00:00:00:00' ? v : null);
  const realSsid = (v) => (v && String(v).replace(/^"|"$/g, '') !== '<unknown ssid>' ? String(v).replace(/^"|"$/g, '') : null);
  const bssid = realBssid(wi.bssid) || realBssid(scan && scan.connectedBssid) || null;
  const low = bssid ? String(bssid).toLowerCase() : null;
  const own = aps.find((a) => a && a.bssid && low && String(a.bssid).toLowerCase() === low)
    || aps.find((a) => a && a.isConnected) || null;
  const freq = wi.frequencyMhz != null ? wi.frequencyMhz : (own ? own.frequencyMhz : null);
  return {
    frequencyMhz: freq,
    bssid: bssid || (own ? own.bssid : null),
    channelWidthMhz: own ? own.channelWidthMhz : null,
    ssid: realSsid(wi.ssid) || realSsid(scan && scan.connectedSsid) || (own ? own.ssid : null),
  };
}

// ---- Módulo 3: Redes cercanas ----------------------------------------------
// Origen: normalizeWifis AfterScan.vue:2088-2143.

// SSID oculto: vacío, '<hidden>' o el '\x00' textual que entrega Android (el
// origen compara contra el literal de 4 caracteres '\\x00'); también se
// descartan SSID compuestos solo por caracteres NUL reales.
function isHiddenSsid(ssid) {
  const s = ssid != null ? String(ssid).trim() : '';
  return !s || s === '<hidden>' || s === '\\x00' || /^\u0000+$/.test(s);
}

// Seguridad a partir de capabilities ("[WPA2-PSK-CCMP][RSN-SAE-CCMP][ESS][WPS]").
function wifiSecurity(capabilities) {
  const c = String(capabilities || '').toUpperCase();
  const wps = c.indexOf('WPS') !== -1;
  let label;
  // OWE (Enhanced Open) va antes que RSN: Android lo anuncia como [RSN-OWE-…].
  if (c.indexOf('SAE') !== -1) label = 'WPA3';
  else if (c.indexOf('OWE') !== -1) label = 'OWE';
  else if (c.indexOf('RSN') !== -1 || c.indexOf('WPA2') !== -1) label = 'WPA2';
  else if (c.indexOf('WPA') !== -1) label = 'WPA';
  else if (c.indexOf('WEP') !== -1) label = 'WEP';
  else label = 'Abierta';
  return { label, wps };
}

// Entrada uniforme a partir de un AP del plugin (scanAccessPoints).
function toWifiEntry(ap) {
  const w = ap || {};
  const freq = w.frequencyMhz != null ? parseInt(w.frequencyMhz, 10) : null;
  const sec = wifiSecurity(w.capabilities);
  return {
    ssid: w.ssid != null ? String(w.ssid).trim() : '',
    bssid: w.bssid != null ? w.bssid : null,
    signalDbm: w.signalDbm != null ? parseInt(w.signalDbm, 10) : null,
    frequencyMhz: freq,
    channel: w.channel != null ? w.channel : channelFromFrequency(freq),
    channelWidthMhz: channelWidthMhz(w.channelWidthMhz),
    band: bandFromFrequency(freq),
    security: sec.label,
    wps: sec.wps,
    capabilities: w.capabilities != null ? w.capabilities : null,
    isConnected: w.isConnected === true,
  };
}

// Normaliza/deduplica el scan: agrupa por SSID+banda y conserva la entrada de
// señal más fuerte. Descarta SSID ocultos. Orden: señal más fuerte primero.
// Extra (no cambia el algoritmo): bssidCount = BSSID agrupados y
// anyConnected = el teléfono está conectado a alguno de ellos.
function normalizeWifis(rawAps) {
  if (!Array.isArray(rawAps)) return [];
  try {
    const groups = {};
    for (let i = 0; i < rawAps.length; i++) {
      const raw = rawAps[i] || {};
      if (isHiddenSsid(raw.ssid)) continue;
      const entry = toWifiEntry(raw);
      // Sin banda clasificable se usa la frecuencia como clave para no
      // fusionar redes distintas por error.
      const key = entry.ssid + '|' + (entry.band || ('f' + entry.frequencyMhz));
      const prev = groups[key];
      if (!prev) {
        entry.bssidCount = 1;
        entry.anyConnected = entry.isConnected;
        groups[key] = entry;
      } else {
        const prevLvl = prev.signalDbm == null ? -Infinity : prev.signalDbm;
        const curLvl = entry.signalDbm == null ? -Infinity : entry.signalDbm;
        const count = prev.bssidCount + 1;
        const anyConnected = prev.anyConnected || entry.isConnected;
        const keep = curLvl > prevLvl ? entry : prev;
        keep.bssidCount = count;
        keep.anyConnected = anyConnected;
        groups[key] = keep;
      }
    }
    const result = Object.keys(groups).map((k) => groups[k]);
    result.sort((a, b) => {
      const la = a.signalDbm == null ? -Infinity : a.signalDbm;
      const lb = b.signalDbm == null ? -Infinity : b.signalDbm;
      return lb - la;
    });
    return result;
  } catch (e) {
    console.warn('[normalizeWifis] excepcion: ' + (e && (e.message || e)));
    return [];
  }
}

// Vista "Ver todos los BSSID": cada AP por separado (incluye ocultos).
function listAllBssids(rawAps) {
  if (!Array.isArray(rawAps)) return [];
  return rawAps.map((ap) => {
    const e = toWifiEntry(ap);
    e.hidden = isHiddenSsid(ap && ap.ssid);
    e.anyConnected = e.isConnected;
    e.bssidCount = 1;
    return e;
  }).sort((a, b) => (b.signalDbm == null ? -Infinity : b.signalDbm) - (a.signalDbm == null ? -Infinity : a.signalDbm));
}

// ---- Estadísticas de ping (forma `stat`) -----------------------------------
// Origen: emptyPingStat AfterScan.vue:1274; statsFromRtts netprobe.js:88-118.
function emptyPingStat() {
  return { avg: null, min: null, max: null, time: null, packetLoss: null, stddev: null };
}

// { avg, min, max, time(=avg), packetLoss, stddev (poblacional = jitter),
//   sent, received, samples[] } redondeados a 0.1.
function statsFromRtts(rtts, attempts) {
  const stat = { avg: null, min: null, max: null, time: null, packetLoss: null, stddev: null };
  const list = Array.isArray(rtts) ? rtts.filter((v) => typeof v === 'number' && isFinite(v)) : [];
  stat.sent = attempts;
  stat.received = list.length;
  stat.samples = list.map((v) => Math.round(v * 10) / 10);
  if (attempts > 0) {
    const lost = attempts - list.length;
    stat.packetLoss = Math.round((Math.max(0, lost) / attempts) * 1000) / 10;
  }
  if (list.length > 0) {
    let sum = 0, min = Infinity, max = -Infinity;
    for (let i = 0; i < list.length; i++) {
      sum += list[i];
      if (list[i] < min) min = list[i];
      if (list[i] > max) max = list[i];
    }
    const avg = sum / list.length;
    let variance = 0;
    for (let j = 0; j < list.length; j++) variance += Math.pow(list[j] - avg, 2);
    variance = variance / list.length;
    const r1 = (n) => Math.round(n * 10) / 10;
    stat.min = r1(min);
    stat.max = r1(max);
    stat.avg = r1(avg);
    stat.time = r1(avg);
    stat.stddev = r1(Math.sqrt(variance));
  }
  return stat;
}

// Resultado de plugin.ping (ICMP: transmitted/received/rtt*/samples) → stat.
function statFromIcmp(res, count) {
  const r = res || {};
  const sent = Number.isFinite(Number(r.transmitted)) ? Number(r.transmitted) : count;
  const samples = Array.isArray(r.samples) ? r.samples.map(Number).filter(isFinite) : [];
  if (samples.length) return statsFromRtts(samples, sent);
  const stat = statsFromRtts([], sent);
  const received = Number(r.received);
  if (Number.isFinite(received) && received > 0 && r.rttAvgMs != null) {
    // Sin muestras sueltas: se usa el resumen de ping (mdev ≈ desviación).
    const r1 = (n) => (n == null || !isFinite(n) ? null : Math.round(Number(n) * 10) / 10);
    Object.assign(stat, {
      received,
      packetLoss: sent > 0 ? Math.round((Math.max(0, sent - received) / sent) * 1000) / 10 : null,
      avg: r1(r.rttAvgMs), time: r1(r.rttAvgMs), min: r1(r.rttMinMs), max: r1(r.rttMaxMs),
      stddev: r1(r.rttMdevMs),
    });
  }
  return stat;
}

// Stat válida del plugin tcpPing (o null): se normaliza y se completa.
function normalizeStat(s) {
  if (!s || typeof s !== 'object') return emptyPingStat();
  const out = Object.assign(emptyPingStat(), {
    avg: s.avg ?? null, min: s.min ?? null, max: s.max ?? null, time: s.time ?? s.avg ?? null,
    packetLoss: s.packetLoss ?? null, stddev: s.stddev ?? null,
  });
  if (s.sent != null) out.sent = s.sent;
  if (s.received != null) out.received = s.received;
  out.samples = Array.isArray(s.samples) ? s.samples.slice() : [];
  return out;
}

// Umbrales de latencia (portal propio de Wifix Remote): ≤30 bueno, ≤80 aviso.
const LATENCY_GOOD_MS = 30;
const LATENCY_WARN_MS = 80;
function latencyLevel(avg) {
  if (avg == null || !isFinite(avg)) return { cls: 'bad', label: 'Sin respuesta' };
  if (avg <= LATENCY_GOOD_MS) return { cls: 'good', label: 'Buena' };
  if (avg <= LATENCY_WARN_MS) return { cls: 'warn', label: 'Aceptable' };
  return { cls: 'bad', label: 'Alta' };
}

// ---- Módulo 2: Dispositivos conectados -------------------------------------
// Origen: AfterScan.vue:893-1060 (pipeline), MyLayout.vue:2287-2456
// (isJunkDeviceName, sameSubnet24, mergeDiscovery, typeFromName,
// typeFromVendor, getVendorByOUI), netprobe.js:544-602 y 626-720
// (guessDeviceType, guessTypeByPorts, probeDevice), discovery.js:719-744
// (guessTypeByBanner, nameFromBanner).

const JUNK_DEVICE_NAMES = ['localhost', 'local', 'unknown', 'generic', 'android', '(none)', 'localhost.localdomain'];

// true si 'name' es un nombre "basura" (vacío, solo guiones, placeholder).
function isJunkDeviceName(name) {
  try {
    const n = String(name).trim().toLowerCase();
    if (n === '' || /^[-\s]+$/.test(n)) return true;
    return JUNK_DEVICE_NAMES.indexOf(n) !== -1;
  } catch (e) {
    return false;
  }
}

// true si a y b son IPv4 válidas de la misma /24.
function sameSubnet24(a, b) {
  try {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const pa = a.trim().split('.');
    const pb = b.trim().split('.');
    if (pa.length !== 4 || pb.length !== 4) return false;
    for (let i = 0; i < 4; i++) {
      const na = Number(pa[i]); const nb = Number(pb[i]);
      if (!Number.isInteger(na) || na < 0 || na > 255) return false;
      if (!Number.isInteger(nb) || nb < 0 || nb > 255) return false;
    }
    return pa[0] === pb[0] && pa[1] === pb[1] && pa[2] === pb[2];
  } catch (e) {
    return false;
  }
}

// Tipo por nombre anunciado (mDNS/SSDP/NetBIOS/PTR). LITERAL de
// guessDeviceType (netprobe.js:544-582) = typeFromName (MyLayout.vue:2413-2437).
function guessDeviceType(name) {
  if (!name || typeof name !== 'string') return null;
  const n = name.toLowerCase();
  if (/chromecast|google-?home|google-?nest|nest-?(mini|hub|audio)/.test(n)) return 'Chromecast';
  if (/android-?tv|shield|mi-?box|fire-?tv|firestick|bravia|aquos|qled|oled|neo.?qled|nano.?cell|crystal|smart.?tv/.test(n)) return 'AndroidTV';
  if (/apple-?tv|appletv/.test(n)) return 'AppleTV';
  if (/\b(printer|impresora|epson|canon|brother|officejet|deskjet|laserjet|hp[a-z0-9]*print|zebra|citizen)\b/.test(n)) return 'Impresora';
  if (/iphone|ipad|ipod/.test(n)) return 'Móvil';
  if (/android|galaxy|redmi|huawei|xiaomi|oppo|vivo|moto-?g|pixel/.test(n)) return 'Móvil';
  if (/macbook|imac|mac-?mini|mac-?pro/.test(n)) return 'PC';
  if (/desktop|laptop|pc-|win-|windows|\bpc\b/.test(n)) return 'PC';
  if (/nas|synology|qnap|diskstation/.test(n)) return 'NAS';
  if (/router|gateway|tplink|tp-link|huawei-?hg|zte|mikrotik|ubnt|unifi/.test(n)) return 'Router';
  if (/xtrim|\bb\d{3,}|\bhg\d{2,}|\beg\d{2,}|zxhn|\bf\d{3,}|\bont\b|\bonu\b|arris|technicolor|commscope|mitrastar|askey|nokia.*gateway|cable\s?modem|cablemodem/.test(n)) return 'Router';
  if (/echo|alexa|sonos|homepod/.test(n)) return 'Parlante';
  if (/cam|camera|camara|hikvision|dahua|reolink|tapo/.test(n)) return 'Cámara';
  if (/\bdeco\b|decodificador|set-?top|\bstb\b|roku|\btcl\b|hisense|webos|tizen|lg.*tv|samsung.*tv|vizio|\buhd\b|\bled\b.*\btv\b/.test(n)) return 'AndroidTV';
  if (/\btv\b/.test(n)) return 'AndroidTV';
  return null;
}
// En el origen typeFromName es una copia idéntica de guessDeviceType.
function typeFromName(name) {
  return guessDeviceType(name);
}

// Tipo por puertos TCP abiertos (netprobe.js:592-602). Orden = prioridad.
function guessTypeByPorts(openPorts) {
  if (!Array.isArray(openPorts) || openPorts.length === 0) return null;
  const has = (p) => openPorts.indexOf(p) !== -1;
  if (has(9100) || has(515) || has(631)) return 'Impresora';
  if (has(445) || has(139)) return 'PC';
  if (has(62078)) return 'Móvil';
  if (has(554) || has(8554)) return 'Cámara';
  if (has(22)) return 'PC';
  if (has(1883) || has(8883)) return 'IoT';
  return null;
}

// Tipo por banner HTTP { server, realm, title } (discovery.js:719-729).
function guessTypeByBanner(banner) {
  if (!banner) return null;
  const hay = [banner.server, banner.realm, banner.title].filter(Boolean).join(' ').toLowerCase();
  if (!hay) return null;
  if (/boa|goahead|rompager|lighttpd|mini_httpd|routeros|dd-wrt|openwrt|tp-link|mikrotik|router|gateway/.test(hay)) return 'Router';
  if (/hikvision|dahua|ip\s?camera|ipcam|webcam|reolink|tapo|camera/.test(hay)) return 'Cámara';
  if (/laserjet|officejet|deskjet|\bhp\b.*print|brother|epson|canon|printer|impresora/.test(hay)) return 'Impresora';
  if (/synology|diskstation|qnap|\bnas\b|truenas/.test(hay)) return 'NAS';
  return null;
}

// Nombre legible desde el <title> del banner, si no es genérico (discovery.js:731-744).
function nameFromBanner(banner) {
  if (!banner || !banner.title) return null;
  const t = String(banner.title).trim();
  const low = t.toLowerCase();
  if (!t || low === 'index' || low === 'login' || low === 'home' ||
      low === 'document' || low === 'untitled' || low === 'welcome' ||
      low === 'error' || /^\d+$/.test(t)) return null;
  if (/^(\d{3}\s|forbidden|unauthorized|not found|bad request|access denied|service unavailable|internal server error)/i.test(low)) return null;
  if (/forbidden|unauthorized|not found|bad request|access denied/i.test(low)) return null;
  return t;
}

// Tipo por fabricante, último recurso (MyLayout.vue:2441-2456).
function typeFromVendor(vendor) {
  if (!vendor || typeof vendor !== 'string') return null;
  const v = vendor.toLowerCase();
  if (v.indexOf('tapo') !== -1) return 'Cámara';
  if (/hikvision|dahua|reolink|ezviz/.test(v)) return 'Cámara';
  if (/epson|canon|brother|hp inc|lexmark|zebra|citizen/.test(v)) return 'Impresora';
  if (/synology|qnap|western digital|seagate/.test(v)) return 'NAS';
  if (/sonos|bose|harman|sonance/.test(v)) return 'Parlante';
  if (v.indexOf('google') !== -1) return 'Chromecast';
  if (/roku|tcl|hisense|vizio/.test(v)) return 'AndroidTV';
  if (/apple|samsung|xiaomi|huawei|oppo|vivo|oneplus|motorola|realme/.test(v)) return 'Móvil';
  if (/intel|dell|lenovo|asus|micro-star|gigabyte|asustek/.test(v)) return 'PC';
  if (/espressif|tuya|sonoff|shelly/.test(v)) return 'IoT';
  if (/tp-link|zte|mikrotik|ubiquiti|netgear|d-link|cisco|technicolor|arris/.test(v)) return 'Router';
  return null;
}

// Tabla OUI local y pequeña (fabricantes comunes en hogares). Reemplaza la
// consulta a macvendors del origen: sin red, sin rate-limit y sin mandar
// MACs a terceros. Lo que no está aquí queda sin fabricante (no se inventa).
const OUI_VENDORS = Object.freeze({
  '00:03:93': 'Apple', '00:0a:95': 'Apple', '00:1e:c2': 'Apple', '3c:22:fb': 'Apple',
  'a4:83:e7': 'Apple', 'f0:18:98': 'Apple',
  '00:12:fb': 'Samsung Electronics', '00:16:32': 'Samsung Electronics',
  '8c:77:12': 'Samsung Electronics', 'f0:25:b7': 'Samsung Electronics',
  '00:e0:fc': 'Huawei Technologies', '00:18:82': 'Huawei Technologies',
  '28:6e:d4': 'Huawei Technologies', '48:46:fb': 'Huawei Technologies',
  '00:19:c6': 'ZTE Corporation', '00:15:eb': 'ZTE Corporation', '34:4b:50': 'ZTE Corporation',
  '50:c7:bf': 'TP-Link', '14:cc:20': 'TP-Link', 'f4:f2:6d': 'TP-Link',
  '00:1b:21': 'Intel Corporate', '00:13:e8': 'Intel Corporate',
  '00:14:22': 'Dell', 'b8:ca:3a': 'Dell',
  '24:0a:c4': 'Espressif', '30:ae:a4': 'Espressif', '5c:cf:7f': 'Espressif',
  'f4:f5:d8': 'Google', '54:60:09': 'Google',
  '00:00:48': 'Seiko Epson', '64:eb:8c': 'Seiko Epson',
  '3c:d9:2b': 'HP Inc.', '00:17:a4': 'HP Inc.',
  '00:00:85': 'Canon', '00:1e:8f': 'Canon',
  '00:1b:a9': 'Brother Industries',
  '44:19:b6': 'Hikvision',
  '64:09:80': 'Xiaomi', 'f8:a4:5f': 'Xiaomi',
  '00:0e:58': 'Sonos', '5c:aa:fd': 'Sonos',
  'b8:27:eb': 'Raspberry Pi Foundation',
  '24:a4:3c': 'Ubiquiti', '04:18:d6': 'Ubiquiti',
  '4c:5e:0c': 'MikroTik', 'd4:ca:6d': 'MikroTik',
  '00:11:32': 'Synology',
  '00:14:6c': 'Netgear', '20:4e:7f': 'Netgear',
  '00:00:0c': 'Cisco',
  '00:05:5d': 'D-Link', '1c:7e:e5': 'D-Link',
  'b0:a7:37': 'Roku', 'dc:3a:5e': 'Roku',
});

// Placeholders de MAC que Android/NetBIOS entregan cuando no hay MAC real.
function realMacOrNull(mac) {
  if (!mac || typeof mac !== 'string') return null;
  const clean = mac.trim().toLowerCase();
  if (!clean || clean === '02:00:00:00:00:00' || clean === '00:00:00:00:00:00' || clean === '00:00:00:00') return null;
  return mac.trim().toUpperCase();
}

// Fabricante por OUI (port de getVendorByOUI sin red). Solo MAC real y sin el
// bit "locally administered" (MAC aleatoria/privada → sin fabricante).
function vendorFromMac(mac) {
  try {
    const real = realMacOrNull(mac);
    if (!real) return null;
    const octets = real.toLowerCase().replace(/-/g, ':').split(':');
    if (octets.length < 3) return null;
    const firstByte = parseInt(octets[0], 16);
    if (!isNaN(firstByte) && (firstByte & 0x02)) return null;
    const oui = octets.slice(0, 3).join(':');
    return Object.prototype.hasOwnProperty.call(OUI_VENDORS, oui) ? OUI_VENDORS[oui] : null;
  } catch (e) {
    return null;
  }
}

// Fusiona el descubrimiento mDNS/SSDP sobre los equipos sondeados. LITERAL de
// mergeDiscovery (MyLayout.vue:2332-2368):
//  - nombre: si discover trae name y el probe NO lo tiene, usa el de discover.
//  - tipo:   discover.type tiene prioridad sobre probe.deviceType.
//  - agrega IPs que SOLO vio discover, filtradas al /24 de localIp.
function mergeDiscovery(probed, discoverMap, localIp) {
  try {
    const list = Array.isArray(probed) ? probed.slice() : [];
    const map = (discoverMap && typeof discoverMap === 'object') ? discoverMap : {};
    const seen = {};
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      if (!d || !d.ip) continue;
      seen[d.ip] = true;
      const disc = map[d.ip];
      if (!disc) continue;
      if ((d.name == null || d.name === '') && disc.name && !isJunkDeviceName(disc.name)) d.name = disc.name;
      if (disc.type) d.deviceType = disc.type;
    }
    const filterSubnet = (typeof localIp === 'string' && localIp.trim() !== '');
    for (const ip in map) {
      if (!Object.prototype.hasOwnProperty.call(map, ip)) continue;
      if (seen[ip]) continue;
      if (filterSubnet && !sameSubnet24(ip, localIp)) continue;
      const only = map[ip];
      list.push({
        ip,
        mac: null,
        hostname: null,
        name: (only && only.name && !isJunkDeviceName(only.name)) ? only.name : null,
        deviceType: (only && only.type) ? only.type : null,
        respondsTcp: false,
        ping: { stat: emptyPingStat() },
      });
    }
    return list;
  } catch (e) {
    return Array.isArray(probed) ? probed : [];
  }
}

// Un resultado de probeHosts → dispositivo (port de la parte JS de
// probeDevice, netprobe.js:626-720: nombre, MAC, tipo por nombre/puertos/
// banner y gateway = Router). `swept` = entrada del barrido de esa IP.
function deviceFromProbe(r, gatewayIp, swept) {
  const p = r || {};
  const ip = p.ip;
  let name = p.mdnsName || p.netbiosName || p.ptrName || null;
  // mDNS suele llegar como "nombre.local": se recorta el sufijo.
  if (name) name = String(name).trim().replace(/\.local\.?$/i, '');
  try {
    if (name != null) {
      const norm = String(name).trim().toLowerCase();
      if (norm === '' || /^[-\s]+$/.test(norm) || JUNK_DEVICE_NAMES.indexOf(norm) !== -1 ||
          norm === String(ip).trim().toLowerCase()) {
        name = null;
      }
    }
  } catch (e) { name = null; }
  const mac = realMacOrNull(p.netbiosMac);
  const openPorts = Array.isArray(p.openPorts) ? p.openPorts
    : (swept && Array.isArray(swept.openPorts) ? swept.openPorts : []);
  let deviceType = guessDeviceType(name) || guessTypeByPorts(openPorts) || null;
  if ((deviceType == null || name == null) && p.banner) {
    if (deviceType == null) deviceType = guessTypeByBanner(p.banner) || null;
    if (name == null) name = nameFromBanner(p.banner) || null;
  }
  if (gatewayIp && ip === gatewayIp) deviceType = 'Router';

  let stat = p.stat ? normalizeStat(p.stat) : null;
  if (!stat || stat.avg == null) {
    // Sin estadística del probe: el RTT del barrido vale como una muestra.
    stat = (swept && swept.rttMs != null) ? statsFromRtts([Number(swept.rttMs)], 1) : (stat || emptyPingStat());
  }
  const respondsTcp = p.respondsTcp === true || !!(swept && swept.respondsTcp);
  return { ip, mac, hostname: null, name, deviceType, respondsTcp, openPorts, ping: { stat } };
}

function ipToNumber(ip) {
  const p = String(ip || '').split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n))) return Number.MAX_SAFE_INTEGER;
  return ((p[0] * 256 + p[1]) * 256 + p[2]) * 256 + p[3];
}

// Arma la lista final de equipos (forma del contrato):
//   { ip, mac|null, name, deviceType, vendor, respondsTcp, ping:{stat} }
// + isSelf (la IP del teléfono). Router primero; luego por IP.
function buildLanDevices({ netConfig, swept, probed, discoverMap }) {
  const nc = netConfig || {};
  const gatewayIp = nc.gatewayIp || null;
  const deviceIp = nc.deviceIp || null;
  const sweptByIp = {};
  (swept || []).forEach((s) => { if (s && s.ip) sweptByIp[s.ip] = s; });
  const probedByIp = {};
  (probed || []).forEach((r) => { if (r && r.ip) probedByIp[r.ip] = r; });
  // Toda IP viva (barrido o probe) entra, aunque el probe no la haya devuelto.
  const ips = Array.from(new Set(Object.keys(sweptByIp).concat(Object.keys(probedByIp))));
  let devices = ips.map((ip) => deviceFromProbe(probedByIp[ip] || { ip }, gatewayIp, sweptByIp[ip]));
  devices = mergeDiscovery(devices, discoverMap, deviceIp);

  const out = devices.map((d) => {
    const vendor = vendorFromMac(d.mac);
    let name = (d.name != null && d.name !== '') ? d.name : null;
    if (name && (isJunkDeviceName(name) || name === d.ip)) name = null;
    return {
      ip: d.ip,
      mac: d.mac != null ? d.mac : null,
      name,
      deviceType: (d.ip === gatewayIp) ? 'Router'
        : (d.deviceType || typeFromName(name) || typeFromVendor(vendor) || null),
      vendor,
      respondsTcp: d.respondsTcp === true,
      ping: (d.ping && d.ping.stat) ? { stat: d.ping.stat } : { stat: emptyPingStat() },
      isSelf: !!deviceIp && d.ip === deviceIp,
    };
  });
  out.sort((a, b) => {
    if (a.deviceType === 'Router' && a.ip === gatewayIp) return -1;
    if (b.deviceType === 'Router' && b.ip === gatewayIp) return 1;
    return ipToNumber(a.ip) - ipToNumber(b.ip);
  });
  return out;
}

function withTimeout(promise, ms, fallback) {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise).catch(() => fallback),
    new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), ms); }),
  ]).finally(() => clearTimeout(timer));
}

// Pipeline completo (AfterScan.getDevicesConnected): getNetConfig → en
// paralelo barrido+probe y descubrimiento (8 s máx.) → fusión → lista final.
// onProgress({ text, done, total }) para la UI.
async function scanLanDevices(onProgress) {
  const progress = typeof onProgress === 'function' ? onProgress : () => {};
  const t0 = Date.now();
  progress({ text: 'Leyendo la configuración de la red…' });
  const netConfig = await WifixNative.getNetConfig();
  if (!netConfig || !netConfig.gatewayIp || !netConfig.deviceIp) {
    throw new Error('El teléfono no está conectado a una red WiFi: conéctalo a la red del cliente y vuelve a escanear.');
  }
  const simulated = !!netConfig.simulated;
  const discoverP = withTimeout(WifixNative.discoverNetwork({ mdnsMs: 6000, ssdpMs: 6000 }), 8000, {});

  const probeP = (async () => {
    const sweep = await WifixNative.sweepSubnet({}, (p) => {
      const total = Number(p.total) || 254;
      const done = Math.min(total, Number(p.done) || 0);
      progress({ text: `Buscando equipos en la red: ${done} de ${total} direcciones`, done, total });
    });
    const alive = (sweep && Array.isArray(sweep.alive)) ? sweep.alive : [];
    const ips = alive.map((a) => a && a.ip).filter(Boolean);
    if (ips.indexOf(netConfig.gatewayIp) === -1) ips.unshift(netConfig.gatewayIp);
    progress({ text: `Identificando ${ips.length} equipos (nombre, tipo y latencia)…` });
    const probed = await WifixNative.probeHosts(ips, netConfig.gatewayIp, (p) => {
      const total = Number(p.total) || ips.length;
      const done = Math.min(total, Number(p.done) || 0);
      progress({ text: `Identificando equipos: ${done} de ${total}`, done, total });
    });
    return { alive, probed };
  })();

  const [{ alive, probed }, discoverMap] = await Promise.all([probeP, discoverP]);
  const devices = buildLanDevices({ netConfig, swept: alive, probed, discoverMap });
  return { devices, netConfig, simulated, durationMs: Date.now() - t0 };
}

// ---- Módulo 4: Latencia -----------------------------------------------------
// Origen: AfterScan.vue:1171-1273 y MyLayout.vue:1520-1540. Secuencial:
// Router (gateway), Google (8.8.8.8) e ISP (IP pública). ICMP primero; si
// pierde el 100 % se cae a TCP-ping (el ICMP suele estar bloqueado).
const LATENCY_GATEWAY_PORTS = [80, 443, 8080, 53, 22];

async function measureLatencyTarget(host, o) {
  let icmpErr = null;
  try {
    const res = await WifixNative.icmpPing(host, { count: o.icmpCount, timeoutSec: 5 });
    const stat = statFromIcmp(res, o.icmpCount);
    if (stat.packetLoss !== 100 && stat.avg != null) {
      return { host, method: 'ICMP', stat, simulated: !!(res && res.simulated) };
    }
  } catch (err) {
    icmpErr = err;
  }
  try {
    const r = await WifixNative.tcpPing(host, { ports: o.tcpPorts, count: o.tcpCount, timeoutMs: o.tcpTimeoutMs });
    const stat = normalizeStat(r);
    if (stat.packetLoss == null && stat.avg == null) stat.packetLoss = 100;
    const port = r ? (r.openPort != null ? r.openPort : (r.port != null ? r.port : null)) : null;
    return { host, method: 'TCP', port, stat, simulated: !!(r && r.simulated) };
  } catch (err) {
    const stat = emptyPingStat();
    stat.packetLoss = 100;
    return { host, method: 'TCP', stat, error: (err && err.message) || (icmpErr && icmpErr.message) || 'Sin respuesta' };
  }
}

async function runLatencyTest(onProgress) {
  const progress = typeof onProgress === 'function' ? onProgress : () => {};
  const targets = [];
  progress({ text: 'Midiendo latencia al router…', done: 0, total: 4 });
  let netConfig = null;
  try { netConfig = await WifixNative.getNetConfig(); } catch (_) { netConfig = null; }
  const gw = netConfig && netConfig.gatewayIp;
  if (gw) {
    targets.push(Object.assign({ key: 'router', label: 'Router' },
      await measureLatencyTarget(gw, { icmpCount: 5, tcpPorts: LATENCY_GATEWAY_PORTS, tcpCount: 5, tcpTimeoutMs: 1500 })));
  } else {
    targets.push({ key: 'router', label: 'Router', host: null, method: null, stat: emptyPingStat(),
      error: 'Sin gateway: el teléfono no está en una red WiFi.' });
  }

  progress({ text: 'Midiendo latencia a Google (8.8.8.8)…', done: 1, total: 4 });
  targets.push(Object.assign({ key: 'google', label: 'Google' },
    await measureLatencyTarget('8.8.8.8', { icmpCount: 6, tcpPorts: [443], tcpCount: 6, tcpTimeoutMs: 2000 })));

  progress({ text: 'Midiendo latencia al ISP (IP pública)…', done: 2, total: 4 });
  let isp = null;
  try { isp = await WifixNative.getPublicIp(); } catch (_) { isp = null; }
  if (isp && isp.ip) {
    targets.push(Object.assign({ key: 'isp', label: 'ISP', isp: isp.isp || null },
      await measureLatencyTarget(isp.ip, { icmpCount: 5, tcpPorts: LATENCY_GATEWAY_PORTS, tcpCount: 5, tcpTimeoutMs: 1500 })));
  } else {
    targets.push({ key: 'isp', label: 'ISP', host: null, method: null, stat: emptyPingStat(),
      error: 'No se pudo obtener la IP pública.' });
  }

  // Latencia HTTP a Internet (opcional, como el origen): mínimo de 7 muestras.
  progress({ text: 'Midiendo latencia HTTP a Internet…', done: 3, total: 4 });
  let internet = null;
  try {
    const h = await WifixNative.httpLatency('https://speed.cloudflare.com/__down?bytes=0', 7);
    if (h && h.minMs != null) internet = { minMs: h.minMs, avgMs: h.avgMs ?? null, jitterMs: h.jitterMs ?? null };
  } catch (_) { internet = null; }

  const simulated = !!((netConfig && netConfig.simulated) || targets.some((t) => t.simulated));
  return { targets, internet, simulated, measuredAt: new Date().toISOString() };
}

const LATENCY_TARGET_NOTES = Object.freeze({
  router: 'Red Interna · Latencia al router',
  google: 'Red Interna · Latencia a Google',
  isp: 'Red Interna · Latencia al ISP (IP pública)',
});

// Un registro POST /ping-tests por destino medido (contrato PingTestInput).
// Los null se OMITEN (el backend valida números ≥ 0).
function buildLatencyPingPayloads(result) {
  const out = [];
  ((result && result.targets) || []).forEach((t) => {
    if (!t || !t.host) return;
    const s = t.stat || {};
    const p = { target: t.host, continuous: false, measuredAt: result.measuredAt || new Date().toISOString() };
    const sent = Number(s.sent);
    const recv = Number(s.received);
    if (Number.isInteger(sent) && sent >= 0) p.packetsSent = sent;
    if (Number.isInteger(recv) && recv >= 0 && (p.packetsSent === undefined || recv <= p.packetsSent)) p.packetsReceived = recv;
    if (s.packetLoss != null && isFinite(s.packetLoss)) p.packetLossPercent = Math.min(100, Math.max(0, s.packetLoss));
    if (s.min != null && isFinite(s.min)) p.minLatencyMs = Math.max(0, s.min);
    if (s.avg != null && isFinite(s.avg)) p.avgLatencyMs = Math.max(0, s.avg);
    if (s.max != null && isFinite(s.max)) p.maxLatencyMs = Math.max(0, s.max);
    const metodo = t.method === 'TCP' ? `TCP${t.port ? ' :' + t.port : ''}` : (t.method || '');
    const jitter = s.stddev != null ? ` · jitter ${s.stddev} ms` : '';
    p.notes = `${LATENCY_TARGET_NOTES[t.key] || 'Red Interna · Latencia'}${metodo ? ' (' + metodo + ')' : ''}${jitter}`;
    out.push(p);
  });
  return out;
}

// ============================================================================
// Red Interna — UI de los módulos medidos
// ============================================================================

const RI_SCAN_TTL_MS = 60 * 1000;          // scan WiFi compartido Saturación/Redes
const RI_RESULT_TTL_MS = 10 * 60 * 1000;   // resultado reutilizable al reabrir

const _riState = {
  account: null,
  scan: null,          // { at, scan, wifiInfo, simulated }
  scanPromise: null,
  results: {},         // id → { at, data, error }
  running: {},         // id → Promise
  mounted: {},         // id → body (el más reciente)
  nearbyMode: 'grouped',
};

function riResetForAccount(cuenta) {
  if (_riState.account === cuenta) return;
  _riState.account = cuenta;
  _riState.results = {};
  _riState.mounted = {};
}

// Un único escaneo WiFi para Saturación y Redes cercanas (con timestamp):
// Android limita a 4 escaneos cada 2 minutos, no se escanea dos veces.
function riGetWifiScan(force) {
  const c = _riState.scan;
  if (!force && c && Date.now() - c.at < RI_SCAN_TTL_MS) return Promise.resolve(c);
  if (_riState.scanPromise) return _riState.scanPromise;
  _riState.scanPromise = (async () => {
    const [scan, wifiInfo] = await Promise.all([
      WifixNative.scanNetworks(),
      WifixNative.wifiLink().catch(() => null),
    ]);
    const entry = { at: Date.now(), scan: scan || { accessPoints: [] }, wifiInfo, simulated: !!(scan && scan.simulated) };
    _riState.scan = entry;
    return entry;
  })().finally(() => { _riState.scanPromise = null; });
  return _riState.scanPromise;
}

function saturationFromScan(entry) {
  const aps = (entry.scan && Array.isArray(entry.scan.accessPoints)) ? entry.scan.accessPoints : [];
  const conn = ownConnInfo(entry.wifiInfo, entry.scan);
  const wifis = normalizeWifis(aps);
  return { sat: computeChannelSaturation(conn, wifis), conn, scanEntry: entry, apCount: aps.length };
}

function nearbyFromScan(entry) {
  const aps = (entry.scan && Array.isArray(entry.scan.accessPoints)) ? entry.scan.accessPoints : [];
  return { grouped: normalizeWifis(aps), all: listAllBssids(aps), scanEntry: entry };
}

const RI_MODULES = {
  sat: {
    runLabel: 'Escanear canales',
    startText: 'Escaneando redes WiFi cercanas…',
    shared: 'scan',
    run: async ({ force }) => saturationFromScan(await riGetWifiScan(force)),
    fromScan: saturationFromScan,
    render: renderSaturationResult,
  },
  devices: {
    runLabel: 'Buscar dispositivos',
    startText: 'Preparando el barrido de la red…',
    run: ({ progress }) => scanLanDevices(progress),
    render: renderDevicesResult,
  },
  nearby: {
    runLabel: 'Escanear redes',
    startText: 'Escaneando redes WiFi cercanas…',
    shared: 'scan',
    run: async ({ force }) => nearbyFromScan(await riGetWifiScan(force)),
    fromScan: nearbyFromScan,
    render: renderNearbyResult,
    after: wireNearbyToggle,
  },
  latency: {
    runLabel: 'Medir latencia',
    startText: 'Midiendo latencia…',
    run: ({ progress }) => runLatencyTest(progress),
    render: renderLatencyResult,
    after: wireLatencySave,
  },
};

function riShellHtml(id) {
  const mod = RI_MODULES[id];
  return `
    <div class="ri-module" data-ri="${id}">
      <div class="ri-toolbar">
        <button type="button" class="save-btn ri-run-btn" data-action="ri-run">${escapeHtml(mod.runLabel)}</button>
        <span class="ri-stamp" data-slot="stamp"></span>
      </div>
      <div class="ri-progress" data-slot="progress" hidden>
        <div class="ri-progress-track" data-slot="track" role="progressbar" aria-label="Progreso del escaneo"
          aria-valuemin="0" aria-valuemax="100">
          <div class="ri-progress-bar" data-slot="bar"></div>
        </div>
        <div class="ri-progress-text" data-slot="ptext" role="status" aria-live="polite"></div>
      </div>
      <div data-slot="result"><div class="detail-empty">Toca “${escapeHtml(mod.runLabel)}” para medir.</div></div>
    </div>`;
}

function riSlot(id, name) {
  const body = _riState.mounted[id];
  return body ? body.querySelector(`[data-slot="${name}"]`) : null;
}

function riSetProgress(id, p) {
  const box = riSlot(id, 'progress');
  if (!box) return;
  if (!p) { box.hidden = true; return; }
  box.hidden = false;
  const text = riSlot(id, 'ptext');
  const bar = riSlot(id, 'bar');
  const track = riSlot(id, 'track');
  if (text) text.textContent = p.text || '';
  const determinate = Number.isFinite(p.done) && Number.isFinite(p.total) && p.total > 0;
  const pct = determinate ? Math.round((p.done / p.total) * 100) : null;
  if (bar) {
    bar.classList.toggle('indeterminate', !determinate);
    bar.style.width = determinate ? `${pct}%` : '';
  }
  if (track) {
    if (determinate) track.setAttribute('aria-valuenow', String(pct));
    else track.removeAttribute('aria-valuenow');
  }
}

function riSetBusy(id, busy) {
  const body = _riState.mounted[id];
  if (!body) return;
  const btn = body.querySelector('[data-action="ri-run"]');
  if (!btn) return;
  btn.disabled = busy;
  const mod = RI_MODULES[id];
  const has = !!_riState.results[id];
  btn.textContent = busy ? 'Midiendo…' : (has ? 'Volver a escanear' : mod.runLabel);
  btn.setAttribute('aria-busy', busy ? 'true' : 'false');
}

function riRender(id) {
  const body = _riState.mounted[id];
  if (!body) return;
  const slot = body.querySelector('[data-slot="result"]');
  const stamp = body.querySelector('[data-slot="stamp"]');
  const res = _riState.results[id];
  if (!slot) return;
  if (!res) return;
  if (stamp) stamp.textContent = res.at ? `Medido a las ${fmtTimeEc(new Date(res.at).toISOString())}` : '';
  if (res.error) {
    slot.innerHTML = `<div class="detail-error" role="alert">${escapeHtml(res.error)}</div>`;
    return;
  }
  const mod = RI_MODULES[id];
  slot.innerHTML = mod.render(res.data);
  if (mod.after) mod.after(slot, res.data, id);
}

// Tras un escaneo WiFi nuevo, el otro módulo que comparte el scan se
// recalcula con el mismo resultado (sin escanear de nuevo).
function riSyncSharedScan(fromId) {
  Object.keys(RI_MODULES).forEach((other) => {
    const mod = RI_MODULES[other];
    if (other === fromId || mod.shared !== 'scan' || !_riState.results[other] || !_riState.scan) return;
    if (_riState.running[other]) return;
    _riState.results[other] = { at: _riState.scan.at, data: mod.fromScan(_riState.scan), error: null };
    riRender(other);
  });
}

function riRun(id, force) {
  if (_riState.running[id]) return _riState.running[id];
  const mod = RI_MODULES[id];
  riSetBusy(id, true);
  riSetProgress(id, { text: mod.startText });
  const p = (async () => {
    try {
      const data = await mod.run({ force: !!force, progress: (pp) => riSetProgress(id, pp) });
      const at = (mod.shared === 'scan' && data && data.scanEntry) ? data.scanEntry.at : Date.now();
      _riState.results[id] = { at, data, error: null };
      if (mod.shared === 'scan') riSyncSharedScan(id);
    } catch (err) {
      console.error('[Wifix] red-interna', id, err);
      _riState.results[id] = { at: Date.now(), data: null, error: (err && err.message) || 'No se pudo completar la medición.' };
    } finally {
      _riState.running[id] = null;
      riSetProgress(id, null);
      riSetBusy(id, false);
      riRender(id);
    }
  })();
  _riState.running[id] = p;
  return p;
}

// Monta el módulo en su acordeón: reutiliza un resultado reciente o mide.
function riMount(id, body) {
  _riState.mounted[id] = body;
  const btn = body.querySelector('[data-action="ri-run"]');
  if (btn) btn.addEventListener('click', () => riRun(id, true));
  if (_riState.running[id]) {
    riSetBusy(id, true);
    riSetProgress(id, { text: RI_MODULES[id].startText });
    return _riState.running[id];
  }
  const res = _riState.results[id];
  if (res && Date.now() - res.at < RI_RESULT_TTL_MS) {
    riSetBusy(id, false);
    riRender(id);
    return Promise.resolve();
  }
  return riRun(id, false);
}

// ---- Avisos comunes ---------------------------------------------------------
function riSimNotice() {
  return mockNotice('', 'Datos simulados — la medición real solo funciona en el APK');
}

function riScanNotices(entry, apCount) {
  const out = [];
  if (entry && entry.simulated) out.push(riSimNotice());
  if (entry && entry.scan && entry.scan.fromCache) {
    out.push('<div class="detail-warning" role="status">Android limita a 4 escaneos cada 2 minutos: se muestran los últimos resultados disponibles (en caché). Espera un momento y vuelve a escanear.</div>');
  }
  if (!apCount) {
    out.push('<div class="detail-warning" role="status">El escaneo no devolvió redes. Si la ubicación del sistema está apagada, Android entrega el escaneo vacío: actívala y vuelve a escanear.</div>');
  }
  return out.join('');
}

const RI_LEVEL_BADGE = Object.freeze({ good: 'badge-resolved', warn: 'badge-pending', bad: 'badge-fail' });
const RI_LEVEL_TILE = Object.freeze({ good: 'ok', warn: 'warn', bad: 'fail' });

function riBandLabel(band) {
  return band ? String(band).replace('GHz', ' GHz') : '—';
}

// ---- Render: Saturación de canal -------------------------------------------

// Barras SVG de redes vecinas por canal (mismo estilo que renderLineChart).
// Colores por clase CSS (tokens), no inline.
function renderChannelBars(perChannel, band, ownChannel, suggested) {
  const counts = perChannel || {};
  let channels;
  if (band === '2.4GHz') {
    channels = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
    if (counts[14]) channels.push(14);
  } else {
    const set = new Set((SATURATION_CANDIDATES[band] || []).filter((c) => band !== '6GHz' || counts[c] || (suggested || []).includes(c)));
    Object.keys(counts).forEach((k) => set.add(Number(k)));
    if (ownChannel != null) set.add(ownChannel);
    channels = Array.from(set).filter(Number.isFinite).sort((a, b) => a - b);
  }
  if (channels.length === 0) return '<div class="detail-empty">Sin redes vecinas en esta banda.</div>';

  const W = 320, H = 130;
  const padL = 24, padR = 8, padT = 16, padB = 22;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxCount = Math.max(1, ...channels.map((c) => counts[c] || 0));
  const slot = plotW / channels.length;
  const barW = Math.max(4, Math.min(22, slot * 0.62));
  const y = (v) => padT + plotH - (v / maxCount) * plotH;
  const sugg = new Set(suggested || []);

  const grid = [0, 0.5, 1].map((f) => {
    const gy = padT + plotH * f;
    const v = Math.round(maxCount * (1 - f));
    return `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${W - padR}" y2="${gy.toFixed(1)}" class="chart-grid"/>` +
      `<text x="${padL - 5}" y="${(gy + 3).toFixed(1)}" class="chart-axis" text-anchor="end">${v}</text>`;
  }).join('');

  const bars = channels.map((ch, i) => {
    const cx = padL + slot * i + slot / 2;
    const c = counts[ch] || 0;
    const own = ch === ownChannel;
    const top = y(c);
    const bg = own
      ? `<rect x="${(cx - slot / 2 + 1).toFixed(1)}" y="${padT}" width="${(slot - 2).toFixed(1)}" height="${plotH}" class="ri-bar-own-bg" rx="3"/>`
      : '';
    const bar = c > 0
      ? `<rect x="${(cx - barW / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${barW.toFixed(1)}" height="${(padT + plotH - top).toFixed(1)}" rx="2" class="ri-bar${own ? ' own' : ''}"/>` +
        `<text x="${cx.toFixed(1)}" y="${(top - 3).toFixed(1)}" class="chart-axis ri-bar-value" text-anchor="middle">${c}</text>`
      : '';
    const labelCls = own ? 'chart-axis ri-axis-own' : sugg.has(ch) ? 'chart-axis ri-axis-suggested' : 'chart-axis';
    const label = `<text x="${cx.toFixed(1)}" y="${H - 8}" class="${labelCls}" text-anchor="middle">${ch}</text>`;
    return bg + bar + label;
  }).join('');

  const resumen = channels.filter((ch) => counts[ch]).map((ch) => `canal ${ch}: ${counts[ch]}`).join(', ') || 'sin redes vecinas';
  const aria = `Redes vecinas por canal en ${riBandLabel(band)}. Tu canal: ${ownChannel ?? 'desconocido'}. ${resumen}.`;
  return `
    <div class="chart-block ri-channel-chart">
      <div class="chart-unit">redes</div>
      <svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(aria)}">
        ${grid}${bars}
      </svg>
      <div class="chart-legend">
        <span class="chart-legend-item"><span class="chart-legend-dot ri-dot-own"></span>Tu canal</span>
        <span class="chart-legend-item"><span class="chart-legend-dot ri-dot-other"></span>Redes vecinas</span>
        <span class="chart-legend-item"><span class="chart-legend-dot ri-dot-suggested"></span>Canal sugerido</span>
      </div>
    </div>`;
}

function renderSaturationResult(data) {
  const { sat, conn, scanEntry, apCount } = data;
  const notices = riScanNotices(scanEntry, apCount);
  if (!sat || sat.error) {
    return `${notices}<div class="detail-error" role="alert">${escapeHtml((sat && sat.error) || 'No se pudo calcular la saturación.')}
      Verifica que el teléfono esté conectado a la red WiFi del cliente.</div>`;
  }
  const badge = RI_LEVEL_BADGE[sat.levelClass] || 'badge-neutral';
  const tile = RI_LEVEL_TILE[sat.levelClass] || '';
  const chips = sat.suggested.length
    ? sat.suggested.map((c) => `<span class="ri-chip">Canal ${escapeHtml(String(c))}</span>`).join('')
    : '<span class="ri-chip-empty">Sin alternativas en esta banda.</span>';
  return `
    ${notices}
    <div class="ri-summary">
      <span class="event-badge ${badge}">Saturación ${escapeHtml(sat.levelLabel.toLowerCase())}</span>
      <span class="ri-summary-text">${escapeHtml(conn.ssid || 'Red conectada')} · canal ${escapeHtml(String(sat.channel ?? '—'))}</span>
    </div>
    <div class="status-grid">
      <div class="status-tile ${tile}">
        <span class="st-label">Saturación</span>
        <span class="st-value">${escapeHtml(sat.levelLabel)}</span>
        <span class="st-sub">Puntaje ${sat.score} (2 × mismo canal + solapadas)</span>
      </div>
      <div class="status-tile">
        <span class="st-label">Canal actual</span>
        <span class="st-value">${escapeHtml(String(sat.channel ?? '—'))}</span>
        <span class="st-sub">${escapeHtml(riBandLabel(sat.band))} · ${escapeHtml(String(sat.channelWidth))} MHz</span>
      </div>
      <div class="status-tile">
        <span class="st-label">Mismo canal</span>
        <span class="st-value">${sat.sameChannelCount}</span>
        <span class="st-sub">redes vecinas en el canal ${escapeHtml(String(sat.channel ?? '—'))}</span>
      </div>
      <div class="status-tile">
        <span class="st-label">Solapadas</span>
        <span class="st-value">${sat.overlappingCount}</span>
        <span class="st-sub">redes que pisan tu ancho de canal</span>
      </div>
    </div>
    <h4 class="band-title ri-subtitle">Redes por canal · ${escapeHtml(riBandLabel(sat.band))}</h4>
    ${renderChannelBars(sat.perChannel, sat.band, sat.channel, sat.suggested)}
    <div class="ri-chips" role="group" aria-label="Canales sugeridos">
      <span class="ri-chips-label">Canales sugeridos</span>
      ${chips}
    </div>`;
}

// ---- Render: Redes cercanas -------------------------------------------------
function riRssi(dbm) {
  const fn = typeof WifixNative !== 'undefined' && WifixNative && WifixNative.classifyRssi;
  return fn ? fn(dbm) : { label: '—', cls: 'rssi-na' };
}

function renderWifiRow(w, mode) {
  const rssi = riRssi(w.signalDbm);
  const ssid = w.hidden ? '<span class="ri-hidden-ssid">(red oculta)</span>' : escapeHtml(w.ssid || '—');
  const conectada = w.anyConnected ? ' <span class="ap-connected">Conectado</span>' : '';
  const secCls = w.security === 'Abierta' || w.security === 'WEP' ? 'ap-band-badge ri-sec-weak' : 'ap-band-badge';
  const extra = mode === 'grouped' && w.bssidCount > 1
    ? `<span class="ap-meta">${w.bssidCount} BSSID</span>` : '';
  return `
    <div class="ap-row">
      <div class="ap-row-head">
        <span class="ap-ssid">${ssid}${conectada}</span>
        <span class="ap-rssi ${rssi.cls}" title="${escapeHtml(rssi.label)}">${w.signalDbm != null ? escapeHtml(String(w.signalDbm)) + ' dBm' : '—'}</span>
        <span class="ap-meta">Canal ${escapeHtml(String(w.channel ?? '—'))} · ${escapeHtml(String(w.channelWidthMhz))} MHz</span>
        <span class="${secCls}">${escapeHtml(w.security)}</span>
        ${w.wps ? '<span class="ap-band-badge">WPS</span>' : ''}
      </div>
      <div class="ap-row-foot">
        <span class="ap-meta-mono">${escapeHtml(w.bssid || '—')}</span>
        <span class="ap-meta">${escapeHtml(rssi.label)}</span>
        ${extra}
      </div>
    </div>`;
}

const RI_BAND_ORDER = ['2.4GHz', '5GHz', '6GHz'];

function renderNearbyResult(data) {
  const mode = _riState.nearbyMode === 'all' ? 'all' : 'grouped';
  const list = mode === 'all' ? data.all : data.grouped;
  const apCount = data.all.length;
  const notices = riScanNotices(data.scanEntry, apCount);
  const byBand = {};
  list.forEach((w) => { const b = w.band || 'Otra'; (byBand[b] = byBand[b] || []).push(w); });
  const bands = RI_BAND_ORDER.filter((b) => byBand[b]).concat(Object.keys(byBand).filter((b) => !RI_BAND_ORDER.includes(b)));
  const resumen = bands.map((b) => `${riBandLabel(b)}: ${byBand[b].length}`).join(' · ');
  const toggle = `
    <div class="ri-toggle" role="group" aria-label="Vista de las redes">
      <button type="button" class="ri-toggle-btn" data-mode="grouped" aria-pressed="${mode === 'grouped'}">Agrupar por SSID</button>
      <button type="button" class="ri-toggle-btn" data-mode="all" aria-pressed="${mode === 'all'}">Ver todos los BSSID</button>
    </div>`;
  if (!list.length) {
    return `${notices}${apCount ? toggle : ''}<div class="detail-empty">No se encontraron redes visibles.</div>`;
  }
  return `
    ${notices}
    <div class="ri-summary"><span class="ri-summary-text"><strong>${list.length}</strong> ${mode === 'all' ? 'BSSID' : 'redes'} · ${escapeHtml(resumen)}</span></div>
    ${toggle}
    ${bands.map((b) => `
      <div class="band-section">
        <h4 class="band-title">${escapeHtml(riBandLabel(b))} · ${byBand[b].length}</h4>
        <div class="ap-list">${byBand[b].map((w) => renderWifiRow(w, mode)).join('')}</div>
      </div>`).join('')}`;
}

function wireNearbyToggle(slot, data, id) {
  slot.querySelectorAll('.ri-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode === 'all' ? 'all' : 'grouped';
      if (mode === _riState.nearbyMode) return;
      _riState.nearbyMode = mode;
      riRender(id);
      const again = slot.querySelector(`.ri-toggle-btn[data-mode="${mode}"]`);
      if (again) again.focus();
    });
  });
}

// ---- Render: Dispositivos conectados ---------------------------------------
const RI_DEVICE_TYPE_LABELS = Object.freeze({
  Router: 'Router', 'Móvil': 'Móvil', PC: 'Computadora', AndroidTV: 'Smart TV', AppleTV: 'Apple TV',
  Chromecast: 'Chromecast', Impresora: 'Impresora', NAS: 'Almacenamiento (NAS)', Parlante: 'Parlante',
  'Cámara': 'Cámara', IoT: 'Dispositivo IoT',
});

const _RI_SVG = (paths) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
const RI_DEVICE_ICONS = Object.freeze({
  Router: _RI_SVG('<rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 16.5h.01M11 16.5h.01"/><path d="M8 9.5a6 6 0 0 1 8 0M5.5 7a9.5 9.5 0 0 1 13 0"/>'),
  'Móvil': _RI_SVG('<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18h2"/>'),
  PC: _RI_SVG('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>'),
  AndroidTV: _RI_SVG('<rect x="2.5" y="5" width="19" height="12" rx="2"/><path d="M8 21h8"/>'),
  AppleTV: _RI_SVG('<rect x="2.5" y="5" width="19" height="12" rx="2"/><path d="M8 21h8"/>'),
  Chromecast: _RI_SVG('<path d="M3 17a4 4 0 0 1 4 4M3 13a8 8 0 0 1 8 8M3 9.5V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-4"/>'),
  Impresora: _RI_SVG('<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><rect x="7" y="14" width="10" height="7"/>'),
  NAS: _RI_SVG('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16M8 6h.01M8 12h.01M8 18h.01"/>'),
  Parlante: _RI_SVG('<rect x="5" y="2.5" width="14" height="19" rx="2"/><circle cx="12" cy="14" r="3.5"/><path d="M12 6.5h.01"/>'),
  'Cámara': _RI_SVG('<path d="M15 10l5-3v10l-5-3"/><rect x="3" y="6" width="12" height="12" rx="2"/>'),
  IoT: _RI_SVG('<rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"/>'),
  unknown: _RI_SVG('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14M12 17h.01"/>'),
});

function riRttPill(stat) {
  const avg = stat && stat.avg;
  const lvl = latencyLevel(avg);
  const txt = avg != null ? `${_fmtNum(avg, 1)} ms` : 'sin respuesta';
  return `<span class="ri-pill ri-${lvl.cls}" title="Latencia ${escapeHtml(lvl.label.toLowerCase())}">${escapeHtml(txt)}</span>`;
}

function renderDeviceRow(d) {
  const type = d.deviceType;
  const icon = RI_DEVICE_ICONS[type] || RI_DEVICE_ICONS.unknown;
  const typeLabel = type ? (RI_DEVICE_TYPE_LABELS[type] || type) : 'Tipo desconocido';
  const title = d.name || (type ? typeLabel : 'Equipo sin identificar');
  const meta = [
    `<span class="ap-meta-mono ri-ip">${escapeHtml(d.ip)}</span>`,
    escapeHtml(typeLabel),
    d.vendor ? escapeHtml(d.vendor) : '',
  ].filter(Boolean).join(' · ');
  return `
    <div class="ap-row ri-dev">
      <div class="ri-dev-icon">${icon}</div>
      <div class="ri-dev-body">
        <div class="ri-dev-head">
          <span class="ap-ssid">${escapeHtml(title)}</span>
          ${d.isSelf ? '<span class="ap-connected">Este teléfono</span>' : ''}
        </div>
        <div class="ri-dev-meta">${meta}</div>
        ${d.mac ? `<div class="ap-meta-mono">MAC ${escapeHtml(d.mac)}</div>` : ''}
      </div>
      ${riRttPill(d.ping && d.ping.stat)}
    </div>`;
}

function renderDevicesResult(data) {
  const devs = data.devices || [];
  const nc = data.netConfig || {};
  const identified = devs.filter((d) => d.name || d.deviceType).length;
  const macNote = '<p class="form-note">Android 10 o superior no permite leer la MAC de otros equipos: solo se muestra cuando el equipo la publica (NetBIOS, típicamente PCs con Windows).</p>';
  if (!devs.length) {
    return `${data.simulated ? riSimNotice() : ''}${macNote}<div class="detail-empty">No se encontraron equipos en la red. Verifica que el teléfono esté en la red WiFi del cliente y vuelve a escanear.</div>`;
  }
  return `
    ${data.simulated ? riSimNotice() : ''}
    <div class="status-grid">
      <div class="status-tile"><span class="st-label">Equipos</span><span class="st-value">${devs.length}</span>
        <span class="st-sub">${data.durationMs ? 'en ' + escapeHtml(fmtDuration(data.durationMs)) : ''}</span></div>
      <div class="status-tile"><span class="st-label">Identificados</span><span class="st-value">${identified} de ${devs.length}</span>
        <span class="st-sub">con nombre o tipo</span></div>
      <div class="status-tile"><span class="st-label">Router</span><span class="st-value ri-mono">${escapeHtml(nc.gatewayIp || '—')}</span></div>
      <div class="status-tile"><span class="st-label">Este teléfono</span><span class="st-value ri-mono">${escapeHtml(nc.deviceIp || '—')}</span></div>
    </div>
    <div class="ap-list ri-dev-list">${devs.map(renderDeviceRow).join('')}</div>
    ${macNote}`;
}

// ---- Render: Latencia --------------------------------------------------------
function renderLatencyTile(t) {
  const s = t.stat || emptyPingStat();
  const lvl = latencyLevel(s.avg);
  const metodo = t.method === 'TCP' ? `TCP${t.port ? ' :' + t.port : ''}` : (t.method || '');
  const destino = [t.host, metodo].filter(Boolean).join(' · ');
  const value = s.avg != null ? `${_fmtNum(s.avg, 1)} ms` : 'Sin respuesta';
  return `
    <div class="status-tile ${RI_LEVEL_TILE[lvl.cls]}">
      <span class="st-label">${escapeHtml(t.label)}</span>
      <span class="st-value">${escapeHtml(value)}</span>
      <span class="st-sub ri-mono">${escapeHtml(destino || '—')}</span>
      ${s.avg != null ? `<span class="st-sub">mín ${escapeHtml(_fmtNum(s.min, 1))} · máx ${escapeHtml(_fmtNum(s.max, 1))} ms</span>
      <span class="st-sub">jitter ${escapeHtml(_fmtNum(s.stddev, 1))} ms · pérdida ${escapeHtml(_fmtNum(s.packetLoss, 1))} %</span>` : ''}
      ${t.error && s.avg == null ? `<span class="st-sub">${escapeHtml(t.error)}</span>` : ''}
    </div>`;
}

function renderLatencyResult(data) {
  const targets = data.targets || [];
  const internet = data.internet;
  const internetTile = `
    <div class="status-tile ${internet ? RI_LEVEL_TILE[latencyLevel(internet.minMs).cls] : 'fail'}">
      <span class="st-label">Internet (HTTP)</span>
      <span class="st-value">${internet ? escapeHtml(_fmtNum(internet.minMs, 1)) + ' ms' : 'Sin respuesta'}</span>
      <span class="st-sub">mínimo de 7 muestras a Cloudflare</span>
    </div>`;
  const series = targets
    .filter((t) => t.stat && Array.isArray(t.stat.samples) && t.stat.samples.length)
    .map((t, i) => ({ label: `${t.label} (${t.method || '—'})`, color: _ISP_COLORS[i % _ISP_COLORS.length],
      points: t.stat.samples.map((v) => ({ t: null, v: Number(v) })) }));
  const chart = series.length
    ? renderLineChart(series, { unit: 'ms', minZero: true, ariaLabel: 'Latencia de cada muestra por destino, en milisegundos' })
    : '<div class="detail-empty">Sin muestras para graficar.</div>';
  const saveBtn = data.simulated
    ? '<p class="form-note">Datos simulados: no se guardan en la visita.</p>'
    : '<button type="button" class="save-btn" data-action="ri-save-latency">Guardar en la visita</button><div class="ri-save-status" data-slot="save-status" role="status" aria-live="polite"></div>';
  return `
    ${data.simulated ? riSimNotice() : ''}
    <div class="status-grid">${targets.map(renderLatencyTile).join('')}${internetTile}</div>
    <h4 class="band-title ri-subtitle">Muestras por destino</h4>
    ${chart}
    <p class="form-note">Promedio ≤ ${LATENCY_GOOD_MS} ms: buena · ≤ ${LATENCY_WARN_MS} ms: aceptable · más: alta. Jitter = desviación de las muestras. Si el ICMP no responde se mide por TCP.</p>
    ${saveBtn}`;
}

function wireLatencySave(slot, data) {
  const btn = slot.querySelector('[data-action="ri-save-latency"]');
  const status = slot.querySelector('[data-slot="save-status"]');
  if (!btn) return;
  // Registros ya guardados de este resultado: un reintento tras una falla
  // parcial no duplica los que sí entraron (los registros son append-only).
  let saved = 0;
  btn.addEventListener('click', async () => {
    const cuenta = currentAccount();
    if (!cuenta) {
      if (status) status.textContent = 'Falta el número de cuenta: confírmala antes de guardar.';
      return;
    }
    const payloads = buildLatencyPingPayloads(data);
    if (!payloads.length) {
      if (status) status.textContent = 'No hay destinos medidos para guardar.';
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    try {
      // Mismo mecanismo que el resto de pruebas: POST /ping-tests con el
      // taskId de la visita en curso (withVisitContext lo resuelve).
      while (saved < payloads.length) {
        await WifixAPI.createPingTest(cuenta, payloads[saved]);
        saved++;
      }
      btn.textContent = 'Guardado';
      btn.classList.add('ok');
      if (status) status.textContent = `${payloads.length} mediciones guardadas en la cuenta ${cuenta}.`;
    } catch (err) {
      console.error('[Wifix] red-interna latencia (guardar):', err);
      btn.disabled = false;
      btn.textContent = 'Reintentar guardado';
      if (status) status.textContent = `No se pudo guardar: ${(err && err.message) || 'error desconocido'}.`;
    }
  });
}

// ============================================================================
// Red Interna (campos 20-21) — dispositivos WiFi y cambio de SSID/contraseña
// (simulados: integración con el router pendiente). El campo 19 (equipos LAN
// por DHCP simulado) se reemplazó por el módulo medido Dispositivos conectados.
// ============================================================================

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

// `measured: true` = módulo medido desde el teléfono (Wifix Remote); el resto
// sigue simulado y va bajo el aviso de datos simulados.
const RED_ITEMS = [
  { id: 'ri-sat', measured: true, icon: SERVICIO_ICONS.metrics, title: 'Saturación de canal',
    load: async () => riShellHtml('sat'), onMount: (body) => { riMount('sat', body); } },
  { id: 'ri-devices', measured: true, icon: SERVICIO_ICONS.lan, title: 'Dispositivos conectados',
    load: async () => riShellHtml('devices'), onMount: (body) => { riMount('devices', body); } },
  { id: 'ri-nearby', measured: true, icon: SERVICIO_ICONS.wifi, title: 'Redes cercanas',
    load: async () => riShellHtml('nearby'), onMount: (body) => { riMount('nearby', body); } },
  { id: 'ri-latency', measured: true, icon: TOOL_ICONS.ping, title: 'Latencia',
    load: async () => riShellHtml('latency'), onMount: (body) => { riMount('latency', body); } },
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
  // Los resultados medidos son de la visita: al cambiar de cuenta se descartan.
  riResetForAccount(cuenta);

  // Arriba, los 4 módulos medidos desde el teléfono (reales en el APK). Abajo,
  // los campos 20-21 (dispositivos WiFi y cambio de SSID), que siguen
  // simulados: un solo aviso, justo encima de ellos.
  const itemHtml = (item) => `
    <div class="servicio-item" data-id="${item.id}">
      <button class="servicio-head" type="button" aria-expanded="false" aria-controls="red-body-${item.id}">
        <div class="servicio-icon">${item.icon}</div>
        <div class="servicio-title">${escapeHtml(item.title)}</div>
        <div class="servicio-chev">${SERVICIO_ICONS.chev}</div>
      </button>
      <div class="servicio-body" id="red-body-${item.id}">
        <div class="servicio-body-inner" data-slot="body"><div class="detail-loading">Toca para cargar…</div></div>
      </div>
    </div>`;
  const medidos = RED_ITEMS.filter(item => item.measured);
  const simulados = RED_ITEMS.filter(item => !item.measured);
  redList.innerHTML =
    `<h3 class="ri-group-title">Diagnóstico de la red del cliente</h3>` + medidos.map(itemHtml).join('') +
    `<h3 class="ri-group-title ri-group-sep">Configuración del router</h3>` + mockNotice() + simulados.map(itemHtml).join('');

  redList.querySelectorAll('.servicio-item').forEach(node => {
    const id = node.dataset.id;
    const item = RED_ITEMS.find(x => x.id === id);
    const head = node.querySelector('.servicio-head');
    const body = node.querySelector('[data-slot="body"]');

    head.addEventListener('click', async () => {
      const wasOpen = node.classList.contains('open');
      node.classList.toggle('open');
      head.setAttribute('aria-expanded', wasOpen ? 'false' : 'true');
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

// ============================================================================
// TEST DE VELOCIDAD — DISPOSITIVO EXTERNO (SIMULADO)
// ----------------------------------------------------------------------------
// El speedtest ya no lo mide la app: lo mide un dispositivo Android dedicado
// del técnico (conector de hasta 10 Gb/s) y el resultado se carga aquí. Hasta
// definir la conexión real, un driver SIMULADO produce valores realistas
// (plan del cliente ± variación). Todo el flujo lleva el badge "Simulado" y lo
// guardado va marcado source:'external-device', simulated:true.
// El motor nativo anterior (NetworkTools / Ookla) quedó desconectado de la UI.
// ============================================================================

/** Plan por defecto si no hay perfil validado con velocidad contratada (simétrico). */
const EXT_SPEED_FALLBACK_PLAN = Object.freeze({ downMbps: 300, upMbps: 300 });

/** Datos del medidor simulado. */
const EXT_SPEED_SIM_DEVICE = Object.freeze({
  deviceId: 'XTM10G-SIM-0001',
  deviceName: 'Medidor Xtrim 10G',
  deviceModel: 'XT-SPEED-10G',
  firmware: '1.0.0-sim',
  portSpeedMbps: 10000,
  connection: 'Bluetooth (simulado)',
});

/** Plan contratado del cliente de la cuenta actual, si se conoce. */
function _extSpeedPlan() {
  const cuenta = currentAccount();
  const p = validatedProfile && validatedAccount === cuenta ? validatedProfile : null;
  const plan = contractedPlanMbps(p);
  const down = plan.down === null ? NaN : plan.down;
  const up = plan.up === null ? NaN : plan.up;
  if (Number.isFinite(down) && down > 0 && Number.isFinite(up) && up > 0) {
    return { downMbps: down, upMbps: up, known: true };
  }
  return { downMbps: EXT_SPEED_FALLBACK_PLAN.downMbps, upMbps: EXT_SPEED_FALLBACK_PLAN.upMbps, known: false };
}

/** Resultado simulado realista: plan ± variación, latencia/jitter de LAN. */
function _extSpeedSimulatedResult(plan, rand = Math.random) {
  const r1 = (x) => Math.round(x * 10) / 10;
  return {
    downloadMbps: r1(plan.downMbps * (0.93 + rand() * 0.1)),   // 93 %–103 % del plan
    uploadMbps: r1(plan.upMbps * (0.92 + rand() * 0.1)),       // 92 %–102 % del plan
    latencyMs: r1(2.5 + rand() * 6),                          // 2.5–8.5 ms
    jitterMs: r1(0.2 + rand() * 1.6),                         // 0.2–1.8 ms
    packetLossPercent: 0,
    linkSpeedMbps: EXT_SPEED_SIM_DEVICE.portSpeedMbps,
    measuredAt: new Date().toISOString(),
  };
}

// TODO(dispositivo-real): reemplazar este driver por la conexión real con el
// medidor (Bluetooth LE / USB-OTG / Wi-Fi Direct: a definir). La UI solo usa
// esta interfaz, así que el cambio queda acotado aquí:
//   connect({ signal })            → { deviceId, deviceName, deviceModel, firmware, portSpeedMbps, connection }
//   measure({ plan, onProgress })  → { downloadMbps, uploadMbps, latencyMs, jitterMs,
//                                      packetLossPercent, linkSpeedMbps, measuredAt }
//                                    onProgress({ phase: 'latency'|'download'|'upload'|'done', progress 0..1, mbps? })
//   disconnect()
// Al conectar el real, `simulated` pasa a false y el badge desaparece solo.
const extSpeedDriver = {
  simulated: true,
  async connect() {
    await new Promise(r => setTimeout(r, 1400));   // "buscando…"
    return Object.assign({}, EXT_SPEED_SIM_DEVICE);
  },
  async measure({ plan, onProgress }) {
    const final = _extSpeedSimulatedResult(plan);
    const report = typeof onProgress === 'function' ? onProgress : () => {};
    const phases = [
      { phase: 'latency', ms: 900 },
      { phase: 'download', ms: 2600, target: final.downloadMbps },
      { phase: 'upload', ms: 2200, target: final.uploadMbps },
    ];
    for (const ph of phases) {
      const steps = Math.max(1, Math.round(ph.ms / 150));
      for (let i = 1; i <= steps; i++) {
        await new Promise(r => setTimeout(r, 150));
        const progress = i / steps;
        // Rampa tipo TCP: sube rápido y se estabiliza cerca del valor final.
        const mbps = ph.target ? Math.round(ph.target * (1 - Math.pow(1 - progress, 3)) * 10) / 10 : undefined;
        report({ phase: ph.phase, progress, mbps });
      }
    }
    report({ phase: 'done', progress: 1 });
    return final;
  },
  async disconnect() { /* simulado: nada que cerrar */ },
};

/** taskId de la visita en curso (visita pendiente de /visits), si ya se conoce. */
function _extSpeedCurrentTaskId() {
  return peekCurrentVisitTaskId(currentAccount());
}

/**
 * Payload para WifixAPI.createSpeedtest (POST /speedtests, contrato
 * SpeedtestInput): source 'external-device', simulated, deviceName/deviceId,
 * measuredAt y taskId (visita en curso) son campos propios. Bajada/subida no
 * pueden superar 10000 Mbps (tope del dispositivo). `notes` queda como texto
 * legible para quien lea el registro (modelo y enlace no tienen campo propio).
 */
const EXT_SPEED_MAX_MBPS = 10000;
function buildExternalSpeedtestPayload(result, device, opts = {}) {
  const taskId = opts.taskId || null;
  const simulated = opts.simulated !== false;
  const linkGbps = (result.linkSpeedMbps || device.portSpeedMbps) / 1000;
  const cap = (v) => Math.min(EXT_SPEED_MAX_MBPS, Math.max(0, Number(v) || 0));
  const notes = [
    `${simulated ? 'Medición simulada' : 'Medición'} con ${device.deviceName} (${device.deviceModel})`,
    `enlace ${linkGbps} Gb/s`,
    opts.planKnown === false ? 'plan del cliente no disponible: se usó un plan de referencia' : null,
  ].filter(Boolean).join(' · ');
  const payload = {
    source: 'external-device',
    simulated,
    deviceName: device.deviceName,
    deviceId: device.deviceId,
    downloadMbps: cap(result.downloadMbps),
    uploadMbps: cap(result.uploadMbps),
    latencyMs: result.latencyMs,
    jitterMs: result.jitterMs,
    packetLossPercent: result.packetLossPercent,
    measuredAt: result.measuredAt,
    notes,
  };
  if (taskId) payload.taskId = taskId;
  return payload;
}

function _extSimBadge() {
  return extSpeedDriver.simulated
    ? '<span class="sim-badge" title="Dispositivo y resultados simulados: la conexión real con el medidor está pendiente">Simulado</span>'
    : '';
}

function externalSpeedtestHtml() {
  const plan = _extSpeedPlan();
  return `
    <div class="tool-form ext-speed" data-tool="external-speedtest" data-state="idle">
      <div class="ext-speed-head">
        <span class="ext-speed-title">Medición con dispositivo externo</span>
        ${_extSimBadge()}
      </div>
      <p class="form-hint">
        La velocidad la mide tu medidor dedicado (puerto de hasta 10 Gb/s) conectado al equipo del cliente;
        el resultado se carga en Wifix.
        Plan de referencia: <strong>${escapeHtml(_fmtNum(plan.downMbps, 1))} ↓ / ${escapeHtml(_fmtNum(plan.upMbps, 1))} ↑ Mbps</strong>${plan.known ? '' : ' (sin perfil del cliente: valor de referencia)'}.
      </p>

      <div class="ext-speed-device" data-slot="device" aria-live="polite">
        <div class="ext-speed-device-state" data-slot="device-state">
          <span class="ext-dot is-off" aria-hidden="true"></span>
          <span>Sin dispositivo conectado</span>
        </div>
        <dl class="ext-speed-device-info" data-slot="device-info" hidden></dl>
      </div>

      <div class="ext-speed-actions">
        <button type="button" class="save-btn" data-action="ext-connect">Conectar dispositivo de medición</button>
        <button type="button" class="save-btn" data-action="ext-measure" hidden>Medir velocidad</button>
        <button type="button" class="add-row-btn" data-action="ext-disconnect" hidden>Desconectar</button>
      </div>

      <div class="ext-speed-progress-wrap" data-slot="progress-wrap" hidden>
        <div class="ext-speed-progress" role="progressbar" aria-label="Progreso de la medición"
          aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" data-slot="progress">
          <div class="ext-speed-progress-bar" data-slot="bar"></div>
        </div>
        <div class="ext-speed-phase" data-slot="phase" role="status" aria-live="polite"></div>
      </div>

      <div class="ext-speed-gauges" data-slot="gauges" hidden>
        <div class="ext-speed-gauge">
          <span class="ext-speed-gauge-label">Bajada</span>
          <span class="ext-speed-gauge-value" data-slot="dl">—</span>
          <span class="ext-speed-gauge-unit">Mbps</span>
        </div>
        <div class="ext-speed-gauge">
          <span class="ext-speed-gauge-label">Subida</span>
          <span class="ext-speed-gauge-value" data-slot="ul">—</span>
          <span class="ext-speed-gauge-unit">Mbps</span>
        </div>
      </div>

      <dl class="ext-speed-result" data-slot="result" hidden></dl>

      <label class="form-row" data-slot="notes-row" hidden><span class="form-label">Notas (opcional)</span>
        <textarea data-field="notes" rows="2"></textarea></label>
      <button type="button" class="save-btn" data-action="ext-save" hidden>Guardar resultado</button>
      <div class="ext-speed-feedback" data-slot="feedback" role="status" aria-live="polite"></div>
    </div>`;
}

/** Activa el flujo conectar → medir → guardar sobre el HTML de externalSpeedtestHtml. */
function wireExternalSpeedtest(formEl) {
  if (!formEl || formEl.dataset.extWired === '1') return;
  formEl.dataset.extWired = '1';
  const $ = (slot) => formEl.querySelector(`[data-slot="${slot}"]`);
  const btn = (action) => formEl.querySelector(`[data-action="${action}"]`);
  const connectBtn = btn('ext-connect');
  const measureBtn = btn('ext-measure');
  const disconnectBtn = btn('ext-disconnect');
  const saveBtn = btn('ext-save');

  let device = null;
  let result = null;
  let plan = null;
  let busy = false;
  const PHASE_TEXT = {
    latency: 'Midiendo latencia y jitter…',
    download: 'Midiendo bajada…',
    upload: 'Midiendo subida…',
    done: 'Medición completa.',
  };
  // Tramos de la barra por fase (latencia 0–15, bajada 15–60, subida 60–100).
  const PHASE_RANGE = { latency: [0, 15], download: [15, 60], upload: [60, 100], done: [100, 100] };

  function setState(state) { formEl.dataset.state = state; }
  function setDeviceState(text, dotClass) {
    $('device-state').innerHTML = `<span class="ext-dot ${dotClass}" aria-hidden="true"></span><span>${escapeHtml(text)}</span>`;
  }
  function setProgress(pct) {
    const v = Math.max(0, Math.min(100, Math.round(pct)));
    $('bar').style.width = `${v}%`;
    $('progress').setAttribute('aria-valuenow', String(v));
  }
  function feedback(text, kind) {
    const el = $('feedback');
    el.textContent = text || '';
    el.className = `ext-speed-feedback${kind ? ' is-' + kind : ''}`;
  }
  function resetResult() {
    result = null;
    $('result').hidden = true;
    $('result').innerHTML = '';
    $('gauges').hidden = true;
    $('dl').textContent = '—';
    $('ul').textContent = '—';
    $('progress-wrap').hidden = true;
    $('notes-row').hidden = true;
    saveBtn.hidden = true;
    saveBtn.disabled = false;
    saveBtn.textContent = 'Guardar resultado';
    setProgress(0);
  }

  connectBtn.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    connectBtn.disabled = true;
    feedback('');
    setState('searching');
    setDeviceState('Buscando dispositivo de medición…', 'is-searching');
    try {
      device = await extSpeedDriver.connect();
      setState('connected');
      setDeviceState('Conectado', 'is-on');
      const info = $('device-info');
      info.innerHTML = `
        <div><dt>Dispositivo</dt><dd>${escapeHtml(device.deviceName)}</dd></div>
        <div><dt>Modelo</dt><dd>${escapeHtml(device.deviceModel)}</dd></div>
        <div><dt>ID</dt><dd class="mono">${escapeHtml(device.deviceId)}</dd></div>
        <div><dt>Puerto</dt><dd>${escapeHtml(_fmtNum(device.portSpeedMbps / 1000, 1))} Gb/s</dd></div>
        <div><dt>Conexión</dt><dd>${escapeHtml(device.connection || '—')}</dd></div>`;
      info.hidden = false;
      connectBtn.hidden = true;
      measureBtn.hidden = false;
      disconnectBtn.hidden = false;
      measureBtn.focus();
    } catch (err) {
      console.error('[Wifix] medidor externo (conectar):', err);
      device = null;
      setState('idle');
      setDeviceState('No se encontró el dispositivo', 'is-error');
      feedback((err && err.message) || 'No se pudo conectar con el medidor.', 'error');
    } finally {
      connectBtn.disabled = false;
      busy = false;
    }
  });

  disconnectBtn.addEventListener('click', async () => {
    if (busy) return;
    try { await extSpeedDriver.disconnect(); } catch (_) { /* nada */ }
    device = null;
    resetResult();
    feedback('');
    setState('idle');
    setDeviceState('Sin dispositivo conectado', 'is-off');
    $('device-info').hidden = true;
    connectBtn.hidden = false;
    measureBtn.hidden = true;
    disconnectBtn.hidden = true;
    connectBtn.focus();
  });

  measureBtn.addEventListener('click', async () => {
    if (busy || !device) return;
    busy = true;
    resetResult();
    feedback('');
    plan = _extSpeedPlan();
    setState('measuring');
    measureBtn.disabled = true;
    disconnectBtn.disabled = true;
    measureBtn.textContent = 'Midiendo…';
    $('progress-wrap').hidden = false;
    $('gauges').hidden = false;
    let lastPhase = null;
    try {
      result = await extSpeedDriver.measure({
        plan,
        onProgress: (p) => {
          const range = PHASE_RANGE[p.phase] || [0, 100];
          setProgress(range[0] + (range[1] - range[0]) * (p.progress || 0));
          // El texto de fase se anuncia solo al cambiar (no en cada tick).
          if (p.phase !== lastPhase) { $('phase').textContent = PHASE_TEXT[p.phase] || ''; lastPhase = p.phase; }
          if (p.phase === 'download' && p.mbps !== undefined) $('dl').textContent = _fmtNum(p.mbps, 1);
          if (p.phase === 'upload' && p.mbps !== undefined) $('ul').textContent = _fmtNum(p.mbps, 1);
        },
      });
      setState('result');
      $('dl').textContent = _fmtNum(result.downloadMbps, 1);
      $('ul').textContent = _fmtNum(result.uploadMbps, 1);
      const pctDown = plan.downMbps ? Math.round((result.downloadMbps / plan.downMbps) * 100) : null;
      $('result').innerHTML = `
        <div><dt>Bajada</dt><dd><strong>${escapeHtml(_fmtNum(result.downloadMbps, 1))} Mbps</strong>${pctDown !== null ? ` (${pctDown} % del plan)` : ''}</dd></div>
        <div><dt>Subida</dt><dd><strong>${escapeHtml(_fmtNum(result.uploadMbps, 1))} Mbps</strong></dd></div>
        <div><dt>Latencia</dt><dd>${escapeHtml(_fmtNum(result.latencyMs, 1))} ms</dd></div>
        <div><dt>Jitter</dt><dd>${escapeHtml(_fmtNum(result.jitterMs, 1))} ms</dd></div>
        <div><dt>Pérdida</dt><dd>${escapeHtml(_fmtNum(result.packetLossPercent, 1))} %</dd></div>
        <div><dt>Enlace</dt><dd>${escapeHtml(_fmtNum(result.linkSpeedMbps / 1000, 1))} Gb/s (puerto del medidor)</dd></div>
        <div><dt>Medido</dt><dd>${dateTimeHtml(result.measuredAt, { relative: false })}</dd></div>
        ${_extSpeedCurrentTaskId() ? `<div><dt>Tarea</dt><dd>${escapeHtml(_extSpeedCurrentTaskId())}</dd></div>` : ''}`;
      $('result').hidden = false;
      $('notes-row').hidden = false;
      saveBtn.hidden = false;
      saveBtn.focus();
    } catch (err) {
      console.error('[Wifix] medidor externo (medir):', err);
      setState('connected');
      $('phase').textContent = '';
      feedback((err && err.message) || 'La medición falló. Vuelve a intentarlo.', 'error');
    } finally {
      measureBtn.disabled = false;
      disconnectBtn.disabled = false;
      measureBtn.textContent = result ? 'Medir de nuevo' : 'Medir velocidad';
      busy = false;
    }
  });

  saveBtn.addEventListener('click', async () => {
    if (busy || !result || !device) return;
    const cuenta = currentAccount();
    if (!cuenta) {
      feedback('Falta el número de cuenta: confírmala antes de guardar.', 'error');
      return;
    }
    busy = true;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Guardando…';
    // Visita en curso: workOrder de la visita pendiente (o nada: el backend
    // asocia por horario). Nunca el TASK/… local del panel NAP.
    const taskId = await resolveCurrentVisitTaskId(cuenta);
    const payload = buildExternalSpeedtestPayload(result, device, {
      taskId,
      simulated: extSpeedDriver.simulated,
      planKnown: plan ? plan.known : undefined,
    });
    const notas = nonEmpty(formEl.querySelector('[data-field="notes"]').value);
    if (notas) payload.notes = `${payload.notes} · ${notas}`;
    try {
      await WifixAPI.createSpeedtest(cuenta, payload);
      setState('saved');
      saveBtn.textContent = 'Guardado';
      feedback(`Resultado guardado en la cuenta ${cuenta}${extSpeedDriver.simulated ? ' (marcado como simulado)' : ''}.`, 'ok');
    } catch (err) {
      console.error('[Wifix] medidor externo (guardar):', err);
      saveBtn.disabled = false;
      saveBtn.textContent = 'Reintentar guardado';
      feedback(`No se pudo guardar: ${(err && err.message) || 'error desconocido'}.`, 'error');
    } finally {
      busy = false;
    }
  });
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
  // Lo mide un dispositivo externo (hoy simulado); guarda con su propio flujo
  // (wireExternalSpeedtest → WifixAPI.createSpeedtest), no con el botón genérico.
  { id: 'speedtest', title: 'Test de Velocidad (dispositivo externo)', icon: TOOL_ICONS.speed,
    render: externalSpeedtestHtml, wire: wireExternalSpeedtest },
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
  if (typeof item.wire === 'function') {
    item.wire(formEl);
    return;
  }

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
          const base64 = await readFileAsBase64(file);

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

// ============================================================================
// Equipo a instalar — Validación de capacidad vs plan contratado
// ----------------------------------------------------------------------------
// Instalaciones, Migraciones y Visita técnica. El técnico escanea la etiqueta
// del equipo que va a instalar (mismo escáner que Equipos Retirados: ML Kit
// barcode + OCR, serial editable), confirma el modelo exacto del catálogo y se
// compara el plan contratado con la capacidad Ethernet/WiFi del equipo.
//
//   ok           → verde, módulo completado.
//   unknown_plan → ámbar, no bloquea (el backend deja la alerta "sin plan").
//   blocked      → alerta roja con el mensaje del servidor. El flujo de la
//                  categoría queda BLOQUEADO para esa cuenta: ningún registro
//                  de la visita se guarda (guardia en WifixAPI, ver
//                  deviceRecordGuard) hasta validar otro equipo apto. Única
//                  acción en el módulo: "Escanear otro equipo".
//
// La regla vive una sola vez en api.js (WifixAPI.evaluateDeviceCapacity) y se
// usa acá solo como vista previa: el veredicto del servidor manda.
// ============================================================================

const DEVICE_MODULES = Object.freeze(['instalaciones', 'migraciones', 'visitas']);
/** Una validación del servidor más vieja que esto no condiciona la visita de hoy. */
const DEVICE_SYNC_MAX_AGE_MS = 12 * 3600000;
const DEVICE_CATALOG_TTL_MS = 15 * 60 * 1000;
const DEVICE_OTHER_MODEL = '__other__';
/** Mensaje corto de la guardia: se muestra en el botón de guardar que se intentó usar. */
const DEVICE_BLOCK_GUARD_MSG = 'Bloqueado: el equipo a instalar no soporta el plan. Escanea otro equipo en «Equipo a instalar».';

/**
 * Prefijos de serial que el contrato da como pista de marca, además de los del
 * catálogo. Las ONT Huawei a veces traen el serial en hex: 48575443 = "HWTC".
 */
const DEVICE_SERIAL_PREFIX_ALIASES = Object.freeze({ '48575443': 'HWTC' });

const detailEquipo = document.getElementById('detailEquipo');
const equipoChip = document.getElementById('equipoChip');
const equipoBody = document.getElementById('equipoBody');
const backFromEquipo = document.getElementById('backFromEquipo');

/** Estado de la validación por categoría+cuenta: { status, validation, at }. */
const _devStates = new Map();
let _devCatalog = { items: null, at: 0, promise: null };
/** Borrador de la pantalla abierta (serial, modelo, plan, envío). */
let _dev = null;

function devUsesModule(category = currentCategory) {
  return DEVICE_MODULES.includes(category);
}

function devKey(account, category) {
  return `${category}|${String(account || '').trim()}`;
}

function devStateFor(account, category = currentCategory) {
  return _devStates.get(devKey(account, category)) || null;
}

function devStatusFromResult(result) {
  if (result === 'ok') return 'ok';
  if (result === 'blocked') return 'blocked';
  if (result === 'unknown_plan') return 'unknown_plan';
  return null;
}

/** Guarda el veredicto (respuesta del POST o del historial) y repinta indicadores. */
function devApplyValidation(account, category, validation) {
  const status = devStatusFromResult(validation && validation.result);
  if (!status || !account) return null;
  const at = Date.parse(validation.createdAt) || Date.now();
  const st = { status, validation, at };
  _devStates.set(devKey(account, category), st);
  devRefreshIndicators();
  return st;
}

/**
 * Guardia de registros de la visita (WifixAPI.setRecordGuard). Devuelve el
 * mensaje de bloqueo o null. Se evalúa con la categoría abierta: en
 * Cancelaciones no hay equipo a instalar y nunca bloquea.
 */
function deviceRecordGuard(accountNumber) {
  if (!devUsesModule()) return null;
  const st = devStateFor(accountNumber);
  return st && st.status === 'blocked' ? DEVICE_BLOCK_GUARD_MSG : null;
}
WifixAPI.setRecordGuard(deviceRecordGuard);

/**
 * Última validación vigente de la categoría en el historial de la cuenta.
 * Pura. Si el item no trae `category` se acepta (supuesto: el backend la
 * devuelve; si no, manda la más reciente). Solo cuenta lo de las últimas 12 h.
 */
function devLatestFromHistory(items, category, now = Date.now()) {
  const list = (Array.isArray(items) ? items : [])
    .filter((v) => v && devStatusFromResult(v.result))
    .filter((v) => !v.category || v.category === category)
    .map((v) => ({ v, t: Date.parse(v.createdAt) }))
    .filter((x) => Number.isFinite(x.t) && now - x.t <= DEVICE_SYNC_MAX_AGE_MS)
    .sort((a, b) => b.t - a.t);
  return list.length ? list[0].v : null;
}

/**
 * Trae del servidor el estado vigente: un bloqueo no se esquiva recargando la
 * app ni reconfirmando la cuenta. No pisa un veredicto local más reciente.
 */
async function devSyncFromServer(account, category = currentCategory) {
  if (!account || !devUsesModule(category)) return null;
  let res;
  try {
    res = await WifixAPI.listDeviceValidations(account);
  } catch (err) {
    console.warn('[Wifix] historial de validación de equipo:', err);
    return null;
  }
  const latest = devLatestFromHistory(res && res.items, category);
  if (!latest) return null;
  const local = devStateFor(account, category);
  const t = Date.parse(latest.createdAt) || 0;
  if (local && local.at >= t) return local;
  const st = devApplyValidation(account, category, latest);
  if (_dev && _dev.account === account && _dev.category === category && detailEquipo &&
      detailEquipo.classList.contains('open')) {
    devRender();
  }
  return st;
}

// --- Catálogo -----------------------------------------------------------------
function devLoadCatalog(force) {
  const c = _devCatalog;
  if (!force && c.items && Date.now() - c.at < DEVICE_CATALOG_TTL_MS) return Promise.resolve(c.items);
  if (!force && c.promise) return c.promise;
  const promise = WifixAPI.getDeviceCatalog()
    .then((r) => {
      const items = r && Array.isArray(r.items) ? r.items.filter((d) => d && d.model) : [];
      _devCatalog = { items, at: Date.now(), promise: null };
      return items;
    })
    .catch((err) => {
      _devCatalog = Object.assign({}, _devCatalog, { promise: null });
      throw err;
    });
  _devCatalog = Object.assign({}, c, { promise });
  return promise;
}

// --- Lógica pura: serial, marca y modelo ---------------------------------------
function devNormalize(s) {
  return String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Códigos que identifican el modelo en la etiqueta: tokens con letras y
 * dígitos ('F670L', 'HG8145X6', 'F8605P', 'B2000', 'AX3') más el par
 * adyacente ('ZXHNF670L', 'HUR2001'). Se descartan versiones ('V9') y
 * genéricos ('WIFI 6').
 */
function devModelTokens(item) {
  const raw = `${item.model || ''} ${item.displayName || ''}`.toUpperCase()
    .split(/[\s\-()/,.]+/).filter(Boolean);
  const useful = (t) => t.length >= 3 && /[A-Z]/.test(t) && /\d/.test(t) && !/^V\d+$/.test(t) && !/^WIFI\d*$/.test(t);
  const out = new Set();
  raw.forEach((t, i) => {
    const n = devNormalize(t);
    if (useful(n)) out.add(n);
    if (i + 1 < raw.length) {
      const pair = devNormalize(t + raw[i + 1]);
      if (pair.length >= 5 && useful(pair) && !/^WIFI/.test(devNormalize(raw[i + 1]))) out.add(pair);
    }
  });
  return [...out];
}

/**
 * Modelos cuyo código aparece en el texto leído (OCR o códigos). Devuelve
 * [{ model, score }] por puntaje: el token más largo que coincide gana, así
 * 'F6600P' le gana a 'F6600' y éste a 'F660'.
 */
function devMatchModelsFromText(lines, catalog) {
  const text = (Array.isArray(lines) ? lines : []).map(devNormalize).filter(Boolean).join('|');
  if (!text) return [];
  return (catalog || [])
    .map((item) => {
      const score = devModelTokens(item).reduce((best, tok) => (text.includes(tok) && tok.length > best ? tok.length : best), 0);
      return { model: item.model, score };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score);
}

/** Modelo a preseleccionar: solo si la mejor coincidencia es única. */
function devPreselectModel(matches) {
  if (!matches || !matches.length) return null;
  if (matches.length > 1 && matches[1].score === matches[0].score) return null;
  return matches[0].model;
}

/** Prefijo del serial reconocido en el catálogo (o null). */
function devSerialPrefix(serial, catalog) {
  let s = devNormalize(serial);
  if (!s) return null;
  for (const [hex, alias] of Object.entries(DEVICE_SERIAL_PREFIX_ALIASES)) {
    if (s.startsWith(hex)) s = alias + s.slice(hex.length);
  }
  const prefixes = new Set();
  (catalog || []).forEach((d) => (d.serialPrefixes || []).forEach((p) => prefixes.add(devNormalize(p))));
  const hit = [...prefixes].filter((p) => p && s.startsWith(p)).sort((a, b) => b.length - a.length);
  return hit[0] || null;
}

/** Equipos del catálogo cuya marca coincide con el prefijo del serial. */
function devModelsForPrefix(prefix, catalog) {
  if (!prefix) return [];
  return (catalog || []).filter((d) => (d.serialPrefixes || []).some((p) => devNormalize(p) === prefix));
}

/**
 * Lista corta: primero lo leído en la etiqueta (por puntaje), luego la marca
 * del prefijo. Vacía = no hay pista (la UI muestra todos).
 */
function devShortlist(catalog, serial, textMatches) {
  const byModel = new Map((catalog || []).map((d) => [d.model, d]));
  const out = [];
  const seen = new Set();
  (textMatches || []).forEach((m) => {
    const d = byModel.get(m.model);
    if (d && !seen.has(d.model)) { seen.add(d.model); out.push(d); }
  });
  devModelsForPrefix(devSerialPrefix(serial, catalog), catalog).forEach((d) => {
    if (!seen.has(d.model)) { seen.add(d.model); out.push(d); }
  });
  return out;
}

/**
 * Serial a partir de lo leído (códigos de barras o líneas de OCR). Reutiliza la
 * limpieza de Equipos Retirados (extractSerial: rótulos SN/GPON SN/D-SN fuera).
 * Prioriza el candidato con prefijo del catálogo o patrón distintivo conocido;
 * si no hay, mejor esfuerzo marcado para verificar. Nunca propone como serial
 * un texto que es el nombre del modelo.
 */
function devPickSerial(rawValues, catalog) {
  const raw = (Array.isArray(rawValues) ? rawValues : []).map((v) => String(v ?? '')).filter(Boolean);
  if (!raw.length) return { serial: '', confidence: 'none', candidates: [] };
  const base = extractSerial(raw, '');
  const modelTokens = new Set((catalog || []).flatMap(devModelTokens).filter((t) => t.length >= 4));
  const looksLikeModel = (c) => [...modelTokens].some((t) => c.includes(t));
  const cleaned = [...new Set(base.cleaned.map(devNormalize))].filter((c) => c.length >= 8 && c.length <= 20 && !looksLikeModel(c));
  const distinctive = Object.keys(SERIAL_PATTERNS).filter(isDistinctivePattern).map((n) => SERIAL_PATTERNS[n].re);
  const strong = cleaned.filter((c) => devSerialPrefix(c, catalog) || distinctive.some((re) => re.test(c)));
  if (strong.length) return { serial: strong[0], confidence: 'ok', candidates: strong.slice(0, 5) };
  const weak = (base.candidates || []).map(devNormalize).filter((c) => c.length >= 4 && !looksLikeModel(c));
  if (weak.length) return { serial: weak[0], confidence: 'warn', candidates: weak.slice(0, 5) };
  return { serial: '', confidence: 'none', candidates: [] };
}

/** Plan contratado del perfil: { mbps, simulated } (mbps null = sin dato). */
function devPlanFromProfile(profile) {
  const n = profile ? Number(profile.contractedDownloadMbps) : NaN;
  const mbps = Number.isFinite(n) && n > 0 ? n : null;
  const simulated = !!(profile && profile.sources && profile.sources.contractedDownloadMbps === 'MOCK');
  return { mbps, simulated };
}

/** Vista previa con la misma regla del servidor. */
function evaluateDeviceCapacity(device, planMbps) {
  return WifixAPI.evaluateDeviceCapacity(device, planMbps);
}

/** Cuerpo del POST /accounts/:n/device-validations (taskId lo agrega api.js). */
function buildDeviceValidationPayload(dev) {
  const serial = devNormalize(dev && dev.serial);
  const model = dev && dev.model === DEVICE_OTHER_MODEL
    ? String(dev.otherModel || '').trim()
    : String((dev && dev.model) || '').trim();
  if (serial.length < 4 || !model || !devUsesModule(dev && dev.category)) return null;
  const body = { serial, model, category: dev.category };
  if (['barcode', 'ocr', 'manual'].includes(dev.serialSource)) body.serialSource = dev.serialSource;
  return body;
}

// --- Captura de etiqueta (compartida con Equipos Retirados e ISP Monitor) -------
/** Lee un File de imagen como base64 puro (sin el prefijo dataURL). */
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      resolve(typeof result === 'string' ? result.split(',').pop() : '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// --- Indicadores fuera del módulo (tarjeta + banner del menú) -----------------
const DEVICE_STATUS_TEXT = Object.freeze({
  ok: 'Validado',
  unknown_plan: 'Validado con aviso',
  blocked: 'Bloqueado',
});

// Se llama también al cargar app.js (invalidateAccountCache), antes de que se
// declaren las constantes de esta sección: por eso busca el banner en el DOM
// y no toca el estado si no hay cuenta confirmada.
function devRefreshIndicators() {
  const deviceBlockBanner = document.getElementById('deviceBlockBanner');
  const account = validatedAccount || '';
  const st = account && devUsesModule() ? devStateFor(account) : null;
  const pill = subscreen.querySelector('[data-slot="equipo-status"]');
  if (pill) {
    if (st) {
      pill.textContent = DEVICE_STATUS_TEXT[st.status];
      pill.className = `sub-card-status is-${st.status}`;
      pill.hidden = false;
    } else {
      pill.textContent = '';
      pill.className = 'sub-card-status';
      pill.hidden = true;
    }
  }
  if (!deviceBlockBanner) return;
  if (st && st.status === 'blocked') {
    const v = st.validation || {};
    deviceBlockBanner.innerHTML = `
      <p class="device-block-banner-title">Flujo bloqueado: equipo no apto para el plan</p>
      <p class="device-block-banner-text">${escapeHtml(v.serial ? `Equipo ${v.serial}${v.model ? ` (${v.model})` : ''}. ` : '')}No se pueden guardar registros en ${escapeHtml(moduleLabel())} hasta validar otro equipo apto.</p>
      <button type="button" class="save-btn device-block-banner-btn" data-action="open-equipo">Escanear otro equipo</button>`;
    deviceBlockBanner.hidden = false;
    const btn = deviceBlockBanner.querySelector('[data-action="open-equipo"]');
    if (btn) btn.addEventListener('click', () => openEquipo());
  } else {
    deviceBlockBanner.innerHTML = '';
    deviceBlockBanner.hidden = true;
  }
}

// --- Render -------------------------------------------------------------------
function devFmtMbps(v) {
  const n = Number(v);
  return Number.isFinite(n) ? `${n.toLocaleString('es-EC')} Mbps` : '—';
}

function devWifiText(d) {
  if (!d) return '—';
  if (d.wifiStatus === 'none') return 'Sin WiFi';
  if (d.wifiStatus === 'disabled') return `${devFmtMbps(d.wifiMaxMbps)} (desactivado)`;
  return devFmtMbps(d.wifiMaxMbps);
}

function devSimBadge() {
  return ' <span class="source-badge" title="Dato simulado: la operadora todavía no expone el plan">simulado</span>';
}

function devCurrentModels(dev) {
  const catalog = (dev && dev.catalog) || [];
  const short = devShortlist(catalog, dev.serial, dev.textMatches);
  const showAll = dev.showAll || short.length === 0;
  const list = showAll ? catalog.slice() : short.slice();
  const sel = catalog.find((d) => d.model === dev.model);
  if (sel && !list.includes(sel)) list.unshift(sel);
  return { list, short, showAll };
}

function devSelectedDevice(dev) {
  if (!dev || !dev.model || dev.model === DEVICE_OTHER_MODEL) return null;
  return (dev.catalog || []).find((d) => d.model === dev.model) || null;
}

function devModelsHtml(dev) {
  if (dev.catalogError) {
    return `<div class="detail-error" role="alert">${escapeHtml(dev.catalogError)}
      <button type="button" class="save-btn outline dev-retry-btn" data-action="dev-retry-catalog">Reintentar</button></div>`;
  }
  if (!dev.catalog) return '<div class="detail-loading" role="status">Cargando catálogo de equipos…</div>';
  const { list, short, showAll } = devCurrentModels(dev);
  const suggested = new Set((dev.textMatches || []).map((m) => m.model));
  const prefix = devSerialPrefix(dev.serial, dev.catalog);
  let hint;
  if (!dev.catalog.length) {
    hint = 'El catálogo de equipos homologados está vacío: indica el modelo de la etiqueta.';
  } else if (short.length && !showAll) {
    hint = prefix
      ? `Modelos de la marca del serial (${escapeHtml(prefix)}…). Elige el modelo exacto de la etiqueta.`
      : 'Modelos leídos en la etiqueta. Confirma el modelo exacto.';
  } else if (devNormalize(dev.serial).length >= 4 && !short.length) {
    hint = 'El serial no permite reconocer la marca: elige el modelo exacto entre todos.';
  } else {
    hint = 'Elige el modelo exacto que figura en la etiqueta del equipo.';
  }
  const option = (d) => {
    const checked = dev.model === d.model;
    return `
      <label class="dev-model-option${checked ? ' is-selected' : ''}">
        <input type="radio" name="devModel" value="${escapeHtml(d.model)}"${checked ? ' checked' : ''}>
        <span class="dev-model-text">
          <span class="dev-model-name">${escapeHtml(d.displayName || d.model)}</span>
          <span class="dev-model-meta">${escapeHtml(d.brand || '—')} · ${escapeHtml(d.category || d.deviceType || '')}</span>
          <span class="dev-model-meta">Ethernet ${escapeHtml(devFmtMbps(d.ethernetMaxMbps))} · ${d.wifiStatus === 'none' ? 'Sin WiFi' : `WiFi ${escapeHtml(devWifiText(d))}`}</span>
        </span>
        ${suggested.has(d.model) ? '<span class="dev-model-tag">Leído en la etiqueta</span>' : ''}
      </label>`;
  };
  const other = dev.model === DEVICE_OTHER_MODEL;
  return `
    <fieldset class="dev-models">
      <legend class="form-label">Modelo exacto del equipo *</legend>
      <p class="form-note dev-models-hint">${hint}</p>
      <div class="dev-model-list">${list.map(option).join('')}
        <label class="dev-model-option dev-model-other${other ? ' is-selected' : ''}">
          <input type="radio" name="devModel" value="${DEVICE_OTHER_MODEL}"${other ? ' checked' : ''}>
          <span class="dev-model-text"><span class="dev-model-name">El modelo no está en la lista</span>
            <span class="dev-model-meta">Equipo no homologado: se registrará y quedará bloqueado</span></span>
        </label>
      </div>
      ${other ? `
      <label class="form-row dev-other-row">
        <span class="form-label">Modelo según la etiqueta *</span>
        <input type="text" data-field="devOtherModel" value="${escapeHtml(dev.otherModel || '')}"
          autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="80" placeholder="Ej. ROUTER TP-LINK ARCHER C6">
      </label>` : ''}
      ${!showAll && short.length < dev.catalog.length ? `
      <button type="button" class="save-btn outline dev-show-all" data-action="dev-show-all"
        aria-label="Ver todos los modelos del catálogo (${dev.catalog.length})">Ver todos los modelos (${dev.catalog.length})</button>` : ''}
    </fieldset>`;
}

/** Tiles plan vs equipo. `outcome` = vista previa o veredicto del servidor. */
function devCapacityTilesHtml({ device, planMbps, planSimulated, planLoading, outcome }) {
  const reasons = (outcome && outcome.reasons) || [];
  const failEth = reasons.some((r) => r.kind === 'ethernet');
  const failWifi = reasons.some((r) => r.kind === 'wifi');
  const evaluated = outcome && outcome.result !== 'unknown_plan' && !!device;
  const tile = (cls, label, value, sub) => `
    <div class="status-tile ${cls}">
      <span class="st-label">${label}</span>
      <span class="st-value">${value}</span>
      ${sub ? `<span class="st-sub">${sub}</span>` : ''}
    </div>`;
  let planValue;
  if (planLoading) planValue = 'Cargando…';
  else if (planMbps) planValue = escapeHtml(devFmtMbps(planMbps));
  else planValue = 'Sin dato';
  const planTile = `
    <div class="status-tile ${planMbps ? 'info' : 'warn'} dev-plan-tile">
      <span class="st-label">Plan contratado (bajada)${planSimulated ? devSimBadge() : ''}</span>
      <span class="st-value">${planValue}</span>
    </div>`;
  if (!device) {
    return `<div class="status-grid dev-capacity">${planTile}
      ${tile('muted', 'Ethernet del equipo', '—', outcome && reasons.some((r) => r.kind === 'not_in_catalog') ? 'No homologado' : 'Elige el modelo')}
      ${tile('muted', 'WiFi del equipo', '—', '')}</div>`;
  }
  const ethCls = !evaluated ? 'muted' : (failEth ? 'fail' : 'ok');
  const ethSub = !evaluated ? 'Sin comparar' : (failEth ? 'Menor que el plan' : 'Soporta el plan');
  let wifiCls;
  let wifiSub;
  if (device.wifiStatus !== 'enabled') {
    wifiCls = 'muted';
    wifiSub = 'No se evalúa';
  } else if (!evaluated) {
    wifiCls = 'muted';
    wifiSub = 'Sin comparar';
  } else {
    wifiCls = failWifi ? 'fail' : 'ok';
    wifiSub = failWifi ? 'Menor que el plan' : 'Soporta el plan';
  }
  return `<div class="status-grid dev-capacity">${planTile}
    ${tile(ethCls, 'Ethernet del equipo', escapeHtml(devFmtMbps(device.ethernetMaxMbps)), ethSub)}
    ${tile(wifiCls, `WiFi del equipo${device.wifiTech ? ` · ${escapeHtml(device.wifiTech)}` : ''}`, escapeHtml(devWifiText(device)), wifiSub)}</div>`;
}

const DEVICE_PREVIEW_TEXT = Object.freeze({
  ok: { cls: 'badge-resolved', text: 'Vista previa: apto' },
  blocked: { cls: 'badge-fail', text: 'Vista previa: no apto' },
  unknown_plan: { cls: 'badge-pending', text: 'Vista previa: sin plan para comparar' },
});

function devPreviewOutcome(dev) {
  if (!dev.model || (dev.model === DEVICE_OTHER_MODEL && !String(dev.otherModel || '').trim())) return null;
  return evaluateDeviceCapacity(devSelectedDevice(dev), dev.plan.mbps);
}

function devCapacityHtml(dev) {
  const outcome = devPreviewOutcome(dev);
  const preview = outcome ? DEVICE_PREVIEW_TEXT[outcome.result] : null;
  return `
    ${devCapacityTilesHtml({
      device: devSelectedDevice(dev),
      planMbps: dev.plan.mbps,
      planSimulated: dev.plan.simulated,
      planLoading: dev.plan.loading,
      outcome,
    })}
    ${dev.plan.error ? `<p class="form-note">${escapeHtml(dev.plan.error)}</p>` : ''}
    ${preview ? `<p class="dev-preview"><span class="event-badge ${preview.cls}">${preview.text}</span>
      <span class="dev-preview-note">El veredicto final lo da el servidor al validar.</span></p>` : ''}`;
}

function devMissingText(dev) {
  if (!dev.catalog) return 'Esperando el catálogo de equipos.';
  if (devNormalize(dev.serial).length < 4) return 'Falta el número de serie del equipo.';
  if (!dev.model) return 'Falta confirmar el modelo exacto.';
  if (dev.model === DEVICE_OTHER_MODEL && !String(dev.otherModel || '').trim()) return 'Escribe el modelo que figura en la etiqueta.';
  return '';
}

function devFormActionsHtml(dev) {
  const missing = devMissingText(dev);
  return `
    ${dev.postError ? `<div class="detail-error" role="alert">${escapeHtml(dev.postError)}</div>` : ''}
    <button type="button" class="save-btn" data-action="dev-validate"${missing || dev.posting ? ' disabled' : ''}
      ${dev.posting ? 'aria-busy="true"' : ''} aria-describedby="devValidateHint">${dev.posting ? 'Validando…' : (dev.postError ? 'Reintentar validación' : 'Validar equipo')}</button>
    <p class="form-note" id="devValidateHint">${escapeHtml(missing || 'Se registra la validación (también si el equipo resulta no apto).')}</p>`;
}

const DEVICE_VERDICT = Object.freeze({
  ok: { cls: 'is-ok', title: 'Equipo validado — módulo completado' },
  unknown_plan: { cls: 'is-warn', title: 'Validado con aviso: plan desconocido' },
  blocked: { cls: 'is-blocked', title: 'Equipo bloqueado: no soporta el plan contratado' },
});

/** Tarjeta del veredicto del servidor (ok / unknown_plan / blocked). */
function devVerdictCardHtml(validation) {
  const v = validation || {};
  const meta = DEVICE_VERDICT[v.result];
  if (!meta) return '';
  const serial = v.serial ? `Serie ${escapeHtml(v.serial)}` : '';
  const model = v.device ? escapeHtml(v.device.displayName || v.device.model) : (v.model ? escapeHtml(v.model) : '');
  const role = v.result === 'blocked' ? 'alert' : 'status';
  return `
    <div class="dev-verdict ${meta.cls}" role="${role}">
      <h3 class="dev-verdict-title" tabindex="-1">${meta.title}</h3>
      <p class="dev-verdict-msg">${escapeHtml(v.message || WifixAPI.deviceValidationMessage(v))}</p>
      ${serial || model ? `<p class="dev-verdict-device">${[model, serial].filter(Boolean).join(' · ')}</p>` : ''}
      ${v.createdAt ? `<p class="dev-verdict-when">Registrado ${dateTimeHtml(v.createdAt)}</p>` : ''}
    </div>
    ${devCapacityTilesHtml({
      device: v.device || null,
      planMbps: v.planMbps,
      planSimulated: v.planSource === 'simulated',
      outcome: { result: v.result, reasons: v.reasons || [] },
    })}`;
}

function devScannerHtml(nativeAvailable) {
  const scanIcon = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3m0 4h4v-4m-7 4h3"/></svg>';
  const camIcon = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>';
  return `
    <div class="serial-detect-block">
      <p class="serial-browser-note">${nativeAvailable
        ? 'Escanea el código de la etiqueta o toma una foto (la foto también lee el modelo)'
        : 'Escaneo disponible solo en la app: toma una foto o escribe el serial'}</p>
      <div class="serial-actions">
        ${nativeAvailable ? `<button type="button" class="serial-action-btn" data-action="dev-scan">${scanIcon} Escanear código</button>` : ''}
        <button type="button" class="serial-action-btn" data-action="dev-photo">${camIcon} Tomar foto</button>
      </div>
      <input type="file" accept="image/*" capture="environment" data-slot="dev-file" hidden aria-hidden="true" tabindex="-1">
      <div class="serial-result-row" data-slot="dev-serial-badge" aria-live="polite"></div>
      <label class="form-row">
        <span class="form-label" id="devSerialLabel">Número de serie *</span>
        <input type="text" data-field="devSerial" aria-labelledby="devSerialLabel" autocomplete="off"
          autocapitalize="characters" spellcheck="false" maxlength="40" placeholder="Ej. ZTEGD0BB8294">
      </label>
    </div>`;
}

function devSerialBadgeHtml(dev) {
  const s = dev.serialStatus;
  if (!s) return '';
  const cls = s.kind === 'ok' ? 'ok' : 'warn';
  return `<span class="serial-confidence-badge ${cls}">${escapeHtml(s.text)}</span>`;
}

/** Modo de la pantalla según el estado guardado y el borrador. */
function devMode(dev) {
  const st = devStateFor(dev.account, dev.category);
  if (st && !dev.rescanning) return st.status === 'blocked' ? 'blocked' : 'done';
  return 'form';
}

function devScreenHtml(dev) {
  const st = devStateFor(dev.account, dev.category);
  const mode = devMode(dev);
  if (mode === 'blocked' || mode === 'done') {
    const again = mode === 'blocked' ? 'Escanear otro equipo' : 'Validar otro equipo';
    return `
      <div class="tool-form dev-module" data-form="device-validation">
        <div data-slot="dev-verdict" aria-live="polite">${devVerdictCardHtml(st.validation)}</div>
        ${mode === 'blocked' ? '<p class="form-note">No se puede completar el módulo ni guardar registros de la visita con este equipo.</p>' : ''}
        <button type="button" class="save-btn${mode === 'done' ? ' outline' : ''}" data-action="dev-rescan">${again}</button>
      </div>`;
  }
  const blockedBefore = st && st.status === 'blocked';
  return `
    <div class="tool-form dev-module" data-form="device-validation">
      ${blockedBefore ? `<div class="dev-still-blocked" role="status">El equipo anterior${st.validation && st.validation.serial ? ` (${escapeHtml(st.validation.serial)})` : ''} quedó bloqueado. El flujo sigue bloqueado hasta validar un equipo apto.</div>` : ''}
      <p class="form-note dev-intro">Escanea la etiqueta del equipo que vas a instalar (ONT, ONU, router o powerline), confirma el modelo y valida que soporte el plan del cliente.</p>
      <h3 class="dev-step">1. Etiqueta del equipo</h3>
      ${devScannerHtml(serialScannerAvailable())}
      <h3 class="dev-step">2. Modelo</h3>
      <div data-slot="dev-models">${devModelsHtml(dev)}</div>
      <h3 class="dev-step">3. Capacidad vs plan</h3>
      <div data-slot="dev-capacity">${devCapacityHtml(dev)}</div>
      <div data-slot="dev-actions">${devFormActionsHtml(dev)}</div>
    </div>`;
}

function devSetSlot(name, html) {
  const el = equipoBody ? equipoBody.querySelector(`[data-slot="${name}"]`) : null;
  if (el) el.innerHTML = html;
}

/** Repinta solo las partes dinámicas del formulario (no el input del serial). */
function devRenderSlots(names = ['dev-models', 'dev-capacity', 'dev-actions', 'dev-serial-badge']) {
  if (!_dev || !equipoBody) return;
  const html = {
    'dev-models': devModelsHtml,
    'dev-capacity': devCapacityHtml,
    'dev-actions': devFormActionsHtml,
    'dev-serial-badge': devSerialBadgeHtml,
  };
  names.forEach((n) => devSetSlot(n, html[n](_dev)));
}

function devRender(focusSel) {
  if (!_dev || !equipoBody) return;
  equipoBody.innerHTML = devScreenHtml(_dev);
  const serialInput = equipoBody.querySelector('[data-field="devSerial"]');
  if (serialInput) serialInput.value = _dev.serial || '';
  const badge = equipoBody.querySelector('[data-slot="dev-serial-badge"]');
  if (badge) badge.innerHTML = devSerialBadgeHtml(_dev);
  if (focusSel) {
    const el = equipoBody.querySelector(focusSel);
    if (el && typeof el.focus === 'function') el.focus();
  }
}

// --- Acciones -------------------------------------------------------------------
function devNewDraft(account, category, prev) {
  return {
    account,
    category,
    catalog: prev ? prev.catalog : null,
    catalogError: null,
    plan: prev ? prev.plan : { mbps: null, simulated: false, loading: true, error: null },
    serial: '',
    serialSource: null,
    detectedSerial: '',
    serialStatus: null,
    textMatches: [],
    model: '',
    otherModel: '',
    showAll: false,
    rescanning: false,
    posting: false,
    postError: null,
  };
}

/** Aplica lo leído por el escáner: serial + modelo sugerido. Pura sobre `dev`. */
function devApplyCapture(dev, rawValues, source) {
  const picked = devPickSerial(rawValues, dev.catalog || []);
  const matches = devMatchModelsFromText(rawValues, dev.catalog || []);
  dev.textMatches = matches;
  if (picked.serial) {
    dev.serial = picked.serial;
    dev.detectedSerial = picked.serial;
    dev.serialSource = source;
    dev.serialStatus = picked.confidence === 'ok'
      ? { kind: 'ok', text: `✓ Serial detectado: ${picked.serial}` }
      : { kind: 'warn', text: `⚠ Verifica el serial contra la etiqueta: ${picked.serial}` };
  } else {
    dev.serialStatus = { kind: 'warn', text: source === 'barcode' ? '⚠ No se reconoció un serial en el código' : '⚠ No se encontró el serial en la foto: escríbelo a mano' };
  }
  const pre = devPreselectModel(matches);
  if (pre) {
    dev.model = pre;
  } else if (dev.model && dev.model !== DEVICE_OTHER_MODEL) {
    // El modelo elegido antes ya no es de la marca del serial nuevo: se pide de nuevo.
    const still = devShortlist(dev.catalog || [], dev.serial, matches).some((d) => d.model === dev.model);
    if (!still && devSerialPrefix(dev.serial, dev.catalog || [])) dev.model = '';
  }
  return dev;
}

async function devLoadPlan(dev) {
  if (validatedProfile && validatedAccount === dev.account) {
    dev.plan = Object.assign(devPlanFromProfile(validatedProfile), { loading: false, error: null });
    return dev.plan;
  }
  try {
    const profile = await WifixAPI.getClientProfile(dev.account);
    dev.plan = Object.assign(devPlanFromProfile(profile), { loading: false, error: null });
  } catch (err) {
    console.warn('[Wifix] plan para validación de equipo:', err);
    dev.plan = { mbps: null, simulated: false, loading: false, error: 'No se pudo cargar el plan del cliente en la app; el servidor lo resolverá al validar.' };
  }
  return dev.plan;
}

async function devLoadCatalogInto(dev, force) {
  dev.catalogError = null;
  try {
    dev.catalog = await devLoadCatalog(force);
  } catch (err) {
    console.error('[Wifix] catálogo de equipos:', err);
    dev.catalog = null;
    dev.catalogError = (err && err.message) ? `No se pudo cargar el catálogo de equipos: ${err.message}` : 'No se pudo cargar el catálogo de equipos.';
  }
  return dev.catalog;
}

/**
 * POST de la validación + aplicación del veredicto. Sin DOM (lo usa el smoke).
 * Devuelve la validación del servidor, o null si falló (dev.postError).
 */
async function devSubmitValidation(dev) {
  const body = buildDeviceValidationPayload(dev);
  if (!body || dev.posting) return null;
  dev.posting = true;
  dev.postError = null;
  try {
    const v = await WifixAPI.createDeviceValidation(dev.account, body);
    if (!v || !devStatusFromResult(v.result)) throw new Error('Respuesta inesperada del servidor.');
    devApplyValidation(dev.account, dev.category, v);
    dev.rescanning = false;
    return v;
  } catch (err) {
    console.error('[Wifix] validación de equipo:', err);
    dev.postError = `No se pudo validar el equipo: ${(err && err.message) || 'error desconocido'}. El módulo sigue sin completar.`;
    return null;
  } finally {
    dev.posting = false;
  }
}

function devStartRescan() {
  if (!_dev) return;
  const next = devNewDraft(_dev.account, _dev.category, _dev);
  next.rescanning = true;
  _dev = next;
  devRender(serialScannerAvailable() ? '[data-action="dev-scan"]' : '[data-field="devSerial"]');
}

async function devCaptureBarcode(btn) {
  if (!_dev) return;
  const dev = _dev;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  try {
    const raw = await window.WifixNative.serialScanner.scanBarcodes();
    if (!raw || !raw.length) {
      dev.serialStatus = { kind: 'warn', text: '⚠ No se detectó ningún código. Prueba con "Tomar foto" o escribe el serial.' };
    } else {
      devApplyCapture(dev, raw, 'barcode');
    }
  } catch (err) {
    console.error('[Wifix] equipo scanBarcodes:', err);
    dev.serialStatus = { kind: 'warn', text: '⚠ Error al escanear' };
  } finally {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
  }
  if (_dev !== dev) return;
  const input = equipoBody.querySelector('[data-field="devSerial"]');
  if (input) input.value = dev.serial;
  devRenderSlots();
}

async function devOcrLines(base64) {
  return (await window.WifixNative.serialScanner.ocrFromImageBase64(base64)) || [];
}

async function devCapturePhoto(btn, file) {
  if (!_dev) return;
  const dev = _dev;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  try {
    let base64 = null;
    if (file) {
      base64 = await readFileAsBase64(file);
    } else {
      const dataUrl = await window.WifixNative.takePhoto();
      if (!dataUrl) {
        dev.serialStatus = { kind: 'warn', text: '⚠ No se tomó ninguna foto' };
      } else {
        base64 = dataUrl.split(',').pop();
      }
    }
    if (base64) {
      const lines = await devOcrLines(base64);
      if (!lines.length) {
        dev.serialStatus = { kind: 'warn', text: '⚠ No se encontró texto en la foto: acerca la cámara a la etiqueta' };
      } else {
        devApplyCapture(dev, lines, 'ocr');
      }
    }
  } catch (err) {
    console.error('[Wifix] equipo foto/OCR:', err);
    dev.serialStatus = { kind: 'warn', text: '⚠ Error al procesar la foto' };
  } finally {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
  }
  if (_dev !== dev) return;
  const input = equipoBody.querySelector('[data-field="devSerial"]');
  if (input) input.value = dev.serial;
  devRenderSlots();
}

/** Delegación de eventos: se registra una sola vez sobre el contenedor. */
function devWireOnce() {
  if (!equipoBody || equipoBody.dataset.devWired) return;
  equipoBody.dataset.devWired = '1';

  equipoBody.addEventListener('input', (ev) => {
    if (!_dev) return;
    const t = ev.target;
    if (t.matches('[data-field="devSerial"]')) {
      _dev.serial = t.value.toUpperCase();
      if (_dev.serial !== _dev.detectedSerial) {
        _dev.serialSource = 'manual';
        _dev.serialStatus = null;
      }
      devRenderSlots();
    } else if (t.matches('[data-field="devOtherModel"]')) {
      // Sin repintar la lista de modelos: el input vive ahí y perdería el foco.
      _dev.otherModel = t.value;
      devRenderSlots(['dev-capacity', 'dev-actions']);
    }
  });

  equipoBody.addEventListener('change', (ev) => {
    if (!_dev) return;
    const t = ev.target;
    if (t.matches('input[name="devModel"]')) {
      _dev.model = t.value;
      devRenderSlots();
      const sel = equipoBody.querySelector(`input[name="devModel"][value="${CSS.escape(t.value)}"]`);
      if (sel) sel.focus();
      if (t.value === DEVICE_OTHER_MODEL) {
        const other = equipoBody.querySelector('[data-field="devOtherModel"]');
        if (other) other.focus();
      }
    } else if (t.matches('[data-slot="dev-file"]')) {
      const file = t.files && t.files[0];
      const btn = equipoBody.querySelector('[data-action="dev-photo"]');
      if (file && btn) devCapturePhoto(btn, file).finally(() => { t.value = ''; });
    }
  });

  equipoBody.addEventListener('click', async (ev) => {
    if (!_dev) return;
    const btn = ev.target.closest('[data-action]');
    if (!btn || !equipoBody.contains(btn)) return;
    const action = btn.dataset.action;
    if (action === 'dev-scan') {
      devCaptureBarcode(btn);
    } else if (action === 'dev-photo') {
      const useNativeCamera = serialScannerAvailable() && typeof window.WifixNative?.takePhoto === 'function';
      if (useNativeCamera) {
        devCapturePhoto(btn, null);
      } else {
        const fileInput = equipoBody.querySelector('[data-slot="dev-file"]');
        if (fileInput) fileInput.click();
      }
    } else if (action === 'dev-show-all') {
      _dev.showAll = true;
      devRenderSlots();
      const first = equipoBody.querySelector('input[name="devModel"]');
      if (first) first.focus();
    } else if (action === 'dev-retry-catalog') {
      const dev = _dev;
      await devLoadCatalogInto(dev, true);
      if (_dev === dev) devRenderSlots();
    } else if (action === 'dev-validate') {
      const dev = _dev;
      const pending = devSubmitValidation(dev);
      devRenderSlots();
      const v = await pending;
      if (_dev !== dev) return;
      if (v) devRender('.dev-verdict-title');
      else devRenderSlots();
    } else if (action === 'dev-rescan') {
      devStartRescan();
    }
  });
}

async function openEquipo() {
  const cuenta = currentAccount();
  if (!cuenta) {
    alert('Ingresa primero el número de cuenta.');
    return;
  }
  if (!devUsesModule()) return;
  equipoChip.textContent = cuenta;
  applyModuleLabels();
  devWireOnce();

  const reuse = _dev && _dev.account === cuenta && _dev.category === currentCategory;
  if (!reuse) _dev = devNewDraft(cuenta, currentCategory, null);
  const dev = _dev;
  devRender();

  detailEquipo.classList.add('open');
  detailEquipo.setAttribute('aria-hidden', 'false');

  await Promise.all([
    dev.catalog ? null : devLoadCatalogInto(dev, false),
    dev.plan.loading ? devLoadPlan(dev) : null,
    devSyncFromServer(cuenta, dev.category),
  ]);
  if (_dev !== dev) return;
  if (devMode(dev) === 'form') devRenderSlots();
  else devRender();
}

if (backFromEquipo) {
  backFromEquipo.addEventListener('click', () => {
    detailEquipo.classList.remove('open');
    detailEquipo.setAttribute('aria-hidden', 'true');
  });
}
