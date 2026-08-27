/* ===========================================================================
 * api.js — Capa de consumo de la API del backend de la app Wifix (Fase 2).
 * Es el ÚNICO punto que sabe si los datos son mock o vienen del servidor real.
 * Para usar el backend real: WifixAPI.useRealApi = true y configurar
 * API_BASE_URL.
 *
 * Maneja también el token: tras `login()` se guarda en localStorage y se
 * envía como `Authorization: Bearer` en cada llamada protegida. Si el backend
 * responde 401, dispara el evento DOM `wifix:unauthorized` para que la
 * pantalla vuelva al login.
 * ========================================================================*/
(function (global) {
  'use strict';

  // Backend URL: por default deriva del host actual usando puerto 8080.
  // Excepción: si la app está cargada desde localhost (APK Capacitor) o desde
  // un archivo (file://), no hay backend ahí — apuntamos al LAN_BACKEND_URL.
  // Cualquier consumidor puede sobrescribir con `WifixAPI.baseUrl = '...'`.
  const LAN_BACKEND_URL = 'http://192.168.1.172:8080/herramientas/v1';

  function defaultBaseUrl() {
    try {
      const host = (window.location.hostname || '').toLowerCase();
      const proto = window.location.protocol;
      const inApk = proto === 'file:' || host === 'localhost' || host === '127.0.0.1' || host === '';
      if (inApk) return LAN_BACKEND_URL;
      const httpProto = proto === 'https:' ? 'https:' : 'http:';
      return `${httpProto}//${host}:8080/herramientas/v1`;
    } catch (_) {
      return LAN_BACKEND_URL;
    }
  }
  const API_BASE_URL = defaultBaseUrl();
  const TOKEN_STORAGE_KEY = 'wifix_token';
  const USER_STORAGE_KEY = 'wifix_user';

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
    // user.id del JWT. clientId/visitId siguen como valores de prueba hasta
    // que exista el sistema upstream.
    return Object.assign(
      {
        accountNumber: String(accountNumber).trim(),
        clientId: 'CLI-FASE2-TEST',
        contractId: 'CTR-FASE2-TEST',
        visitId: 'VIS-FASE2-TEST',
      },
      body,
    );
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

  function emitUnauthorized() {
    try {
      window.dispatchEvent(new CustomEvent('wifix:unauthorized'));
    } catch (_) { /* ignore */ }
  }

  async function fetchJson(method, path, body) {
    const init = { method, headers: { 'Content-Type': 'application/json' } };
    const token = getToken();
    if (token) init.headers['Authorization'] = 'Bearer ' + token;
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetch(API_BASE_URL + path, init);
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
      throw err;
    }
    return data;
  }

  // ---------------------------------------------------------------------------
  // Catálogos mock fallback para client-profile (al usar mock antes del login).
  // ---------------------------------------------------------------------------
  function mockClientProfile(accountNumber) {
    return {
      accountNumber: accountNumber,
      fullName: 'Cliente Mock Apellido Apellido',
      address: 'Av. Amazonas N1234, Quito',
      phones: ['0991234567', '022345678'],
      planName: 'Wifix Hogar 200',
      contractedDownloadMbps: 200,
      contractedUploadMbps: 100,
    };
  }
  function mockContractStatus(accountNumber) {
    return {
      clientName: 'Cliente Mock Apellido Apellido',
      accounts: [
        { accountNumber: accountNumber, contractId: 'CTR-' + accountNumber, status: 'ACTIVA' },
      ],
    };
  }
  // Genera NAPs mock alrededor de una coordenada, con la misma forma que
  // devuelve la API de operadora (/api/tec/naps/{lat},{lng}).
  function mockNearbyNaps(coords) {
    const lat = coords && isFinite(coords.latitude) ? coords.latitude : -0.1800;
    const lng = coords && isFinite(coords.longitude) ? coords.longitude : -78.4680;
    const offsets = [
      [20, 0.6], [47, 2.1], [61, 3.4], [73, 4.8], [92, 1.2], [113, 5.6],
    ];
    const used = [4, 3, 2, 0, 2, 1];
    return offsets.map(function (pair, i) {
      const meters = pair[0];
      const bearing = pair[1];
      const dLat = (meters * Math.cos(bearing)) / 111320;
      const dLng = (meters * Math.sin(bearing)) / (111320 * Math.cos(lat * Math.PI / 180));
      const total = i % 2 === 0 ? 8 : 16;
      return {
        napCode: 'NAP-' + (12 + i) + '-0' + ((i % 6) + 1),
        latitude: lat + dLat,
        longitude: lng + dLng,
        distanceMeters: meters,
        occupiedPorts: used[i],
        totalPorts: total,
        freePorts: total - used[i],
      };
    });
  }
  function mockNapPorts(napCode) {
    const ports = Array.from({ length: 16 }, function (_, i) {
      const occupied = i % 3 !== 0;
      const port = { portNumber: i + 1, occupied: occupied };
      if (occupied) {
        port.clientAccountNumber = 'WX-' + (100000 + i);
        port.clientStatus = i % 7 === 0 ? 'S' : 'A';
      }
      return port;
    });
    return {
      napCode: napCode,
      ports: ports,
      detailAvailable: true,
      occupiedPorts: ports.filter(function (p) { return p.occupied; }).length,
      totalPorts: ports.length,
    };
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
  function mockClosedTask(seed) {
    return {
      taskId: 'TASK/' + (100000 + seed) + '/2026',
      occurredAt: nowIso(),
      reason: 'WiFi débil en habitaciones',
      closingNotes: 'Se cambió canal a 5GHz y mejoró cobertura.',
      technician: 'Andrés Cevallos',
      result: seed % 2 === 0 ? 'SATISFACTORIA' : 'INSATISFACTORIA',
    };
  }

  // ---------------------------------------------------------------------------
  // API pública
  // ---------------------------------------------------------------------------
  const WifixAPI = {
    // true = habla con el backend real (default). Poner false para usar
    // los mocks locales sin backend (útil para demos sin servidor).
    useRealApi: true,
    baseUrl: API_BASE_URL,

    // ---- Sesión ------------------------------------------------------------
    isAuthenticated() {
      return Boolean(getToken());
    },
    getCurrentUser: getUser,
    getToken: getToken,
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
      const body = withContext(accountNumber, Object.assign({ measuredAt: nowIso() }, payload));
      if (this.useRealApi) return fetchJson('POST', '/distance-measurements', body);
      await delay(80);
      return Object.assign({ id: uuidMock(), createdAt: nowIso() }, body);
    },
    async createSpeedtest(accountNumber, payload) {
      const body = withContext(accountNumber, Object.assign({ measuredAt: nowIso() }, payload));
      if (this.useRealApi) return fetchJson('POST', '/speedtests', body);
      await delay(80);
      return Object.assign({ id: uuidMock(), createdAt: nowIso() }, body);
    },
    async createWifiHeatmap(accountNumber, payload) {
      const body = withContext(accountNumber, payload);
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
      const body = withContext(accountNumber, Object.assign({ measuredAt: nowIso() }, payload));
      if (this.useRealApi) return fetchJson('POST', '/ping-tests', body);
      await delay(80);
      return Object.assign({ id: uuidMock(), createdAt: nowIso() }, body);
    },
    async createTracerouteTest(accountNumber, payload) {
      const body = withContext(accountNumber, Object.assign({ measuredAt: nowIso() }, payload));
      if (this.useRealApi) return fetchJson('POST', '/traceroute-tests', body);
      await delay(80);
      return Object.assign({ id: uuidMock(), createdAt: nowIso() }, body);
    },

    // ---- Equipos retirados -------------------------------------------------
    async createRetiredEquipment(accountNumber, payload) {
      const body = withContext(accountNumber, Object.assign({ retiredAt: nowIso() }, payload));
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
        const res = await fetch(API_BASE_URL + '/media', { method: 'POST', body: form, headers: headers });
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
    async getAccountToolHistory(accountNumber) {
      if (this.useRealApi) {
        return fetchJson('GET', '/accounts/' + encodeURIComponent(accountNumber) + '/tool-history');
      }
      await delay(60);
      return {
        accountNumber: accountNumber,
        distanceMeasurements: [],
        speedtests: [],
        wifiHeatmaps: [],
        pingTests: [],
        tracerouteTests: [],
        retiredEquipment: [],
      };
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

    // ---- Diagnóstico de Red (campos 6, 8-14, 19-21) ------------------------
    // Campo 6: NAPs cercanas a una coordenada (GPS del técnico o de la tarea).
    // La API de operadora indexa por lat/lng, no por número de cuenta.
    async getNearbyNaps(coords) {
      if (!coords || !isFinite(coords.latitude) || !isFinite(coords.longitude)) {
        throw new Error('Se necesita una coordenada (lat/lng) para buscar NAPs.');
      }
      if (this.useRealApi) {
        return fetchJson(
          'GET',
          '/naps/nearby?lat=' + encodeURIComponent(coords.latitude) +
            '&lng=' + encodeURIComponent(coords.longitude),
        );
      }
      await delay(80);
      return mockNearbyNaps(coords);
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

    async getNapPorts(napCode) {
      if (this.useRealApi) {
        return fetchJson('GET', '/naps/' + encodeURIComponent(napCode) + '/ports');
      }
      await delay(80);
      return mockNapPorts(napCode);
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

    // ---- Tareas y Visitas (campos 15-16) -----------------------------------
    async getUnsatisfactoryTasks(accountNumber) {
      if (this.useRealApi) {
        return fetchJson('GET', '/accounts/' + encodeURIComponent(accountNumber) + '/unsatisfactory-tasks');
      }
      await delay(80);
      return [mockClosedTask(1), mockClosedTask(3)].map(function (t) {
        t.result = 'INSATISFACTORIA';
        return t;
      });
    },
    async getPreviousVisits(accountNumber) {
      if (this.useRealApi) {
        return fetchJson('GET', '/accounts/' + encodeURIComponent(accountNumber) + '/previous-visits');
      }
      await delay(80);
      return [mockClosedTask(2), mockClosedTask(4), mockClosedTask(6)];
    },
  };

  global.WifixAPI = WifixAPI;
})(window);
