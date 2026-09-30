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
  async function withVisitContext(accountNumber, body) {
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
      contractedUploadMbps: 100,
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
  function mockClientProfile(accountNumber) {
    const sinFsm = MOCK_FSM_NO_DATA[String(accountNumber || '').trim()];
    if (sinFsm) return mockClientProfileNoFsm(String(accountNumber).trim(), sinFsm);
    return {
      accountNumber: accountNumber,
      fullName: 'Cliente Mock Apellido Apellido',
      address: 'Av. Amazonas N1234, Quito',
      phones: ['0991234567', '022345678'],
      email: 'cliente.mock@example.com',
      planName: 'Wifix Hogar 200',
      contractedDownloadMbps: 200,
      contractedUploadMbps: 100,
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
      return Object.assign(base, {
        found: false, nap: null, portNumber: null, equipmentId: null,
        clientStatus: null, searchedNaps: 3, reason: 'NOT_FOUND',
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
    });
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
  function mockTerminalSnapshot(id) {
    const isMac = /^[0-9A-F]{12}$/i.test(String(id).replace(/[:-]/g, ''));
    return {
      id: id,
      found: true,
      online: true,
      technology: isMac ? 'HFC' : 'GPON',
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
  function mockDiagnostics(id) {
    const isMac = /^[0-9A-F]{12}$/i.test(String(id).replace(/[:-]/g, ''));
    // SNR y codewords son métricas DOCSIS: en GPON la operadora responde 204.
    const docsis = function (scope, metric) {
      return isMac
        ? mockSeries(id, scope, metric)
        : { id: id, scope: scope, metric: metric, keys: [], points: [], channels: [], recognized: true, raw: null, fetchedAt: nowIso() };
    };
    return {
      id: id,
      terminal: mockTerminalSnapshot(id),
      status: { terminal: mockSeries(id, 'terminal', 'status'), network: mockSeries(id, 'network', 'status') },
      snr: { terminal: docsis('terminal', 'snr'), network: docsis('network', 'snr') },
      codewords: { terminal: docsis('terminal', 'codewords'), network: docsis('network', 'codewords') },
      errors: [],
      fetchedAt: nowIso(),
    };
  }
  function mockNetworkMetrics(accountNumber) {
    return {
      accountNumber: accountNumber,
      technology: 'GPON',
      signalLevels: { rxDbm: -18.4, txDbm: 2.1 },
      outagesLast24h: 1,
      trafficMbpsIn: 87.3,
      trafficMbpsOut: 12.5,
      measuredAt: nowIso(),
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
    // (El ingreso por nº de orden FSM responde 501 NOT_IMPLEMENTED: la UI lo
    // muestra deshabilitado y no lo llama.)
    async lookupAccountsByDocument(document) {
      if (this.useRealApi) {
        return fetchJson('POST', '/accounts/lookup', { document: String(document || '').trim() });
      }
      await delay(70);
      return mockLookup(document);
    },

    // ---- Integración FSM ---------------------------------------------------
    // Estado de la integración con la operadora. Es información local del
    // backend: NO dispara ninguna llamada a la operadora.
    async getFsmHealth() {
      if (this.useRealApi) return fetchJson('GET', '/integrations/fsm/health');
      await delay(60);
      return mockFsmHealth();
    },

    // Estado de varias cuentas en una sola acción del técnico (campo 8, paso 2).
    // NUNCA se llama de forma automática: solo por gesto explícito.
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

    // ---- ISP Monitor por serial GPON / MAC HFC (campos 9-13) --------------
    // Ficha del equipo: estado del terminal, de la red y evento asociado.
    async getTerminal(id) {
      if (this.useRealApi) {
        return fetchJson('GET', '/terminals/' + encodeURIComponent(id));
      }
      await delay(80);
      return mockTerminalSnapshot(id);
    },
    // Panel completo: ficha + las 6 series de 24 h en una sola llamada.
    async getTerminalDiagnostics(id) {
      if (this.useRealApi) {
        return fetchJson('GET', '/terminals/' + encodeURIComponent(id) + '/diagnostics');
      }
      await delay(140);
      return mockDiagnostics(id);
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
    // (checklist de 7 tipos + los registros de la app asociados por taskId o
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
  // forma de VisitRecords (checklist de 7 tipos + registros por tipo).
  const VISIT_CHECKLIST = [
    ['speedtest', 'Speedtest (app)'],
    ['externalSpeedtest', 'Speedtest (dispositivo externo)'],
    ['ping', 'Ping'],
    ['traceroute', 'Traceroute'],
    ['wifiSignal', 'Medición de señal WiFi'],
    ['distance', 'Medición de distancia'],
    ['retiredEquipment', 'Equipos retirados'],
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
    const r = { speedtests: [], pingTests: [], tracerouteTests: [], wifiHeatmaps: [], distanceMeasurements: [], retiredEquipment: [] };
    (spec || []).forEach(function (k) {
      if (k === 'ext') {
        r.speedtests.push(Object.assign(base(40, 'TASK_ID'), {
          source: 'external-device', deviceName: 'Medidor Xtrim 10G', deviceId: 'XTM10G-SIM-0001', simulated: true,
          downloadMbps: 487.3, uploadMbps: 241.8, latencyMs: 4.1, jitterMs: 0.6, packetLossPercent: 0,
        }));
      }
      if (k === 'app') {
        r.speedtests.push(Object.assign(base(55, 'TIME_WINDOW'), {
          source: 'app', simulated: false, downloadMbps: 212.4, uploadMbps: 98.7, latencyMs: 14.2, jitterMs: 2.3,
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
      retiredEquipment: r.retiredEquipment.length,
    };
    const all = [].concat(r.speedtests, r.pingTests, r.tracerouteTests, r.wifiHeatmaps, r.distanceMeasurements, r.retiredEquipment);
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
      { seed: 14, result: 'SATISFACTORIA',   reason: 'WiFi débil en habitaciones',    notesLoaded: false, recs: ['wifi', 'dist', 'retired'] },
      { seed: 27, result: 'CANCELADA',       reason: 'Cliente ausente',               notesLoaded: true, closingNotes: 'Cliente no se encontraba en el domicilio.', recs: [] },
      { seed: 41, result: 'REALIZADA',       reason: 'Cambio de equipo',              notesLoaded: false, recs: ['app'] },
      { seed: 63, result: 'SATISFACTORIA',   reason: 'Instalación',                   notesLoaded: false, recs: [] },
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
