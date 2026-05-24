/* ===========================================================================
 * api.js — Capa de consumo de la API del backend "Herramientas y Equipos
 * Retirados" (Fase 1). Es el ÚNICO punto que sabe si los datos son mock o
 * vienen de un servidor real. Para cambiar de mock a backend real basta con
 * poner WifixAPI.useRealApi = true y configurar API_BASE_URL.
 *
 * Sigue el patrón de buildXxxMock() del repo: cada función devuelve datos
 * con la forma de los esquemas del OpenAPI; al cambiar a fetch real ni
 * la pantalla ni el guardado se enteran del cambio.
 * ========================================================================*/
(function (global) {
  'use strict';

  const API_BASE_URL = 'http://localhost:8080/herramientas/v1';

  // Identificadores upstream "por definir": en Fase 1 se rellenan aquí con
  // valores de prueba. Cuando exista el sistema upstream se inyectarán desde
  // afuera y se quitarán de aquí.
  const STUB_IDS = {
    clientId: 'CLI-FASE1-TEST',
    contractId: 'CTR-FASE1-TEST',
    visitId: 'VIS-FASE1-TEST',
    technicianId: 'TEC-FASE1-TEST',
  };

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
    // RFC 4122 v4 con Math.random — suficiente para Fase 1 mock.
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
    return Object.assign(
      { accountNumber: String(accountNumber).trim() },
      STUB_IDS,
      body,
    );
  }

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  async function fetchJson(method, path, body) {
    const init = { method, headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetch(API_BASE_URL + path, init);
    const data = await res.json().catch(function () { return null; });
    if (!res.ok) {
      const code = data && data.code ? data.code : 'HTTP_' + res.status;
      const msg = data && data.message ? data.message : 'Error de red.';
      const err = new Error(msg);
      err.code = code;
      err.details = data && data.details;
      throw err;
    }
    return data;
  }

  // ---------------------------------------------------------------------------
  // API pública
  // ---------------------------------------------------------------------------
  const WifixAPI = {
    useRealApi: false,
    baseUrl: API_BASE_URL,

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
        const res = await fetch(API_BASE_URL + '/media', { method: 'POST', body: form });
        const data = await res.json().catch(function () { return null; });
        if (!res.ok) {
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
  };

  global.WifixAPI = WifixAPI;
})(window);
