/* ===========================================================================
 * api.js — Capa de consumo de la API del backend de la app Wifix (Fase 2).
 * Es el ÚNICO punto que sabe si los datos son mock o vienen del servidor real.
 * Para usar el backend real: WifixAPI.useRealApi = true. La URL se resuelve en
 * cada request con resolveBackendUrl() (override en localStorage >
 * PUBLIC_BACKEND_URL > LAN/origen); ver WifixAPI.getBaseUrl/setBaseUrl.
 *
 * Maneja también el token: tras `login()` se guarda en localStorage y se
 * envía como `Authorization: Bearer` en cada llamada protegida. Si el backend
 * responde 401, dispara el evento DOM `wifix:unauthorized` para que la
 * pantalla vuelva al login.
 * ========================================================================*/
(function (global) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Resolución de la URL del backend. Orden de prioridad:
  //   1. Override manual en localStorage['wifix.backend.url'] (puerta de
  //      servicio del login: 7 taps sobre el logo).
  //   2. PUBLIC_BACKEND_URL — el backend HTTPS de producción. Se aplica cuando
  //      la app corre dentro del APK / localhost / file://, donde no hay un
  //      origen del que derivar nada.
  //   3. Fallback LAN: dentro del APK apunta a LAN_BACKEND_URL; servida desde
  //      un host real, deriva del origen actual con el puerto 8080.
  // ---------------------------------------------------------------------------

  // Backend de demo en el VPS Quasar (DokPloy + Traefik, TLS de Let's Encrypt).
  // Vacío = sin backend público, se usa la lógica LAN.
  const PUBLIC_BACKEND_URL = 'https://api-wifix.portaltulpa.com/herramientas/v1';
  const LAN_BACKEND_URL = 'http://192.168.1.172:8080/herramientas/v1';
  const BACKEND_URL_OVERRIDE_KEY = 'wifix.backend.url';

  // Sólo http/https y con host: evita que un override tipeado a mano
  // ('192.168.1.5:8080', 'javascript:...') rompa todas las llamadas.
  function normalizeBackendUrl(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const value = raw.trim();
    if (!value) return null;
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      if (!parsed.hostname) return null;
      return value.replace(/\/+$/, '');
    } catch (_) {
      return null;
    }
  }

  function getBackendUrlOverride() {
    try { return normalizeBackendUrl(localStorage.getItem(BACKEND_URL_OVERRIDE_KEY)); } catch (_) { return null; }
  }

  // Devuelve la URL guardada, o null. Sólo un valor vacío borra el override:
  // una URL inválida se rechaza SIN pisar el override que ya funcionaba (si no,
  // un typo en el prompt dejaba la app apuntando a otro backend).
  function setBackendUrlOverride(url) {
    const raw = (url === null || url === undefined) ? '' : String(url).trim();
    if (!raw) {
      try { localStorage.removeItem(BACKEND_URL_OVERRIDE_KEY); } catch (_) { /* no disponible */ }
      return null;
    }
    const normalized = normalizeBackendUrl(raw);
    if (!normalized) return null;
    try { localStorage.setItem(BACKEND_URL_OVERRIDE_KEY, normalized); } catch (_) { /* no disponible */ }
    return normalized;
  }

  // Se llama en CADA request: así un cambio del override surte efecto sin
  // recargar la app y no queda ninguna URL cacheada en una constante.
  function resolveBackendUrl() {
    const override = getBackendUrlOverride();
    if (override) return override;
    let inApk = true;
    let host = '';
    let proto = 'file:';
    try {
      host = (window.location.hostname || '').toLowerCase();
      proto = window.location.protocol;
      inApk = proto === 'file:' || host === 'localhost' || host === '127.0.0.1' || host === '';
    } catch (_) {
      inApk = true;
    }
    const publicUrl = normalizeBackendUrl(PUBLIC_BACKEND_URL);
    if (inApk) return publicUrl || LAN_BACKEND_URL;
    // Servida desde un host real: el backend vive en el mismo host, puerto 8080.
    const httpProto = proto === 'https:' ? 'https:' : 'http:';
    return `${httpProto}//${host}:8080/herramientas/v1`;
  }

  const TOKEN_STORAGE_KEY = 'wifix_token';
  const USER_STORAGE_KEY = 'wifix_user';
  // Marca (realm) de la operadora. null = usar el default del backend.
  const BRAND_STORAGE_KEY = 'wifix_fsm_brand';
  // Tope de cuentas por llamada a /accounts/status-batch (contrato §7).
  const STATUS_BATCH_LIMIT = 12;

  // ---------------------------------------------------------------------------
  // Datos de catálogo mock — alineados con SPEC §8 (mismos nombres y códigos).
  // ---------------------------------------------------------------------------
  const MOCK_EQUIPMENT_MODELS = [
    { id: 'em-01', name: 'Decodificadores', category: 'DECODIFICADOR', serialFieldType: 'SN', brand: null, active: true },
    { id: 'em-02', name: 'Decodificadores HD', category: 'DECODIFICADOR_HD', serialFieldType: 'HOST-SN', brand: null, active: true },
    { id: 'em-03', name: 'MTA', category: 'MTA', serialFieldType: 'SN', brand: null, active: true },
    { id: 'em-04', name: 'ONU300G', category: 'ONU', serialFieldType: 'PON-SN', brand: null, active: true },
    { id: 'em-05', name: 'ONU HUR', category: 'ONU', serialFieldType: 'PON-SN', brand: null, active: true },
    { id: 'em-06', name: 'ONU B2000', category: 'ONU', serialFieldType: 'SN', brand: null, active: true },
    { id: 'em-07', name: 'ONT Huawei OptiXstar', category: 'ONT', serialFieldType: 'SN', brand: 'Huawei', active: true },
    { id: 'em-08', name: 'ONT ZTE (todas)', category: 'ONT', serialFieldType: 'GPON-SN', brand: 'ZTE', active: true },
    { id: 'em-09', name: 'Router Huawei', category: 'ROUTER', serialFieldType: 'SN', brand: 'Huawei', active: true },
    { id: 'em-10', name: 'Router ZTE', category: 'ROUTER', serialFieldType: 'D-SN', brand: 'ZTE', active: true },
  ];

  const MOCK_REMOVAL_REASONS = [
    { code: 'DANO_FISICO', label: 'Daño físico', active: true },
    { code: 'NO_ENCIENDE', label: 'No enciende', active: true },
    { code: 'PUERTO_DANADO', label: 'Puerto LAN o RF dañado (no da conectividad)', active: true },
    { code: 'EQUIPO_INHIBIDO', label: 'Equipo inhibido', active: true },
    { code: 'NO_DA_SERVICIO', label: 'No da servicio (navegación, WiFi)', active: true },
    { code: 'NO_SE_APROVISIONA', label: 'No se aprovisiona', active: true },
    { code: 'EQUIPO_OK_CANCELACION', label: 'Equipo OK (cancelación)', active: true },
    { code: 'OTROS', label: 'Otros', active: true },
  ];

  const MOCK_NETWORK_SERVERS = [
    { id: 'ns-01', name: 'Google DNS', target: '8.8.8.8', type: 'DNS', active: true },
    { id: 'ns-02', name: 'Cloudflare DNS', target: '1.1.1.1', type: 'DNS', active: true },
    { id: 'ns-03', name: 'Gateway local', target: '192.168.1.1', type: 'GATEWAY', active: true },
  ];

  const MOCK_SPEEDTEST_SERVERS = [
    { id: 'ss-01', name: 'Servidor Quito', host: 'quito.speedtest.example.com', city: 'Quito', active: true },
    { id: 'ss-02', name: 'Servidor Guayaquil', host: 'guayaquil.speedtest.example.com', city: 'Guayaquil', active: true },
  ];

  // ---------------------------------------------------------------------------
  // Helpers comunes
  // ---------------------------------------------------------------------------
  function uuidMock() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function withContext(accountNumber, body) {
    if (!accountNumber || !String(accountNumber).trim()) {
      throw new Error('accountNumber es obligatorio.');
    }
    // technicianId NO se envía desde el frontend: el backend lo derivará del
    // user.id del JWT. clientId/contractId siguen como valores de prueba hasta
    // que exista el sistema upstream. visitId ya NO se envía: la visita la
    // identifica `taskId` (ver withVisitContext).
    return Object.assign(
      {
        accountNumber: String(accountNumber).trim(),
        clientId: 'CLI-FASE2-TEST',
        contractId: 'CTR-FASE2-TEST',
      },
      body,
    );
  }

  // Visita en curso: app.js registra un resolver que devuelve el workOrder
  // (o fsmTaskId) de la visita PENDIENTE de la cuenta, o null. Todos los POST
  // de herramientas y equipos retirados lo mandan como `taskId`; sin visita
  // pendiente no se manda nada y el backend asocia el registro por horario.
  // Un `taskId` explícito en el payload manda sobre el resolver.
  let taskIdResolver = null;

  // Guardia de registros de la visita (validación de equipo vs plan): app.js
  // registra una función (accountNumber) => null | string. Si devuelve un
  // mensaje, el flujo de la categoría está BLOQUEADO (el equipo a instalar no
  // soporta el plan) y ningún registro de la visita se guarda: speedtest, ping,
  // traceroute, señal WiFi, distancia, equipos retirados y casa cliente.
  // Es el único punto por el que pasan todos esos POST (withVisitContext +
  // createClientLocation), así que el bloqueo no depende de cada pantalla.
  let recordGuard = null;
  function assertRecordAllowed(accountNumber) {
    if (typeof recordGuard !== 'function') return;
    let msg = null;
    try { msg = recordGuard(String(accountNumber || '').trim()); } catch (_) { msg = null; }
    if (msg) {
      const err = new Error(String(msg));
      err.code = 'DEVICE_BLOCKED';
      throw err;
    }
  }

  // Guardia del Nº de task (Visita técnica, contrato 2026-10-06 §4): app.js
  // registra (accountNumber) => null | string. Sin task validada ningún
  // registro de la visita se guarda (incluida la validación de equipo, que sí
  // esquiva la guardia de bloqueo de equipo).
  let taskGuard = null;
  function assertTaskAllowed(accountNumber) {
    if (typeof taskGuard !== 'function') return;
    let msg = null;
    try { msg = taskGuard(String(accountNumber || '').trim()); } catch (_) { msg = null; }
    if (msg) {
      const err = new Error(String(msg));
      err.code = 'TASK_REQUIRED';
      throw err;
    }
  }

  async function withVisitContext(accountNumber, body) {
    assertTaskAllowed(accountNumber);
    assertRecordAllowed(accountNumber);
    const ctx = withContext(accountNumber, body);
    if (ctx.taskId === undefined || ctx.taskId === null || String(ctx.taskId).trim() === '') {
      delete ctx.taskId;
      if (typeof taskIdResolver === 'function') {
        try {
          const t = await taskIdResolver(ctx.accountNumber);
          if (t && String(t).trim()) ctx.taskId = String(t).trim();
        } catch (_) { /* sin taskId: el backend asocia por horario */ }
      }
    }
    return ctx;
  }

  // ?technology=GPON|HFC (pista opcional de ISP Monitor).
  function techQuery(opts) {
    const t = normalizeTechHint(opts && opts.technology);
    return t ? '?technology=' + t : '';
  }

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // --- Gestión de token --------------------------------------------------
  function getToken() {
    try { return localStorage.getItem(TOKEN_STORAGE_KEY); } catch (_) { return null; }
  }
  function setToken(token) {
    try {
      if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
      else localStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch (_) { /* localStorage bloqueado, no se persiste */ }
  }
  function getUser() {
    try {
      const raw = localStorage.getItem(USER_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }
  function setUser(user) {
    try {
      if (user) localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
      else localStorage.removeItem(USER_STORAGE_KEY);
    } catch (_) { /* localStorage bloqueado */ }
  }

  // --- Marca / realm de la operadora (header X-Wifix-Brand) ---------------
  // Un solo punto de verdad: la marca NO se pasa como argumento a las
  // funciones de WifixAPI, viaja siempre como header desde fetchJson.
  function getBrand() {
    try { return localStorage.getItem(BRAND_STORAGE_KEY); } catch (_) { return null; }
  }
  function setBrand(brand) {
    try {
      if (brand) localStorage.setItem(BRAND_STORAGE_KEY, String(brand));
      else localStorage.removeItem(BRAND_STORAGE_KEY);
    } catch (_) { /* localStorage bloqueado, no se persiste */ }
  }

  function emitUnauthorized() {
    try {
      window.dispatchEvent(new CustomEvent('wifix:unauthorized'));
    } catch (_) { /* ignore */ }
  }

  // UPSTREAM_AUTH_ERROR (HTTP 503): problema administrativo del servidor
  // (token de la operadora ausente/vencido/rechazado). NO cierra sesión, NO
  // limpia el token de Wifix, NO recarga la app: solo avisa a la UI para que
  // pinte un banner en el panel afectado. Ver contrato §1.
  function emitIntegrationUnavailable(meta, message) {
    try {
      const m = meta || {};
      window.dispatchEvent(new CustomEvent('wifix:integration-unavailable', {
        detail: {
          integration: m.integration || 'FSM',
          brand: m.brand !== undefined && m.brand !== null ? m.brand : getBrand(),
          reason: m.reason || null,
          message: message || null,
        },
      }));
    } catch (_) { /* ignore */ }
  }

  // `GET /naps/nearby` devuelve un array desnudo, así que el bloque `degraded`
  // viaja en el header X-Wifix-Degraded (JSON URL-encoded). Ver contrato §5.
  function readDegradedHeader(res) {
    try {
      const raw = res && res.headers && res.headers.get ? res.headers.get('X-Wifix-Degraded') : null;
      if (!raw) return null;
      return JSON.parse(decodeURIComponent(raw));
    } catch (_) { return null; }
  }

  // Error de red (backend caído, sin WiFi/datos, DNS, CORS). Se normaliza a un
  // Error con `code = 'NETWORK_ERROR'` y mensaje en español; `cause` conserva el
  // TypeError original para la consola.
  function networkError(cause) {
    const err = new Error('No se pudo conectar con el servidor. Revisa tu conexión.');
    err.code = 'NETWORK_ERROR';
    err.cause = cause || null;
    return err;
  }

  // opts.withMeta === true -> devuelve { data, degraded } en vez de data.
  async function fetchJson(method, path, body, opts) {
    const init = { method, headers: { 'Content-Type': 'application/json' } };
    const token = getToken();
    if (token) init.headers['Authorization'] = 'Bearer ' + token;
    const brand = getBrand();
    if (brand) init.headers['X-Wifix-Brand'] = brand;
    if (body !== undefined) init.body = JSON.stringify(body);
    let res;
    try {
      res = await fetch(resolveBackendUrl() + path, init);
    } catch (netErr) {
      // `fetch` sólo rechaza por fallo de red/CORS/DNS (TypeError). El mensaje
      // nativo es en inglés ("Failed to fetch"): se traduce acá para que la UI
      // nunca muestre texto crudo del navegador.
      throw networkError(netErr);
    }
    const data = await res.json().catch(function () { return null; });
    if (!res.ok) {
      const code = data && data.code ? data.code : 'HTTP_' + res.status;
      const msg = data && data.message ? data.message : 'Error de red.';
      if (res.status === 401) {
        setToken(null);
        setUser(null);
        emitUnauthorized();
      }
      const err = new Error(msg);
      err.code = code;
      err.status = res.status;
      err.details = data && data.details;
      if (code === 'UPSTREAM_AUTH_ERROR') {
        err.meta = data && data.meta;
        emitIntegrationUnavailable(data && data.meta, msg);
      }
      throw err;
    }
    if (opts && opts.withMeta === true) {
      return { data: data, degraded: readDegradedHeader(res) };
    }
    return data;
  }

  // Las rutas de visitas/tareas pasaron de array desnudo a { items, ... }.
  // Se normaliza acá para que app.js vea siempre un objeto (contrato §10/§11).
  function asItemsEnvelope(result) {
    if (Array.isArray(result)) return { items: result, totalOrders: result.length };
    if (result && Array.isArray(result.items)) return result;
    return { items: [], totalOrders: 0 };
  }

  // ---------------------------------------------------------------------------
  // Catálogos mock fallback para client-profile (al usar mock antes del login).
  // ---------------------------------------------------------------------------
  // Marca mock: la del selector si el técnico eligió una, si no la default.
  function mockBrand() {
    return getBrand() || 'telenews';
  }
  function mockWorkOrderId(seed) {
    return 'ORDER/' + (424900 + (seed || 0)) + '/2026';
  }
  // Cuentas mock sin identidad en FSM (contrato client-profile con FSM en vivo):
  //   50000001 → FSM no devolvió nada: identidad null + degraded FSM_NO_DATA
  //   50000002 → igual, pero el nombre sale de la whitelist (sources WHITELIST)
  const MOCK_FSM_NO_DATA = {
    '50000001': { fullName: null, nameSource: 'NONE',
      message: 'Sin datos en FSM para esta cuenta.' },
    '50000002': { fullName: 'MARIA FERNANDA ZAMBRANO LOOR', nameSource: 'WHITELIST',
      message: 'Sin datos en FSM para esta cuenta; nombre tomado de la base de clientes Xtrim.' },
  };
  function mockClientProfileNoFsm(accountNumber, hit) {
    return {
      accountNumber: accountNumber,
      fullName: hit.fullName,
      address: null,
      phones: null,
      email: null,
      planName: 'Wifix Hogar 200',
      contractedDownloadMbps: 200,
      contractedUploadMbps: 200,
      latitude: null,
      longitude: null,
      sources: {
        fullName: hit.nameSource, address: 'NONE', phones: 'NONE', email: 'NONE',
        latitude: 'NONE', longitude: 'NONE',
        planName: 'MOCK', contractedDownloadMbps: 'MOCK', contractedUploadMbps: 'MOCK',
      },
      degraded: { reason: 'FSM_NO_DATA', message: hit.message },
    };
  }
  // Velocidad contratada de prueba por cuenta (demo de la validación de equipo):
  // Solo valores que da el plan simulado del backend (50/100/200/400/600/1000).
  // Todo plan simulado es SIMÉTRICO (decisión de Franco): subida = bajada.
  //   40000600 → 600 Mbps  (un ONT con WiFi 500 queda bloqueado por WiFi)
  //   40001000 → 1000 Mbps (powerline: bloquea por Ethernet y por WiFi)
  //   40000000 → sin plan  (unknown_plan: no bloquea, deja alerta)
  //   resto    → 200 Mbps
  const MOCK_PLAN_BY_ACCOUNT = { '40000600': 600, '40001000': 1000, '40000000': null };
  function mockClientProfile(accountNumber) {
    const sinFsm = MOCK_FSM_NO_DATA[String(accountNumber || '').trim()];
    if (sinFsm) return mockClientProfileNoFsm(String(accountNumber).trim(), sinFsm);
    const key = String(accountNumber || '').trim();
    if (Object.prototype.hasOwnProperty.call(MOCK_PLAN_BY_ACCOUNT, key)) {
      const down = MOCK_PLAN_BY_ACCOUNT[key];
      return Object.assign(mockClientProfileBase(accountNumber), {
        planName: down ? 'Wifix Hogar ' + down : null,
        contractedDownloadMbps: down,
        contractedUploadMbps: down || null,
      });
    }
    return mockClientProfileBase(accountNumber);
  }
  function mockClientProfileBase(accountNumber) {
    return {
      accountNumber: accountNumber,
      fullName: 'Cliente Mock Apellido Apellido',
      address: 'Av. Amazonas N1234, Quito',
      phones: ['0991234567', '022345678'],
      email: 'cliente.mock@example.com',
      planName: 'Wifix Hogar 200',
      contractedDownloadMbps: 200,
      contractedUploadMbps: 200,
      latitude: -2.247946,
      longitude: -79.904161,
      // Plan y velocidad siguen simulados hasta que exista API de Comarch.
      sources: {
        fullName: 'FSM', address: 'FSM', phones: 'FSM', email: 'FSM',
        latitude: 'FSM', longitude: 'FSM',
        planName: 'MOCK', contractedDownloadMbps: 'MOCK', contractedUploadMbps: 'MOCK',
      },
    };
  }
  function mockContractStatus(accountNumber) {
    return {
      clientName: 'Cliente Mock Apellido Apellido',
      accounts: [
        {
          accountNumber: accountNumber,
          contractId: null,            // FSM no expone contrato (contrato §4, ⚠1)
          status: 'ACTIVA',
          statusCode: 'A',
          statusDescription: 'Activo',
          lastWorkOrder: mockWorkOrderId(0),
        },
      ],
      brand: mockBrand(),
    };
  }
  // Whitelist de clientes reales de Xtrim (GET /accounts/:n/whitelist), modo
  // demo. enforce:true como en producción: cualquier otra cuenta queda fuera.
  //   35070291 → ACTIVO (importada)
  //   40123456 → ACTIVO (agregada a mano: source EXTRA)
  //   35070288 → SUSPENDIDO por mora (accessType 'Mora Dia 31')
  const MOCK_WHITELIST = {
    '35070291': { source: 'IMPORT', status: 'ACTIVO', city: 'GUAYAQUIL', node: 'GYE-NORTE-04',
      businessType: 'RESIDENCIAL', accountType: 'POSTPAGO', accessType: 'Normal' },
    '40123456': { source: 'EXTRA', status: 'ACTIVO', city: 'QUITO', node: 'UIO-CENTRO-02',
      businessType: 'RESIDENCIAL', accountType: 'POSTPAGO', accessType: 'Normal' },
    '35070288': { source: 'IMPORT', status: 'SUSPENDIDO', city: 'GUAYAQUIL', node: 'GYE-SUR-11',
      businessType: 'RESIDENCIAL', accountType: 'POSTPAGO', accessType: 'Mora Dia 31' },
    // Sin identidad en FSM (ver MOCK_FSM_NO_DATA): sí están en la base de Xtrim.
    '50000001': { source: 'IMPORT', status: 'ACTIVO', city: 'MANTA', node: 'MTA-01',
      businessType: 'RESIDENCIAL', accountType: 'POSTPAGO', accessType: 'Normal' },
    '50000002': { source: 'IMPORT', status: 'ACTIVO', city: 'PORTOVIEJO', node: 'PTV-03',
      businessType: 'RESIDENCIAL', accountType: 'POSTPAGO', accessType: 'Normal' },
    // Planes de prueba para la validación de equipo (ver MOCK_PLAN_BY_ACCOUNT).
    '40000600': { source: 'IMPORT', status: 'ACTIVO', city: 'GUAYAQUIL', node: 'GYE-NORTE-04',
      businessType: 'RESIDENCIAL', accountType: 'POSTPAGO', accessType: 'Normal' },
    '40001000': { source: 'IMPORT', status: 'ACTIVO', city: 'QUITO', node: 'UIO-CENTRO-02',
      businessType: 'RESIDENCIAL', accountType: 'POSTPAGO', accessType: 'Normal' },
    '40000000': { source: 'IMPORT', status: 'ACTIVO', city: 'GUAYAQUIL', node: 'GYE-SUR-11',
      businessType: 'RESIDENCIAL', accountType: 'POSTPAGO', accessType: 'Normal' },
  };
  const MOCK_WHITELIST_IMPORTED_AT = '2026-09-24T14:30:00.000Z';
  function mockWhitelist(accountNumber) {
    const cuenta = String(accountNumber || '').trim();
    const hit = MOCK_WHITELIST[cuenta];
    if (!hit) {
      return { accountNumber: cuenta, listed: false, importedAt: MOCK_WHITELIST_IMPORTED_AT, enforce: true };
    }
    return Object.assign({ accountNumber: cuenta, listed: true }, hit,
      { importedAt: MOCK_WHITELIST_IMPORTED_AT, enforce: true });
  }
  // Ingreso por cédula/RUC (POST /accounts/lookup), modo demo. Misma
  // normalización que el backend (sin espacios/puntos/guiones; 9 → 10 y
  // 12 → 13 dígitos restituyendo el 0). Las cuentas salen de MOCK_WHITELIST
  // para que "Confirmar" siga el mismo camino que por número de cuenta:
  //   0912345678    → 2 cuentas (35070291 ACTIVO, 35070288 SUSPENDIDO)
  //   0923456789    → 1 cuenta (40123456)
  //   0990012345001 → RUC con 1 cuenta (50000001)
  //   resto         → sin coincidencias
  const MOCK_LOOKUP = {
    '0912345678': [{ n: '35070291', fullName: 'PEREZ GOMEZ JUAN CARLOS' }, { n: '35070288', fullName: 'PEREZ GOMEZ JUAN CARLOS' }],
    '0923456789': [{ n: '40123456', fullName: 'ZAMBRANO VERA MARIA JOSE' }],
    '0990012345001': [{ n: '50000001', fullName: 'COMERCIAL MANTA S.A.' }],
  };
  function normalizeDocument(raw) {
    let d = String(raw || '').replace(/[\s.\-]/g, '');
    if (/^\d{9}$/.test(d) || /^\d{12}$/.test(d)) d = '0' + d;
    return d;
  }
  function mockLookup(document) {
    const doc = normalizeDocument(document);
    if (doc.length < 6) {
      const err = new Error('El documento debe tener al menos 6 caracteres.');
      err.code = 'VALIDATION_ERROR';
      err.status = 400;
      throw err;
    }
    const kind = /^\d{10}$/.test(doc) ? 'CEDULA' : /^\d{13}$/.test(doc) ? 'RUC' : 'OTRO';
    const matches = (MOCK_LOOKUP[doc] || []).map(function (m) {
      const w = MOCK_WHITELIST[m.n] || {};
      return {
        accountNumber: m.n, status: w.status || 'ACTIVO', city: w.city || null, node: w.node || null,
        businessType: w.businessType || null, accountType: w.accountType || null,
        accessType: w.accessType || null, fullName: m.fullName,
      };
    });
    return { by: 'document', documentKind: kind, matches: matches, count: matches.length,
      truncated: false, importedAt: MOCK_WHITELIST_IMPORTED_AT };
  }
  // Estado de la integración. No toca la operadora: es información local.
  function mockFsmHealth() {
    const in24h = new Date(Date.now() + 86400000).toISOString();
    return {
      mode: 'mock',
      defaultBrand: 'telenews',
      brands: [
        { brand: 'telenews', available: true, reason: null, tokenSource: 'STATIC', expiresAt: in24h, expiresInSeconds: 86400 },
        { brand: 'seteinfo', available: true, reason: null, tokenSource: 'STATIC', expiresAt: in24h, expiresInSeconds: 86400 },
      ],
      napsPrimarySource: 'tec',
    };
  }
  // Estados por cuenta (campo 8, paso 2). Determinista por número de cuenta
  // para que la rejilla de puertos no "baile" entre consultas.
  // Índice = (últimos 2 dígitos de la cuenta) % 6; el 5 simula un fallo.
  // Incluye T (cancelado) y O/P (cuentan como Activo) para probar la agrupación.
  const MOCK_STATUS_TABLE = [
    { statusCode: 'A', status: 'ACTIVA', statusDescription: 'Activo' },
    { statusCode: 'S', status: 'SUSPENDIDA', statusDescription: 'Suspendido' },
    { statusCode: 'T', status: 'TERMINADA', statusDescription: 'Terminado' },
    { statusCode: 'O', status: 'ORDENADA', statusDescription: 'Ordenada' },
    { statusCode: 'P', status: 'PENDIENTE', statusDescription: 'Pendiente' },
  ];
  function mockStatusBatch(accounts) {
    const list = accounts || [];
    const items = list.map(function (acc, i) {
      const digits = String(acc).replace(/\D/g, '');
      const seed = digits ? Number(digits.slice(-2)) : i;
      // Una de cada seis cuentas simula un fallo aislado: el lote NO se cae.
      if (seed % 6 === 5) {
        return {
          accountNumber: String(acc), status: null, statusCode: null, statusDescription: null,
          error: 'FSM no devolvió estado para esta cuenta.',
        };
      }
      const row = MOCK_STATUS_TABLE[seed % 6];
      return {
        accountNumber: String(acc),
        status: row.status,
        statusCode: row.statusCode,
        statusDescription: row.statusDescription,
        error: null,
      };
    });
    const failed = items.filter(function (it) { return it.error; }).length;
    return {
      brand: mockBrand(),
      items: items,
      requested: items.length,
      resolved: items.length - failed,
      failed: failed,
    };
  }
  // Ocupación de las NAPs mock (índice = napId - MOCK_NAP_BASE_ID). Se comparte
  // entre el listado y el detalle de puertos para que los conteos cuadren.
  // Casos de prueba dentro del radio de instalación (280 m, default); con el
  // rango extendido (500 m) aparecen además 289/344/412 m (fuera de radio):
  //   [0] 8/8  → llena (roja), con clientes T (cancelado) al consultar estados
  //   [2] 7/8  → un puerto libre (verde)
  //   [3] 0/16 → vacía
  const MOCK_NAP_BASE_ID = 11540;
  const MOCK_NAP_USED = [8, 3, 7, 0, 2, 1, 6, 8, 5, 0, 3, 7];
  function mockNapTotal(i) { return i % 2 === 0 ? 8 : 16; }
  // Genera NAPs mock alrededor de una coordenada, con la misma forma que
  // devuelve la API de operadora (/api/tec/naps/{lat},{lng}).
  function mockNearbyNaps(coords, opts) {
    const lat = coords && isFinite(coords.latitude) ? coords.latitude : -0.1800;
    const lng = coords && isFinite(coords.longitude) ? coords.longitude : -78.4680;
    const o = opts || {};
    const meters = isFinite(o.meters) ? Number(o.meters) : 280;
    const maxRows = isFinite(o.maxRows) ? Number(o.maxRows) : 5;
    const offsets = [
      [20, 0.6], [47, 2.1], [61, 3.4], [73, 4.8], [92, 1.2], [113, 5.6],
      [148, 2.7], [186, 0.2], [231, 4.1], [289, 3.0], [344, 5.1], [412, 1.7],
    ];
    const used = MOCK_NAP_USED;
    const all = offsets.map(function (pair, i) {
      const dist = pair[0];
      const bearing = pair[1];
      const dLat = (dist * Math.cos(bearing)) / 111320;
      const dLng = (dist * Math.sin(bearing)) / (111320 * Math.cos(lat * Math.PI / 180));
      const total = mockNapTotal(i);
      return {
        napId: MOCK_NAP_BASE_ID + i,
        napCode: 'NAP-' + (12 + i) + '-0' + ((i % 6) + 1),
        networkName: 'OLT-GYE-0' + ((i % 4) + 1) + '/1/2',
        latitude: lat + dLat,
        longitude: lng + dLng,
        distanceMeters: dist,
        occupiedPorts: used[i],
        totalPorts: total,
        freePorts: total - used[i],
        source: 'FSM',
      };
    });
    // Devuelve TODAS las del radio: getNearbyNaps recorta a maxRows y así sabe
    // si la lista quedó realmente truncada.
    return all.filter(function (n) { return n.distanceMeters <= meters; });
  }
  // NAP actual del cliente (GET /accounts/:n/current-nap), modo demo. Dos
  // cuentas "encontradas" en NAPs del listado mock (mismo napId/código/conteo
  // que mockNearbyNaps alrededor del domicilio mock), el resto NOT_FOUND:
  //   35070291 → NAP índice 2 (7/8, verde), puerto 7, cliente Activo
  //   40123456 → NAP índice 0 (8/8, roja),  puerto 3, cliente Suspendido
  // mockNapPorts pone esa cuenta en ese puerto para que la grilla cuadre.
  const MOCK_CURRENT_NAPS = {
    '35070291': { idx: 2, port: 7, equipmentId: 'ZTEGD434832',
      status: { code: 'A', name: 'ACTIVA', description: 'Activo' } },
    '40123456': { idx: 0, port: 3, equipmentId: 'ZTEGD9A1C2F7',
      status: { code: 'S', name: 'SUSPENDIDA', description: 'Suspendido por mora' } },
  };
  function mockCurrentNapFor(idx) {
    const keys = Object.keys(MOCK_CURRENT_NAPS);
    for (let i = 0; i < keys.length; i++) {
      if (MOCK_CURRENT_NAPS[keys[i]].idx === idx) {
        return Object.assign({ accountNumber: keys[i] }, MOCK_CURRENT_NAPS[keys[i]]);
      }
    }
    return null;
  }
  function mockCurrentNap(accountNumber, coords) {
    const cuenta = String(accountNumber);
    const home = mockClientProfile(cuenta);
    const conCoords = !!(coords && isFinite(coords.latitude) && isFinite(coords.longitude));
    const base = { accountNumber: cuenta, brand: mockBrand() };
    // Sin coordenada del domicilio ni del técnico, como el backend: NO_COORDS.
    if (!conCoords && (typeof home.latitude !== 'number' || typeof home.longitude !== 'number')) {
      return Object.assign(base, {
        found: false, nap: null, portNumber: null, equipmentId: null,
        clientStatus: null, searchedNaps: 0, reason: 'NO_COORDS',
      });
    }
    const center = conCoords ? coords : { latitude: home.latitude, longitude: home.longitude };
    const hit = MOCK_CURRENT_NAPS[cuenta];
    if (!hit) {
      // El backend ahora SIEMPRE devuelve una NAP: si la operadora no la
      // informa, una simulada (simulated:true, source:'SIMULATED') con napId
      // y equipmentId null y código inventado: la app no pide sus puertos.
      const ref = mockNearbyNaps(center, { meters: 1000 })[1];
      const digits = cuenta.replace(/[^0-9]/g, '');
      const sim = {
        napId: null,
        napCode: 'PL' + (10 + (Number(digits.slice(-2) || 0) % 90)) + 'XR' + (1 + (Number(digits.slice(-1) || 0) % 9)),
        networkName: 'OLT-GYE-03/1/4',
        latitude: ref.latitude,
        longitude: ref.longitude,
        distanceMeters: ref.distanceMeters,
        occupiedPorts: ref.occupiedPorts,
        totalPorts: ref.totalPorts,
        freePorts: ref.freePorts,
        source: 'SIMULATED',
      };
      return Object.assign(base, {
        found: true,
        nap: sim,
        portNumber: (Number(digits.slice(-2) || 0) % sim.totalPorts) + 1,
        equipmentId: null,
        clientStatus: { code: 'A', name: 'ACTIVA', description: 'Activo (simulado)' },
        searchedNaps: 0,
        assignment: 'CONTRACTED',
        simulated: true,
        source: 'SIMULATED',
        simulationReason: 'NOT_FOUND',
      });
    }
    const nap = mockNearbyNaps(center, { meters: 1000 })[hit.idx];
    return Object.assign(base, {
      found: true,
      nap: nap,
      portNumber: hit.port,
      equipmentId: hit.equipmentId,
      clientStatus: Object.assign({}, hit.status),
      searchedNaps: hit.idx + 1,
      assignment: 'CONTRACTED',
      simulated: false,
      source: 'FSM',
    });
  }

  // --- Ubicación "Casa cliente" (GET/POST /accounts/:n/client-location) ----
  // Append-only en memoria (se pierde al recargar, igual que el resto del mock).
  const MOCK_CLIENT_LOCATIONS = {};
  function mockHaversine(a, b) {
    const R = 6371000;
    const toRad = function (d) { return d * Math.PI / 180; };
    const dLat = toRad(b.latitude - a.latitude);
    const dLon = toRad(b.longitude - a.longitude);
    const h = Math.pow(Math.sin(dLat / 2), 2)
      + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.pow(Math.sin(dLon / 2), 2);
    return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 10) / 10;
  }
  function mockRegisteredLocation(cuenta) {
    const p = mockClientProfile(cuenta);
    // En demo el backend marca la registrada como MOCK ("de prueba").
    return typeof p.latitude === 'number' && typeof p.longitude === 'number'
      ? { latitude: p.latitude, longitude: p.longitude, source: 'MOCK' } : null;
  }
  function mockClientLocationList(accountNumber) {
    const cuenta = String(accountNumber);
    const items = (MOCK_CLIENT_LOCATIONS[cuenta] || []).slice();
    return { latest: items[0] || null, items: items, registeredLocation: mockRegisteredLocation(cuenta) };
  }
  function mockCreateClientLocation(accountNumber, body) {
    const cuenta = String(accountNumber);
    const b = body || {};
    const lat = Number(b.latitude);
    const lng = Number(b.longitude);
    // Mismas reglas que el backend: (0,0) inválido, accuracyMeters número >= 0
    // opcional (null no), capturedAt no futuro.
    const acc = b.accuracyMeters;
    const accBad = acc !== undefined && (typeof acc !== 'number' || !isFinite(acc) || acc < 0);
    const futuro = b.capturedAt && new Date(b.capturedAt).getTime() > Date.now() + 60000;
    if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180 ||
        (lat === 0 && lng === 0) || accBad || futuro ||
        b.label !== 'CASA_CLIENTE' || (b.source !== 'GPS' && b.source !== 'MANUAL')) {
      const err = new Error('Datos de ubicación inválidos.');
      err.code = 'VALIDATION_ERROR';
      err.status = 400;
      throw err;
    }
    const reg = mockRegisteredLocation(cuenta);
    const cur = mockCurrentNap(cuenta, null);
    const nap = cur && cur.nap && (!b.napCode || cur.nap.napCode === b.napCode) ? cur.nap : null;
    const pt = { latitude: lat, longitude: lng };
    const user = getUser() || { id: 'mock-user-1', email: 'franco@tulpasolutions.com' };
    const now = nowIso();
    const rec = {
      id: uuidMock(),
      accountNumber: cuenta,
      label: 'CASA_CLIENTE',
      latitude: lat,
      longitude: lng,
      accuracyMeters: b.accuracyMeters === undefined ? null : b.accuracyMeters,
      source: b.source,
      napCode: b.napCode || null,
      napPort: b.napPort === undefined ? null : b.napPort,
      taskId: b.taskId || null,
      capturedAt: b.capturedAt || now,
      createdAt: now,
      capturedBy: { id: user.id, email: user.email },
      registeredLocation: reg,
      distanceToRegisteredMeters: reg ? mockHaversine(pt, reg) : null,
      distanceToNapMeters: nap && typeof nap.latitude === 'number' ? mockHaversine(pt, nap) : null,
      napLocation: cur && cur.nap && typeof cur.nap.latitude === 'number'
        ? { latitude: cur.nap.latitude, longitude: cur.nap.longitude, simulated: cur.simulated === true } : null,
    };
    if (b.notes) rec.notes = String(b.notes);
    MOCK_CLIENT_LOCATIONS[cuenta] = [rec].concat(MOCK_CLIENT_LOCATIONS[cuenta] || []);
    return rec;
  }
  // Puertos de una NAP. `napRef` numérico = napId de FSM (detalle real);
  // cualquier otro valor = código de NAP por el camino TEC, sin detalle.
  function mockNapPorts(napRef) {
    const ref = String(napRef);
    if (!/^\d+$/.test(ref)) {
      return {
        napRef: ref,
        napId: null,
        napCode: ref,
        ports: [],
        detailAvailable: false,
        note: 'El detalle puerto a puerto todavía no está expuesto por esta fuente.',
        occupiedPorts: 0,
        totalPorts: 0,
        statusFanOut: { supported: false, pendingAccounts: 0, batchLimit: STATUS_BATCH_LIMIT },
        source: 'TEC',
      };
    }
    const base = Number(ref);
    const idx = base - MOCK_NAP_BASE_ID;
    const known = idx >= 0 && idx < MOCK_NAP_USED.length;
    // NAPs del listado mock: mismo total/ocupados que en mockNearbyNaps.
    // Cualquier otro napId numérico: 16 puertos, 2 de cada 3 ocupados.
    const total = known ? mockNapTotal(idx) : 16;
    const used = known ? MOCK_NAP_USED[idx] : Math.ceil(total * 2 / 3);
    const ports = [];
    for (let i = 0; i < total; i++) {
      // Permutación (5 es coprimo con 8 y 16): reparte los libres por la NAP
      // en vez de dejarlos todos al final.
      const occupied = ((i * 5 + (known ? idx : base)) % total) < used;
      // Los 2 últimos dígitos de la cuenta fijan el estado mock (ver
      // mockStatusBatch): así la NAP 8/8 siempre trae algún cancelado (T).
      const suffix = (i + (known ? idx : base) * 3) % 100;
      // Puerto del cliente de current-nap (mock): su cuenta y su equipo.
      const actual = known ? mockCurrentNapFor(idx) : null;
      if (actual && actual.port === i + 1 && occupied) {
        ports.push({
          portNumber: i + 1,
          occupied: true,
          clientAccountNumber: actual.accountNumber,
          equipmentId: actual.equipmentId,
          clientStatus: null,
          statusPending: true,
        });
        continue;
      }
      ports.push({
        portNumber: i + 1,
        occupied: occupied,
        // El estado NO se consulta en este paso: llega null y statusPending.
        clientAccountNumber: occupied ? String(35070000 + (known ? idx : base % 90) * 100 + suffix) : null,
        equipmentId: occupied ? 'ZTEGD' + (base % 1000) + pad4(i + 1) : null,
        clientStatus: null,
        statusPending: occupied,
      });
    }
    const occupiedPorts = ports.filter(function (p) { return p.occupied; }).length;
    return {
      napRef: ref,
      napId: base,
      napCode: 'NAP-' + ref,
      ports: ports,
      detailAvailable: true,
      occupiedPorts: occupiedPorts,
      totalPorts: total,
      statusFanOut: { supported: true, pendingAccounts: occupiedPorts, batchLimit: STATUS_BATCH_LIMIT },
      source: 'FSM',
    };
  }
  function pad4(n) {
    return ('000' + n).slice(-4);
  }

  // --- ISP Monitor: ficha del terminal y series de 24 h -------------------
  // Los mocks replican la forma que ya devuelve el backend con la API real:
  // 288 muestras de 5 minutos, `online` para el terminal y `terminalsOnline`
  // (cantidad de equipos de la misma red de acceso) para la red.
  function mockStamps(n, stepMs) {
    const now = Date.now();
    const out = [];
    for (let i = n - 1; i >= 0; i--) out.push(new Date(now - i * stepMs).toISOString());
    return out;
  }
  function mockSeries(id, scope, metric) {
    const stamps = mockStamps(288, 300000);
    let keys = [];
    const points = stamps.map(function (t, i) {
      // Perfil determinista por muestra: sin Math.random para que no "baile"
      // entre re-renders del panel.
      const wave = Math.sin((i / 288) * Math.PI * 2);
      if (metric === 'status') {
        if (scope === 'network') {
          keys = ['terminalsOnline'];
          // La red de acceso pierde un par de equipos en la madrugada.
          const dip = i > 60 && i < 78 ? 2 : 0;
          return { t: t, values: { terminalsOnline: 18 - dip } };
        }
        keys = ['online'];
        const down = i > 63 && i < 72;
        return { t: t, values: { online: down ? 0 : 1 } };
      }
      if (metric === 'snr') {
        keys = ['snrDown', 'snrUp'];
        const base = scope === 'terminal' ? 35 : 37;
        return {
          t: t,
          values: {
            snrDown: Math.round((base + wave * 2.5) * 10) / 10,
            snrUp: Math.round((base - 4 + wave * 1.8) * 10) / 10,
          },
        };
      }
      keys = ['corrected', 'uncorrected'];
      const spike = i > 63 && i < 72 ? 3 : 1;
      return {
        t: t,
        values: {
          corrected: Math.round((1.2 + Math.abs(wave) * 1.5) * spike * 1000) / 1000,
          uncorrected: Math.round((0.05 + Math.abs(wave) * 0.12) * spike * 1000) / 1000,
        },
      };
    });

    // SNR y codewords llegan desglosados por canal upstream (formato DOCSIS
    // real): dos canales, cada uno con su propia serie.
    let channels = [];
    if (metric === 'snr' || metric === 'codewords') {
      channels = [
        { label: 'Logical Upstream Channel 0/1.0/0', network: '2G-2', ifIndex: 5000016, keys: keys, points: points },
        {
          label: 'Logical Upstream Channel 0/1.1/0', network: '2G-2 v', ifIndex: 5000018, keys: keys,
          points: points.map(function (p) {
            const shifted = {};
            keys.forEach(function (k) { shifted[k] = Math.round((p.values[k] * 0.97) * 1000) / 1000; });
            return { t: p.t, values: shifted };
          }),
        },
      ];
    }

    return {
      id: id, scope: scope, metric: metric,
      keys: keys, points: points, channels: channels, recognized: true, raw: null,
      fetchedAt: nowIso(),
    };
  }
  function mockTerminalSnapshot(id, opts) {
    const tech = mockTechnology(id, opts && opts.technology).technology;
    return {
      id: id,
      found: true,
      online: true,
      technology: tech,
      city: 'Quito',
      networkIds: [9198],
      event: { active: false, description: null },
      history: [
        { period: 'LastHour', ids: [id], statuses: ['up'], drop: null, events: null },
        { period: 'LastDay', ids: [id], statuses: ['up'], drop: null, events: null },
        { period: 'LastWeek', ids: [id], statuses: ['up'], drop: null, events: null },
        { period: 'LastMonth', ids: ['ZTEGD0BB8294', id], statuses: ['down', 'up'], drop: null, events: null },
      ],
      fields: [
        { key: 'device', path: 'device', value: 9919 },
        { key: 'ifIndex', path: 'ifIndex', value: 285282307 },
        { key: 'index', path: 'index', value: 11 },
      ],
      raw: null,
      fetchedAt: nowIso(),
    };
  }
  // Pista de tecnología (?technology=): mismos sinónimos que el backend.
  function normalizeTechHint(hint) {
    const h = String(hint || '').trim().toUpperCase();
    if (!h) return null;
    if (['GPON', 'ONT', 'ONU', 'XPON', 'FIBRA', 'FTTH'].indexOf(h) >= 0) return 'GPON';
    if (['HFC', 'CABLEMODEM', 'CM', 'DOCSIS'].indexOf(h) >= 0) return 'HFC';
    return null;
  }
  // Tecnología en modo demo: pista → HINT; MAC 12-hex → HFC y serial de
  // vendor (4 letras + 8 hex) → GPON por formato; el resto queda sin
  // identificar (null / UNKNOWN), para probar el selector de la app.
  function mockTechnology(id, hint) {
    const h = normalizeTechHint(hint);
    if (h) return { technology: h, technologySource: 'HINT' };
    const clean = String(id).replace(/[:-]/g, '').toUpperCase();
    if (/^[0-9A-F]{12}$/.test(clean)) return { technology: 'HFC', technologySource: 'ID_FORMAT' };
    if (/^[A-Z]{4}[0-9A-F]{8}$/.test(clean)) return { technology: 'GPON', technologySource: 'ID_FORMAT' };
    return { technology: null, technologySource: 'UNKNOWN' };
  }
  // Instante ISO con offset de Ecuador (…-05:00), como startedAtLocal.
  function isoEcuador(iso) {
    if (!iso) return null;
    const d = new Date(new Date(iso).getTime() - 5 * 3600000);
    return d.toISOString().replace('Z', '-05:00');
  }
  // Caídas (OutageSummary) a partir de la serie de estado del terminal: la
  // más reciente primero. La causa solo la simula el mock.
  function mockOutages(statusSeries, technology) {
    const pts = (statusSeries && statusSeries.points) || [];
    const items = [];
    let cur = null;
    pts.forEach(function (p) {
      const v = p.values ? p.values.online : undefined;
      if (v === undefined) return;
      if (v <= 0 && !cur) cur = { startedAt: p.t, last: p.t };
      else if (v <= 0) cur.last = p.t;
      else if (cur) { cur.endedAt = p.t; items.push(cur); cur = null; }
    });
    if (cur) { cur.endedAt = null; items.push(cur); }
    const until = pts.length ? pts[pts.length - 1].t : nowIso();
    const cause = technology === 'GPON'
      ? { cause: 'LOS', causeLabel: 'Pérdida de señal óptica (LOS)' }
      : technology === 'HFC'
        ? { cause: 'T3_TIMEOUT', causeLabel: 'Timeout T3 (sin respuesta del CMTS)' }
        : { cause: 'UNKNOWN', causeLabel: 'Causa no informada por el monitoreo' };
    const out = items.map(function (o) {
      const end = o.endedAt ? new Date(o.endedAt).getTime() : Date.now();
      return Object.assign({
        startedAt: o.startedAt,
        startedAtLocal: isoEcuador(o.startedAt),
        endedAt: o.endedAt,
        endedAtLocal: isoEcuador(o.endedAt),
        durationSeconds: Math.round((end - new Date(o.startedAt).getTime()) / 1000),
        ongoing: !o.endedAt,
        precisionSeconds: 300,
        simulated: true,
      }, cause);
    }).reverse();
    return {
      source: 'SIMULATED',
      causeSource: 'SIMULATED',
      simulated: true,
      timezone: 'America/Guayaquil',
      window: { from: pts.length ? pts[0].t : null, until: until, hours: 24 },
      count: out.length,
      totalDownSeconds: out.reduce(function (a, o) { return a + o.durationSeconds; }, 0),
      items: out,
    };
  }
  function mockUptime(outages) {
    const last = outages.items[0];
    if (!last) {
      return { seconds: 24 * 3600, since: outages.window.from, sinceLocal: isoEcuador(outages.window.from), lowerBound: true, source: 'SIMULATED' };
    }
    if (last.ongoing) return { seconds: null, since: null, sinceLocal: null, lowerBound: false, source: 'SIMULATED' };
    return {
      seconds: Math.round((Date.now() - new Date(last.endedAt).getTime()) / 1000),
      since: last.endedAt, sinceLocal: last.endedAtLocal, lowerBound: false, source: 'SIMULATED',
    };
  }
  // Semilla determinista por id (los valores no "bailan" entre consultas).
  function idSeed(id) {
    let h = 0;
    String(id).split('').forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) % 1000; });
    return h / 1000;
  }
  function mockGpon(id) {
    const s = idSeed(id);
    const r2 = function (x) { return Math.round(x * 100) / 100; };
    return {
      technology: 'GPON',
      simulated: true,
      sources: { optical: 'SIMULATED', onuState: 'SIMULATED', accessNetwork: 'SIMULATED', oltTopology: 'SIMULATED' },
      onu: { serial: String(id).toUpperCase(), onuId: 1 + Math.round(s * 60), state: 'ONLINE', stateLabel: 'En línea' },
      olt: { name: 'OLT-QUI-06', ponPort: '0/2/' + (1 + Math.round(s * 15)), accessNetworkIds: [9198] },
      optical: { rxPowerDbm: r2(-19 - s * 7), txPowerDbm: r2(2.2 + s * 1.5), oltRxPowerDbm: r2(-22 - s * 5) },
      distanceMeters: 2000 + Math.round(s * 12000),
      temperatureC: r2(38 + s * 10),
      voltageV: r2(3.25 + s * 0.1),
      biasCurrentMa: r2(15 + s * 10),
      thresholds: {
        rxPowerDbm: { min: -27, max: -8, warnBelow: -25 },
        txPowerDbm: { min: 0.5, max: 5 },
        oltRxPowerDbm: { min: -28, max: -8 },
        temperatureCMax: 70,
        voltageV: { min: 3.1, max: 3.5 },
      },
      health: -19 - s * 7 < -25 ? 'WARNING' : 'OK',
      measuredAt: nowIso(),
    };
  }
  function mockDocsis(id) {
    const s = idSeed(id);
    const r1 = function (x) { return Math.round(x * 10) / 10; };
    const sim = ['frequencyMHz', 'powerDbmv', 'snrDb', 'modulation'];
    const ds = [1, 2, 3, 4].map(function (n) {
      return { channelId: 'DS' + n, direction: 'downstream', label: 'Downstream ' + n, frequencyMHz: 555 + n * 8,
        powerDbmv: r1(1.2 + s * 2 + n * 0.2), snrDb: r1(36.5 + s * 2 - n * 0.2), modulation: '256-QAM', simulatedFields: sim };
    });
    const us = [
      { channelId: '5000016', direction: 'upstream', label: 'Logical Upstream Channel 0/1.0/0', frequencyMHz: 18.8,
        powerDbmv: r1(43 + s * 2), snrDb: r1(35 + s), modulation: '64-QAM', simulatedFields: ['frequencyMHz', 'powerDbmv', 'modulation'] },
      { channelId: '5000018', direction: 'upstream', label: 'Logical Upstream Channel 0/1.1/0', frequencyMHz: 25.2,
        powerDbmv: r1(42.6 + s * 2), snrDb: r1(34 + s), modulation: '64-QAM', simulatedFields: ['frequencyMHz', 'powerDbmv', 'modulation'] },
    ];
    const avg = function (arr, k) { return r1(arr.reduce(function (a, c) { return a + c[k]; }, 0) / arr.length); };
    return {
      technology: 'HFC',
      simulated: true,
      sources: { snrUpstream: 'SIMULATED', snrDownstream: 'SIMULATED', power: 'SIMULATED', codewords: 'SIMULATED' },
      downstream: { powerDbmv: avg(ds, 'powerDbmv'), snrDb: avg(ds, 'snrDb'), channels: ds },
      upstream: { powerDbmv: avg(us, 'powerDbmv'), snrDb: avg(us, 'snrDb'), channels: us },
      codewords: { correctedPercent: r1(1.5 + s), uncorrectedPercent: Math.round((0.02 + s * 0.05) * 1000) / 1000 },
      thresholds: {
        downstreamPowerDbmv: { min: -7, max: 7 },
        downstreamSnrDbMin: 33,
        upstreamPowerDbmv: { min: 35, max: 51 },
        upstreamSnrDbMin: 27,
        uncorrectedPercentMax: 0.1,
      },
      health: 'OK',
      measuredAt: nowIso(),
    };
  }
  // Panel completo en modo demo, con la forma de TerminalDiagnostics
  // (2026-09-30): technology/technologySource, docsis|gpon, outages, uptime.
  // Todo simulado (conector en mock) → simulated: true en la raíz.
  function mockDiagnostics(id, opts) {
    const tech = mockTechnology(id, opts && opts.technology);
    const isHfc = tech.technology === 'HFC';
    // SNR y codewords son métricas DOCSIS: solo se "consultan" en HFC.
    const docsisSeries = function (scope, metric) {
      return isHfc
        ? mockSeries(id, scope, metric)
        : { id: id, scope: scope, metric: metric, keys: [], points: [], channels: [], recognized: true, raw: null, fetchedAt: nowIso() };
    };
    const skipped = isHfc ? [] : ['terminal/snr', 'network/snr', 'terminal/codewords', 'network/codewords'].map(function (e) {
      return { endpoint: e, reason: tech.technology === 'GPON'
        ? 'Métrica DOCSIS: la operadora solo la publica para HFC. Este equipo es GPON.'
        : 'Tecnología no identificada: no se consultan métricas DOCSIS.' };
    });
    const terminal = mockTerminalSnapshot(id, opts);
    const status = { terminal: mockSeries(id, 'terminal', 'status'), network: mockSeries(id, 'network', 'status') };
    const outages = mockOutages(status.terminal, tech.technology);
    return {
      id: id,
      terminal: terminal,
      status: status,
      snr: { terminal: docsisSeries('terminal', 'snr'), network: docsisSeries('network', 'snr') },
      codewords: { terminal: docsisSeries('terminal', 'codewords'), network: docsisSeries('network', 'codewords') },
      errors: [],
      skipped: skipped,
      window: { hours: 24, until: nowIso() },
      fetchedAt: nowIso(),
      technology: tech.technology,
      technologySource: tech.technologySource,
      simulated: true,
      docsis: isHfc ? mockDocsis(id) : null,
      gpon: tech.technology === 'GPON' ? mockGpon(id) : null,
      outages: outages,
      uptime: mockUptime(outages),
    };
  }
  // Métricas por cuenta: la tecnología sale de la misma regla que la orden y
  // el monitor. GPON → niveles ópticos (nada DOCSIS); HFC → sin óptica GPON.
  function mockNetworkMetrics(accountNumber) {
    const technology = mockAccountTechnology(accountNumber);
    return {
      accountNumber: accountNumber,
      technology: technology,
      signalLevels: technology === 'GPON' ? { rxDbm: -18.4, txDbm: 2.1 } : null,
      outagesLast24h: 1,
      trafficMbpsIn: 87.3,
      trafficMbpsOut: 12.5,
      measuredAt: nowIso(),
    };
  }
  // --- Tecnología por cuenta (compartida: orden mock e ISP Monitor) --------
  // Espejo de resolveAccountTechnology(accountNumber) del backend: hoy
  // SIMULADA y determinística (~70 % GPON / 30 % HFC). La usan /orders/context
  // e ISP Monitor por cuenta para que orden y monitor no se contradigan.
  // TODO(tytan-real): la tecnología real vendrá del inventario de la operadora.
  // Cuentas fijas de demo (las de la whitelist mock), para recorrer los casos:
  //   35070291 → GPON, equipo working, sin falla
  //   40123456 → GPON, falla interna (solo el cliente lost)
  //   40000600 → GPON, falla externa en la NAP (plan 600)
  //   40001000 → GPON, falla externa en la red de acceso (plan 1000)
  //   35070288 → HFC (cablemódem), sin falla
  const MOCK_ACCOUNT_TECH = {
    '35070291': 'GPON', '40123456': 'GPON', '40000600': 'GPON', '40001000': 'GPON', '35070288': 'HFC',
  };
  const MOCK_ISP_SCENARIO = {
    '35070291': 'NONE', '40123456': 'INTERNAL', '40000600': 'EXTERNAL_NAP',
    '40001000': 'EXTERNAL_NETWORK', '35070288': 'NONE',
  };
  // Hash FNV-1a de 32 bits: estable entre sesiones y navegadores.
  function accountHash(accountNumber) {
    let h = 0x811c9dc5;
    const s = String(accountNumber || '').trim();
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }
  function mockAccountTechnology(accountNumber) {
    const key = String(accountNumber || '').trim();
    if (MOCK_ACCOUNT_TECH[key]) return MOCK_ACCOUNT_TECH[key];
    return accountHash(key) % 10 < 7 ? 'GPON' : 'HFC';
  }
  // ~10 % de las cuentas con falla (interna / NAP / red), determinístico.
  function mockIspScenario(accountNumber) {
    const key = String(accountNumber || '').trim();
    if (MOCK_ISP_SCENARIO[key]) return MOCK_ISP_SCENARIO[key];
    const k = (accountHash(key) >>> 8) % 30;
    return k === 0 ? 'INTERNAL' : k === 1 ? 'EXTERNAL_NAP' : k === 2 ? 'EXTERNAL_NETWORK' : 'NONE';
  }
  function hexFrom(rnd, n) {
    let s = '';
    for (let i = 0; i < n; i++) s += Math.floor(rnd() * 16).toString(16);
    return s.toUpperCase();
  }
  // Identificador del equipo de la cuenta: serial GPON (ZTEG/XPON/STGU + 8 hex)
  // o MAC de 12 hex del cablemódem. Lo comparten la orden mock y el monitor.
  function mockAccountDeviceId(accountNumber, technology) {
    const rnd = seededRandom((accountHash(accountNumber) ^ 0x5bd1e995) >>> 0);
    if ((technology || mockAccountTechnology(accountNumber)) === 'HFC') return hexFrom(rnd, 12);
    const prefix = ['ZTEG', 'ZTEG', 'XPON', 'STGU'][Math.floor(rnd() * 4)];
    return prefix + hexFrom(rnd, 8);
  }
  // Plan en bits: misma fuente que client-profile (plan simulado, simétrico).
  function mockIspPlan(accountNumber) {
    const p = mockClientProfile(accountNumber);
    const down = Number(p.contractedDownloadMbps);
    if (!isFinite(down) || down <= 0) return null;
    const up = Number(p.contractedUploadMbps) > 0 ? Number(p.contractedUploadMbps) : down;
    return {
      profile: 'RES-' + (down * 1000) + '/' + (up * 1000) + '-I',
      downloadKbps: down * 1000, uploadKbps: up * 1000,
      downloadMbps: down, uploadMbps: up,
      name: p.planName || null,
    };
  }
  const MOCK_ISP_CITIES = ['Guayaquil', 'Quito', 'Manta', 'Portoviejo', 'Machala', 'Daule'];
  function titleCity(s) {
    const c = String(s || '').toLowerCase();
    return c ? c.charAt(0).toUpperCase() + c.slice(1) : null;
  }
  // Topología simulada de la cuenta: red de acceso, NAP del cliente, puerto.
  function mockIspTopology(accountNumber, technology) {
    const h = accountHash(accountNumber);
    const rnd = seededRandom((h ^ 0x27d4eb2f) >>> 0);
    const L = function () { return String.fromCharCode(65 + Math.floor(rnd() * 26)); };
    const pre = ['HG', 'QQ', 'GY', 'UI'][h % 4];
    const accessNetwork = pre + (1 + Math.floor(rnd() * 8)) + L() + L();
    const wl = MOCK_WHITELIST[String(accountNumber || '').trim()];
    const city = (wl && titleCity(wl.city)) || MOCK_ISP_CITIES[h % MOCK_ISP_CITIES.length];
    const isGpon = technology === 'GPON';
    const slot = 1 + Math.floor(rnd() * 4);
    const port = 1 + Math.floor(rnd() * 16);
    const onu = 1 + Math.floor(rnd() * 64);
    // NAP del cliente: 6 caracteres (HG4NB2); en HFC es un tap (RM7TF6).
    return {
      city: city,
      accessNetwork: accessNetwork,
      clientNap: accessNetwork.slice(0, 3) + (isGpon ? 'N' : 'T') + L() + (1 + Math.floor(rnd() * 9)),
      port: isGpon ? 'gpon_olt-1/' + slot + '/' + port : 'Cable' + slot + '/0/' + port + '-upstream0',
      onuId: isGpon ? 'gpon-onu_1/' + slot + '/' + port + ':' + onu : null,
      headend: isGpon ? (city.slice(0, 3).toUpperCase() + ' HEADEND ZTE ' + (1 + (h % 4)))
        : (city.slice(0, 3).toUpperCase() + ' CMTS ARRIS E6000 ' + (1 + (h % 3))),
      distanceMeters: 800 + Math.floor(rnd() * 9000),
    };
  }
  function mockIspClientName(accountNumber) {
    return String(mockOrderClientName(accountNumber) || 'CLIENTE XTRIM').toUpperCase();
  }
  function mockIspAccountStatus(accountNumber) {
    const wl = MOCK_WHITELIST[String(accountNumber || '').trim()];
    if (wl && wl.status === 'SUSPENDIDO') return 'S';
    return 'A';
  }
  const HOUR_MS = 3600000;
  // Instante estable durante el día (no "baila" entre consultas).
  function mockAgo(hours) {
    return new Date(ecuadorMidnightUtcMs() + 8 * HOUR_MS - hours * HOUR_MS).toISOString();
  }

  // Validación de la cuenta como el backend: dígitos, 4–12 significativos
  // (sin ceros a la izquierda) → si no, 400; fuera de la whitelist → 404.
  function mockIspCheckAccount(accountNumber) {
    const raw = String(accountNumber || '').trim();
    const significant = raw.replace(/^0+/, '');
    if (!/^\d+$/.test(raw) || significant.length < 4 || significant.length > 12) {
      throw validationError('Número de cuenta inválido: usa solo dígitos (4 a 12).');
    }
    if (!MOCK_WHITELIST[raw]) {
      const err = new Error('La cuenta ' + raw + ' no está en la base de clientes Xtrim.');
      err.code = 'NOT_FOUND';
      err.status = 404;
      throw err;
    }
  }

  // GET /accounts/:n/isp-monitor (modo demo). Mismo shape que el contrato.
  function mockIspMonitor(accountNumber) {
    const cuenta = String(accountNumber || '').trim();
    const technology = mockAccountTechnology(cuenta);
    const isGpon = technology === 'GPON';
    const scenario = mockIspScenario(cuenta);
    const lost = scenario !== 'NONE';
    const topo = mockIspTopology(cuenta, technology);
    const plan = mockIspPlan(cuenta);
    const profile = mockClientProfile(cuenta);
    const serial = mockAccountDeviceId(cuenta, technology);
    const clientName = mockIspClientName(cuenta);
    const h = accountHash(cuenta);
    const rnd = seededRandom((h ^ 0x165667b1) >>> 0);
    const r2 = function (x) { return Math.round(x * 100) / 100; };
    const lastOffline = lost ? mockAgo(1 + (h % 5)) : mockAgo(24 * (3 + (h % 20)));
    const lastOnline = lost ? mockAgo(30 + (h % 48)) : mockAgo(24 * (3 + (h % 20)) - 0.2);
    const cause = lost
      ? (scenario === 'INTERNAL' ? (h % 2 ? 'DYING GASP' : 'ONU LOS') : 'ONU LOS')
      : (h % 3 === 0 ? 'ONU LOS' : 'DYING GASP');
    const accountStatus = mockIspAccountStatus(cuenta);
    let optics = null;
    if (isGpon) {
      if (!lost) {
        const rx = r2(-15 - rnd() * 7);
        const rxOlt = r2(-18 - rnd() * 7);
        const tx = r2(1.8 + rnd() * 1.6);
        optics = { distanceMeters: topo.distanceMeters, rxOltDbm: rxOlt, txDbm: tx, rxDbm: rx,
          voltage: r2(3.24 + rnd() * 0.08), temperatureC: r2(38 + rnd() * 9),
          rxOltOk: rxOlt >= -28 && rxOlt <= -8, txOk: tx >= 0.5 && tx <= 5, rxOk: rx >= -27 && rx <= -8 };
      } else {
        // Equipo lost (como el backend): lecturas numéricas null y flags false.
        optics = { distanceMeters: null, rxOltDbm: null, txDbm: null, rxDbm: null,
          voltage: null, temperatureC: null, rxOltOk: false, txOk: false, rxOk: false };
      }
    }
    const internet = plan ? plan.downloadMbps : 200;
    const portState = lost ? 'down' : 'up';
    const device = {
      serial: serial,
      model: isGpon ? 'F6600V9.0' : 'TG2482A',
      version: isGpon ? 'V9.0' : '9.1.103',
      software: isGpon ? 'V9.0.10P2N8' : '9.1.103S5',
      state: lost ? 'lost' : 'working',
      adminState: accountStatus === 'A' ? 'up' : 'down',   // como el backend
      port: topo.port,
      accessNetwork: topo.accessNetwork,
      headend: topo.headend,
      onuId: topo.onuId,
      lastOnline: lastOnline,
      lastOffline: lastOffline,
      offlineCause: isGpon ? cause : null,                 // HFC: el CMTS no informa causa
      speedMode: isGpon ? 'GPON' : 'DOCSIS 3.1',
      nap: topo.clientNap,
      client: { accountNumber: cuenta, name: clientName, address: profile.address || null },
      servicePorts: isGpon ? [
        { id: 1, mode: 'tag', vlanIn: 950, vlanOut: 950, service: 'INT Residencial',
          trafficProfile: 'DOWN-RES-' + (internet * 1000) + '-I', macLearned: lost ? 0 : 1, state: portState },
      ].concat(h % 3 === 0 ? [{ id: 2, mode: 'tag', vlanIn: 960, vlanOut: 960, service: 'VOIP', trafficProfile: 'VOIP-1M',
        macLearned: lost ? 0 : 1, state: portState }] : []) : [],
      wanIp: isGpon ? 'DHCP' : (lost ? null : '10.' + (h % 200) + '.' + ((h >>> 8) % 250) + '.' + (2 + (h % 250))),
      cpes: lost ? [] : [{
        ip: '190.155.' + (h % 250) + '.' + (2 + ((h >>> 4) % 250)),
        mac: hexFrom(seededRandom((h ^ 7) >>> 0), 12).match(/.{2}/g).join(':'),
        vendor: isGpon ? 'zte' : 'arris',
      }],
      optics: optics,
    };
    let docsis = null;
    if (!isGpon) {
      const r1 = function (x) { return Math.round(x * 10) / 10; };
      docsis = lost
        ? { downstream: [], upstream: [], codewords: { corrected: null, uncorrected: null }, ok: false }
        : {
          downstream: [1, 2, 3, 4, 5, 6, 7, 8].map(function (n) {
            return { channel: n, frequencyMHz: 549 + n * 6, powerDbmv: r1(-1.5 + rnd() * 6), snrDb: r1(36 + rnd() * 4) };
          }),
          upstream: [1, 2, 3, 4].map(function (n) {
            return { channel: n, frequencyMHz: r1(16.4 + n * 6.4), powerDbmv: r1(40 + rnd() * 8), snrDb: r1(31 + rnd() * 6) };
          }),
          codewords: { corrected: 1200 + Math.floor(rnd() * 9000), uncorrected: Math.floor(rnd() * 40) },
          ok: true,
        };
    }
    return {
      simulated: true,
      source: 'ISP_MONITOR',
      technology: technology,
      searchRow: {
        serial: serial, city: topo.city, accessNetwork: topo.accessNetwork,
        profile: plan ? plan.profile : null, accountNumber: cuenta,
        accountStatus: accountStatus, clientName: clientName,
      },
      plan: plan,
      device: device,
      docsis: docsis,
    };
  }

  const MOCK_ISP_NAMES = [
    'GALO ALFREDO ESPINOZA CEDEÑO', 'MARIA JOSE VERA LOOR', 'CARLOS ANDRES PINCAY TOMALA',
    'ROSA ELENA MORAN QUIMI', 'JORGE LUIS BAJAÑA SUAREZ', 'ANA LUCIA CEDEÑO ZAMBRANO',
    'PEDRO PABLO VILLAMAR ROCA', 'GABRIELA ESTEFANIA LEON MERA', 'LUIS FERNANDO ALAVA MERO',
    'KATHERINE PAOLA SALAZAR ORTIZ', 'DIEGO ARMANDO CHOEZ PIGUAVE', 'NANCY BEATRIZ YAGUAL TIGRERO',
    'WILSON EDUARDO MACIAS PONCE', 'VERONICA ALEXANDRA RIZZO PLUAS', 'FREDDY JAVIER CASTRO LINO',
    'PATRICIA MONSERRATE INTRIAGO BRAVO',
  ];
  // Regla de diagnóstico (contrato §2), aplicada sobre los datos ya armados.
  function ispDiagnosis(naps, clientNapCode) {
    let client = null;
    let clientNap = null;
    naps.forEach(function (n) {
      n.devices.forEach(function (d) { if (d.isClient) { client = d; clientNap = n; } });
    });
    if (!client || client.state !== 'lost') {
      return { scope: 'NONE', message: 'El equipo del cliente está working y su NAP no reporta fallas: no hay falla de red visible.' };
    }
    const others = clientNap.devices.filter(function (d) { return !d.isClient; });
    if (others.every(function (d) { return d.state === 'working'; })) {
      return { scope: 'INTERNAL', message: 'Solo el equipo del cliente está lost: la falla es interna (domicilio/drop/equipo).' };
    }
    let total = 0;
    let lostAll = 0;
    let napsWithLost = 0;
    naps.forEach(function (n) {
      total += n.summary.total; lostAll += n.summary.lost;
      if (n.summary.lost > 0) napsWithLost++;
    });
    if (total && lostAll / total >= 0.3 && napsWithLost >= 2) {
      return { scope: 'EXTERNAL_NETWORK', message: lostAll + ' de ' + total + ' equipos de la red de acceso están lost en ' +
        napsWithLost + ' NAPs: la falla es externa en la red de acceso.' };
    }
    if (clientNap.summary.lost / clientNap.summary.total >= 0.5) {
      return { scope: 'EXTERNAL_NAP', message: clientNap.summary.lost + ' de ' + clientNap.summary.total +
        ' equipos de la NAP ' + clientNapCode + ' están lost: la falla es externa en la NAP.' };
    }
    return { scope: 'INTERNAL', message: 'El equipo del cliente está lost y su NAP tiene pocos equipos caídos: revisar primero domicilio/drop/equipo.' };
  }
  function napSummary(devices) {
    const lost = devices.filter(function (d) { return d.state === 'lost'; }).length;
    return {
      total: devices.length, working: devices.length - lost, lost: lost,
      state: lost === 0 ? 'OK' : lost === devices.length ? 'DOWN' : 'PARTIAL',
    };
  }

  // GET /accounts/:n/isp-monitor/access-network (modo demo).
  // TODO(lopdp): en modo real esto expone nombres de terceros (clientes de la
  // misma red de acceso). Hoy es simulado: definir minimización antes de real.
  function mockAccessNetwork(accountNumber) {
    const cuenta = String(accountNumber || '').trim();
    const technology = mockAccountTechnology(cuenta);
    const scenario = mockIspScenario(cuenta);
    const topo = mockIspTopology(cuenta, technology);
    const h = accountHash(cuenta);
    const rnd = seededRandom((h ^ 0x3c6ef372) >>> 0);
    const isGpon = technology === 'GPON';
    const napCount = 4 + Math.floor(rnd() * 4);              // 4..7
    const codes = [topo.clientNap];
    while (codes.length < napCount) {
      // Vecinas: 6 o 7 caracteres (HG4NA10); en HFC, taps (RM7TF12).
      const c = topo.accessNetwork.slice(0, 3) + (isGpon ? 'N' : 'T') +
        String.fromCharCode(65 + Math.floor(rnd() * 26)) + (1 + Math.floor(rnd() * 12));
      if (codes.indexOf(c) === -1) codes.push(c);
    }
    const accountStatusPick = function () { const x = rnd(); return x < 0.88 ? 'A' : x < 0.96 ? 'S' : 'T'; };
    const naps = codes.map(function (code, i) {
      // La NAP del cliente con al menos 3 equipos: así los 3 casos se distinguen.
      const size = i === 0 ? 3 + Math.floor(rnd() * 6) : 2 + Math.floor(rnd() * 7);   // 2..8
      const devices = [];
      for (let k = 0; k < size; k++) {
        const isClient = i === 0 && k === 0;
        const acc = isClient ? cuenta : String(10000000 + Math.floor(rnd() * 89999999));
        devices.push({
          serial: isClient ? mockAccountDeviceId(cuenta, technology)
            : (isGpon ? ['ZTEG', 'STGU', 'XPON'][Math.floor(rnd() * 3)] + hexFrom(rnd, 8) : hexFrom(rnd, 12)),
          accountNumber: acc,
          services: { internet: isClient ? true : rnd() < 0.95, phone: rnd() < 0.4, tv: rnd() < 0.55 },
          clientName: isClient ? mockIspClientName(cuenta) : MOCK_ISP_NAMES[Math.floor(rnd() * MOCK_ISP_NAMES.length)],
          accountStatus: isClient ? mockIspAccountStatus(cuenta) : accountStatusPick(),
          state: 'working',
          isClient: isClient,
        });
      }
      // El cliente no va siempre primero dentro de su NAP.
      if (i === 0) {
        const pos = Math.floor(rnd() * size);
        const tmp = devices[pos]; devices[pos] = devices[0]; devices[0] = tmp;
      }
      return { nap: code, devices: devices };
    });
    const clientNap = naps[0];
    const client = clientNap.devices.filter(function (d) { return d.isClient; })[0];
    if (scenario === 'INTERNAL') {
      client.state = 'lost';
    } else if (scenario === 'EXTERNAL_NAP') {
      // Toda la NAP del cliente lost menos un vecino: ≥50 % y PARCIAL.
      let keep = clientNap.devices.filter(function (d) { return !d.isClient; })[0];
      clientNap.devices.forEach(function (d) { d.state = d === keep ? 'working' : 'lost'; });
    } else if (scenario === 'EXTERNAL_NETWORK') {
      // NAP del cliente y otras NAPs completas lost hasta pasar el 30 % de la red.
      const total = naps.reduce(function (a, n) { return a + n.devices.length; }, 0);
      let lostCount = 0;
      for (let i = 0; i < naps.length && (i < 2 || lostCount / total < 0.3); i++) {
        naps[i].devices.forEach(function (d) { d.state = 'lost'; });
        lostCount += naps[i].devices.length;
      }
    } else if (h % 2 === 0) {
      // Sin falla del cliente, pero un equipo suelto lost en otra NAP (realismo).
      const other = naps[1 + (h % (naps.length - 1))];
      other.devices[other.devices.length - 1].state = 'lost';
    }
    const ordered = naps.map(function (n) { return { nap: n.nap, summary: napSummary(n.devices), devices: n.devices }; });
    const totals = ordered.reduce(function (a, n) {
      return { devices: a.devices + n.summary.total, working: a.working + n.summary.working, lost: a.lost + n.summary.lost };
    }, { devices: 0, working: 0, lost: 0 });
    return {
      simulated: true,
      accessNetwork: topo.accessNetwork,
      technology: technology,
      clientNap: topo.clientNap,
      naps: ordered,
      totals: totals,
      diagnosis: ispDiagnosis(ordered, topo.clientNap),
    };
  }

  function mockNodeEvents() {
    return [
      { type: 'Mantenimiento de red', description: 'Reset general y validación.', status: 'RESUELTO', occurredAt: nowIso() },
    ];
  }
  function mockLanDevices() {
    return [
      { hostname: 'iPhone-Cliente', ipAddress: '192.168.1.45', macAddress: 'A4:B8:7E:11:22:33', leaseExpiresAt: nowIso() },
      { hostname: 'TV-Samsung', ipAddress: '192.168.1.102', macAddress: '00:1A:2B:CC:DD:EE', leaseExpiresAt: nowIso() },
    ];
  }
  function mockWifiDevices() {
    return [
      { hostname: 'iPhone-Cliente', macAddress: 'A4:B8:7E:11:22:33', band: '5GHz', signalDbm: -52 },
      { hostname: 'Laptop-HP',     macAddress: '3C:5A:B4:DE:AD:BE', band: '2.4GHz', signalDbm: -68 },
    ];
  }
  function mockWifiConfig(accountNumber) {
    return {
      accountNumber: accountNumber,
      bands: [
        { band: '2.4GHz', ssid: 'WIFIX_Cliente' },
        { band: '5GHz', ssid: 'WIFIX_Cliente_5G' },
      ],
    };
  }
  // ⚠2 `technician` es siempre null: FSM no expone quién cerró la tarea.
  function mockClosedTask(seed) {
    return {
      taskId: 'TASK/' + (100000 + seed) + '/2026',
      workOrder: mockWorkOrderId(seed),
      occurredAt: new Date(Date.now() - seed * 86400000).toISOString(),
      reason: 'WiFi débil en habitaciones',
      closingNotes: 'Se cambió canal a 5GHz y mejoró cobertura.',
      technician: null,
      result: seed % 2 === 0 ? 'SATISFACTORIA' : 'INSATISFACTORIA',
      notesLoaded: false,
    };
  }
  // Notas de cierre de una orden (se cargan bajo demanda, una por expansión).
  function mockWorkOrderTasks(workOrder) {
    const wo = String(workOrder);
    const digits = wo.replace(/\D/g, '');
    const seed = digits ? Number(digits.slice(-3)) : 0;
    const finishedAt = new Date(Date.now() - (seed % 30) * 86400000).toISOString();
    return {
      workOrder: wo,
      brand: mockBrand(),
      tasks: [
        {
          taskId: 'TASK/' + (294000 + (seed % 900)) + '/2026',
          status: 'CERRADA',
          businessKey: 'BK-' + (seed % 9999),
          createdAt: new Date(Date.parse(finishedAt) - 9000000).toISOString(),
          finishedAt: finishedAt,
          result: seed % 2 === 0 ? 'SATISFACTORIA' : 'INSATISFACTORIA',
          notes: [
            { createdAt: new Date(Date.parse(finishedAt) - 600000).toISOString(),
              content: 'Cliente reporta intermitencia, se reinició la ONT y se validó potencia óptica.' },
            { createdAt: finishedAt,
              content: 'Se reubicó el equipo a la sala; señal WiFi estable en toda la vivienda.' },
          ],
        },
      ],
    };
  }
  function mockAccountOrders(accountNumber, estado) {
    const profile = mockClientProfile(accountNumber);
    const orders = [0, 1, 2].map(function (i) {
      const created = new Date(Date.now() - (i + 1) * 5 * 86400000).toISOString();
      const finished = i === 0 ? null : new Date(Date.parse(created) + 9000000).toISOString();
      return {
        workOrder: mockWorkOrderId(i),
        task: i === 0 ? 'MANTENIMIENTO' : 'INSTALACION',
        state: finished ? 'FINALIZADA' : 'EN PROCESO',
        externalProcess: 'PROC-' + (1000 + i),
        cpartyId: 'CP-' + (500 + i),
        createdAt: created,
        endedAt: finished,
        finished: finished !== null,
        note: 'Orden de prueba generada por el modo demo.',
        latitude: profile.latitude,
        longitude: profile.longitude,
        address: profile.address,
      };
    });
    const filtered = estado === 'Pendientes'
      ? orders.filter(function (o) { return !o.finished; })
      : orders;
    return {
      accountNumber: accountNumber,
      brand: mockBrand(),
      client: {
        names: profile.fullName,
        phoneNumber: profile.phones[0],
        email: profile.email,
        address: profile.address,
        latitude: profile.latitude,
        longitude: profile.longitude,
      },
      orders: filtered,
    };
  }

  // ---------------------------------------------------------------------------
  // Validación de equipo vs plan contratado (contrato 2026-10-01)
  // ---------------------------------------------------------------------------
  // Catálogo mock = los 19 modelos ESTADO_EQUIPO 'Moderno' de "Velocidades por
  // modelos de equipos GPON.xlsx" (Hoja1), con la misma normalización que el
  // script de importación del backend: WIFI 'N/A' → none/null, '300 DESACTIVADO'
  // → disabled/300 (informativo), numérico → enabled. serialPrefixes es solo una
  // pista de marca para filtrar la lista; no identifica el modelo exacto.
  function mockDevice(model, displayName, brand, deviceType, category, wifiTech, eth, wifi, wifiStatus, prefixes) {
    return {
      model: model, displayName: displayName, brand: brand, deviceType: deviceType, category: category,
      wifiTech: wifiTech, ethernetMaxMbps: eth, wifiMaxMbps: wifi, wifiStatus: wifiStatus, serialPrefixes: prefixes,
    };
  }
  const ONT_GPON = 'ONT / ONU (GPON)';
  const MOCK_DEVICE_CATALOG = [
    mockDevice('ROUTER ZXHN H3601P V9 WIFI 6', 'ROUTER ZXHN H3601P V9 WIFI 6', 'ZTE', 'ROUTER', 'Router WiFi', 'WIFI 6', 1000, 1200, 'enabled', ['ZTEL']),
    mockDevice('AX3 DUAL CORE WIFI 6', 'AX3 DUAL CORE WIFI 6', 'HUAWEI', 'ROUTER', 'Router WiFi', 'WIFI 6', 1000, 1000, 'enabled', ['BWH']),
    mockDevice('AX3 QUAD CORE WIFI 6', 'AX3 QUAD CORE WIFI 6', 'HUAWEI', 'ROUTER', 'Router WiFi', 'WIFI 6', 1000, 1000, 'enabled', ['BWH']),
    mockDevice('POWER LINE TP-LINK TLWPA4220 STARTER KIT', 'POWER LINE TP-LINK TLWPA4220 STARTER KIT', 'TP-LINK', 'REPETIDOR POWERLINE', 'Accesorio (Power Line)', 'WIFI 4', 100, 300, 'enabled', []),
    mockDevice('ONT HUR 2001', 'ONT HUR 2001', 'INTELLEGO', 'ONT', ONT_GPON, 'SIN WIFI', 1000, null, 'none', ['STGU']),
    mockDevice('ONU Bridge TXG-B2000', 'ONU Bridge TXG-B2000', 'ONU', 'ONT', ONT_GPON, 'SIN WIFI', 1000, null, 'none', ['XPON']),
    mockDevice('ONU HUR4101XR', 'ONU HUR4101XR', 'INTELLEGO', 'ONT', ONT_GPON, 'SIN WIFI', 1000, null, 'none', ['STGU']),
    mockDevice('ONU300G-1G', 'ONU300G-1G', 'Blik Telecom', 'ONT', ONT_GPON, 'SIN WIFI', 1000, null, 'none', ['STGU']),
    mockDevice('ZXHN F601', 'ZXHN F601', 'ZTE', 'ONT', ONT_GPON, 'SIN WIFI', 1000, null, 'none', ['ZTEG']),
    mockDevice('ZXHN F612C', 'ZXHN F612C', 'ZTE', 'ONT', ONT_GPON, 'SIN WIFI', 1000, null, 'none', ['ZTEG']),
    mockDevice('ZXHN F660', 'ZXHN F660', 'ZTE', 'ONT', ONT_GPON, 'WIFI 4', 1000, 300, 'disabled', ['ZTEG']),
    mockDevice('ZXHN F670L', 'ZXHN F670L', 'ZTE', 'ONT', ONT_GPON, 'WIFI 5', 1000, 500, 'enabled', ['ZTEG']),
    mockDevice('ZXHN F670Y', 'ZXHN F670Y', 'ZTE', 'ONT', ONT_GPON, 'WIFI 5', 1000, 500, 'enabled', ['ZTEG']),
    mockDevice('ZXHN F688 V9.0', 'ZXHN F688 V9.0', 'ZTE', 'ONT', ONT_GPON, 'WIFI 5', 1000, 500, 'enabled', ['ZTEG']),
    mockDevice('ONT OptiXstar HG8145X6', 'ONT OptiXstar HG8145X6', 'HUAWEI', 'ONT', ONT_GPON, 'WIFI 6', 1000, 1000, 'enabled', ['HWTC']),
    mockDevice('ONT ZTE ZXHN F6600 WIFI 6', 'ONT ZTE ZXHN F6600 WIFI 6', 'ZTE', 'ONT', ONT_GPON, 'WIFI 6', 1000, 1000, 'enabled', ['ZTEG']),
    mockDevice('ONT ZTE ZXHN F6600P', 'ONT ZTE ZXHN F6600P', 'ZTE', 'ONT', ONT_GPON, 'WIFI 6', 1000, 1000, 'enabled', ['ZTEG']),
    mockDevice('ONT ZXHN F1611A-1FXS', 'ONT ZXHN F1611A-1FXS', 'ZTE', 'ONT', ONT_GPON, 'WIFI 6', 1000, 1200, 'enabled', ['ZTEG']),
    mockDevice('ONT ZTE XGS-PON ZXHN F8605P', 'ONT XGS-PON ZXHN F8605P', 'ZTE', 'ONT', 'ONT / ONU (XGS-PON)', 'WIFI 6', 2500, 1800, 'enabled', ['ZTEG']),
  ];
  // Etiquetas simuladas (líneas como las devuelve el OCR de ML Kit) para
  // demostrar en el navegador la detección automática del modelo, que en el
  // APK hace la foto real. Combinadas con las cuentas de plan simulado
  // (35070291 → 200, 40000600 → 600, 40001000 → 1000, 40000000 → sin plan)
  // cubren: detección por OCR, único modelo de la marca, ambigua, sin match,
  // bloqueo por plan y aprobado.
  const MOCK_LABEL_SCANS = [
    { id: 'ocr-f670l', title: 'ONT ZTE ZXHN F670L', lines: ['ZTE', 'ZXHN F670L', 'GPON SN: ZTEGD0BB8294', 'MAC: 00:1E:73:4A:9C:21', 'Made in China'] },
    { id: 'marca-hwtc', title: 'ONT Huawei sin modelo legible', lines: ['HUAWEI', 'GPON SN: HWTC8C4D7E21', 'Power 12V 1.5A'] },
    { id: 'ambigua-ax3', title: 'Router Huawei WiFi AX3', lines: ['HUAWEI', 'WiFi AX3', 'S/N: BWH7A1234567'] },
    { id: 'sin-match', title: 'ONT ZTE con el modelo tapado', lines: ['ZTE', 'GPON SN: ZTEGC8F21A77', 'Power 12V 1A'] },
    { id: 'powerline', title: 'Powerline TP-Link TL-WPA4220', lines: ['tp-link', 'AV600 Powerline WiFi Extender', 'Model: TL-WPA4220', 'S/N: 2219876543210'] },
    { id: 'ocr-f6600p', title: 'ONT ZTE ZXHN F6600P', lines: ['ZTE', 'ZXHN F6600P', 'GPON SN: ZTEGC4A1B2C3', 'WiFi 6'] },
  ];
  let mockLabelCursor = 0;
  function mockLabelScan(hint) {
    const h = String(hint || '').toLowerCase();
    const byName = h ? MOCK_LABEL_SCANS.filter(function (s) { return h.indexOf(s.id) !== -1; })[0] : null;
    const s = byName || MOCK_LABEL_SCANS[mockLabelCursor++ % MOCK_LABEL_SCANS.length];
    return { id: s.id, title: s.title, lines: s.lines.slice() };
  }

  const DEVICE_VALIDATION_CATEGORIES = ['instalaciones', 'migraciones', 'visitas'];
  const SERIAL_SOURCES = ['barcode', 'ocr', 'manual'];

  function positiveMbps(v) {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    return typeof n === 'number' && isFinite(n) && n > 0 ? n : null;
  }

  // Regla del contrato, PURA (sin red ni DOM). El servidor es la fuente de
  // verdad; app.js la usa para el feedback inmediato y el mock para responder.
  //   device null (no está en catálogo)          → blocked  [not_in_catalog]
  //   sin planMbps                               → unknown_plan (no bloquea)
  //   ethernetMaxMbps < plan                     → blocked  [ethernet]
  //   wifiStatus 'enabled' && wifiMaxMbps < plan → blocked  [wifi]
  //   wifiStatus 'none' | 'disabled'             → solo cuenta Ethernet
  // Ethernet y WiFi se evalúan las dos (pueden salir ambas razones).
  function evaluateDeviceCapacity(device, planMbps) {
    const plan = positiveMbps(planMbps);
    if (!device) return { result: 'blocked', reasons: [{ kind: 'not_in_catalog' }], planMbps: plan };
    if (plan === null) return { result: 'unknown_plan', reasons: [], planMbps: null };
    const reasons = [];
    const eth = Number(device.ethernetMaxMbps);
    if (!(isFinite(eth) && eth >= plan)) {
      reasons.push({ kind: 'ethernet', deviceMbps: isFinite(eth) ? eth : 0, planMbps: plan });
    }
    if (device.wifiStatus === 'enabled') {
      const wifi = Number(device.wifiMaxMbps);
      if (!(isFinite(wifi) && wifi >= plan)) {
        reasons.push({ kind: 'wifi', deviceMbps: isFinite(wifi) ? wifi : 0, planMbps: plan });
      }
    }
    return { result: reasons.length ? 'blocked' : 'ok', reasons: reasons, planMbps: plan };
  }

  // Texto en español del veredicto (el servidor manda el suyo; este es el del
  // mock y el de la vista previa). Base del contrato + detalle por razón.
  function deviceValidationMessage(outcome) {
    const o = outcome || {};
    const plan = positiveMbps(o.planMbps);
    const planTxt = plan !== null ? plan + ' Mbps' : 'sin dato';
    if (o.result === 'ok') {
      return 'Equipo apto: soporta la máxima capacidad del plan contratado (' + planTxt + ').';
    }
    if (o.result === 'unknown_plan') {
      return 'No se conoce la velocidad del plan contratado: no se pudo comparar con la capacidad del equipo. ' +
        'Puede continuar; quedó registrada una alerta para revisión.';
    }
    const reasons = Array.isArray(o.reasons) ? o.reasons : [];
    if (reasons.some(function (r) { return r && r.kind === 'not_in_catalog'; })) {
      return 'Advertencia: el dispositivo que usted está instalando no es el correcto, ya que no está homologado ' +
        '(no figura en el catálogo de equipos vigentes) y no garantiza la máxima capacidad del plan contratado (' +
        planTxt + '); por lo tanto, no le va a dar un buen servicio al cliente.';
    }
    const detail = reasons.map(function (r) {
      if (r.kind === 'ethernet') return 'su enlace Ethernet llega a ' + r.deviceMbps + ' Mbps';
      if (r.kind === 'wifi') return 'su WiFi llega a ' + r.deviceMbps + ' Mbps';
      return '';
    }).filter(Boolean).join(' y ');
    return 'Advertencia: el dispositivo que usted está instalando no es el correcto, ya que no permite la máxima ' +
      'capacidad del plan contratado (' + planTxt + ') y, por lo tanto, no le va a dar un buen servicio al cliente.' +
      (detail ? ' Detalle: ' + detail + '.' : '');
  }

  // Append-only en memoria (se pierde al recargar, igual que el resto del mock).
  const MOCK_DEVICE_VALIDATIONS = {};
  function mockCreateDeviceValidation(accountNumber, body) {
    const cuenta = String(accountNumber || '').trim();
    const b = body || {};
    const serial = typeof b.serial === 'string' ? b.serial.trim() : '';
    const model = typeof b.model === 'string' ? b.model.trim() : '';
    if (!cuenta || !serial || !model || DEVICE_VALIDATION_CATEGORIES.indexOf(b.category) === -1 ||
        (b.serialSource !== undefined && SERIAL_SOURCES.indexOf(b.serialSource) === -1) ||
        (b.taskId !== undefined && typeof b.taskId !== 'string')) {
      const err = new Error('Datos de validación de equipo inválidos.');
      err.code = 'VALIDATION_ERROR';
      err.status = 400;
      throw err;
    }
    // Igual que el backend: acepta MODELO o displayName, sin distinguir
    // mayúsculas ni espacios (F8605P: model y display difieren).
    const norm = function (x) { return String(x || '').toUpperCase().replace(/\s+/g, ' ').trim(); };
    const device = MOCK_DEVICE_CATALOG.filter(function (d) {
      return norm(d.model) === norm(model) || norm(d.displayName) === norm(model);
    })[0] || null;
    const profile = mockClientProfile(cuenta);
    const planMbps = positiveMbps(profile.contractedDownloadMbps);
    const planSource = profile.sources && profile.sources.contractedDownloadMbps === 'MOCK' ? 'simulated' : 'real';
    const outcome = evaluateDeviceCapacity(device, planMbps);
    const user = getUser() || { id: 'mock-user-1', email: 'franco@tulpasolutions.com' };
    const rec = {
      id: uuidMock(),
      accountNumber: cuenta,
      category: b.category,
      serial: serial,
      model: model,
      serialSource: b.serialSource || null,
      taskId: b.taskId || null,
      result: outcome.result,
      planMbps: planMbps,
      planSource: planSource,
      device: device ? Object.assign({}, device, { serialPrefixes: device.serialPrefixes.slice() }) : null,
      reasons: outcome.reasons,
      message: deviceValidationMessage({ result: outcome.result, reasons: outcome.reasons, planMbps: planMbps }),
      technician: { id: user.id, email: user.email, name: user.name || null },
      createdAt: nowIso(),
    };
    MOCK_DEVICE_VALIDATIONS[cuenta] = [rec].concat(MOCK_DEVICE_VALIDATIONS[cuenta] || []);
    return rec;
  }

  // ---------------------------------------------------------------------------
  // Orden de trabajo TYTAN (simulada) — contrato ronda 2026-10-06 §2-§5
  // ---------------------------------------------------------------------------
  // Todo es determinístico por nº de orden: la misma orden devuelve siempre la
  // misma cuenta, tareas y equipos (semilla = dígitos de la orden).
  function validationError(message) {
    const err = new Error(message);
    err.code = 'VALIDATION_ERROR';
    err.status = 400;
    return err;
  }

  // 'ORDER/463158/2026' | '463158' → 'ORDER/463158/2026' (año actual si solo
  // vienen los dígitos). null si el formato no es válido.
  function normalizeOrderNumber(raw) {
    const s = String(raw === null || raw === undefined ? '' : raw).replace(/\s+/g, '').toUpperCase();
    let m = /^ORDER\/(\d{4,10})\/(\d{4})$/.exec(s);
    if (m) return 'ORDER/' + m[1] + '/' + m[2];
    m = /^(\d{4,10})$/.exec(s);
    if (m) return 'ORDER/' + m[1] + '/' + new Date().getFullYear();
    return null;
  }

  // 'TASK/549487/2026' | '549487' → 'TASK/549487/2026'. 6-7 dígitos (§4).
  function normalizeTaskId(raw) {
    const s = String(raw === null || raw === undefined ? '' : raw).replace(/\s+/g, '').toUpperCase();
    let m = /^TASK\/(\d{6,7})\/(\d{4})$/.exec(s);
    if (m) return 'TASK/' + m[1] + '/' + m[2];
    m = /^(\d{6,7})$/.exec(s);
    if (m) return 'TASK/' + m[1] + '/' + new Date().getFullYear();
    return null;
  }

  // PRNG determinístico (mulberry32) para que la orden "no baile".
  function seededRandom(seed) {
    let a = (Number(seed) >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function orderDigits(workOrder) {
    const m = /^ORDER\/(\d+)\//.exec(String(workOrder || ''));
    return m ? Number(m[1]) : 0;
  }
  function orderYear(workOrder) {
    const m = /\/(\d{4})$/.exec(String(workOrder || ''));
    return m ? Number(m[1]) : new Date().getFullYear();
  }
  // Cuenta de la orden: sale de la whitelist mock (pasa el bloqueo aguas abajo).
  // Se excluyen las cuentas de prueba "sin datos en FSM": la orden TYTAN sí
  // trae al cliente. Object.keys ordena numéricamente: el orden es estable.
  function mockOrderAccount(n) {
    const keys = Object.keys(MOCK_WHITELIST).filter(function (k) { return !MOCK_FSM_NO_DATA[k]; });
    return keys.length ? keys[n % keys.length] : '40123456';
  }
  function mockOrderClientName(account) {
    const docs = Object.keys(MOCK_LOOKUP);
    for (let i = 0; i < docs.length; i++) {
      const hit = MOCK_LOOKUP[docs[i]].filter(function (m) { return m.n === account; })[0];
      if (hit) return hit.fullName;
    }
    const p = mockClientProfile(account);
    return p.fullName || 'CLIENTE XTRIM';
  }

  const MOCK_ORDER_CREWS = [
    'CONN-154 GYE MIGRA | LLANOS SANCHEZ RODNEY ALBERTO',
    'CONN-087 GYE VISTEC | MORAN QUIMI JOSE LUIS',
    'CONN-212 GYE INSTAL | VERA CASTRO ANDRES FELIPE',
    'CONN-033 GYE VISTEC | PINCAY TOMALA KEVIN DAVID',
  ];
  const MOCK_ORDER_REASONS_OK = [
    'CAMBIO DE MATERIAL EXTERNO DAÑO POR TERCEROS',
    'CAMBIO DE CONECTOR EN ROSETA',
    'REUBICACIÓN DE EQUIPO A PEDIDO DEL CLIENTE',
    'CAMBIO DE EQUIPO POR FALLA',
  ];
  const MOCK_ORDER_REASONS_KO = [
    'CLIENTE NO SE ENCUENTRA EN DOMICILIO',
    'FALLA MASIVA EN RED DE ACCESO',
    'NAP SIN PUERTOS DISPONIBLES',
  ];
  const MOCK_ORDER_MATERIALS = [
    { name: 'CONECTOR SC APC SM PARA FUSION [MIN-CON-033]', type: 'Material' },
    { name: 'DROP FIBRA OPTICA 1 HILO (METROS) [MIN-FIB-010]', type: 'Material' },
    { name: 'ROSETA OPTICA 1 PUERTO [MIN-ROS-002]', type: 'Material' },
    { name: 'GRAPA PLASTICA PARA DROP [MIN-GRA-005]', type: 'Material' },
    { name: 'CABLE COAXIAL RG6 (METROS) [MIN-COA-001]', type: 'Material' },
    { name: 'PATCH CORD UTP CAT6 1.5M [MIN-PAT-004]', type: 'Material' },
  ];
  const DAY_MS = 86400000;
  // Medianoche de hoy en Ecuador (UTC-5), como instante UTC: las fechas mock
  // son estables durante el día (misma orden → mismos datos).
  function ecuadorMidnightUtcMs() {
    const ec = new Date(Date.now() - 5 * 3600000);
    return Date.UTC(ec.getUTCFullYear(), ec.getUTCMonth(), ec.getUTCDate()) + 5 * 3600000;
  }

  function mockOrderContext(workOrder) {
    const wo = normalizeOrderNumber(workOrder);
    if (!wo) throw validationError('Formato de orden inválido. Usa ORDER/463158/2026 o solo el número.');
    const n = orderDigits(wo);
    const year = orderYear(wo);
    const rnd = seededRandom(n);
    const pick = function (arr) { return arr[Math.floor(rnd() * arr.length)]; };
    const account = mockOrderAccount(n);
    const profile = mockClientProfile(account);
    // Misma regla que ISP Monitor por cuenta (orden y monitor no se contradicen).
    const technology = mockAccountTechnology(account);
    // HFC no tiene Migración (como el backend): esas órdenes quedan en Visita Técnica.
    const orderType = (function (t) { return technology === 'HFC' && t === 'Migración' ? 'Visita Técnica' : t; })(['Visita Técnica', 'Migración', 'Instalación'][n % 3]);
    const sig = { 'Visita Técnica': 'FSM_VISTEC', 'Migración': 'FSM_MIGRA', 'Instalación': 'FSM_INSTAL' }[orderType];
    const open = n % 5 !== 0;           // 4 de cada 5 órdenes con la tarea de hoy pendiente
    const count = 2 + (n % 4);          // 2..5 tareas
    const midnight = ecuadorMidnightUtcMs();
    const tasks = [];
    for (let i = 0; i < count; i++) {
      // i = 0 es la más reciente (hoy si la orden sigue abierta).
      const daysAgo = i === 0 ? (open ? 0 : 1 + Math.floor(rnd() * 2)) : i * 2 + Math.floor(rnd() * 2);
      const schedFrom = midnight - daysAgo * DAY_MS + (8 + Math.floor(rnd() * 6)) * 3600000;
      const schedTo = schedFrom + 2 * 3600000;
      const taskNum = 500000 + ((n * 37 + i * 1009) % 99999);
      const pendiente = open && i === 0;
      const cancelado = !pendiente && rnd() < 0.3;
      const status = pendiente ? 'Pendiente' : (cancelado ? 'Cancelado' : 'Realizado');
      const doneFrom = status === 'Realizado' ? schedFrom + Math.floor(rnd() * 40) * 60000 : null;
      const doneTo = doneFrom ? doneFrom + (35 + Math.floor(rnd() * 70)) * 60000 : null;
      let closure = null;
      if (status === 'Realizado') {
        const ok = rnd() < 0.7;
        const nMat = ok ? 1 + Math.floor(rnd() * 3) : Math.floor(rnd() * 2);
        const mats = [];
        for (let k = 0; k < nMat; k++) {
          const mt = MOCK_ORDER_MATERIALS[(n + i + k * 2) % MOCK_ORDER_MATERIALS.length];
          if (mats.some(function (x) { return x.name === mt.name; })) continue;
          mats.push({ name: mt.name, type: mt.type, quantity: 1 + Math.floor(rnd() * 6) });
        }
        const napLvl = -(13 + Math.floor(rnd() * 5));
        const ptoLvl = napLvl - (2 + Math.floor(rnd() * 5));
        closure = {
          result: ok ? 'Satisfactoria' : 'Insatisfactoria',
          reason: ok ? pick(MOCK_ORDER_REASONS_OK) : pick(MOCK_ORDER_REASONS_KO),
          notes: 'CTO: QQ4JC1 PTO ' + (1 + Math.floor(rnd() * 8)) + '. NIVELES EN EL PUNTO: ' + ptoLvl +
            ' NIVELES EN LA NAP ' + napLvl + '. ' + (ok ? 'SE DEJA SERVICIO OPERATIVO, CLIENTE CONFORME.' : 'SE REAGENDA VISITA.'),
          materials: mats,
        };
      } else if (status === 'Cancelado') {
        closure = {
          result: 'Insatisfactoria',
          reason: pick(MOCK_ORDER_REASONS_KO),
          notes: 'TAREA CANCELADA. SE NOTIFICA A CALL CENTER PARA REAGENDAR.',
          materials: [],
        };
      }
      tasks.push({
        taskId: 'TASK/' + taskNum + '/' + year,
        taskType: orderType + ' ' + technology,
        status: status,
        doneFrom: doneFrom ? new Date(doneFrom).toISOString() : null,
        doneTo: doneTo ? new Date(doneTo).toISOString() : null,
        scheduledFrom: new Date(schedFrom).toISOString(),
        scheduledTo: new Date(schedTo).toISOString(),
        assignedTo: pick(MOCK_ORDER_CREWS),
        priority: 1 + (i % 3),
        closure: closure,
      });
    }
    const oldest = tasks[tasks.length - 1];
    const createdAt = new Date(Date.parse(oldest.scheduledFrom) - DAY_MS).toISOString();
    const isGpon = technology === 'GPON';
    const serviceBase = 156000000 + (n % 99999);
    const mac = function (seed) {
      let s = '';
      const r = seededRandom(seed);
      for (let k = 0; k < 6; k++) s += ('0' + Math.floor(r() * 256).toString(16)).slice(-2);
      return s.toUpperCase();
    };
    const equipment = [
      {
        serviceId: String(serviceBase + 1), status: 'Aprovisionado',
        type: 'SERVICE CALL+' + technology, shortName: 'Modem', productName: 'Modem',
        model: isGpon ? 'ONT ZTE ZXHN F6600 WIFI 6' : 'CABLEMODEM ARRIS TG2482A',
        // GPON: el serial que ve ISP Monitor; HFC: la MAC del cablemódem.
        serial: isGpon ? mockAccountDeviceId(account, technology) : 'ARR' + String(n).padStart(9, '0'),
        mac: isGpon ? mac(n + 1) : mockAccountDeviceId(account, technology),
      },
      {
        serviceId: String(serviceBase + 2), status: 'Aprovisionado',
        type: 'INTERNET ' + technology, shortName: 'Internet', productName: 'Internet ' + (profile.contractedDownloadMbps || 200) + ' Mbps',
        model: null, serial: null, mac: null,
      },
    ];
    if (n % 3 !== 1) {
      equipment.push({
        serviceId: String(serviceBase + 3), status: 'Aprovisionado',
        type: 'EXTENSOR WIFI', shortName: 'Extensor', productName: 'Extensor WiFi',
        model: 'EXTENSOR TP-LINK DECO X20', serial: '22' + String(n).padStart(10, '0'), mac: mac(n + 3),
      });
    }
    if (n % 4 === 0) {
      equipment.push({
        serviceId: String(serviceBase + 4), status: 'Aprovisionado',
        type: 'TELEVISION ' + technology, shortName: 'Decodificador', productName: 'Decodificador HD',
        model: 'DECODIFICADOR KAONMEDIA KSTB6077', serial: 'KM' + String(n).padStart(10, '0'), mac: mac(n + 4),
      });
    }
    // NAP del cliente y red de acceso: los mismos que ve ISP Monitor.
    const topoIsp = mockIspTopology(account, technology);
    return {
      simulated: true,
      source: 'TYTAN',
      order: {
        workOrder: wo,
        orderType: orderType,
        technology: technology,
        status: open ? 'En curso' : (tasks[0].status === 'Cancelado' ? 'Cancelado' : 'Realizado'),
        createdAt: createdAt,
        closedAt: open ? null : (tasks[0].doneTo || tasks[0].scheduledTo),
        slaAt: new Date(Date.parse(createdAt) + 3 * DAY_MS).toISOString(),
        externalSystem: 'TYTAN',
        externalId: String(38000000 + (n % 999999)),
        signatureProcess: sig + '/' + (100000 + (n % 899999)) + '/' + year,
      },
      client: {
        accountNumber: account,
        fullName: mockOrderClientName(account),
        phones: Array.isArray(profile.phones) ? profile.phones.slice() : [],
        address: profile.address || null,
        latitude: typeof profile.latitude === 'number' ? profile.latitude : null,
        longitude: typeof profile.longitude === 'number' ? profile.longitude : null,
        napCode: topoIsp.clientNap,
        zoneCode: topoIsp.accessNetwork,
      },
      tasks: tasks,
      equipment: equipment,
      registeredAddress: profile.address || null,
      observations: [
        'Cliente reporta ' + (isGpon ? 'intermitencia en la fibra' : 'lentitud en el cablemódem') + ' en horario nocturno.',
        'Llamar antes de llegar. Referencia: casa esquinera, portón ' + pick(['verde', 'negro', 'blanco']) + '.',
      ].join(' '),
    };
  }

  function mockLookupByOrder(order) {
    const wo = normalizeOrderNumber(order);
    if (!wo) throw validationError('Formato de orden inválido. Usa ORDER/463158/2026 o solo el número.');
    const ctx = mockOrderContext(wo);
    const acc = ctx.client.accountNumber;
    const w = MOCK_WHITELIST[acc] || {};
    return {
      by: 'order',
      workOrder: wo,
      simulated: true,
      source: 'TYTAN',
      matches: [{
        accountNumber: acc, status: w.status || 'ACTIVO', city: w.city || null, node: w.node || null,
        businessType: w.businessType || null, accountType: w.accountType || null,
        accessType: w.accessType || null, fullName: ctx.client.fullName,
      }],
      count: 1,
      truncated: false,
      importedAt: MOCK_WHITELIST_IMPORTED_AT,
    };
  }

  function mockTaskCheck(workOrder, taskId) {
    const wo = normalizeOrderNumber(workOrder);
    const tid = normalizeTaskId(taskId);
    if (!wo) throw validationError('Formato de orden inválido. Usa ORDER/463158/2026 o solo el número.');
    if (!tid) throw validationError('Formato de task inválido. Usa TASK/549487/2026 o solo el número (6-7 dígitos).');
    const ctx = mockOrderContext(wo);
    const task = ctx.tasks.filter(function (t) { return t.taskId === tid; })[0];
    if (!task) return { valid: false, reason: 'TASK_NOT_IN_ORDER', taskId: tid, workOrder: wo, simulated: true };
    return { valid: true, taskId: tid, workOrder: wo, task: task, simulated: true };
  }

  // NAP elegida en Instalación (append-only en memoria, como el resto del mock).
  const MOCK_NAP_ASSIGNMENTS = {};
  const NAP_ASSIGNMENT_SOURCES = ['FSM', 'TEC', 'MOCK'];
  function mockCreateNapAssignment(accountNumber, body) {
    const cuenta = String(accountNumber || '').trim();
    const b = body || {};
    const numOrNull = function (v) { return v === null || v === undefined || (typeof v === 'number' && isFinite(v)); };
    const napCode = typeof b.napCode === 'string' ? b.napCode.trim() : '';
    if (!cuenta || !napCode || NAP_ASSIGNMENT_SOURCES.indexOf(b.source) === -1 ||
        !numOrNull(b.latitude) || !numOrNull(b.longitude) || !numOrNull(b.distanceMeters) ||
        !(b.port === null || b.port === undefined || (Number.isInteger(b.port) && b.port > 0))) {
      throw validationError('Datos de la NAP elegida inválidos.');
    }
    const user = getUser() || { id: 'mock-user-1', email: 'franco@tulpasolutions.com' };
    const row = {
      id: uuidMock(),
      accountNumber: cuenta,
      napId: b.napId === undefined || b.napId === null ? null : String(b.napId),
      napCode: napCode,
      napName: b.napName || null,
      port: b.port === undefined ? null : b.port,
      latitude: b.latitude === undefined ? null : b.latitude,
      longitude: b.longitude === undefined ? null : b.longitude,
      distanceMeters: b.distanceMeters === undefined ? null : b.distanceMeters,
      source: b.source,
      taskId: b.taskId || null,
      workOrder: b.workOrder || null,
      technicianId: user.id,
      createdAt: nowIso(),
    };
    MOCK_NAP_ASSIGNMENTS[cuenta] = [row].concat(MOCK_NAP_ASSIGNMENTS[cuenta] || []);
    return row;
  }
  function mockNapAssignmentList(accountNumber) {
    const items = (MOCK_NAP_ASSIGNMENTS[String(accountNumber || '').trim()] || []).slice();
    return { latest: items[0] || null, items: items };
  }

  // ---------------------------------------------------------------------------
  // API pública
  // ---------------------------------------------------------------------------
  const WifixAPI = {
    // true = habla con el backend real (default). Poner false para usar
    // los mocks locales sin backend (útil para demos sin servidor).
    useRealApi: true,

    // URL efectiva del backend. Es un getter: se recalcula en cada lectura, así
    // que refleja el override de localStorage sin recargar la app. Asignar
    // `WifixAPI.baseUrl = '...'` guarda el override (equivale a setBaseUrl);
    // asignar '' o null lo borra y vuelve a la resolución automática.
    get baseUrl() { return resolveBackendUrl(); },
    set baseUrl(url) { setBackendUrlOverride(url); },
    getBaseUrl: resolveBackendUrl,
    setBaseUrl: setBackendUrlOverride,
    getBaseUrlOverride: getBackendUrlOverride,

    // ---- Sesión ------------------------------------------------------------
    isAuthenticated() {
      return Boolean(getToken());
    },
    getCurrentUser: getUser,
    getToken: getToken,
    // Marca (realm) de la operadora: viaja como header X-Wifix-Brand en todas
    // las peticiones. null = el backend usa su marca por defecto.
    getBrand: getBrand,
    setBrand: setBrand,
    logout() {
      setToken(null);
      setUser(null);
    },

    async login(email, password) {
      if (this.useRealApi) {
        const data = await fetchJson('POST', '/auth/login', { email: email, password: password });
        setToken(data.token);
        setUser(data.user);
        return data;
      }
      await delay(120);
      if (!email || !password) {
        const err = new Error('Correo y contraseña son obligatorios.');
        err.code = 'VALIDATION_ERROR';
        throw err;
      }
      // Mock: credenciales de demostración.
      if (email !== 'franco@tulpasolutions.com' || password !== 'wifix-dev-2026') {
        const err = new Error('Correo o contraseña inválidos.');
        err.code = 'UNAUTHORIZED';
        throw err;
      }
      const fakeUser = { id: 'mock-user-1', email: email, name: 'Franco Ceruso', active: true };
      const fakeToken = 'mock.' + btoa(email) + '.token';
      setToken(fakeToken);
      setUser(fakeUser);
      return { token: fakeToken, user: fakeUser };
    },

    async getMe() {
      if (this.useRealApi) return fetchJson('GET', '/auth/me');
      await delay(40);
      return getUser();
    },

    // ---- Catálogos ---------------------------------------------------------
    async listEquipmentModels() {
      if (this.useRealApi) return fetchJson('GET', '/catalogs/equipment-models');
      await delay(50);
      return MOCK_EQUIPMENT_MODELS;
    },
    async listRemovalReasons() {
      if (this.useRealApi) return fetchJson('GET', '/catalogs/removal-reasons');
      await delay(50);
      return MOCK_REMOVAL_REASONS;
    },
    async listNetworkServers() {
      if (this.useRealApi) return fetchJson('GET', '/catalogs/network-servers');
      await delay(50);
      return MOCK_NETWORK_SERVERS;
    },
    async listSpeedtestServers() {
      if (this.useRealApi) return fetchJson('GET', '/catalogs/speedtest-servers');
      await delay(50);
      return MOCK_SPEEDTEST_SERVERS;
    },

    // ---- Herramientas ------------------------------------------------------
    async createDistanceMeasurement(accountNumber, payload) {
      const body = await withVisitContext(accountNumber, Object.assign({ measuredAt: nowIso() }, payload));
      if (this.useRealApi) return fetchJson('POST', '/distance-measurements', body);
      await delay(80);
      return Object.assign({ id: uuidMock(), createdAt: nowIso() }, body);
    },
    async createSpeedtest(accountNumber, payload) {
      const body = await withVisitContext(accountNumber, Object.assign({ measuredAt: nowIso() }, payload));
      if (this.useRealApi) return fetchJson('POST', '/speedtests', body);
      await delay(80);
      return Object.assign({ id: uuidMock(), createdAt: nowIso() }, body);
    },
    async createWifiHeatmap(accountNumber, payload) {
      const body = await withVisitContext(accountNumber, payload);
      if (this.useRealApi) return fetchJson('POST', '/wifi-heatmaps', body);
      await delay(80);
      return Object.assign({ id: uuidMock(), createdAt: nowIso() }, body);
    },
    async listWifiHeatmaps(accountNumber, opts) {
      const params = new URLSearchParams({ accountNumber, ...(opts || {}) });
      if (this.useRealApi) return fetchJson('GET', `/wifi-heatmaps?${params.toString()}`);
      await delay(40);
      return { items: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 } };
    },
    async getWifiHeatmap(id) {
      if (this.useRealApi) return fetchJson('GET', `/wifi-heatmaps/${encodeURIComponent(id)}`);
      await delay(40);
      return null;
    },
    async listWifiAccessPoints(accountNumber) {
      if (this.useRealApi) return fetchJson('GET', `/accounts/${encodeURIComponent(accountNumber)}/wifi-access-points`);
      await delay(40);
      return [];
    },
    async upsertWifiAccessPoint(accountNumber, payload) {
      if (this.useRealApi) return fetchJson('POST', `/accounts/${encodeURIComponent(accountNumber)}/wifi-access-points`, payload);
      await delay(50);
      return Object.assign({ id: uuidMock(), accountNumber, createdAt: nowIso(), updatedAt: nowIso() }, payload);
    },
    async updateWifiAccessPoint(id, patch) {
      if (this.useRealApi) return fetchJson('PATCH', `/wifi-access-points/${encodeURIComponent(id)}`, patch);
      await delay(50);
      return Object.assign({ id, updatedAt: nowIso() }, patch);
    },
    async createPingTest(accountNumber, payload) {
      const body = await withVisitContext(accountNumber, Object.assign({ measuredAt: nowIso() }, payload));
      if (this.useRealApi) return fetchJson('POST', '/ping-tests', body);
      await delay(80);
      return Object.assign({ id: uuidMock(), createdAt: nowIso() }, body);
    },
    async createTracerouteTest(accountNumber, payload) {
      const body = await withVisitContext(accountNumber, Object.assign({ measuredAt: nowIso() }, payload));
      if (this.useRealApi) return fetchJson('POST', '/traceroute-tests', body);
      await delay(80);
      return Object.assign({ id: uuidMock(), createdAt: nowIso() }, body);
    },

    // ---- Equipos retirados -------------------------------------------------
    async createRetiredEquipment(accountNumber, payload) {
      const body = await withVisitContext(accountNumber, Object.assign({ retiredAt: nowIso() }, payload));
      if (this.useRealApi) return fetchJson('POST', '/retired-equipment', body);
      await delay(80);
      return Object.assign({ id: uuidMock(), createdAt: nowIso() }, body);
    },

    // ---- Media (foto del código de barras) ---------------------------------
    async uploadMedia(file) {
      if (this.useRealApi) {
        const form = new FormData();
        form.append('file', file);
        const token = getToken();
        const headers = {};
        if (token) headers['Authorization'] = 'Bearer ' + token;
        let res;
        try {
          res = await fetch(resolveBackendUrl() + '/media', { method: 'POST', body: form, headers: headers });
        } catch (netErr) {
          throw networkError(netErr);
        }
        const data = await res.json().catch(function () { return null; });
        if (!res.ok) {
          if (res.status === 401) { setToken(null); setUser(null); emitUnauthorized(); }
          const err = new Error((data && data.message) || 'Error al subir archivo.');
          err.code = (data && data.code) || 'HTTP_' + res.status;
          throw err;
        }
        return data;
      }
      await delay(120);
      return {
        id: uuidMock(),
        url: 'mock://media/' + encodeURIComponent(file.name),
        contentType: file.type || 'image/jpeg',
        sizeBytes: file.size || 0,
        createdAt: nowIso(),
      };
    },

    // ---- Historial de la cuenta -------------------------------------------
    // ---- Validación de equipo vs plan contratado ---------------------------
    // Catálogo de equipos homologados: { items: [{ model, displayName, brand,
    // deviceType, category, wifiTech, ethernetMaxMbps, wifiMaxMbps,
    // wifiStatus, serialPrefixes }] }.
    async getDeviceCatalog() {
      if (this.useRealApi) return fetchJson('GET', '/device-catalog');
      await delay(60);
      return { items: MOCK_DEVICE_CATALOG.map(function (d) { return Object.assign({}, d, { serialPrefixes: d.serialPrefixes.slice() }); }) };
    },
    // POST append-only (201). body = { serial, model, category, taskId?,
    // serialSource? }. Sin taskId se manda el de la visita en curso, igual que
    // en los demás registros por visita (si no hay, lo asigna el backend).
    // NO pasa por la guardia de registros: validar otro equipo es justamente la
    // salida de un bloqueo.
    async createDeviceValidation(accountNumber, body) {
      assertTaskAllowed(accountNumber);
      const b = Object.assign({}, body || {});
      if (b.taskId === undefined || b.taskId === null || String(b.taskId).trim() === '') {
        delete b.taskId;
        if (typeof taskIdResolver === 'function') {
          try {
            const t = await taskIdResolver(String(accountNumber || '').trim());
            if (t && String(t).trim()) b.taskId = String(t).trim();
          } catch (_) { /* sin taskId: el backend lo asigna */ }
        }
      }
      if (this.useRealApi) {
        return fetchJson('POST', '/accounts/' + encodeURIComponent(accountNumber) + '/device-validations', b);
      }
      await delay(120);
      return mockCreateDeviceValidation(accountNumber, b);
    },
    // Historial de la cuenta: { items: [...] } (más reciente primero).
    async listDeviceValidations(accountNumber) {
      if (this.useRealApi) {
        const r = await fetchJson('GET', '/accounts/' + encodeURIComponent(accountNumber) + '/device-validations');
        return { items: r && Array.isArray(r.items) ? r.items : (Array.isArray(r) ? r : []) };
      }
      await delay(60);
      return { items: (MOCK_DEVICE_VALIDATIONS[String(accountNumber || '').trim()] || []).slice() };
    },
    // Regla y mensaje puros (misma lógica que el mock y que el servidor).
    evaluateDeviceCapacity: evaluateDeviceCapacity,
    deviceValidationMessage: deviceValidationMessage,
    // Solo demo/mock: etiqueta simulada para la "foto" sin OCR nativo. `hint`
    // (nombre del archivo) elige por id ('ambigua-ax3', 'sin-match', ...); si
    // no, rota. app.js no la usa con la API real.
    mockLabelScan: mockLabelScan,
    mockLabelScanIds: function () { return MOCK_LABEL_SCANS.map(function (s) { return s.id; }); },

    // Registra la guardia de registros de la visita (ver assertRecordAllowed).
    setRecordGuard(fn) {
      recordGuard = typeof fn === 'function' ? fn : null;
    },
    // Registra la guardia del Nº de task de la visita (ver assertTaskAllowed).
    setTaskGuard(fn) {
      taskGuard = typeof fn === 'function' ? fn : null;
    },

    // ---- Datos del Cliente (campos 1-5, 7) ---------------------------------
    async getClientProfile(accountNumber) {
      if (this.useRealApi) {
        return fetchJson('GET', '/accounts/' + encodeURIComponent(accountNumber) + '/client-profile');
      }
      await delay(80);
      return mockClientProfile(accountNumber);
    },
    async updateClientProfile(accountNumber, input) {
      if (this.useRealApi) {
        return fetchJson('PUT', '/accounts/' + encodeURIComponent(accountNumber) + '/client-profile', input);
      }
      await delay(120);
      return Object.assign(mockClientProfile(accountNumber), input);
    },
    async getContractStatus(accountNumber) {
      if (this.useRealApi) {
        return fetchJson('GET', '/accounts/' + encodeURIComponent(accountNumber) + '/contract-status');
      }
      await delay(80);
      return mockContractStatus(accountNumber);
    },

    // ---- Whitelist de clientes Xtrim ---------------------------------------
    // Cuerpo tal cual del backend: { accountNumber, listed: true|false|null,
    // source?, status?, city?, node?, businessType?, accountType?, accessType?,
    // importedAt, enforce, reason? }. Los errores (404 de un backend sin la
    // ruta, 5xx, red) se propagan: app.js los trata como "no se pudo validar".
    async checkWhitelist(accountNumber) {
      if (this.useRealApi) {
        return fetchJson('GET', '/accounts/' + encodeURIComponent(accountNumber) + '/whitelist');
      }
      await delay(60);
      return mockWhitelist(accountNumber);
    },

    // Ingreso por cédula/RUC. POST (no GET): el documento viaja en el cuerpo,
    // nunca en la URL. Respuesta: { by, documentKind, matches[], count,
    // truncated, importedAt, reason? }; el documento nunca vuelve.
    async lookupAccountsByDocument(document) {
      if (this.useRealApi) {
        return fetchJson('POST', '/accounts/lookup', { document: String(document || '').trim() });
      }
      await delay(70);
      return mockLookup(document);
    },

    // ---- Orden de trabajo TYTAN (simulada; contrato 2026-10-06) -----------
    // Ingreso por nº de orden (§2). Acepta 'ORDER/463158/2026' o '463158'.
    // 200 { by:'order', workOrder, simulated, source:'TYTAN', matches:[1],
    // count, truncated, importedAt, reason? }. Formato inválido → 400.
    async lookupAccountsByOrder(order) {
      if (this.useRealApi) {
        return fetchJson('POST', '/accounts/lookup', { order: String(order || '').trim() });
      }
      await delay(90);
      return mockLookupByOrder(order);
    },
    // Contexto completo de la orden (§3): { order, client, tasks[], equipment[],
    // registeredAddress, observations, simulated, source }. workOrder siempre
    // como query param (lleva barras).
    async getOrderContext(workOrder) {
      if (this.useRealApi) {
        return fetchJson('GET', '/orders/context?workOrder=' + encodeURIComponent(workOrder));
      }
      await delay(120);
      return mockOrderContext(workOrder);
    },
    // Validación del Nº de task de la visita (§4): { valid, taskId, workOrder,
    // task } o { valid:false, reason:'TASK_NOT_IN_ORDER' }. Formato inválido → 400.
    async checkOrderTask(workOrder, taskId) {
      if (this.useRealApi) {
        return fetchJson('GET', '/orders/task-check?workOrder=' + encodeURIComponent(workOrder) +
          '&taskId=' + encodeURIComponent(taskId));
      }
      await delay(80);
      return mockTaskCheck(workOrder, taskId);
    },
    // Normalizadores puros (misma regla que el backend) para validar en la UI.
    normalizeOrderNumber: normalizeOrderNumber,
    normalizeTaskId: normalizeTaskId,

    // ---- NAP elegida en Instalación (§5, append-only) ----------------------
    // body = { napId, napCode, napName, port, latitude, longitude,
    // distanceMeters, source:'FSM'|'TEC'|'MOCK', taskId, workOrder }.
    // 201 → fila guardada { id, accountNumber, ..., technicianId, createdAt }.
    async createNapAssignment(accountNumber, body) {
      assertTaskAllowed(accountNumber);
      assertRecordAllowed(accountNumber);
      if (this.useRealApi) {
        return fetchJson('POST', '/accounts/' + encodeURIComponent(accountNumber) + '/nap-assignment', body);
      }
      await delay(100);
      return mockCreateNapAssignment(accountNumber, body);
    },
    // { latest: row|null, items: row[] } (más reciente primero).
    async getNapAssignment(accountNumber) {
      if (this.useRealApi) {
        const r = await fetchJson('GET', '/accounts/' + encodeURIComponent(accountNumber) + '/nap-assignment');
        const items = r && Array.isArray(r.items) ? r.items : [];
        return { latest: (r && r.latest) || items[0] || null, items: items };
      }
      await delay(60);
      return mockNapAssignmentList(accountNumber);
    },

    // ---- Integración FSM ---------------------------------------------------
    // Estado de la integración con la operadora. Es información local del
    // backend: NO dispara ninguna llamada a la operadora.
    async getFsmHealth() {
      if (this.useRealApi) return fetchJson('GET', '/integrations/fsm/health');
      await delay(60);
      return mockFsmHealth();
    },

    // Estado de varias cuentas (campo 8, paso 2). Desde la ronda 2026-10-06
    // (contrato §6) la app lo pide SOLA para los clientes de las NAPs cuyos
    // puertos ya se cargan automáticamente; el backend cachea 5 min.
    // Si llegan más cuentas que el tope, se parte en lotes SECUENCIALES para no
    // abusar de la operadora (todo su tráfico es producción).
    async getAccountsStatusBatch(accounts) {
      const list = [];
      const seen = {};
      (accounts || []).forEach(function (a) {
        const s = String(a === null || a === undefined ? '' : a).trim();
        if (!s || seen[s]) return;
        seen[s] = true;
        list.push(s);
      });
      if (list.length === 0) {
        const err = new Error('Se necesita al menos una cuenta para consultar estados.');
        err.code = 'VALIDATION_ERROR';
        throw err;
      }
      const merged = { brand: null, items: [], requested: 0, resolved: 0, failed: 0 };
      for (let i = 0; i < list.length; i += STATUS_BATCH_LIMIT) {
        const chunk = list.slice(i, i + STATUS_BATCH_LIMIT);
        let part;
        if (this.useRealApi) {
          part = await fetchJson('POST', '/accounts/status-batch', { accounts: chunk });
        } else {
          await delay(120);
          part = mockStatusBatch(chunk);
        }
        if (part) {
          if (part.brand && !merged.brand) merged.brand = part.brand;
          if (Array.isArray(part.items)) merged.items = merged.items.concat(part.items);
          merged.requested += Number(part.requested) || chunk.length;
          merged.resolved += Number(part.resolved) || 0;
          merged.failed += Number(part.failed) || 0;
        }
      }
      return merged;
    },

    // Órdenes crudas normalizadas de la cuenta. estado: 'Todas' | 'Pendientes'.
    async getAccountOrders(accountNumber, estado) {
      const q = estado ? '?estado=' + encodeURIComponent(estado) : '';
      if (this.useRealApi) {
        return fetchJson('GET', '/accounts/' + encodeURIComponent(accountNumber) + '/orders' + q);
      }
      await delay(80);
      return mockAccountOrders(accountNumber, estado);
    },

    // Notas de cierre de una orden. `workOrder` va como query param porque
    // contiene barras (ORDER/424900/2026).
    async getWorkOrderTasks(workOrder) {
      if (this.useRealApi) {
        return fetchJson('GET', '/workorders/tasks?workOrder=' + encodeURIComponent(workOrder));
      }
      await delay(80);
      return mockWorkOrderTasks(workOrder);
    },

    // ---- Diagnóstico de Red (campos 6, 8-14, 19-21) ------------------------
    // Campo 6: NAPs cercanas a una coordenada (GPS del técnico o de la tarea).
    // La API de operadora indexa por lat/lng, no por número de cuenta.
    // opts = { meters, maxRows } (opcional). Devuelve { naps, degraded }:
    // el aviso de degradación viaja en el header X-Wifix-Degraded porque la
    // respuesta del backend es un array desnudo.
    async getNearbyNaps(coords, opts) {
      if (!coords || !isFinite(coords.latitude) || !isFinite(coords.longitude)) {
        throw new Error('Se necesita una coordenada (lat/lng) para buscar NAPs.');
      }
      const o = opts || {};
      if (this.useRealApi) {
        let path = '/naps/nearby?lat=' + encodeURIComponent(coords.latitude) +
          '&lng=' + encodeURIComponent(coords.longitude);
        if (o.meters !== undefined && o.meters !== null) path += '&meters=' + encodeURIComponent(o.meters);
        if (o.maxRows !== undefined && o.maxRows !== null) path += '&maxRows=' + encodeURIComponent(o.maxRows);
        const r = await fetchJson('GET', path, undefined, { withMeta: true });
        return {
          naps: Array.isArray(r.data) ? r.data : [],
          degraded: r.degraded || null,
        };
      }
      await delay(80);
      const todas = mockNearbyNaps(coords, o);
      const maxRows = isFinite(o.maxRows) ? Number(o.maxRows) : 5;
      const degraded = todas.length > maxRows
        ? {
          reason: 'TRUNCATED',
          message: 'Se muestran las ' + maxRows + ' NAPs más cercanas de ' + todas.length +
            ' en el radio. Amplía el número de filas para ver el resto.',
        }
        : null;
      return { naps: todas.slice(0, maxRows), degraded: degraded };
    },

    // NAP a la que está conectado el cliente (visita técnica). coords
    // opcional ({ latitude, longitude }): el backend exige lat y lng juntos;
    // sin coords busca alrededor de la coordenada del cliente.
    // Devuelve el cuerpo tal cual + `degraded` (cuerpo o header X-Wifix-Degraded).
    async getCurrentNap(accountNumber, coords) {
      const conCoords = !!(coords && isFinite(coords.latitude) && isFinite(coords.longitude) &&
        coords.latitude !== null && coords.longitude !== null);
      if (this.useRealApi) {
        let path = '/accounts/' + encodeURIComponent(accountNumber) + '/current-nap';
        if (conCoords) {
          path += '?lat=' + encodeURIComponent(coords.latitude) +
            '&lng=' + encodeURIComponent(coords.longitude);
        }
        const r = await fetchJson('GET', path, undefined, { withMeta: true });
        const body = r.data || {};
        return Object.assign({}, body, { degraded: body.degraded || r.degraded || null });
      }
      await delay(80);
      return Object.assign(mockCurrentNap(accountNumber, conCoords ? coords : null), { degraded: null });
    },

    // Ubicación "Casa cliente" de la cuenta: { latest, items, registeredLocation }.
    async getClientLocation(accountNumber) {
      if (this.useRealApi) {
        return fetchJson('GET', '/accounts/' + encodeURIComponent(accountNumber) + '/client-location');
      }
      await delay(60);
      return mockClientLocationList(accountNumber);
    },
    // Nueva captura (append-only, 201). body = { latitude, longitude,
    // accuracyMeters, label:'CASA_CLIENTE', source:'GPS'|'MANUAL', napCode,
    // napPort, taskId?, capturedAt, notes? }. Va tal cual: sin clientId/contractId.
    async createClientLocation(accountNumber, body) {
      assertTaskAllowed(accountNumber);
      assertRecordAllowed(accountNumber);
      if (this.useRealApi) {
        return fetchJson('POST', '/accounts/' + encodeURIComponent(accountNumber) + '/client-location', body);
      }
      await delay(100);
      return mockCreateClientLocation(accountNumber, body);
    },

    // ---- ISP Monitor por número de cuenta (contrato 2026-10-06 b) ---------
    // Fila de búsqueda, plan en bits, ficha ONU Info (GPON) o cablemódem
    // (HFC). `docsis` solo viene con technology === 'HFC'.
    // Errores (igual que el backend): 400 cuenta inválida; 404 cuenta fuera
    // de la whitelist (solo si está activa: en el mock siempre lo está).
    async getIspMonitor(accountNumber) {
      if (this.useRealApi) {
        return fetchJson('GET', '/accounts/' + encodeURIComponent(accountNumber) + '/isp-monitor');
      }
      await delay(120);
      mockIspCheckAccount(accountNumber);
      return mockIspMonitor(accountNumber);
    },
    // Equipos de la red de acceso agrupados por NAP + diagnóstico de la falla
    // (interna / NAP / red de acceso / sin falla).
    async getIspAccessNetwork(accountNumber) {
      if (this.useRealApi) {
        return fetchJson('GET', '/accounts/' + encodeURIComponent(accountNumber) + '/isp-monitor/access-network');
      }
      await delay(160);
      mockIspCheckAccount(accountNumber);
      return mockAccessNetwork(accountNumber);
    },
    // Regla de tecnología simulada por cuenta (la misma de /orders/context).
    mockAccountTechnology: mockAccountTechnology,

    // ---- ISP Monitor por serial GPON / MAC HFC (campos 9-13) --------------
    // Ficha del equipo: estado del terminal, de la red y evento asociado.
    // opts.technology ('GPON' | 'HFC'): pista cuando la app ya sabe qué equipo
    // es (serial de ONT, o lo que eligió el técnico). La ficha de ISP Monitor
    // manda si trae el tipo; la pista solo desempata.
    async getTerminal(id, opts) {
      if (this.useRealApi) {
        return fetchJson('GET', '/terminals/' + encodeURIComponent(id) + techQuery(opts));
      }
      await delay(80);
      return mockTerminalSnapshot(id, opts);
    },
    // Panel completo: ficha + series de 24 h + bloque por tecnología
    // (docsis | gpon), caídas con hora exacta (outages) y uptime.
    async getTerminalDiagnostics(id, opts) {
      if (this.useRealApi) {
        return fetchJson('GET', '/terminals/' + encodeURIComponent(id) + '/diagnostics' + techQuery(opts));
      }
      await delay(140);
      return mockDiagnostics(id, opts);
    },
    // Serie suelta: scope = 'terminal' | 'network', metric = 'status' | 'snr' | 'codewords'.
    async getTerminalSeries(id, scope, metric) {
      if (this.useRealApi) {
        return fetchJson(
          'GET',
          '/terminals/' + encodeURIComponent(id) + '/series/' +
            encodeURIComponent(scope) + '/' + encodeURIComponent(metric),
        );
      }
      await delay(80);
      return mockSeries(id, scope, metric);
    },

    // `napRef` = napId numérico de FSM cuando existe, o el código de NAP.
    // Este paso NUNCA pide estados de cliente: `withStatus` no se envía jamás
    // desde la webapp (contrato §6 y §13).
    async getNapPorts(napRef) {
      if (this.useRealApi) {
        return fetchJson('GET', '/naps/' + encodeURIComponent(napRef) + '/ports');
      }
      await delay(80);
      return mockNapPorts(napRef);
    },
    async getNetworkMetrics(accountNumber) {
      if (this.useRealApi) {
        return fetchJson('GET', '/accounts/' + encodeURIComponent(accountNumber) + '/network-metrics');
      }
      await delay(80);
      return mockNetworkMetrics(accountNumber);
    },
    async getNodeEvents(accountNumber) {
      if (this.useRealApi) {
        return fetchJson('GET', '/accounts/' + encodeURIComponent(accountNumber) + '/node-events');
      }
      await delay(80);
      return mockNodeEvents();
    },
    async getLanDevices(accountNumber) {
      if (this.useRealApi) {
        return fetchJson('GET', '/accounts/' + encodeURIComponent(accountNumber) + '/lan-devices');
      }
      await delay(80);
      return mockLanDevices();
    },
    async getWifiDevices(accountNumber) {
      if (this.useRealApi) {
        return fetchJson('GET', '/accounts/' + encodeURIComponent(accountNumber) + '/wifi-devices');
      }
      await delay(80);
      return mockWifiDevices();
    },
    async getWifiConfig(accountNumber) {
      if (this.useRealApi) {
        return fetchJson('GET', '/accounts/' + encodeURIComponent(accountNumber) + '/wifi-config');
      }
      await delay(80);
      return mockWifiConfig(accountNumber);
    },
    async updateWifiConfig(accountNumber, input) {
      if (this.useRealApi) {
        return fetchJson('PUT', '/accounts/' + encodeURIComponent(accountNumber) + '/wifi-config', input);
      }
      await delay(120);
      const base = mockWifiConfig(accountNumber);
      base.bands = input.bands.map(function (b) { return { band: b.band, ssid: b.ssid }; });
      return base;
    },

    // ---- Visitas pendientes y anteriores (campos 15-16) --------------------
    // Una sola ruta: { items, pendingCount, totalOrders, scanned, truncated,
    // brand, degraded? }. Los items ya vienen ordenados por el backend: la
    // pendiente primero (a lo sumo una: la próxima visita) y luego el resto
    // por fecha descendente. Se tolera el array desnudo por robustez.
    // opts.includeRecords → `?include=records`: cada visita trae `records`
    // (checklist por tipo + los registros de la app asociados por taskId o
    // por horario). Reemplaza al "historial de la app".
    async getVisits(accountNumber, opts) {
      const withRecords = !!(opts && opts.includeRecords);
      if (this.useRealApi) {
        const r = await fetchJson('GET', '/accounts/' + encodeURIComponent(accountNumber) + '/visits' +
          (withRecords ? '?include=records' : ''));
        return asItemsEnvelope(r);
      }
      await delay(80);
      return mockVisits(accountNumber, withRecords);
    },

    // Registra quién resuelve el taskId de la visita en curso (ver withVisitContext).
    setTaskIdResolver(fn) {
      taskIdResolver = typeof fn === 'function' ? fn : null;
    },
  };

  // Mock de visitas: una pendiente (la más reciente, sin notas de cierre) y el
  // historial con la mezcla de resultados que devuelve la operadora. Nunca más
  // de una PENDIENTE. Con `withRecords`, cada visita trae `records` con la
  // forma de VisitRecords (checklist de 8 tipos + registros por tipo).
  const VISIT_CHECKLIST = [
    ['speedtest', 'Speedtest (app)'],
    ['externalSpeedtest', 'Speedtest (dispositivo externo)'],
    ['ping', 'Ping'],
    ['traceroute', 'Traceroute'],
    ['wifiSignal', 'Medición de señal WiFi'],
    ['distance', 'Medición de distancia'],
    ['clientLocation', 'Ubicación casa cliente'],
    ['napAssignment', 'NAP elegida (instalación)'],
    ['retiredEquipment', 'Equipos retirados'],
    ['deviceValidation', 'Validación de equipo vs plan'],
  ];
  function mockVisitRecords(visit, accountNumber, spec) {
    const acct = String(accountNumber || '35070291');
    const at = function (min) { return new Date(new Date(visit.occurredAt).getTime() - min * 60000).toISOString(); };
    const link = function (by) {
      return by === 'TASK_ID' ? { taskId: visit.workOrder, linkedBy: 'TASK_ID' } : { linkedBy: 'TIME_WINDOW' };
    };
    const base = function (min, by) {
      return Object.assign({ id: uuidMock(), accountNumber: acct, createdAt: at(min - 1), measuredAt: at(min) }, link(by));
    };
    const r = { speedtests: [], pingTests: [], tracerouteTests: [], wifiHeatmaps: [], distanceMeasurements: [], clientLocations: [], napAssignments: [], retiredEquipment: [], deviceValidations: [] };
    (spec || []).forEach(function (k) {
      if (k === 'ext') {
        r.speedtests.push(Object.assign(base(40, 'TASK_ID'), {
          source: 'external-device', deviceName: 'Medidor Xtrim 10G', deviceId: 'XTM10G-SIM-0001', simulated: true,
          downloadMbps: 487.3, uploadMbps: 479.6, latencyMs: 4.1, jitterMs: 0.6, packetLossPercent: 0,
        }));
      }
      if (k === 'app') {
        r.speedtests.push(Object.assign(base(55, 'TIME_WINDOW'), {
          source: 'app', simulated: false, downloadMbps: 212.4, uploadMbps: 206.1, latencyMs: 14.2, jitterMs: 2.3,
          packetLossPercent: 0, serverName: 'CNT Guayaquil',
        }));
      }
      if (k === 'ping') {
        r.pingTests.push(Object.assign(base(35, 'TIME_WINDOW'), {
          target: '8.8.8.8', packetsSent: 10, packetsReceived: 10, packetLossPercent: 0,
          minLatencyMs: 10.9, avgLatencyMs: 12.3, maxLatencyMs: 15.8, continuous: false,
        }));
      }
      if (k === 'trace') {
        r.tracerouteTests.push(Object.assign(base(30, 'TASK_ID'), {
          target: '8.8.8.8',
          hops: [
            { hopNumber: 1, host: '192.168.1.1', latencyMs: 1.2 },
            { hopNumber: 2, host: '10.20.0.1', latencyMs: 4.8 },
            { hopNumber: 3, host: null },
            { hopNumber: 4, host: '8.8.8.8', latencyMs: 11.6 },
          ],
        }));
      }
      if (k === 'wifi') {
        r.wifiHeatmaps.push(Object.assign(base(25, 'TIME_WINDOW'), {
          label: 'Planta baja',
          rooms: [
            { roomName: 'Sala', floor: 1, measuredAt: at(25),
              measurements: [{ bssid: 'aa:bb:cc:dd:ee:01', apLabelSnapshot: 'Router principal', signalDbm: -41, isConnected: true }] },
            { roomName: 'Dormitorio', floor: 1, measuredAt: at(22),
              measurements: [{ bssid: 'aa:bb:cc:dd:ee:01', apLabelSnapshot: 'Router principal', signalDbm: -67, isConnected: true }] },
          ],
        }));
      }
      if (k === 'dist') r.distanceMeasurements.push(Object.assign(base(20, 'TIME_WINDOW'), { distanceMeters: 142.7 }));
      if (k === 'loc') {
        r.clientLocations.push(Object.assign(base(18, 'TASK_ID'), {
          label: 'CASA_CLIENTE', latitude: -2.247811, longitude: -79.904402, accuracyMeters: 6.5, source: 'GPS',
          napCode: 'NAP-GYE-0412', napPort: 7, capturedAt: at(18),
          capturedBy: { id: 'mock-user-1', email: 'franco@tulpasolutions.com' },
          registeredLocation: { latitude: -2.247946, longitude: -79.904161, source: 'FSM' },
          distanceToRegisteredMeters: 30.6, distanceToNapMeters: 41.2,
        }));
      }
      if (k === 'napas') {
        r.napAssignments.push(Object.assign(base(17, 'TASK_ID'), {
          napId: '11542', napCode: 'NAP-14-03', napName: 'OLT-GYE-03/1/2', port: 5,
          latitude: -2.247512, longitude: -79.903980, distanceMeters: 61, source: 'FSM',
          workOrder: visit.workOrder, technicianId: 'mock-user-1',
        }));
      }
      if (k === 'devval') {
        const wifiReason = [{ kind: 'wifi', deviceMbps: 500, planMbps: 600 }];
        r.deviceValidations.push(Object.assign(base(45, 'TASK_ID'), {
          category: 'visitas', serial: 'ZTEGD0BB8294', serialSource: 'barcode', model: 'ZXHN F670L',
          result: 'blocked', planMbps: 600, planSource: 'simulated',
          device: MOCK_DEVICE_CATALOG.filter(function (d) { return d.model === 'ZXHN F670L'; })[0],
          reasons: wifiReason,
          message: deviceValidationMessage({ result: 'blocked', reasons: wifiReason, planMbps: 600 }),
          technician: { id: 'mock-user-1', email: 'franco@tulpasolutions.com', name: 'Franco Ceruso' },
        }));
        r.deviceValidations.push(Object.assign(base(42, 'TASK_ID'), {
          category: 'visitas', serial: 'ZTEGC1A20077', serialSource: 'ocr', model: 'ONT ZTE ZXHN F6600P',
          result: 'ok', planMbps: 600, planSource: 'simulated',
          device: MOCK_DEVICE_CATALOG.filter(function (d) { return d.model === 'ONT ZTE ZXHN F6600P'; })[0],
          reasons: [],
          message: deviceValidationMessage({ result: 'ok', reasons: [], planMbps: 600 }),
          technician: { id: 'mock-user-1', email: 'franco@tulpasolutions.com', name: 'Franco Ceruso' },
        }));
      }
      if (k === 'retired') {
        r.retiredEquipment.push(Object.assign(base(15, 'TASK_ID'), {
          equipmentModelId: 'ONT ZTE (todas)', serialValue: 'ZTEGD0BB8294', removalReasonCode: 'DANADO', retiredAt: at(15),
        }));
      }
    });
    const counts = {
      speedtest: r.speedtests.filter(function (x) { return x.source !== 'external-device'; }).length,
      externalSpeedtest: r.speedtests.filter(function (x) { return x.source === 'external-device'; }).length,
      ping: r.pingTests.length,
      traceroute: r.tracerouteTests.length,
      wifiSignal: r.wifiHeatmaps.length,
      distance: r.distanceMeasurements.length,
      clientLocation: r.clientLocations.length,
      napAssignment: r.napAssignments.length,
      retiredEquipment: r.retiredEquipment.length,
      deviceValidation: r.deviceValidations.length,
    };
    const all = [].concat(r.speedtests, r.pingTests, r.tracerouteTests, r.wifiHeatmaps, r.distanceMeasurements, r.clientLocations, r.napAssignments, r.retiredEquipment, r.deviceValidations);
    const kinds = all.map(function (x) { return x.linkedBy; })
      .filter(function (v, i, arr) { return arr.indexOf(v) === i; });
    const until = visit.endedAt
      ? new Date(new Date(visit.endedAt).getTime() + 2 * 3600000).toISOString()
      : new Date(Date.now() + 2 * 3600000).toISOString();
    return Object.assign({
      linkedBy: all.length === 0 ? null : kinds.length > 1 ? 'MIXED' : kinds[0],
      window: visit.result === 'CANCELADA' ? null : { from: visit.createdAt, until: until },
      checklist: VISIT_CHECKLIST.map(function (c) {
        return { type: c[0], label: c[1], done: counts[c[0]] > 0, count: counts[c[0]] };
      }),
    }, r);
  }
  function mockVisits(accountNumber, withRecords) {
    const pendiente = mockClosedTask(0);
    pendiente.occurredAt = new Date(Date.now() - 3 * 3600000).toISOString();
    pendiente.reason = 'Sin servicio de internet';
    pendiente.closingNotes = '';
    pendiente.result = 'PENDIENTE';
    pendiente.notesLoaded = true;
    pendiente.createdAt = pendiente.occurredAt;
    pendiente.endedAt = null;
    pendiente.fsmTaskId = 'TASK/294328/2026';
    pendiente.taskId = pendiente.workOrder;

    const historial = [
      { seed: 6,  result: 'INSATISFACTORIA', reason: 'Intermitencia en la conexión', notesLoaded: true, recs: ['ext', 'ping', 'trace'] },
      { seed: 14, result: 'SATISFACTORIA',   reason: 'WiFi débil en habitaciones',    notesLoaded: false, recs: ['wifi', 'dist', 'loc', 'retired', 'devval'] },
      { seed: 27, result: 'CANCELADA',       reason: 'Cliente ausente',               notesLoaded: true, closingNotes: 'Cliente no se encontraba en el domicilio.', recs: [] },
      { seed: 41, result: 'REALIZADA',       reason: 'Cambio de equipo',              notesLoaded: false, recs: ['app'] },
      { seed: 63, result: 'SATISFACTORIA',   reason: 'Instalación',                   notesLoaded: false, recs: ['loc', 'napas'] },
    ].map(function (v) {
      const t = mockClosedTask(v.seed);
      t.result = v.result;
      t.reason = v.reason;
      t.notesLoaded = v.notesLoaded;
      t.closingNotes = v.notesLoaded ? (v.closingNotes || t.closingNotes) : '';
      // La lista es por orden: taskId == workOrder (contrato VisitItem).
      t.fsmTaskId = t.taskId;
      t.taskId = t.workOrder;
      t.endedAt = t.occurredAt;
      t.createdAt = new Date(new Date(t.occurredAt).getTime() - 26 * 3600000).toISOString();
      if (withRecords) t.records = mockVisitRecords(t, accountNumber, v.recs);
      return t;
    });
    if (withRecords) pendiente.records = mockVisitRecords(pendiente, accountNumber, []);

    const out = {
      items: [pendiente].concat(historial),
      pendingCount: 1,
      totalOrders: 14,
      scanned: 10,
      truncated: true,
      brand: mockBrand(),
      degraded: {
        reason: 'TRUNCATED',
        message: 'Se revisaron las 10 órdenes más recientes de 14. Abre una visita concreta para ver sus notas.',
      },
    };
    if (withRecords) out.recordsSummary = { linked: 10, unlinked: 0, windowGraceHours: 2, windowLookbackHours: 72 };
    return out;
  }

  global.WifixAPI = WifixAPI;
})(window);
