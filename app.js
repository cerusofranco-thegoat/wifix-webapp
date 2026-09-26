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

// Módulos del menú principal: cada uno decide qué secciones ve el técnico.
// - cards: sub-tarjetas visibles (data-sub del #subscreen).
// - servicio: ids de SERVICIO_ITEMS que se muestran en Datos del Servicio;
//   null = todos. Si la tarjeta 'servicio' no está en cards, no se usa.
// Instalaciones y Migraciones comparten secciones: en la migración el técnico
// instala lo nuevo y retira el equipo anterior (Equipos Retirados es clave).
const INSTALL_SECTIONS = Object.freeze({
  cards: Object.freeze(['personales', 'servicio', 'herramientas', 'retirados']),
  servicio: Object.freeze(['naps', 'events']),
});

const MODULES = {
  instalaciones: {
    eyebrow: 'Categoría', title: 'Instalaciones',
    ...INSTALL_SECTIONS,
  },
  migraciones: {
    eyebrow: 'Categoría', title: 'Migraciones',
    ...INSTALL_SECTIONS,
  },
  visitas: {
    eyebrow: 'Categoría', title: 'Visitas técnicas',
    cards: ['personales', 'servicio', 'red', 'herramientas', 'retirados'],
    servicio: null,
  },
  cancelaciones: {
    eyebrow: 'Categoría', title: 'Cancelación de servicio',
    cards: ['personales', 'retirados'],
    servicio: [],
  },
};

let currentCategory = 'instalaciones';

function currentModule() {
  return MODULES[currentCategory] || MODULES.instalaciones;
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
  applyModuleVisibility();
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
  accountInput.removeAttribute('aria-invalid');
  accountInput.removeAttribute('aria-describedby');
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
});
clearAccount.addEventListener('click', () => {
  accountInput.value = '';
  inputWrap.classList.remove('has-value');
  invalidateAccountCache();
  accountInput.focus();
});

// Las tarjetas arrancan deshabilitadas para a11y; se habilitan al confirmar cuenta.
invalidateAccountCache();
applyModuleVisibility();

// === Confirmar cuenta ========================================================
const confirmAccountBtn = document.getElementById('confirmAccount');
const confirmAccountFeedback = document.getElementById('confirmAccountFeedback');

confirmAccountBtn.addEventListener('click', () => { confirmAccountFlow(); });

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

      confirmAccountFeedback.textContent = `Cuenta confirmada — ${profile.fullName || '—'}`;
      confirmAccountFeedback.className = 'confirm-account-feedback success';
      renderWhitelistLine(wl, cuenta);

      // Estado del cliente: UNA sola llamada adicional. Si falla no invalida la
      // confirmación — el técnico ya tiene el nombre y puede seguir trabajando.
      try {
        const contract = await WifixAPI.getContractStatus(cuenta);
        const accounts = (contract && Array.isArray(contract.accounts)) ? contract.accounts : [];
        const own = accounts.find(a => a.accountNumber === cuenta) || accounts[0] || null;
        const estado = own && own.status ? own.status : '—';
        confirmAccountFeedback.textContent =
          `Cuenta confirmada — ${profile.fullName || '—'} · ${estado}`;
      } catch (statusErr) {
        console.warn('[Wifix] contract-status en confirmación:', statusErr);
        confirmAccountFeedback.textContent =
          `Cuenta confirmada — ${profile.fullName || '—'} · —`;
      }
    } catch (err) {
      console.error('[Wifix] confirm-account:', err);
      if (isUpstreamOrNetworkFailure(err)) {
        // La operadora (o la red) no responde, pero eso NO es culpa de la cuenta:
        // Herramientas y Equipos Retirados no dependen de la operadora y tienen
        // que funcionar igual. Se confirma en modo limitado y se avisa en amarillo.
        confirmAccountInLimitedMode(cuenta, err);
        renderWhitelistLine(wl, cuenta);
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
    confirmAccountBtn.textContent = 'Confirmar cuenta';
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
  detailEyebrow.textContent = currentModule().title;

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
// `sources[campo]` puede ser 'FSM' | 'MOCK' | 'COMARCH' (contrato §3).
function sourceBadge(profile, field) {
  const src = profile && profile.sources ? profile.sources[field] : null;
  if (src !== 'MOCK') return '';
  return ' <span class="source-badge" title="Dato simulado: la operadora todavía no lo expone">simulado</span>';
}

// Mismo criterio que sourceBadge(), pero a nivel de pantalla o panel completo:
// Red Interna (campos 19-21) y Daños en la red de acceso (campo 14) todavía se
// alimentan de datos simulados porque la integración con la operadora no existe.
// Aviso discreto (chip), nunca un banner que tape la pantalla.
function mockNotice(extraClass = '') {
  const cls = extraClass ? ` ${extraClass}` : '';
  return `<span class="mock-notice${cls}" role="note"` +
    ` title="Estos datos no vienen de la operadora todavía">` +
    `Datos simulados — integración pendiente</span>`;
}

function renderClientProfile(profile, cuenta) {
  const phonesHtml = (profile.phones && profile.phones.length)
    ? profile.phones.map(escapeHtml).join('<br/>')
    : '—';
  const down = profile.contractedDownloadMbps ?? '—';
  const up = profile.contractedUploadMbps ?? '—';
  const speedTxt = `${escapeHtml(down)} ↓ / ${escapeHtml(up)} ↑ Mbps`;
  // Plan y velocidad siguen simulados hasta que exista la API de Comarch: se
  // rotulan como tales para que el técnico no los lea como datos reales.
  const badgePlan = sourceBadge(profile, 'planName');
  const badgeVel = sourceBadge(profile, 'contractedDownloadMbps') || sourceBadge(profile, 'contractedUploadMbps');

  detailList.innerHTML = [
    renderDetailRow(ICONS.user,  'Nombres y Apellidos' + sourceBadge(profile, 'fullName'), escapeHtml(profile.fullName || '—')),
    renderDetailRow(ICONS.pin,   'Dirección' + sourceBadge(profile, 'address'), escapeHtml(profile.address || '—')),
    renderDetailRow(ICONS.phone, 'Teléfonos' + sourceBadge(profile, 'phones'), phonesHtml),
    renderDetailRow(ICONS.mail,  'Correo' + sourceBadge(profile, 'email'), escapeHtml(profile.email || '—')),
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
      <label class="form-row"><span class="form-label">Nombres y Apellidos</span>
        <input type="text" data-field="fullName" value="${escapeHtml(profile.fullName || '')}"></label>
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
let _napPanelState = {
  taskId: null,
  openedAt: null,
  coords: null,      // { latitude, longitude, accuracy } cuando hay GPS
  selectedNap: null, // napRef seleccionado para GPON (napId o napCode)
  selectedPort: null, // puerto elegido dentro de la NAP GPON (libre o cancelado)
  naps: [],          // array de NAPs cargadas (se guarda al cargar el panel)
  meters: 100,       // radio de búsqueda (100 / 250 / 500)
  maxRows: 5,        // cuántas NAPs mostrar (5 / 10 / 20)
  degraded: null,    // aviso de degradación de la última consulta
  homeCoords: null,  // coordenada del domicilio que trae la orden (si existe)
  // --- Visita técnica: NAP actual del cliente (GET /accounts/:n/current-nap)
  // Se consulta UNA vez por apertura del panel (loadNapPanel); los re-render
  // leen de aquí y nunca vuelven a llamar al backend.
  currentNap: null,      // respuesta de current-nap (found true/false) o null
  currentNapError: null, // Error si la consulta falló (red, 502, 503)
  showNearby: true,      // lista de NAPs cercanas visible ("Cambiar NAP")
};

// ¿El panel está en modo "visita con NAP del cliente encontrada"?
function _napIsVisitFound() {
  const cur = _napPanelState.currentNap;
  return !!(cur && cur.found && cur.nap);
}

// napRef de la NAP del cliente (o '' si no hay).
function _napCurrentRef() {
  return _napIsVisitFound() ? _napRef(_napPanelState.currentNap.nap) : '';
}

// Referencia de la NAP para el backend: napId numérico de FSM cuando existe,
// si no el código de NAP (camino TEC). Contrato §6.
function _napRef(nap) {
  if (!nap) return '';
  return nap.napId !== null && nap.napId !== undefined ? String(nap.napId) : String(nap.napCode || '');
}

// Caché de puertos por panel: expandir la NAP y luego seleccionarla para GPON
// son dos gestos distintos sobre la MISMA NAP. Sin caché serían dos llamadas a
// la operadora por lo mismo. Se limpia en cada búsqueda nueva de NAPs.
async function _napPortsCached(scope, napRef) {
  if (!scope._napPortsCache) scope._napPortsCache = {};
  if (scope._napPortsCache[napRef]) return scope._napPortsCache[napRef];
  const data = await WifixAPI.getNapPorts(napRef);
  _napMarkClientPort(napRef, data);
  scope._napPortsCache[napRef] = data;
  return data;
}

// Marca en los datos de puertos cuál es el puerto del cliente de la visita
// (p.isClientPort). Va en el objeto y no en el DOM para que sobreviva a los
// repintados de celda de _applyPortStatuses.
function _napMarkClientPort(napRef, data) {
  if (!data || !Array.isArray(data.ports) || !_napIsVisitFound()) return;
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
    const ref = _napRef(n);
    const isSelected = _napPanelState.selectedNap === ref;
    const color = _napColorClass(n);
    const reutilizables = _napReusablePorts(scope, ref).length;
    // "Red de acceso", nunca "nodo": es el puerto de OLT / la tarjeta de CMTS.
    const red = n.networkName
      ? `<span class="nap-network-name"><span class="nap-network-key">Red de acceso</span>${escapeHtml(n.networkName)}</span>`
      : '';
    const esDelCliente = !!ref && ref === _napCurrentRef();
    return `
      <div class="nap-card nap-state-${color}${isSelected ? ' nap-selected' : ''}" data-nap="${escapeHtml(ref)}">
        <div class="nap-head">
          ${_napNameHtml(n, ref)}
          <span class="nap-badges">
            <span class="nap-state-badge ${color}">${escapeHtml(_napColorLabel(n))}</span>
            ${esDelCliente ? '<span class="nap-client-badge">NAP del cliente</span>' : ''}
            ${isSelected ? '<span class="nap-selected-badge">GPON seleccionada</span>' : ''}
          </span>
        </div>
        <span class="nap-distance">${_napDistanceText(n)}</span>
        ${red}
        ${_napOccupancyBar(n)}
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
  // La distancia de la NAP del cliente depende de la coordenada del técnico.
  _napRenderCurrent(scope);

  if (!coords) {
    slot.innerHTML = `<div class="detail-empty">Captura tu ubicación (GPS o lat/lng manual) para buscar las NAPs del sector.</div>`;
    _napRenderMap(scope);
    return;
  }

  slot.innerHTML = `<div class="detail-loading">Buscando NAPs cercanas…</div>`;
  scope._napPortsCache = {};
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
      slot.innerHTML = `<div class="detail-empty">No hay NAPs registradas a ${_napPanelState.meters} m de esta coordenada. Prueba con un radio mayor.</div>`;
      _napRenderMap(scope);
      return;
    }
    // Si la NAP seleccionada ya no está en el resultado, se limpia la selección.
    if (_napPanelState.selectedNap &&
        !_napPanelState.naps.some(n => _napRef(n) === _napPanelState.selectedNap)) {
      _napPanelState.selectedNap = null;
      _napPanelState.selectedPort = null;
      await _renderGponSummary(scope);
    }
    _renderNapCards(_napPanelState.naps, scope);
    _wireNapCardButtons(scope, _napPanelState.naps);
    _napRenderMap(scope);
  } catch (err) {
    console.error('[Wifix] NAPs cercanas', err);
    slot.innerHTML = renderPanelError(err, 'No se pudieron consultar las NAPs.');
    _napPanelState.naps = [];
    _napRenderMap(scope);
  }
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
    _napAfterCoordsChange(scope);
  }

  // Visita con la NAP del cliente y la lista cercana oculta: la coordenada
  // solo mueve al técnico en el mapa y recalcula la distancia (no se consulta
  // la operadora). En los demás casos se buscan las NAPs cercanas como antes.
  function _napAfterCoordsChange(sc) {
    if (_napIsVisitFound() && !_napPanelState.showNearby) {
      _napRenderCurrent(sc);
      _napRenderMap(sc);
      return;
    }
    _napFetchAndRender(sc);
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
    _napAfterCoordsChange(scope);
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

  // --- "Cambiar NAP" (visita): despliega la búsqueda de NAPs cercanas ------
  const toggleBtn = scope.querySelector('[data-action="nap-toggle-nearby"]');
  const nearbyWrap = scope.querySelector('[data-slot="nap-nearby"]');
  if (toggleBtn && nearbyWrap) {
    toggleBtn.addEventListener('click', () => {
      const abrir = !_napPanelState.showNearby;
      _napPanelState.showNearby = abrir;
      nearbyWrap.hidden = !abrir;
      toggleBtn.setAttribute('aria-expanded', abrir ? 'true' : 'false');
      toggleBtn.textContent = abrir ? 'Ocultar NAPs cercanas' : 'Cambiar NAP';
      if (!abrir) {
        _napRenderMap(scope);
        return;
      }
      // Abrir es un gesto explícito: se busca con la coordenada que haya
      // (GPS, manual o la del domicilio precargada). Solo la primera vez.
      if (!nearbyWrap.dataset.searched && adoptInputCoords()) {
        nearbyWrap.dataset.searched = '1';
        _napFetchAndRender(scope);
      } else {
        _napRenderMap(scope);
      }
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
    });
  });
}

// ---------------------------------------------------------------------------
// Visita técnica — NAP actual del cliente (GET /accounts/:n/current-nap)
// ---------------------------------------------------------------------------

// Texto del aviso cuando no se encontró la NAP del cliente o la consulta falló.
// Devuelve '' si no corresponde aviso (no es visita o se encontró).
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
  return 'No se encontró la NAP del cliente en las NAPs cercanas.';
}

function _napCurrentNoticeHtml() {
  const txt = _napCurrentNoticeText();
  if (!txt) return '';
  return `<div class="nap-current-note" role="status">${escapeHtml(txt)} Se muestran las NAPs cercanas.</div>`;
}

// Distancia del técnico (GPS/manual) a la NAP del cliente. La que trae
// current-nap es desde el centro de búsqueda (el domicilio), no desde el técnico.
function _napDistanceFromTech(nap) {
  const c = _napPanelState.coords;
  if (!c || !_napHasCoords(nap)) return null;
  return _napHaversineMeters(c.latitude, c.longitude, Number(nap.latitude), Number(nap.longitude));
}

function _napDistanceFromTechText(nap) {
  const d = _napDistanceFromTech(nap);
  return d !== null ? `${d.toFixed(1)} m desde tu ubicación` : 'Captura tu ubicación para ver la distancia';
}

// Tarjeta única "NAP del cliente" (visita técnica con la NAP encontrada).
function _renderCurrentNapCard() {
  if (!_napIsVisitFound()) return _napCurrentNoticeHtml();
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
  // Texto literal de la operadora bajo el grupo, si aporta (p. ej. "Suspendido por mora").
  const literal = st && st.description && String(st.description).toUpperCase() !== grupo.label.toUpperCase()
    ? ` <span class="nap-client-status-sub">(${escapeHtml(st.description)})</span>` : '';
  const degraded = cur.degraded && cur.degraded.message
    ? `<div class="nap-degraded-note" role="status">${escapeHtml(cur.degraded.message)}</div>` : '';
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
          <span class="nap-state-badge ${color}">${escapeHtml(_napColorLabel(n))}</span>
        </span>
      </div>
      <span class="nap-distance" data-slot="nap-current-distance">${escapeHtml(_napDistanceFromTechText(n))}</span>
      ${red}
      ${_napOccupancyBar(n)}
      ${puerto}
      <div class="nap-client-meta">
        <span class="nap-client-status ${escapeHtml(grupo.tile)}">
          <span class="nap-client-key">Cliente</span>${escapeHtml(grupo.label)}${literal}
        </span>${equipo}
      </div>
      <div class="nap-actions">
        <button class="add-row-btn nap-ports-btn" type="button" data-action="view-ports" data-nap="${escapeHtml(ref)}"
          aria-expanded="false">Ver puertos</button>
        ${_napDirectionsBtnHtml(n)}
      </div>
      <div class="nap-ports-slot" data-ports-for="${escapeHtml(ref)}" data-slot="ports-${escapeHtml(ref)}"></div>
    </div>`;
}

// Actualiza la distancia de la tarjeta del cliente sin regenerarla: así no se
// pierde la grilla de puertos si ya estaba abierta.
function _napRenderCurrent(scope) {
  if (!_napIsVisitFound() || !scope || !scope.querySelector) return;
  const dist = scope.querySelector('[data-slot="nap-current-distance"]');
  if (dist) dist.textContent = _napDistanceFromTechText(_napPanelState.currentNap.nap);
}

// "Ver puertos" de la tarjeta del cliente (misma grilla que la lista).
function _wireNapCurrentCard(scope) {
  if (!_napIsVisitFound()) return;
  wireNapPortsButtons(scope);
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

// NAPs a pintar: en visita, la del cliente (+ las cercanas si se desplegó
// "Cambiar NAP"); en instalación/migración, las cercanas. Sin coordenada se omiten.
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
  const visita = _napIsVisitFound();
  if (visita) add(_napPanelState.currentNap.nap);
  if (!visita || _napPanelState.showNearby) (_napPanelState.naps || []).forEach(add);
  return out;
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

  const tech = _napPanelState.coords;
  const home = _napPanelState.homeCoords;
  const naps = _napMapNaps();
  if (!tech && !home && naps.length === 0) {
    _napMapDestroy();
    slot.innerHTML = '<div class="nap-map-empty">El mapa aparece al capturar tu ubicación o al buscar NAPs.</div>';
    return;
  }

  // ¿Sigue viva la instancia en este mismo contenedor?
  const viva = !!(_napMap.map && _napMap.el && _napMap.el.isConnected && slot.contains(_napMap.el));
  if (!viva && !_napMapCreate(scope, slot)) return;

  // Marcadores (se regeneran en cada repintado; la instancia se reutiliza).
  _napMap.layer.clearLayers();
  _napMap.markers = {};
  if (home) {
    L.marker([home.latitude, home.longitude], {
      icon: L.divIcon({ className: 'nap-map-home', html: _NAP_MAP_HOME_SVG, iconSize: [28, 28], iconAnchor: [14, 14] }),
      title: 'Domicilio del cliente', alt: 'Domicilio del cliente', keyboard: false,
    }).bindTooltip('Domicilio del cliente').addTo(_napMap.layer);
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
  slot.innerHTML = `
    <div class="nap-map" role="region" aria-label="Mapa de NAPs: tu ubicación, domicilio del cliente y NAPs"></div>
    <div class="nap-map-legend" aria-hidden="true">
      <span><span class="nap-map-dot tech"></span>Tú</span>
      <span><span class="nap-map-dot home"></span>Domicilio</span>
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

  const taskId = _napPanelState.taskId;
  const fechaHora = formatDate(_napPanelState.openedAt);

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

  // Visita técnica con la NAP del cliente encontrada: una sola tarjeta y la
  // búsqueda por radio queda detrás de "Cambiar NAP". Sin NAP (o con error)
  // el panel es el mismo de instalaciones, con un aviso arriba.
  const visita = _napIsVisitFound();

  return `
    <div class="nap-panel${visita ? ' nap-panel-visit' : ''}" data-panel="nap-gpon">

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

      ${visita ? `
      <!-- 3) NAP del cliente (visita técnica) -->
      <div class="nap-section-title">NAP del cliente</div>
      <div data-slot="nap-map" class="nap-map-slot"></div>
      <div data-slot="nap-current">${_renderCurrentNapCard()}</div>
      <button type="button" class="add-row-btn nap-toggle-nearby-btn" data-action="nap-toggle-nearby"
        aria-expanded="${_napPanelState.showNearby ? 'true' : 'false'}" aria-controls="napNearbySection">
        ${_napPanelState.showNearby ? 'Ocultar NAPs cercanas' : 'Cambiar NAP'}
      </button>` : `
      <div data-slot="nap-current">${_napCurrentNoticeHtml()}</div>`}

      <div class="nap-nearby" id="napNearbySection" data-slot="nap-nearby"${visita && !_napPanelState.showNearby ? ' hidden' : ''}>
      <!-- 4) Radio de búsqueda y cantidad de resultados -->
      <div class="nap-radius-control">
        <div class="nap-radius-group" role="group" aria-label="Radio de búsqueda">
          <span class="nap-radius-label">Radio</span>
          ${[100, 250, 500].map((m) => `
            <button type="button" class="nap-radius-btn${_napPanelState.meters === m ? ' is-active' : ''}"
              data-action="nap-meters" data-meters="${m}"
              aria-pressed="${_napPanelState.meters === m ? 'true' : 'false'}">${m} m</button>`).join('')}
        </div>
        <div class="nap-radius-group">
          <label class="nap-rows-label" for="napMaxRows">Mostrar</label>
          <select class="nap-rows-select" id="napMaxRows" data-field="nap-maxrows">
            ${[5, 10, 20].map((r) => `
              <option value="${r}"${_napPanelState.maxRows === r ? ' selected' : ''}>${r}</option>`).join('')}
          </select>
          <button type="button" class="add-row-btn nap-search-btn" data-action="nap-search">Buscar NAPs</button>
        </div>
      </div>

      <!-- 5) Mapa + tarjetas de NAPs -->
      ${visita ? '' : '<div data-slot="nap-map" class="nap-map-slot"></div>'}
      <div class="nap-section-title">NAPs disponibles en el sector</div>
      <div data-slot="nap-degraded" hidden></div>
      <div data-slot="nap-cards">
        <div class="detail-empty">${usandoDomicilio
          ? 'Toca «Buscar NAPs» para consultar el sector de la coordenada del domicilio.'
          : 'Captura tu ubicación (GPS o lat/lng manual) para buscar las NAPs del sector.'}</div>
      </div>
      </div>

      <!-- 6) Bloque resumen GPON -->
      <div data-slot="gpon-summary" hidden></div>

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
  _napPanelState.currentNap = null;
  _napPanelState.currentNapError = null;
  _napPanelState.showNearby = true;
  // Coordenada del domicilio: sale del perfil que ya se cargó al confirmar la
  // cuenta. NO se pide de nuevo: cero llamadas extra a la operadora.
  _napPanelState.homeCoords = null;
  if (validatedProfile && validatedAccount === cuenta &&
      isFinite(validatedProfile.latitude) && isFinite(validatedProfile.longitude) &&
      validatedProfile.latitude !== null && validatedProfile.longitude !== null) {
    _napPanelState.homeCoords = {
      latitude: validatedProfile.latitude,
      longitude: validatedProfile.longitude,
      accuracy: null,
    };
  }
  // Visitas técnicas: primero la NAP a la que YA está conectado el cliente.
  // Una sola llamada por apertura del panel: los re-render leen el estado.
  if (currentCategory === 'visitas' && cuenta) {
    try {
      // Sin coordenada del domicilio, el backend no puede ubicar la NAP: si el
      // técnico ya tiene GPS de una apertura anterior, se usa como centro.
      const centro = !_napPanelState.homeCoords && _napPanelState.coords ? _napPanelState.coords : null;
      const res = await WifixAPI.getCurrentNap(cuenta, centro);
      if (seq !== _napLoadSeq) return null;
      _napPanelState.currentNap = res;
    } catch (err) {
      if (seq !== _napLoadSeq) return null;
      console.error('[Wifix] NAP actual del cliente', err);
      _napPanelState.currentNapError = err;
    }
    _napPanelState.showNearby = !_napIsVisitFound();
  }
  return renderNapPanel();
}

// Al terminar de insertar el HTML del panel, activa la lógica interactiva.
// Llamado desde openDatosServicio después de body.innerHTML = html.
function _bootNapPanel(body) {
  const panel = body.querySelector('[data-panel="nap-gpon"]');
  if (!panel) return;
  _wireNapPanel(panel);
  _wireNapCurrentCard(panel);
  // Si ya había una coordenada de una apertura anterior, se reconsulta sola
  // (salvo en visita con la lista cercana oculta: ahí no hace falta).
  if (_napPanelState.coords && _napPanelState.showNearby) {
    const wrap = panel.querySelector('[data-slot="nap-nearby"]');
    if (wrap && wrap.dataset) wrap.dataset.searched = '1';
    _napFetchAndRender(panel);
  } else {
    _napRenderMap(panel);
  }
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

  // `drop`: el monitoreo de la operadora detectó una caída de red. Es el único
  // campo extra de la ficha que la operadora confirmó relevante.
  const drop = terminal.drop || { detected: false, description: null };
  const dropRow = drop.detected
    ? `<div class="isp-event alert">
         <span class="isp-event-title">Caída de red detectada</span>
         <span class="isp-event-desc">${escapeHtml(drop.description || 'El monitoreo registró una caída.')}</span>
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
        <span class="isp-badge tech">${escapeHtml(terminal.technology || '—')}</span>
      </div>
      <div class="isp-status-cell">
        <span class="isp-status-label">Ciudad</span>
        <span class="isp-badge tech">${escapeHtml(terminal.city || '—')}</span>
      </div>
    </div>
    ${eventRow}
    ${dropRow}
    ${red ? `<div class="mini-row"><span class="mr-label">${escapeHtml(_ispNetworkLabel(terminal.technology))}</span><span class="mr-value">${escapeHtml(red)}</span></div>` : ''}
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
function _ispMetricSection(title, metric, data, terminal, skipped, chartOpts) {
  const cards = ['terminal', 'network'].map(scope => _ispSeriesCards(
    data && data[scope],
    scope === 'terminal' ? 'Equipo del cliente' : _ispNetworkLabel(terminal.technology),
    chartOpts,
  )).join('');

  return `
    <div class="isp-section-title">${escapeHtml(title)}</div>
    ${cards || _ispEmptyMetricNote(metric, terminal.technology, skipped)}`;
}

function renderIspDiagnostics(data) {
  const terminal = data.terminal || {};
  const statusTerminal = data.status && data.status.terminal;
  const statusNetwork = data.status && data.status.network;
  const stats = _ispOutageStats(statusTerminal);

  const skipped = data.skipped || [];
  const redLabel = _ispNetworkLabel(terminal.technology);

  // El endpoint de red devuelve cuántos equipos de esa red están en línea: se
  // grafica como cantidad, no como porcentaje. La operadora no expone el total
  // de la red, así que un "% de la red en línea" no se puede calcular; lo que
  // sirve al técnico es el escalón (si cae de golpe, el problema no es del
  // domicilio).
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
          <span class="isp-stat-label">equipos en línea en la misma red</span>
        </div>
      </div>
      ${renderStatusBand(statusTerminal, 'Equipo del cliente')}
      ${_ispChartCard(`Equipos en línea · ${redLabel}`, networkChart,
        { minZero: true, ariaLabel: 'Equipos en línea en la misma red de acceso, últimas 24 horas' })}
      <p class="isp-hint">
        Es la cantidad de equipos en línea en ${escapeHtml(redLabel.toLowerCase())},
        no un porcentaje: la operadora no publica el total de la red. Lo que
        importa es el escalón — si cae de golpe, el problema no es del domicilio.
      </p>`
    : `<div class="detail-empty">La operadora no devolvió el histórico de estado de este equipo.</div>`;

  return `
    <div class="isp-results">
      ${renderIspTerminalCard(terminal)}
      ${errors}

      ${terminal.found ? `<div class="isp-section-title">Disponibilidad — últimas 24 h</div>${availability}` : ''}

      ${terminal.found ? _ispMetricSection('Señal a ruido — 24 h (DOCSIS)', 'snr', data.snr, terminal, skipped,
        { unit: 'dB', ariaLabel: 'Señal a ruido de las últimas 24 horas' }) : ''}

      ${terminal.found ? _ispMetricSection('Errores FEC corregidos y sin corregir — 24 h (DOCSIS)', 'codewords', data.codewords, terminal, skipped,
        { minZero: true, ariaLabel: 'Errores FEC de las últimas 24 horas' }) : ''}

      ${terminal.found ? renderIspHistory(terminal.history) : ''}

      <div class="isp-footnote">
        Consultado ${escapeHtml(formatDate(data.fetchedAt))} · ISP Monitor ·
        las series cubren las últimas 24 h contadas desde ese instante.
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
          const base64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result;
              resolve(typeof result === 'string' ? result.split(',').pop() : '');
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
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
  return aviso + events.map(e => `
    <div class="event-item">
      <span class="event-date">${formatDatePill(e.occurredAt)}</span>
      <div class="event-body">
        <span class="event-badge ${badgeClass(e.status)}">${escapeHtml(e.status)}</span>
        <span class="event-title">${escapeHtml(e.type)}</span>
        <span class="event-desc">${escapeHtml(e.description || '')}</span>
      </div>
    </div>`).join('');
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

function renderVisitItem(t, extraClass) {
  // ⚠2 FSM no expone el técnico que cerró la tarea: llega null y se muestra
  // como "—". Queda pendiente pedirlo a la operadora.
  const tecnico = t.technician || '—';
  const notas = t.closingNotes ? escapeHtml(t.closingNotes) : '';
  // Notas bajo demanda: una expansión = una llamada. Nada de precargar.
  const botonNotas = (!t.notesLoaded && t.workOrder)
    ? `
      <button type="button" class="task-notes-btn" data-action="task-notes"
        data-workorder="${escapeHtml(t.workOrder)}" aria-expanded="false">Ver notas de cierre</button>
      <div class="task-notes-slot" data-slot="task-notes"></div>`
    : '';
  const aviso = t.result === 'REALIZADA'
    ? '<span class="visit-hint">Resultado no verificado por la operadora</span>'
    : '';
  return `
    <div class="event-item${extraClass ? ' ' + extraClass : ''}" data-workorder="${escapeHtml(t.workOrder || '')}" data-result="${escapeHtml(t.result || '')}">
      <span class="event-date">${formatDatePill(t.occurredAt)}</span>
      <div class="event-body">
        <span class="event-badge ${visitBadgeClass(t.result)}">${escapeHtml(t.result || '—')}</span>
        <span class="event-title">${escapeHtml(t.taskId || t.workOrder || '—')} · ${escapeHtml(tecnico)}</span>
        <span class="event-desc"><strong>${escapeHtml(t.reason || '—')}</strong>${notas ? ' — ' + notas : ''}</span>
        ${aviso}
        ${botonNotas}
      </div>
    </div>`;
}

// Panel único "Visitas pendientes y anteriores" (GET /accounts/{n}/visits).
// `result` es { items, pendingCount, totalOrders, scanned, truncated, brand,
// degraded? }; se tolera el array desnudo. El backend ya ordena: la pendiente
// primero y el resto por fecha descendente. Aquí solo se separan en grupos
// sin reordenar, por si llegara más de una pendiente.
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
      ${anteriores.map(t => renderVisitItem(t)).join('')}
    </section>`
    : '';

  return nota + bloquePendiente + bloqueAnteriores;
}

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
    load: (cuenta) => loadNapPanel(cuenta) },
  { id: 'status',  icon: SERVICIO_ICONS.user,    title: 'Status del cliente por contrato/cuenta',
    load: (cuenta) => WifixAPI.getContractStatus(cuenta).then(c => renderStatusFromContract(c, cuenta)) },
  { id: 'isp',     icon: SERVICIO_ICONS.metrics, title: 'ISP Monitor — señal, SNR, FEC y caídas 24 h',
    load: (cuenta) => renderIspPanel(cuenta) },
  // "Red de acceso" y no "nodo", igual que en el panel de ISP Monitor: la
  // operadora aclaró que ese concepto no existe (los datos salen de tarjetas de
  // CMTS o de puertos de OLT). El endpoint sigue llamándose `node-events`
  // porque es el contrato publicado; lo que cambia es lo que lee el técnico.
  { id: 'events',  icon: SERVICIO_ICONS.alert,   title: 'Daños (eventos) en la red de acceso',
    load: (cuenta) => WifixAPI.getNodeEvents(cuenta).then(renderEventsList) },
  // Una sola ruta para la visita pendiente y el historial (campos 15-16).
  { id: 'visits',  icon: SERVICIO_ICONS.history, title: 'Visitas pendientes y anteriores',
    load: (cuenta) => WifixAPI.getVisits(cuenta).then(renderVisitsList) },
  { id: 'history', icon: SERVICIO_ICONS.history, title: 'Historial de la app (registros guardados)',
    load: (cuenta) => WifixAPI.getAccountToolHistory(cuenta).then(renderHistorySummary) },
];

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
        <div class="servicio-title">${escapeHtml(item.title)}</div>
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

  // Campos 19-21: equipos LAN, dispositivos WiFi y cambio de SSID todavía se
  // sirven de datos simulados. Un solo aviso por pantalla, arriba de la lista.
  redList.innerHTML = mockNotice() + RED_ITEMS.map(item => `
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
