/* ===========================================================================
 * native.js — Puente entre la webapp Wifix y el plugin Capacitor nativo
 * (NetworkToolsPlugin.java). Sólo activo cuando la app corre dentro del APK.
 *
 * Cuando se detecta Capacitor:
 *  - Apunta WifixAPI.baseUrl al backend LAN configurado en NATIVE_BACKEND.
 *  - Inyecta un botón "Ejecutar prueba automática" en los formularios de
 *    Ping, Traceroute y Mapa de Calor, que llena los campos con datos
 *    reales medidos por el plugin nativo.
 *  - Expone WifixNative.{ping, traceroute, getWifiInfo, isNative}.
 *
 * En el navegador (sin Capacitor) este script no hace nada — los formularios
 * funcionan como antes con entrada manual.
 * ========================================================================*/
(function (global) {
  'use strict';

  // --------------------------------------------------------------------------
  // Configuración del backend en LAN — AJUSTAR a la IP del PC del técnico.
  // (Sólo se aplica si se está corriendo dentro del APK.)
  // --------------------------------------------------------------------------
  const NATIVE_BACKEND = {
    host: '192.168.1.172',
    port: 8080,
    basePath: '/herramientas/v1'
  };

  // --------------------------------------------------------------------------
  // Detección de runtime nativo
  // --------------------------------------------------------------------------
  function isNative() {
    return !!(global.Capacitor && global.Capacitor.isNativePlatform && global.Capacitor.isNativePlatform());
  }

  function nativePlugin() {
    if (!isNative()) return null;
    return global.Capacitor.Plugins && global.Capacitor.Plugins.NetworkTools || null;
  }

  // --------------------------------------------------------------------------
  // API pública
  // --------------------------------------------------------------------------
  const WifixNative = {
    isNative,

    async ping(host, opts) {
      const plugin = nativePlugin();
      if (!plugin) throw new Error('Plugin nativo no disponible (estás en el navegador).');
      const { count = 4, timeoutSec = 5 } = opts || {};
      return plugin.ping({ host, count, timeoutSec });
    },

    async traceroute(host, opts) {
      const plugin = nativePlugin();
      if (!plugin) throw new Error('Plugin nativo no disponible.');
      const { maxHops = 30, timeoutSec = 3 } = opts || {};
      return plugin.traceroute({ host, maxHops, timeoutSec });
    },

    async getWifiInfo() {
      const plugin = nativePlugin();
      if (!plugin) throw new Error('Plugin nativo no disponible.');
      return plugin.getWifiInfo();
    },

    async speedtest(opts) {
      // No requiere plugin nativo — basta con descargar un blob conocido del
      // backend y medir tiempo. En nativo se evita CORS y el WebView no
      // limita la conexión como en un browser ajeno.
      const { sizeBytes = 5 * 1024 * 1024, url } = opts || {};
      const target = url || `${global.WifixAPI.baseUrl.replace(/\/[^/]+$/, '')}/health`;
      const t0 = performance.now();
      const res = await fetch(target, { cache: 'no-store' });
      const buf = await res.arrayBuffer();
      const elapsedMs = performance.now() - t0;
      const bytes = buf.byteLength;
      const mbps = (bytes * 8) / (elapsedMs / 1000) / 1e6;
      return { bytes, elapsedMs, downloadMbps: Number(mbps.toFixed(2)) };
    }
  };

  global.WifixNative = WifixNative;

  // --------------------------------------------------------------------------
  // Si NO es nativo, no hacemos nada más.
  // --------------------------------------------------------------------------
  if (!isNative()) {
    console.info('[WifixNative] no es Capacitor — modo webapp puro.');
    return;
  }

  console.info('[WifixNative] Capacitor detectado, activando puente nativo.');

  // --------------------------------------------------------------------------
  // Apuntar el backend a la IP LAN configurada.
  // --------------------------------------------------------------------------
  function applyNativeBackend() {
    if (!global.WifixAPI) {
      // api.js aún no se cargó — reintentar en el próximo tick.
      setTimeout(applyNativeBackend, 50);
      return;
    }
    const url = `http://${NATIVE_BACKEND.host}:${NATIVE_BACKEND.port}${NATIVE_BACKEND.basePath}`;
    global.WifixAPI.baseUrl = url;
    console.info('[WifixNative] WifixAPI.baseUrl =', url);
  }
  applyNativeBackend();

  // --------------------------------------------------------------------------
  // Inyección automática de botones "Ejecutar prueba" en los formularios.
  // --------------------------------------------------------------------------
  function setField(formEl, name, value) {
    const el = formEl.querySelector(`[data-field="${name}"]`);
    if (el != null && value != null) el.value = String(value);
  }

  function ensureRunButton(formEl, label, onRun) {
    if (formEl.dataset.nativeWired === '1') return;
    formEl.dataset.nativeWired = '1';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'save-btn native-run-btn';
    btn.textContent = label;
    btn.style.background = '#1f6feb';
    btn.style.marginBottom = '8px';

    const status = document.createElement('div');
    status.className = 'native-run-status';
    status.style.fontSize = '12px';
    status.style.opacity = '0.8';
    status.style.margin = '4px 0 8px';

    const saveBtn = formEl.querySelector('[data-action="save"]');
    if (saveBtn) {
      saveBtn.parentNode.insertBefore(status, saveBtn);
      saveBtn.parentNode.insertBefore(btn, status);
    } else {
      formEl.appendChild(btn);
      formEl.appendChild(status);
    }

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const originalLabel = btn.textContent;
      btn.textContent = 'Ejecutando…';
      status.textContent = '';
      try {
        const msg = await onRun(formEl);
        status.style.color = '#3fb950';
        status.textContent = msg || 'OK';
      } catch (err) {
        console.error('[WifixNative] ejecución falló:', err);
        status.style.color = '#f85149';
        status.textContent = (err && err.message) ? err.message : String(err);
      } finally {
        btn.disabled = false;
        btn.textContent = originalLabel;
      }
    });
  }

  // --- Ping ---
  function wirePingForm(formEl) {
    ensureRunButton(formEl, 'Ejecutar ping nativo', async () => {
      const target = formEl.querySelector('[data-field="target"]').value.trim();
      if (!target) throw new Error('Indicá un target (IP o URL).');
      const r = await WifixNative.ping(target, { count: 10 });
      setField(formEl, 'packetsSent', r.transmitted);
      setField(formEl, 'packetsReceived', r.received);
      if (typeof r.rttMinMs === 'number') setField(formEl, 'minLatencyMs', r.rttMinMs.toFixed(1));
      if (typeof r.rttAvgMs === 'number') setField(formEl, 'avgLatencyMs', r.rttAvgMs.toFixed(1));
      if (typeof r.rttMaxMs === 'number') setField(formEl, 'maxLatencyMs', r.rttMaxMs.toFixed(1));
      return `${r.received}/${r.transmitted} paquetes · avg ${r.rttAvgMs ?? '—'} ms`;
    });
  }

  // --- Traceroute ---
  function wireTracerouteForm(formEl) {
    ensureRunButton(formEl, 'Ejecutar traceroute nativo', async () => {
      const target = formEl.querySelector('[data-field="target"]').value.trim();
      if (!target) throw new Error('Indicá un target.');
      const r = await WifixNative.traceroute(target, { maxHops: 20 });

      // Limpiar hops actuales y crear uno por cada hop devuelto.
      const hopsSlot = formEl.querySelector('[data-slot="hops"]');
      const addBtn = formEl.querySelector('[data-action="add-hop"]');
      if (hopsSlot) hopsSlot.innerHTML = '';

      for (let i = 0; i < r.hops.length; i++) {
        if (addBtn) addBtn.click();
        const row = hopsSlot.children[i];
        if (!row) continue;
        const h = r.hops[i];
        const set = (k, v) => {
          const el = row.querySelector(`[data-field="${k}"]`);
          if (el != null && v != null) el.value = String(v);
        };
        set('hopNumber', i + 1);
        set('host', h.ip || '');
        if (typeof h.rttMs === 'number') set('latencyMs', h.rttMs.toFixed(1));
        else if (typeof h.elapsedMs === 'number' && h.status !== 'timeout') set('latencyMs', h.elapsedMs);
      }
      return `${r.hops.length} hops · ${r.reached ? 'alcanzado' : 'no alcanzado'}`;
    });
  }

  // --- Heatmap (usa RSSI actual para llenar la fila visible) ---
  function wireHeatmapForm(formEl) {
    ensureRunButton(formEl, 'Leer dBm del WiFi actual', async () => {
      const w = await WifixNative.getWifiInfo();
      const rows = formEl.querySelectorAll('.room-row');
      const lastRow = rows[rows.length - 1];
      if (lastRow) {
        const el = lastRow.querySelector('[data-field="signalDbm"]');
        if (el) el.value = String(w.rssiDbm);
      }
      return `${w.ssid ?? 'WiFi'} · ${w.rssiDbm} dBm · ${w.linkSpeedMbps} Mbps`;
    });
  }

  // --- Speedtest (descarga un blob conocido del backend) ---
  function wireSpeedtestForm(formEl) {
    ensureRunButton(formEl, 'Ejecutar speedtest', async () => {
      const r = await WifixNative.speedtest();
      setField(formEl, 'downloadMbps', r.downloadMbps);
      setField(formEl, 'serverName', `LAN ${NATIVE_BACKEND.host}`);
      return `${r.downloadMbps} Mbps · ${(r.bytes / 1024 / 1024).toFixed(1)} MB en ${r.elapsedMs.toFixed(0)} ms`;
    });
  }

  // --------------------------------------------------------------------------
  // Mutation observer: cada vez que se renderiza un .tool-form, lo enganchamos.
  // --------------------------------------------------------------------------
  const FORM_HANDLERS = {
    ping: wirePingForm,
    traceroute: wireTracerouteForm,
    heatmap: wireHeatmapForm,
    speedtest: wireSpeedtestForm
  };

  function wireForm(el) {
    if (!el.matches || !el.matches('.tool-form[data-tool]')) return;
    const handler = FORM_HANDLERS[el.dataset.tool];
    if (handler) handler(el);
  }

  function scanAndWire(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('.tool-form[data-tool]').forEach(wireForm);
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach(node => {
        if (node.nodeType !== 1) return;
        wireForm(node);
        scanAndWire(node);
      });
    }
  });

  function start() {
    scanAndWire(document.body);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(window);
