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

    // --- Ping único (para consola en vivo) ------------------------------------
    // Espeja plugin.pingOnce — devuelve una sola respuesta ICMP.
    // opts: { timeoutSec }
    // Retorna: { status:'reply'|'timeout'|'unreachable', from?, bytes?, ttl?, timeMs?, raw }
    async pingOnce(host, opts) {
      const plugin = nativePlugin();
      if (!plugin) throw new Error('Plugin nativo no disponible (estás en el navegador).');
      const { timeoutSec = 3 } = opts || {};
      return plugin.pingOnce({ host, timeoutSec });
    },

    // --- Salto individual de traceroute (para consola en vivo) ----------------
    // Espeja plugin.traceHop — mide un TTL específico.
    // opts: { timeoutSec }
    // Retorna: { ttl, ip?, rttMs?, status:'intermediate'|'reached'|'timeout', raw }
    async traceHop(host, ttl, opts) {
      const plugin = nativePlugin();
      if (!plugin) throw new Error('Plugin nativo no disponible.');
      const { timeoutSec = 3 } = opts || {};
      return plugin.traceHop({ host, ttl, timeoutSec });
    },

    async getWifiInfo() {
      const plugin = nativePlugin();
      if (!plugin) throw new Error('Plugin nativo no disponible.');
      return plugin.getWifiInfo();
    },

    async startOdometer(onUpdate) {
      const Geo = global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.Geolocation;
      if (!Geo) throw new Error('Plugin de Geolocation no disponible.');
      const perms = await Geo.checkPermissions();
      if (perms.location !== 'granted') {
        const req = await Geo.requestPermissions({ permissions: ['location'] });
        if (req.location !== 'granted') throw new Error('Permiso de ubicación denegado.');
      }
      const state = {
        totalMeters: 0,
        points: [],
        startedAt: Date.now(),
        watchId: null
      };
      const MIN_STEP_M = 3;
      const MAX_JUMP_M = 200;
      const MAX_ACCURACY_M = 40;
      state.watchId = await Geo.watchPosition(
        { enableHighAccuracy: true, timeout: 10000 },
        (pos, err) => {
          if (err) { console.error('[odometer]', err); return; }
          if (!pos || !pos.coords) return;
          const c = pos.coords;
          if (typeof c.accuracy === 'number' && c.accuracy > MAX_ACCURACY_M) return;
          const last = state.points[state.points.length - 1];
          const pt = { lat: c.latitude, lng: c.longitude, ts: pos.timestamp || Date.now(), accuracy: c.accuracy };
          if (last) {
            const d = haversineMeters(last.lat, last.lng, pt.lat, pt.lng);
            if (d < MIN_STEP_M) return;
            if (d > MAX_JUMP_M) return;
            state.totalMeters += d;
          }
          state.points.push(pt);
          if (typeof onUpdate === 'function') onUpdate({
            totalMeters: state.totalMeters,
            pointCount: state.points.length,
            currentAccuracy: c.accuracy,
            elapsedMs: Date.now() - state.startedAt,
            startPoint: state.points[0],
            endPoint: pt
          });
        }
      );
      return state;
    },

    async stopOdometer(state) {
      const Geo = global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.Geolocation;
      if (Geo && state && state.watchId) await Geo.clearWatch({ id: state.watchId });
    },

    async scanAccessPoints() {
      const plugin = nativePlugin();
      if (!plugin) throw new Error('Plugin nativo no disponible.');
      return plugin.scanAccessPoints();
    },

    // Obtiene la posición GPS actual.
    // opts: { timeoutMs } — timeout en milisegundos (por defecto 10000).
    // Devuelve: { latitude, longitude, accuracy }
    //
    // Prioridad:
    //  1) Capacitor.Plugins.Geolocation (APK nativo)
    //  2) navigator.geolocation (fallback navegador)
    //  3) Error si ninguno está disponible.
    async getCurrentPosition(opts) {
      const timeoutMs = (opts && opts.timeoutMs) || 10000;

      // --- Rama Capacitor (APK) ---
      const Geo = global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.Geolocation;
      if (Geo) {
        await Geo.requestPermissions({ permissions: ['location'] });
        const pos = await Geo.getCurrentPosition({ enableHighAccuracy: true, timeout: timeoutMs });
        return {
          latitude:  pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy:  pos.coords.accuracy,
        };
      }

      // --- Rama navegador (fallback) ---
      if (global.navigator && global.navigator.geolocation) {
        return new Promise((resolve, reject) => {
          global.navigator.geolocation.getCurrentPosition(
            (pos) => resolve({
              latitude:  pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy:  pos.coords.accuracy,
            }),
            (err) => reject(new Error(err.message || 'Error de geolocalización.')),
            { enableHighAccuracy: true, timeout: timeoutMs }
          );
        });
      }

      throw new Error('Geolocalización no disponible en este dispositivo.');
    },

    // ------------------------------------------------------------------------
    // speedtestServers — SÓLO discovery + ping (fases 1-2 del antiguo motor).
    // No mide banda; alimenta el selector de servidor de la UI.
    //
    //  1) Discover: API de Ookla (via CapacitorHttp para saltar CORS) →
    //     lista de ~20 servers cercanos ordenados por distancia.
    //  2) Ping a los 8 más cercanos (vía plugin nativo, sin CORS) → pingMs por
    //     servidor.
    //  3) Auto-selección del recomendado: el de menor ping si alguno respondió;
    //     si ninguno respondió, el más cercano por distancia (la lista ya viene
    //     ordenada por cercanía desde la API).
    //
    // Devuelve { servers, selected } donde:
    //  - servers: array de objetos servidor (ver contrato), con flag `selected`
    //    en true en el recomendado.
    //  - selected: el objeto servidor recomendado (referencia dentro de servers).
    // ------------------------------------------------------------------------
    async speedtestServers() {
      // ---------- Fase 1: Discovery con la API de Ookla ----------
      // La API geo-localiza por IP del cliente y devuelve servers cercanos.
      // CapacitorHttp.request hace requests nativas (Java) → bypass CORS.
      const Http = global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.CapacitorHttp;
      const OOKLA_API = 'https://www.speedtest.net/api/js/servers?engine=js&https_functional=true&limit=20';

      let ooklaServers = [];
      try {
        if (!Http) throw new Error('CapacitorHttp no disponible en este runtime.');
        const res = await Http.request({ url: OOKLA_API, method: 'GET' });
        const list = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
        if (!Array.isArray(list)) throw new Error('Respuesta inesperada de la API de Ookla.');
        ooklaServers = list.map((s) => ({
          id: String(s.id),
          sponsor: s.sponsor,
          city: s.name,
          country: s.country,
          label: `${s.sponsor} · ${s.name}, ${s.country}`,
          host: s.host,
          url: s.url,   // ej: https://speedtest.cnt.com.ec:8080/speedtest/upload.php
          distance: s.distance,
          lat: parseFloat(s.lat), lon: parseFloat(s.lon),
        }));
      } catch (err) {
        throw new Error(`No se pudieron descubrir servidores Ookla: ${err.message || err}`);
      }
      if (ooklaServers.length === 0) {
        throw new Error('La API de Ookla no devolvió servidores para tu ubicación.');
      }

      // ---------- Puente al plugin nativo ----------
      // ping/latencia/download/upload corren en Java (HttpURLConnection):
      // sin CORS y con ancho de banda real. Discovery se queda en JS arriba.
      const NetworkTools = global.Capacitor && global.Capacitor.Plugins
        && global.Capacitor.Plugins.NetworkTools;
      if (!NetworkTools || typeof NetworkTools.httpPing !== 'function') {
        throw new Error('Plugin NetworkTools (speedtest nativo) no disponible. Recompila el APK.');
      }

      // ---------- Fase 2: Ping a cada server (vía plugin nativo) ----------
      const pingServer = async (server) => {
        const base = server.url.replace(/\/upload\.php$/i, '');
        const pingUrl = `${base}/random350x350.jpg`;
        try {
          const r = await NetworkTools.httpPing({ url: pingUrl, samples: 3 });
          return (r && r.ok && r.avgMs != null) ? r.avgMs : null;
        } catch (_) {
          return null;
        }
      };
      // Pingueamos hasta los 8 más cercanos por geografía para no demorar.
      const candidates = ooklaServers.slice(0, 8);
      const pings = await Promise.all(candidates.map(pingServer));
      const servers = candidates.map((s, i) => ({
        id: s.id,
        label: s.label,
        sponsor: s.sponsor,
        city: s.city,
        country: s.country,
        host: s.host,
        url: s.url,
        distance: s.distance,
        pingMs: pings[i] != null ? Number(pings[i].toFixed(1)) : null,
        online: pings[i] != null,
        selected: false,
      }));
      // Auto-selección del recomendado: el de menor ping si alguno respondió;
      // si ninguno respondió, el más cercano por distancia (servers ya viene
      // ordenado por cercanía desde la API).
      const online = servers.filter((s) => s.online);
      online.sort((a, b) => a.pingMs - b.pingMs);
      const best = online.length > 0 ? online[0] : servers[0];
      // Marca en el array original para que la UI lo resalte.
      const selectedIdx = servers.findIndex((s) => s.id === best.id);
      if (selectedIdx >= 0) servers[selectedIdx].selected = true;

      return { servers, selected: servers[selectedIdx >= 0 ? selectedIdx : 0] };
    },

    async speedtest(opts) {
      // Mide latencia/descarga/subida REALMENTE contra el servidor Ookla/ISP
      // elegido (no contra Cloudflare). Los endpoints se derivan de server.url
      // (forma: https://host:puerto/speedtest/upload.php):
      //   base    = url sin "/upload.php"
      //   latencia= base/latency.txt (fallback base/random350x350.jpg)
      //   bajada  = base/random4000x4000.jpg (Ookla la genera al vuelo)
      //   subida  = server.url (el upload.php; acepta POST chunked)
      //
      // Fallback honesto y ETIQUETADO: si la bajada o la subida contra el
      // servidor falla (0 bytes / 0 Mbps / rechazo del plugin), se reintenta
      // esa fase contra Cloudflare (speed.cloudflare.com/__down|__up) y se marca
      // measuredVia='cloudflare-fallback'. Si incluso Cloudflare falla, se lanza
      // un Error con el motivo real (código HTTP / última excepción del plugin).
      // Nunca devuelve 0 en silencio.
      //
      // opts:
      //   server     — objeto servidor de speedtestServers().servers; si no
      //                viene, se descubre internamente y se usa el recomendado
      //                (selected) → "mandar sin elegir = más cercano y mejor".
      //   onProgress — callback con las mismas fases/campos de siempre
      //                (discover, latency, download, upload, done; cada uno con
      //                phase/progress/mbps/elapsedMs según corresponda).
      // TODO ISP Monitor: comparar con QoS del lado del ISP.

      const onProgress = (opts && opts.onProgress) || (() => {});

      // ---------- Fase 1: resolver servidor (elegido o auto) ----------
      onProgress({ phase: 'discover' });
      let server = opts && opts.server;
      let servers;
      if (server && server.url) {
        // Servidor elegido por el técnico: no re-descubrimos la lista completa.
        // Conservamos `servers` con ese único servidor para mantener el contrato
        // (la UI ya tiene la lista que obtuvo con speedtestServers()).
        servers = [server];
      } else {
        const disc = await this.speedtestServers();
        servers = disc.servers;
        server = disc.selected;
      }
      if (!server || !server.url) {
        throw new Error('No hay servidor disponible para medir.');
      }

      const NetworkTools = global.Capacitor && global.Capacitor.Plugins
        && global.Capacitor.Plugins.NetworkTools;
      if (!NetworkTools || typeof NetworkTools.httpPing !== 'function') {
        throw new Error('Plugin NetworkTools (speedtest nativo) no disponible. Recompila el APK.');
      }

      // Endpoints derivados del servidor elegido.
      const base = server.url.replace(/\/upload\.php$/i, '');
      const SRV_LATENCY = `${base}/latency.txt`;
      const SRV_LATENCY_ALT = `${base}/random350x350.jpg`;
      const SRV_DOWN = `${base}/random4000x4000.jpg`;
      const SRV_UP = server.url;

      // Endpoints Cloudflare (fallback honesto y etiquetado).
      const CF_DOWN = 'https://speed.cloudflare.com/__down';
      const CF_UP = 'https://speed.cloudflare.com/__up';

      const serverName = server.sponsor || server.label || 'Servidor';
      const city = server.city;
      const country = server.country;
      let colo = server.sponsor;   // metadata; download puede sobreescribir.

      // ---------- Fase 2: Latencia precisa contra el servidor (nativo) ----------
      onProgress({ phase: 'latency', progress: 0 });
      const LATENCY_SAMPLES = 12;
      let latencyMs = NaN, jitterMs = 0, packetLossPercent = 0;
      try {
        let lat = await NetworkTools.httpPing({ url: SRV_LATENCY, samples: LATENCY_SAMPLES });
        // Si latency.txt no existe / no responde, reintentar con el asset jpg
        // (presente en todo servidor Ookla).
        if (!lat || !lat.ok || lat.minMs == null) {
          lat = await NetworkTools.httpPing({ url: SRV_LATENCY_ALT, samples: LATENCY_SAMPLES });
        }
        latencyMs = lat && lat.minMs != null ? lat.minMs : NaN;
        jitterMs = lat && lat.jitterMs != null ? lat.jitterMs : 0;
        packetLossPercent = lat && lat.packetLossPercent != null ? lat.packetLossPercent : 0;
      } catch (_) { /* deja NaN/0 */ }
      onProgress({ phase: 'latency', progress: 1 });

      // ---------- Suscripción a progreso nativo ----------
      // El plugin emite "speedtestProgress" cada ~300ms con {phase,mbps,
      // elapsedMs,progress}. Lo reenviamos a onProgress tal cual (mismos
      // campos y nombres que el código JS anterior).
      const sub = await NetworkTools.addListener('speedtestProgress', (p) => {
        if (!p || !p.phase) return;
        onProgress({
          phase: p.phase,
          progress: p.progress != null ? Math.min(1, p.progress) : 0,
          mbps: p.mbps != null ? Number(p.mbps.toFixed(2)) : 0,
          elapsedMs: p.elapsedMs || 0,
        });
      });

      // measuredVia es 'server' por defecto; pasa a 'cloudflare-fallback' si
      // alguna de las dos fases de banda tuvo que caer a Cloudflare.
      let measuredVia = 'server';
      let downloadMbps = 0, dlBytes = 0, dlElapsedMs = 0;
      let uploadMbps = 0, ulBytes = 0, ulElapsedMs = 0;
      try {
        // ---------- Fase 3: Download multi-stream (nativo, saturando) ----------
        // 6 conexiones paralelas mínimo 15 s. Satura el link: un solo stream
        // raramente alcanza el bandwidth real por TCP slow-start. El plugin
        // relanza el GET en bucle por stream hasta minMs; Ookla genera la
        // imagen random4000x4000.jpg al vuelo (varios MB por request).
        onProgress({ phase: 'download', progress: 0, mbps: 0, elapsedMs: 0 });
        // El plugin puede rechazar (call.reject) ante errores de red; lo
        // atrapamos para poder caer a Cloudflare en vez de abortar todo.
        const dl = await NetworkTools.downloadTest({
          url: SRV_DOWN,
          parallelStreams: 6,
          minMs: 15000,
          maxMs: 22000,
        }).catch((e) => ({ __rejected: (e && e.message) ? e.message : String(e) }));
        downloadMbps = dl && dl.downloadMbps != null ? dl.downloadMbps : 0;
        dlBytes = dl && dl.downloadBytes != null ? dl.downloadBytes : 0;
        dlElapsedMs = dl && dl.downloadElapsedMs != null ? dl.downloadElapsedMs : 0;
        if (dl && dl.colo) colo = dl.colo;

        // Si el servidor no entregó nada, caer a Cloudflare (etiquetado).
        if (!dlBytes || !downloadMbps) {
          measuredVia = 'cloudflare-fallback';
          const dlFile = `${CF_DOWN}?bytes=26214400`;   // 25 MB por request
          const cf = await NetworkTools.downloadTest({
            url: dlFile,
            parallelStreams: 6,
            minMs: 15000,
            maxMs: 22000,
          });
          downloadMbps = cf && cf.downloadMbps != null ? cf.downloadMbps : 0;
          dlBytes = cf && cf.downloadBytes != null ? cf.downloadBytes : 0;
          dlElapsedMs = cf && cf.downloadElapsedMs != null ? cf.downloadElapsedMs : 0;
          if (cf && cf.colo) colo = cf.colo;
          // Ni el servidor ni Cloudflare entregaron nada: error con motivo real.
          if (!dlBytes || !downloadMbps) {
            const srvMsg = (dl && dl.__rejected)
              ? `servidor rechazó (${dl.__rejected})`
              : `servidor HTTP ${dl && dl.downloadFirstHttpCode != null ? dl.downloadFirstHttpCode : -1}` +
                (dl && dl.downloadLastError ? ` · ${dl.downloadLastError}` : '');
            const cfCode = cf && cf.downloadFirstHttpCode != null ? cf.downloadFirstHttpCode : -1;
            const cfErr = cf && cf.downloadLastError ? ` · ${cf.downloadLastError}` : '';
            throw new Error(`Bajada falló: ${srvMsg}; Cloudflare HTTP ${cfCode}${cfErr}`);
          }
        }

        // ---------- Fase 4: Upload multi-stream (nativo) ----------
        // Subida contra el upload.php del servidor (POST chunked continuo).
        onProgress({ phase: 'upload', progress: 0, mbps: 0, elapsedMs: 0 });
        const ul = await NetworkTools.uploadTest({
          url: SRV_UP,
          parallelStreams: 4,
          minMs: 15000,
          maxMs: 22000,
        }).catch((e) => ({ __rejected: (e && e.message) ? e.message : String(e) }));
        uploadMbps = ul && ul.uploadMbps != null ? ul.uploadMbps : 0;
        ulBytes = ul && ul.uploadBytes != null ? ul.uploadBytes : 0;
        ulElapsedMs = ul && ul.uploadElapsedMs != null ? ul.uploadElapsedMs : 0;

        // Si el servidor no aceptó nada, caer a Cloudflare (etiquetado).
        if (!ulBytes || !uploadMbps) {
          measuredVia = 'cloudflare-fallback';
          const cf = await NetworkTools.uploadTest({
            url: CF_UP,
            parallelStreams: 4,
            minMs: 15000,
            maxMs: 22000,
          });
          uploadMbps = cf && cf.uploadMbps != null ? cf.uploadMbps : 0;
          ulBytes = cf && cf.uploadBytes != null ? cf.uploadBytes : 0;
          ulElapsedMs = cf && cf.uploadElapsedMs != null ? cf.uploadElapsedMs : 0;
          // Ni el servidor ni Cloudflare aceptaron nada: error con motivo real.
          if (!ulBytes || !uploadMbps) {
            const srvMsg = (ul && ul.__rejected)
              ? `servidor rechazó (${ul.__rejected})`
              : 'servidor aceptó 0 bytes';
            throw new Error(`Subida falló: ${srvMsg}; Cloudflare también devolvió 0.`);
          }
        }
      } finally {
        try { await sub.remove(); } catch (_) {}
      }

      onProgress({ phase: 'done' });
      return {
        serverName,
        colo, city, country,
        servers,
        selectedServer: server,
        measuredVia,
        downloadMbps: Number(downloadMbps.toFixed(2)),
        uploadMbps: Number(uploadMbps.toFixed(2)),
        latencyMs: Number(latencyMs.toFixed(1)),
        jitterMs: Number(jitterMs.toFixed(1)),
        packetLossPercent: Number(packetLossPercent.toFixed(1)),
        downloadBytes: dlBytes,
        uploadBytes: ulBytes,
        downloadElapsedMs: dlElapsedMs,
        uploadElapsedMs: ulElapsedMs,
      };
    }
  };

  function haversineMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (d) => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  // --------------------------------------------------------------------------
  // serialScanner — escaneo de serial vía ML Kit (barcode + OCR)
  // La lógica de negocio (filtrado, validación de patrón) queda en el frontend;
  // este wrapper sólo devuelve datos crudos.
  // --------------------------------------------------------------------------
  WifixNative.serialScanner = {
    /**
     * true sólo si corre dentro del APK con los plugins disponibles.
     */
    available() {
      return isNative() &&
        !!(global.Capacitor && global.Capacitor.Plugins &&
           global.Capacitor.Plugins.BarcodeScanner &&
           global.Capacitor.Plugins.CapacitorPluginMlKitTextRecognition);
    },

    /**
     * Abre el escáner en vivo de ML Kit (barcode/QR) vía `BarcodeScanner.scan()`.
     * Pide permiso de cámara si hace falta antes de abrir.
     * Devuelve un array con los rawValue de todos los códigos detectados,
     * deduplicados y en .trim().toUpperCase(). Si el usuario cancela o no hay
     * códigos devuelve []. No lanza por cancelación.
     *
     * @returns {Promise<string[]>}
     */
    async scanBarcodes() {
      if (!isNative()) return [];
      const BS = global.Capacitor.Plugins.BarcodeScanner;
      if (!BS) return [];

      // Permisos de cámara
      try {
        const perms = await BS.checkPermissions();
        if (perms.camera !== 'granted') {
          const req = await BS.requestPermissions();
          if (req.camera !== 'granted') {
            console.warn('[serialScanner] Permiso de cámara denegado.');
            return [];
          }
        }
      } catch (permErr) {
        console.error('[serialScanner] Error al pedir permiso de cámara:', permErr);
        return [];
      }

      // scan() abre la UI nativa de ML Kit (Google Barcode Scanner bundled).
      // Requiere Google Play Services; en su ausencia lanza una excepción.
      try {
        const result = await BS.scan();
        const barcodes = (result && result.barcodes) || [];
        if (barcodes.length === 0) return [];

        // Deduplicar y normalizar
        const seen = new Set();
        const out = [];
        for (const b of barcodes) {
          const val = (b.rawValue || '').trim().toUpperCase();
          if (val && !seen.has(val)) {
            seen.add(val);
            out.push(val);
          }
        }
        return out;
      } catch (err) {
        // El usuario canceló o el módulo no está disponible — no propagamos.
        const msg = (err && err.message) || String(err);
        if (/cancel/i.test(msg) || /dismiss/i.test(msg)) return [];
        console.error('[serialScanner] scanBarcodes error:', err);
        return [];
      }
    },

    /**
     * Recibe una imagen en base64 (dataURL "data:image/...;base64,..." o base64 puro),
     * corre el OCR on-device de ML Kit (pantrist) y devuelve las LÍNEAS de texto
     * reconocidas como array de strings crudas.
     * Si no reconoce nada devuelve [].
     *
     * Usa: CapacitorPluginMlKitTextRecognition.detectText({ base64Image })
     * Shape de salida: { text: string, blocks: Block[] } donde cada Block tiene lines[].
     *
     * @param {string} base64 - dataURL o base64 puro
     * @returns {Promise<string[]>}
     */
    async ocrFromImageBase64(base64) {
      if (!isNative()) return [];
      const OCR = global.Capacitor.Plugins.CapacitorPluginMlKitTextRecognition;
      if (!OCR) return [];

      // Normalizar: el plugin espera base64 puro (sin el prefijo dataURL).
      const cleanBase64 = typeof base64 === 'string' && base64.indexOf(',') !== -1
        ? base64.split(',')[1]
        : base64;

      try {
        const result = await OCR.detectText({ base64Image: cleanBase64 });
        if (!result || !result.blocks || result.blocks.length === 0) return [];

        // Extraer líneas de texto de todos los bloques
        const lines = [];
        for (const block of result.blocks) {
          if (!block.lines) continue;
          for (const line of block.lines) {
            if (line.text) lines.push(line.text);
          }
        }
        return lines;
      } catch (err) {
        console.error('[serialScanner] ocrFromImageBase64 error:', err);
        return [];
      }
    }
  };

  // --------------------------------------------------------------------------
  // takePhoto — toma una foto con la cámara del dispositivo en el momento.
  // Devuelve un dataURL "data:image/jpeg;base64,..." o null si el usuario
  // cancela o si se deniega el permiso. No lanza por cancelación.
  //
  // Contrato:
  //   WifixNative.takePhoto(): Promise<string|null>
  //
  // Usa @capacitor/camera 6.x (Capacitor.Plugins.Camera):
  //   - checkPermissions / requestPermissions para el alias "camera".
  //   - getPhoto({ source: 'CAMERA', resultType: 'dataUrl', quality: 70 })
  //     → { dataUrl: "data:image/jpeg;base64,..." }
  // --------------------------------------------------------------------------
  WifixNative.takePhoto = async function takePhoto() {
    if (!isNative()) return null;
    const Cam = global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.Camera;
    if (!Cam) {
      console.warn('[WifixNative.takePhoto] Plugin Camera no disponible.');
      return null;
    }

    // Verificar / solicitar permiso de cámara en runtime.
    try {
      const perms = await Cam.checkPermissions();
      if (perms.camera !== 'granted') {
        const req = await Cam.requestPermissions({ permissions: ['camera'] });
        if (req.camera !== 'granted') {
          console.warn('[WifixNative.takePhoto] Permiso de cámara denegado.');
          return null;
        }
      }
    } catch (permErr) {
      console.error('[WifixNative.takePhoto] Error al verificar permisos:', permErr);
      return null;
    }

    // Abrir la cámara y tomar la foto.
    // source: 'CAMERA' — abre la cámara nativa, no la galería.
    // resultType: 'dataUrl' — devuelve { dataUrl: "data:image/jpeg;base64,..." }.
    // quality: 70 — compresión JPEG razonable para uso en campo.
    try {
      const photo = await Cam.getPhoto({
        source: 'CAMERA',
        resultType: 'dataUrl',
        quality: 70,
        allowEditing: false,
        saveToGallery: false,
      });
      return (photo && photo.dataUrl) ? photo.dataUrl : null;
    } catch (err) {
      // El usuario canceló la cámara — no propagamos el error.
      const msg = (err && err.message) || String(err);
      if (
        /cancel/i.test(msg) ||
        /dismiss/i.test(msg) ||
        /user cancelled/i.test(msg) ||
        /User cancelled/i.test(msg)
      ) {
        return null;
      }
      console.error('[WifixNative.takePhoto] Error al tomar foto:', err);
      return null;
    }
  };

  global.WifixNative = WifixNative;

  // --------------------------------------------------------------------------
  // Si NO es nativo: solo inyectar aviso en las consolas en vivo y salir.
  // --------------------------------------------------------------------------
  if (!isNative()) {
    console.info('[WifixNative] no es Capacitor — modo webapp puro.');

    function injectBrowserNotice(formEl) {
      if (formEl.dataset.liveWired === '1') return;
      formEl.dataset.liveWired = '1';
      const output = formEl.querySelector('[data-slot="console"]');
      const startBtn = formEl.querySelector('[data-action="live-start"]');
      if (!output) return;
      const msg = formEl.dataset.tool === 'ping-live'
        ? 'Ping en vivo solo disponible en la app Android (APK).'
        : 'Traceroute en vivo solo disponible en la app Android (APK).';
      const line = document.createElement('div');
      line.className = 'console-line console-warn';
      line.textContent = msg;
      output.appendChild(line);
      if (startBtn) {
        startBtn.disabled = true;
        startBtn.title = 'Requiere APK Android';
      }
    }

    function scanLiveForms(root) {
      if (!root || !root.querySelectorAll) return;
      root.querySelectorAll('.tool-form[data-tool="ping-live"], .tool-form[data-tool="traceroute-live"]')
        .forEach(injectBrowserNotice);
    }

    const browserObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach(node => {
          if (node.nodeType !== 1) return;
          if (node.matches && (node.matches('.tool-form[data-tool="ping-live"]') || node.matches('.tool-form[data-tool="traceroute-live"]'))) {
            injectBrowserNotice(node);
          }
          scanLiveForms(node);
        });
      }
    });

    function startBrowserObserver() {
      scanLiveForms(document.body);
      browserObserver.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startBrowserObserver);
    } else {
      startBrowserObserver();
    }

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

  // --- Mapa de Calor WiFi (medidor + odómetro por habitación) ---
  function rssiQualityLabel(dbm) {
    if (dbm == null || isNaN(dbm)) return '—';
    if (dbm >= -50) return 'Excelente';
    if (dbm >= -60) return 'Muy buena';
    if (dbm >= -70) return 'Buena';
    if (dbm >= -80) return 'Regular';
    return 'Mala';
  }

  function buildGaugeSvg(pct) {
    const safe = Math.max(0, Math.min(100, Number(pct) || 0));
    const R = 80;
    const CIRC = 2 * Math.PI * R;          // 502.65
    const ARC_PCT = 0.75;                  // 3/4 de vuelta (270°)
    const ARC = CIRC * ARC_PCT;            // 376.99
    const fill = ARC * (safe / 100);
    const ROT = 135;                       // empieza en 7:30
    return `
      <svg viewBox="0 0 200 200" class="wifi-gauge-svg" aria-hidden="true">
        <circle cx="100" cy="100" r="${R}" fill="none"
                stroke="rgba(255,255,255,0.10)" stroke-width="14"
                stroke-dasharray="${ARC.toFixed(2)} ${CIRC.toFixed(2)}"
                transform="rotate(${ROT} 100 100)" />
        <circle cx="100" cy="100" r="${R}" fill="none"
                stroke="url(#wifi-gauge-grad)" stroke-width="14" stroke-linecap="round"
                stroke-dasharray="${fill.toFixed(2)} ${CIRC.toFixed(2)}"
                transform="rotate(${ROT} 100 100)" />
        <defs>
          <linearGradient id="wifi-gauge-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#ffb347"/>
            <stop offset="100%" stop-color="#ff6a3d"/>
          </linearGradient>
        </defs>
      </svg>`;
  }

  // --- Mapa de Calor WiFi multi-AP (Flujos A + B del refactor) -------------
  // Flujo A: descubrimiento + etiquetado de APs (al abrir, scan + pre-carga
  // de APs ya registrados de esta cuenta).
  // Flujo B: por cada habitación, scan continuo (1.5 s) mostrando RSSI por
  // cada AP etiquetado; el técnico tocá "Capturar habitación" para snapshotear.
  // Persistencia local en localStorage para no perder mediciones si falla la red.

  function classifyRssi(dbm) {
    if (dbm == null || isNaN(dbm)) return { label: '—', cls: 'rssi-na' };
    if (dbm >= -55) return { label: 'Excelente', cls: 'rssi-excelente' };
    if (dbm >= -65) return { label: 'Buena',     cls: 'rssi-buena' };
    if (dbm >= -75) return { label: 'Aceptable', cls: 'rssi-aceptable' };
    if (dbm >= -85) return { label: 'Pobre',     cls: 'rssi-pobre' };
    return { label: 'Zona muerta', cls: 'rssi-muerta' };
  }
  function rssiPercent(dbm) {
    if (dbm == null || isNaN(dbm)) return 0;
    return Math.max(0, Math.min(100, 2 * (dbm + 100)));
  }
  function safeText(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function draftKey(acct) { return `wifix:heatmap-draft:${acct || 'unknown'}`; }
  function loadDraft(acct) {
    try { return JSON.parse(localStorage.getItem(draftKey(acct)) || 'null'); }
    catch (_) { return null; }
  }
  function saveDraft(acct, draft) {
    try { localStorage.setItem(draftKey(acct), JSON.stringify(draft)); } catch (_) {}
  }
  function clearDraft(acct) {
    try { localStorage.removeItem(draftKey(acct)); } catch (_) {}
  }

  // --- Medición de Señal WiFi -----------------------------------------------
  // Modelo simplificado:
  //  - Medidor del AP CONECTADO al teléfono, en vivo (gauge + RSSI + datos).
  //  - Un único router anclado por GPS → distancia continua a ese punto.
  //  - Lista desplegable solo-lectura con los demás APs detectados de la MISMA
  //    red conectada (mismo SSID). Sólo info, no edición.
  //  - Por habitación: snapshot del medidor + distancia al router + measurements
  //    multi-AP (para el backend), sin pedirle al técnico que etiquete nada.

  function wireHeatmapForm(formEl) {
    if (formEl.dataset.nativeWired === '1') return;
    formEl.dataset.nativeWired = '1';

    formEl.innerHTML = `
      <label class="form-row">
        <span class="form-label">Etiqueta del relevamiento</span>
        <input type="text" data-field="label" placeholder="Casa Pérez · piso 1">
      </label>

      <div class="heatmap-section heatmap-previous-section" data-slot="previous-section" hidden>
        <button type="button" class="previous-head" data-action="toggle-previous">
          <span class="form-label">Mediciones anteriores</span>
          <span class="previous-count" data-slot="previous-count">0</span>
          <span class="previous-caret">▾</span>
        </button>
        <div class="previous-body" data-slot="previous-body" hidden>
          <div class="previous-list" data-slot="previous-list">
            <div class="heatmap-empty">Cargando…</div>
          </div>
          <div class="previous-detail" data-slot="previous-detail" hidden>
            <div class="previous-detail-head">
              <span data-slot="previous-detail-title">Detalle</span>
              <button type="button" class="previous-close" data-action="close-previous">✕</button>
            </div>
            <div class="heatmap-legacy-banner" data-slot="previous-legacy-banner" hidden>
              ⚠️ Relevamiento en formato anterior — sin desglose por equipo.
            </div>
            <div class="analysis-tabs previous-tabs" role="tablist">
              <button type="button" class="analysis-tab active" data-tab="by-room" role="tab">Por habitación</button>
              <button type="button" class="analysis-tab" data-tab="by-ap" role="tab">Por equipo</button>
              <button type="button" class="analysis-tab" data-tab="summary" role="tab">Resumen</button>
            </div>
            <div class="analysis-panel" data-slot="previous-analysis-panel"></div>
          </div>
        </div>
      </div>

      <div class="wifi-meter-card">
        <div class="wifi-meter-head">
          <span class="form-label">Medidor en vivo</span>
          <span class="wifi-live-dot" title="Medición en vivo"></span>
        </div>
        <div class="wifi-gauge" data-slot="gauge">
          <div class="wifi-gauge-center">
            <span class="wifi-gauge-label">Señal WiFi</span>
            <span class="wifi-gauge-value" data-slot="pct">—</span>
            <span class="wifi-gauge-unit">%</span>
          </div>
        </div>
        <dl class="wifi-data">
          <div><dt>Red conectada</dt><dd data-slot="ssid">—</dd></div>
          <div><dt>RSSI</dt><dd data-slot="rssi">—</dd></div>
          <div><dt>Intensidad</dt><dd data-slot="quality">—</dd></div>
          <div><dt>Velocidad de enlace</dt><dd data-slot="linkspeed">—</dd></div>
          <div><dt>Dirección IP</dt><dd data-slot="ip">—</dd></div>
          <div><dt>BSSID (MAC)</dt><dd data-slot="mac">—</dd></div>
          <div><dt>Estándar</dt><dd data-slot="standard">—</dd></div>
          <div><dt>Frecuencia</dt><dd data-slot="freq">—</dd></div>
          <div><dt>Distancia estimada</dt><dd data-slot="distance">— m</dd></div>
        </dl>
      </div>

      <div class="heatmap-section heatmap-detected-section">
        <button type="button" class="previous-head" data-action="toggle-detected">
          <span class="form-label">Routers y amplificadores de esta red</span>
          <span class="previous-count" data-slot="detected-count">0</span>
          <span class="previous-caret" data-slot="detected-caret">▾</span>
        </button>
        <div class="detected-body" data-slot="detected-body" hidden>
          <div class="detected-list" data-slot="detected-list">
            <div class="heatmap-empty">Sin conexión a una red WiFi.</div>
          </div>
        </div>
      </div>

      <div class="heatmap-section">
        <div class="heatmap-section-head">
          <span class="form-label">Habitación actual</span>
        </div>
        <div class="form-grid-2">
          <label class="form-row"><span class="form-label">Nombre</span>
            <input type="text" data-field="roomName" placeholder="Dormitorio principal"></label>
          <label class="form-row"><span class="form-label">Piso</span>
            <input type="number" data-field="roomFloor" value="1" min="1"></label>
        </div>
        <button type="button" class="save-btn heatmap-capture-btn" data-action="capture-room" disabled>📍 Capturar habitación</button>
      </div>

      <div class="heatmap-section">
        <div class="heatmap-rooms-head">
          <span class="form-label">Habitaciones registradas</span>
          <span class="heatmap-rooms-count" data-slot="rooms-count">0</span>
        </div>
        <div class="heatmap-rooms-list" data-slot="rooms-list">
          <div class="heatmap-empty">Aún no hay habitaciones capturadas.</div>
        </div>
      </div>

      <div class="heatmap-section heatmap-analysis-section" data-slot="analysis-section" hidden>
        <div class="heatmap-section-head">
          <span class="form-label">Análisis</span>
        </div>
        <div class="heatmap-legacy-banner" data-slot="legacy-banner" hidden>
          ⚠️ Este relevamiento está en formato anterior — sin desglose por equipo.
        </div>
        <div class="analysis-tabs" role="tablist">
          <button type="button" class="analysis-tab active" data-tab="by-room" role="tab">Por habitación</button>
          <button type="button" class="analysis-tab" data-tab="by-ap" role="tab">Por equipo</button>
          <button type="button" class="analysis-tab" data-tab="summary" role="tab">Resumen</button>
        </div>
        <div class="analysis-panel" data-slot="analysis-panel"></div>
      </div>

      <label class="form-row"><span class="form-label">Notas generales</span>
        <textarea data-field="notes" rows="2" placeholder="Detalles del relevamiento"></textarea></label>
      <button type="button" class="save-btn heatmap-save-btn" data-action="save-heatmap" disabled>💾 Guardar medición</button>
      <div class="heatmap-status" data-slot="save-status"></div>`;

    // Estimación de distancia desde RSSI usando log-distance path loss model.
    // d = 10 ^ ((P0 - rssi) / (10 * n))
    //   P0  = -50 dBm (RSSI típico a 1 m de un router doméstico)
    //   n   = 3.0     (factor de propagación en interior con paredes)
    // Es una aproximación; varía bastante por obstáculos (muebles, paredes
    // de concreto). Sirve como orden de magnitud, no como medida exacta.
    const RSSI_REF_DBM = -50;
    const PATH_LOSS_EXP = 3.0;
    function estimateDistanceFromRssi(rssi) {
      if (rssi == null || isNaN(rssi)) return null;
      const d = Math.pow(10, (RSSI_REF_DBM - rssi) / (10 * PATH_LOSS_EXP));
      return d > 0 ? d : null;
    }

    const state = {
      account: null,
      latestWifi: null,        // getWifiInfo más reciente (AP conectado)
      latestScan: [],          // accessPoints del último scan (filtrado por SSID)
      rooms: [],
      timer: null,
      sensing: false,
      isLegacy: false,
      // Análisis del relevamiento actual
      analysisTab: 'by-room',
      analysisApIdx: 0,
      // Historial
      previousList: [],
      previousData: {},
      previousOpenId: null,
      previousAnalysisTab: 'by-room',
      previousAnalysisApIdx: 0,
    };

    const $ = (s) => formEl.querySelector(`[data-slot="${s}"]`);
    const setStatus = (slot, msg, color) => {
      const el = $(slot);
      if (!el) return;
      el.textContent = msg || '';
      el.style.color = color || 'rgba(180,210,255,0.7)';
    };
    const captureBtn = formEl.querySelector('[data-action="capture-room"]');
    const saveBtn = formEl.querySelector('[data-action="save-heatmap"]');

    // ---------- Persistencia ----------
    function persistDraft() {
      saveDraft(state.account, {
        label: formEl.querySelector('[data-field="label"]').value,
        notes: formEl.querySelector('[data-field="notes"]').value,
        rooms: state.rooms,
      });
    }
    function restoreDraft(d) {
      if (!d) return;
      formEl.querySelector('[data-field="label"]').value = d.label || '';
      formEl.querySelector('[data-field="notes"]').value = d.notes || '';
      state.rooms = Array.isArray(d.rooms) ? d.rooms : [];
    }

    // ---------- Render del medidor en vivo ----------
    function paintMeter() {
      const w = state.latestWifi;
      const pct = w
        ? (typeof w.signalPercent === 'number' ? w.signalPercent
            : Math.max(0, Math.min(100, 2 * ((w.rssiDbm || -100) + 100))))
        : 0;
      const gaugeEl = $('gauge');
      const center = gaugeEl.querySelector('.wifi-gauge-center');
      gaugeEl.innerHTML = buildGaugeSvg(pct);
      gaugeEl.appendChild(center);
      $('pct').textContent = w ? pct : '—';
      $('ssid').textContent = (w && w.ssid) || '—';
      $('rssi').textContent = w ? `${w.rssiDbm} dBm` : '—';
      $('quality').textContent = w ? rssiQualityLabel(w.rssiDbm) : '—';
      $('linkspeed').textContent = w && w.linkSpeedMbps != null ? `${w.linkSpeedMbps} Mbps` : '—';
      $('ip').textContent = (w && w.ipAddress) || '—';
      $('mac').textContent = (w && w.bssid) || '—';
      $('standard').textContent = (w && w.wifiStandardName) || (w && w.band) || '—';
      $('freq').textContent = w && w.frequencyMhz ? `${w.frequencyMhz} MHz${w.band ? ' · ' + w.band : ''}` : '—';

      const dist = w ? estimateDistanceFromRssi(w.rssiDbm) : null;
      $('distance').textContent = dist != null
        ? `~ ${dist.toFixed(1)} m (estimado por señal)`
        : '—';

      // Habilita capturar habitación cuando hay al menos lectura WiFi.
      captureBtn.disabled = !w;
    }

    function rssiQualityLabel(dbm) {
      if (dbm == null || isNaN(dbm)) return '—';
      if (dbm >= -55) return 'Excelente';
      if (dbm >= -65) return 'Buena';
      if (dbm >= -75) return 'Aceptable';
      if (dbm >= -85) return 'Pobre';
      return 'Zona muerta';
    }

    // ---------- Lista de equipos en la red conectada ----------
    function renderDetectedList() {
      const list = $('detected-list');
      const count = $('detected-count');
      const aps = state.latestScan;
      // count refleja routers físicos (grupos), no BSSID individuales.
      count.textContent = String(aps.length);
      if (aps.length === 0) {
        list.innerHTML = '<div class="heatmap-empty">Sin conexión a una red WiFi.</div>';
        return;
      }
      list.innerHTML = aps.map((ap) => {
        const cls = classifyRssi(ap.signalDbm);
        // Mostrar badge de bandas cuando hay más de una (dual-band).
        const isDualBand = ap.bandsLabel && ap.bandsLabel.includes('+');
        const bandBadge = isDualBand
          ? `<span class="ap-band-badge">${safeText(ap.bandsLabel)}</span>`
          : '';
        return `
          <div class="ap-row">
            <div class="ap-row-head">
              <span class="ap-ssid">${safeText(ap.ssid || '(oculto)')}</span>
              <span class="ap-meta">${ap.band || '—'} · ch ${ap.channel ?? '—'}</span>
              <span class="ap-rssi ${cls.cls}">${ap.signalDbm} dBm</span>
              ${ap.isConnected ? '<span class="ap-connected">conectado</span>' : ''}
            </div>
            <div class="ap-row-foot">
              <span class="ap-meta-mono">${safeText(ap.bssid)}</span>
              ${bandBadge}
            </div>
          </div>`;
      }).join('');
    }

    // ---------- Polling ----------
    async function pollWifi() {
      try {
        state.latestWifi = await WifixNative.getWifiInfo();
      } catch (_) { state.latestWifi = null; }
      paintMeter();
    }

    async function pollScan() {
      try {
        const res = await WifixNative.scanAccessPoints();
        const aps = res.accessPoints || [];
        const connSsid = res.connectedSsid;
        // Sólo APs de la red conectada al teléfono.
        const filtered = connSsid ? aps.filter((a) => a.ssid === connSsid) : [];

        // --- Paso 1: dedupe por BSSID exacto (mismo OEM duplicado en getScanResults).
        const byBssid = new Map();
        for (const ap of filtered) {
          const k = (ap.bssid || '').toLowerCase();
          if (!k) continue;
          const prev = byBssid.get(k);
          if (!prev || ap.signalDbm > prev.signalDbm) byBssid.set(k, ap);
        }

        // --- Paso 2: agrupar por router físico (primeros 5 octetos de la MAC).
        // Dos BSSID que difieran sólo en el último octeto son el mismo equipo
        // emitiendo en bandas distintas (2.4 GHz + 5 GHz).
        const byRouter = new Map();
        for (const ap of byBssid.values()) {
          const parts = ap.bssid.toLowerCase().split(':');
          const routerKey = parts.slice(0, 5).join(':');
          const group = byRouter.get(routerKey);
          if (!group) {
            byRouter.set(routerKey, { representative: ap, bands: [ap] });
          } else {
            group.bands.push(ap);
            // El representante es la banda de señal más fuerte.
            if (ap.signalDbm > group.representative.signalDbm) {
              group.representative = ap;
            }
          }
        }

        // --- Paso 3: construir el array final (un objeto por router físico).
        const grouped = [];
        for (const { representative, bands } of byRouter.values()) {
          // isConnected=true si cualquiera de las bandas es la conectada.
          const anyConnected = bands.some((b) => !!b.isConnected);
          // bandsLabel es SOLO para UI — nunca va al payload del backend.
          const bandNames = bands
            .map((b) => b.band || 'unknown')
            .filter((v, i, arr) => arr.indexOf(v) === i) // unique
            .sort();
          const bandsLabel = bandNames.length > 1 ? bandNames.join(' + ') : (bandNames[0] || '—');
          grouped.push(Object.assign({}, representative, {
            isConnected: anyConnected,
            bandsLabel,
          }));
        }

        grouped.sort((a, b) => b.signalDbm - a.signalDbm);
        state.latestScan = grouped;
        renderDetectedList();
      } catch (_) { /* sin red, no rompemos UI */ }
    }

    // ---------- Toggle equipos detectados ----------
    formEl.querySelector('[data-action="toggle-detected"]').addEventListener('click', () => {
      const body = $('detected-body');
      body.hidden = !body.hidden;
      $('detected-caret').textContent = body.hidden ? '▾' : '▴';
    });

    // ---------- Capturar habitación ----------
    captureBtn.addEventListener('click', () => {
      const roomName = formEl.querySelector('[data-field="roomName"]').value.trim();
      const floor = parseInt(formEl.querySelector('[data-field="roomFloor"]').value, 10) || 1;
      if (!roomName) { setStatus('save-status', 'Ingresá el nombre de la habitación.', '#f85149'); return; }
      if (!state.latestWifi) { setStatus('save-status', 'Sin lectura WiFi aún — esperá un par de segundos.', '#f85149'); return; }
      const w = state.latestWifi;
      const dist = estimateDistanceFromRssi(w.rssiDbm);

      // Measurements multi-AP (todos los APs de la red conectada).
      // El AP conectado va con isConnected=true; el resto con su lectura.
      const measurements = [];
      for (const ap of state.latestScan) {
        measurements.push({
          bssid: ap.bssid,
          apLabelSnapshot: ap.isConnected ? (w.ssid || ap.ssid || ap.bssid) : ap.ssid || ap.bssid,
          signalDbm: ap.signalDbm,
          band: ap.band || 'unknown',
          channel: ap.channel,
          isConnected: !!ap.isConnected,
        });
      }
      // Fallback si el scan vino vacío: usamos sólo la lectura del AP conectado.
      if (measurements.length === 0) {
        measurements.push({
          bssid: w.bssid || 'connected-unknown',
          apLabelSnapshot: w.ssid || 'Red conectada',
          signalDbm: w.rssiDbm,
          band: w.band || 'unknown',
          isConnected: true,
        });
      }

      state.rooms.push({
        roomName, floor,
        measuredAt: new Date().toISOString(),
        measurements,
        extras: {
          ssid: w.ssid || null,
          connectedBssid: w.bssid || null,
          estimatedDistanceMeters: dist != null ? Number(dist.toFixed(2)) : null,
          distanceMethod: 'rssi-path-loss',
          rssiRefDbm: RSSI_REF_DBM,
          pathLossExp: PATH_LOSS_EXP,
          linkSpeedMbps: w.linkSpeedMbps,
          frequencyMhz: w.frequencyMhz,
          wifiStandardName: w.wifiStandardName || null,
          ipAddress: w.ipAddress || null,
        },
      });
      formEl.querySelector('[data-field="roomName"]').value = '';
      renderRoomsList();
      saveBtn.disabled = state.rooms.length === 0;
      persistDraft();
      setStatus('save-status',
        `Habitación "${roomName}" capturada (${w.rssiDbm} dBm${dist != null ? `, ~${dist.toFixed(1)} m est.` : ''}).`,
        '#3fb950');
    });

    function renderRoomsList() {
      const slot = $('rooms-list');
      const count = $('rooms-count');
      count.textContent = String(state.rooms.length);
      if (state.rooms.length === 0) {
        slot.innerHTML = '<div class="heatmap-empty">Aún no hay habitaciones capturadas.</div>';
        renderAnalysis();
        return;
      }
      slot.innerHTML = state.rooms.map((r, i) => {
        const best = r.measurements.reduce((a, b) => (b.signalDbm > a.signalDbm ? b : a));
        const cls = classifyRssi(best.signalDbm);
        const distMeters = r.extras && (r.extras.estimatedDistanceMeters ?? r.extras.distanceFromRouterMeters);
        const distTxt = distMeters != null ? ` · ~${distMeters.toFixed(1)} m est.` : '';
        return `
          <div class="heatmap-room-row ${cls.cls}">
            <div class="heatmap-room-main">
              <strong>${safeText(r.roomName)}</strong>
              <span class="heatmap-room-sub">Piso ${r.floor} · ${best.signalDbm} dBm · ${cls.label}${distTxt}</span>
            </div>
            <button type="button" class="heatmap-room-remove" data-remove-room="${i}" aria-label="Quitar">×</button>
          </div>`;
      }).join('');
      renderAnalysis();
    }
    formEl.querySelector('[data-slot="rooms-list"]').addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-remove-room]');
      if (!btn) return;
      const idx = parseInt(btn.dataset.removeRoom, 10);
      state.rooms.splice(idx, 1);
      renderRoomsList();
      saveBtn.disabled = state.rooms.length === 0;
      persistDraft();
    });

    // ---------- Análisis ----------
    const DEAD_ZONE_THRESHOLD = -75;
    const STRONG_SIGNAL_THRESHOLD = -55;
    function bestApInRoom(room) {
      return room.measurements.reduce((a, b) => (b.signalDbm > a.signalDbm ? b : a));
    }
    function uniqueApsFromRooms(rooms) {
      const map = new Map();
      for (const r of rooms) {
        for (const m of r.measurements) {
          const k = (m.bssid || '').toLowerCase();
          if (!k) continue;
          if (!map.has(k)) map.set(k, { bssid: m.bssid, label: m.apLabelSnapshot || m.bssid });
        }
      }
      return Array.from(map.values());
    }
    function renderAnalysis() {
      const section = $('analysis-section');
      if (state.rooms.length === 0) { section.hidden = true; return; }
      section.hidden = false;
      renderAnalysisInto({
        tabsEl: formEl.querySelector('.heatmap-analysis-section .analysis-tabs'),
        panelEl: $('analysis-panel'),
        bannerEl: $('legacy-banner'),
        rooms: state.rooms,
        isLegacy: state.isLegacy,
        tabState: state, tabKey: 'analysisTab', apIdxKey: 'analysisApIdx',
      });
    }
    function renderAnalysisInto(opts) {
      const { tabsEl, panelEl, bannerEl, rooms, isLegacy, tabState, tabKey, apIdxKey } = opts;
      if (bannerEl) bannerEl.hidden = !isLegacy;
      const byApTab = tabsEl.querySelector('.analysis-tab[data-tab="by-ap"]');
      if (byApTab) byApTab.disabled = isLegacy;
      if (isLegacy && tabState[tabKey] === 'by-ap') tabState[tabKey] = 'by-room';
      tabsEl.querySelectorAll('.analysis-tab').forEach((b) => {
        b.classList.toggle('active', b.dataset.tab === tabState[tabKey]);
      });
      if (tabState[tabKey] === 'by-room') panelEl.innerHTML = renderByRoom(rooms);
      else if (tabState[tabKey] === 'by-ap') panelEl.innerHTML = renderByAp(rooms, tabState[apIdxKey] || 0);
      else panelEl.innerHTML = renderSummary(rooms);
    }
    function renderByRoom(rooms) {
      const rows = rooms.map((r) => {
        const best = bestApInRoom(r);
        const cls = classifyRssi(best.signalDbm);
        const isDead = best.signalDbm < DEAD_ZONE_THRESHOLD;
        return `
          <div class="analysis-room-row ${isDead ? 'rssi-muerta' : cls.cls}">
            <div class="analysis-room-bullet">${isDead ? '🚨' : '✅'}</div>
            <div class="analysis-room-main">
              <strong>${safeText(r.roomName)}</strong>
              <span class="analysis-room-sub">${best.signalDbm} dBm · ${cls.label}${(() => { const d = r.extras && (r.extras.estimatedDistanceMeters ?? r.extras.distanceFromRouterMeters); return d != null ? ` · ~${d.toFixed(1)} m est.` : ''; })()}</span>
            </div>
            ${isDead ? '<span class="analysis-badge bad">Zona muerta</span>' : ''}
          </div>`;
      }).join('');
      return `<div class="analysis-rooms">${rows}</div>`;
    }
    function renderByAp(rooms, apIdx) {
      const aps = uniqueApsFromRooms(rooms);
      if (aps.length === 0) return '<div class="heatmap-empty">No hay datos.</div>';
      const idx = apIdx >= aps.length ? 0 : apIdx;
      const chips = aps.map((ap, i) => `
        <button type="button" class="analysis-ap-chip ${i === idx ? 'active' : ''}" data-ap-idx="${i}">
          ${safeText(ap.label)}
        </button>`).join('');
      const ap = aps[idx];
      const apBssid = ap.bssid.toLowerCase();
      const rows = rooms.map((r) => {
        const m = r.measurements.find((x) => (x.bssid || '').toLowerCase() === apBssid);
        if (!m) {
          return `
            <div class="analysis-room-row rssi-na">
              <div class="analysis-room-bullet">⚪</div>
              <div class="analysis-room-main">
                <strong>${safeText(r.roomName)}</strong>
                <span class="analysis-room-sub">Sin medición de este equipo en esta habitación</span>
              </div>
            </div>`;
        }
        const cls = classifyRssi(m.signalDbm);
        return `
          <div class="analysis-room-row ${cls.cls}">
            <div class="analysis-room-bullet">${m.signalDbm >= DEAD_ZONE_THRESHOLD ? '✅' : '❗'}</div>
            <div class="analysis-room-main">
              <strong>${safeText(r.roomName)}</strong>
              <span class="analysis-room-sub">${m.signalDbm} dBm · ${cls.label}${m.isConnected ? ' · conectado' : ''}</span>
            </div>
          </div>`;
      }).join('');
      return `<div class="analysis-ap-chips">${chips}</div><div class="analysis-rooms">${rows}</div>`;
    }
    function renderSummary(rooms) {
      const dead = rooms.filter((r) => bestApInRoom(r).signalDbm < DEAD_ZONE_THRESHOLD);
      const overlaps = rooms.filter((r) =>
        r.measurements.filter((m) => m.signalDbm >= STRONG_SIGNAL_THRESHOLD).length >= 2);
      const parts = [];
      if (dead.length === 0 && overlaps.length === 0) {
        parts.push(`
          <div class="summary-card good">
            <span class="summary-icon">✓</span>
            <div>
              <strong>Cobertura adecuada en todas las habitaciones medidas.</strong>
              <span class="summary-detail">${rooms.length} habitaciones, sin zonas muertas ni solape problemático.</span>
            </div>
          </div>`);
      }
      if (dead.length > 0) {
        const rows = dead.map((r) => {
          const best = bestApInRoom(r);
          return `<li><strong>${safeText(r.roomName)}</strong> — ${best.signalDbm} dBm</li>`;
        }).join('');
        parts.push(`
          <div class="summary-card bad">
            <span class="summary-icon">🚨</span>
            <div>
              <strong>Zonas muertas detectadas en ${dead.length} ${dead.length === 1 ? 'habitación' : 'habitaciones'}:</strong>
              <ul class="summary-list">${rows}</ul>
              <span class="summary-detail">Sugerencia: considerá reubicar el router o sumar un extensor / nodo mesh.</span>
            </div>
          </div>`);
      }
      if (overlaps.length > 0) {
        const rows = overlaps.map((r) => {
          const strong = r.measurements.filter((m) => m.signalDbm >= STRONG_SIGNAL_THRESHOLD)
            .map((m) => `${safeText(m.apLabelSnapshot || m.bssid)} (${m.signalDbm} dBm)`).join(', ');
          return `<li><strong>${safeText(r.roomName)}</strong>: ${strong}</li>`;
        }).join('');
        parts.push(`
          <div class="summary-card warn">
            <span class="summary-icon">⚠️</span>
            <div>
              <strong>Solape fuerte entre equipos en ${overlaps.length} ${overlaps.length === 1 ? 'habitación' : 'habitaciones'}:</strong>
              <ul class="summary-list">${rows}</ul>
              <span class="summary-detail">Puede generar saltos frecuentes entre equipos (roaming).</span>
            </div>
          </div>`);
      }
      return parts.join('');
    }
    formEl.querySelector('.heatmap-analysis-section .analysis-tabs').addEventListener('click', (ev) => {
      const btn = ev.target.closest('.analysis-tab');
      if (!btn || btn.disabled) return;
      state.analysisTab = btn.dataset.tab;
      renderAnalysis();
    });
    formEl.querySelector('[data-slot="analysis-panel"]').addEventListener('click', (ev) => {
      const chip = ev.target.closest('.analysis-ap-chip');
      if (!chip) return;
      state.analysisApIdx = parseInt(chip.dataset.apIdx, 10) || 0;
      renderAnalysis();
    });

    // ---------- Mediciones anteriores ----------
    function renderPreviousList() {
      const section = $('previous-section');
      const list = $('previous-list');
      const countEl = $('previous-count');
      countEl.textContent = String(state.previousList.length);
      section.hidden = state.previousList.length === 0;
      if (state.previousList.length === 0) return;
      list.innerHTML = state.previousList.map((h) => {
        const date = new Date(h.createdAt).toLocaleString('es-EC', {
          year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
        });
        const rooms = Array.isArray(h.rooms) ? h.rooms.length : 0;
        const anyLegacy = Array.isArray(h.rooms) && h.rooms.some((r) => r.legacyFormat);
        return `
          <button type="button" class="previous-item" data-prev-id="${safeText(h.id)}">
            <div class="previous-item-main">
              <strong>${safeText(h.label || 'Sin etiqueta')}</strong>
              <span class="previous-item-meta">${date} · ${rooms} habitaciones${anyLegacy ? ' · formato anterior' : ''}</span>
            </div>
            <span class="previous-item-chev">›</span>
          </button>`;
      }).join('');
    }
    async function openPreviousHeatmap(id) {
      const detail = $('previous-detail');
      const titleEl = $('previous-detail-title');
      titleEl.textContent = 'Cargando…';
      detail.hidden = false;
      state.previousOpenId = id;
      try {
        let full = state.previousData[id];
        if (!full) {
          full = await global.WifixAPI.getWifiHeatmap(id);
          state.previousData[id] = full;
        }
        const date = new Date(full.createdAt).toLocaleString('es-EC');
        titleEl.textContent = `${full.label || 'Sin etiqueta'} · ${date}`;
        const anyLegacy = Array.isArray(full.rooms) && full.rooms.some((r) => r.legacyFormat);
        renderAnalysisInto({
          tabsEl: formEl.querySelector('.previous-tabs'),
          panelEl: $('previous-analysis-panel'),
          bannerEl: $('previous-legacy-banner'),
          rooms: full.rooms || [],
          isLegacy: anyLegacy,
          tabState: state, tabKey: 'previousAnalysisTab', apIdxKey: 'previousAnalysisApIdx',
        });
      } catch (err) {
        titleEl.textContent = 'Error: ' + (err.message || err);
      }
    }
    formEl.querySelector('[data-action="toggle-previous"]').addEventListener('click', () => {
      const body = $('previous-body');
      body.hidden = !body.hidden;
      formEl.querySelector('.heatmap-previous-section .previous-caret').textContent = body.hidden ? '▾' : '▴';
    });
    formEl.querySelector('[data-slot="previous-list"]').addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-prev-id]');
      if (!btn) return;
      openPreviousHeatmap(btn.dataset.prevId);
    });
    formEl.querySelector('[data-action="close-previous"]').addEventListener('click', () => {
      $('previous-detail').hidden = true;
      state.previousOpenId = null;
    });
    formEl.querySelector('.previous-tabs').addEventListener('click', (ev) => {
      const btn = ev.target.closest('.analysis-tab');
      if (!btn || btn.disabled || !state.previousOpenId) return;
      state.previousAnalysisTab = btn.dataset.tab;
      openPreviousHeatmap(state.previousOpenId);
    });
    formEl.querySelector('[data-slot="previous-analysis-panel"]').addEventListener('click', (ev) => {
      const chip = ev.target.closest('.analysis-ap-chip');
      if (!chip || !state.previousOpenId) return;
      state.previousAnalysisApIdx = parseInt(chip.dataset.apIdx, 10) || 0;
      openPreviousHeatmap(state.previousOpenId);
    });

    // ---------- Guardar mapa de calor ----------
    saveBtn.addEventListener('click', async () => {
      if (state.rooms.length === 0) return;
      saveBtn.disabled = true;
      const original = saveBtn.textContent;
      saveBtn.textContent = 'Guardando…';
      try {
        const payload = {
          label: formEl.querySelector('[data-field="label"]').value.trim() || undefined,
          notes: formEl.querySelector('[data-field="notes"]').value.trim() || undefined,
          rooms: state.rooms.map((r) => {
            const out = {
              roomName: r.roomName,
              floor: r.floor,
              measuredAt: r.measuredAt,
              measurements: r.measurements,
            };
            if (r.extras) out.notes = JSON.stringify(r.extras);
            return out;
          }),
        };
        await global.WifixAPI.createWifiHeatmap(state.account, payload);
        setStatus('save-status', `✓ Medición guardada (${state.rooms.length} habitaciones).`, '#3fb950');
        state.rooms = [];
        renderRoomsList();
        clearDraft(state.account);
      } catch (err) {
        setStatus('save-status', 'Error: ' + (err.message || err), '#f85149');
      } finally {
        saveBtn.textContent = original;
        saveBtn.disabled = state.rooms.length === 0;
      }
    });

    ['label', 'notes'].forEach((field) => {
      formEl.querySelector(`[data-field="${field}"]`).addEventListener('input', persistDraft);
    });

    // ---------- Sensing ----------
    // Sin GPS: la "distancia" se infiere del RSSI del AP conectado en cada
    // momento. Eso refleja naturalmente el roaming del teléfono — si se
    // conecta a un equipo distinto, todo el medidor cambia.
    async function startSensing() {
      if (state.sensing) return;
      state.sensing = true;
      await pollWifi();
      await pollScan();
      state.timer = setInterval(async () => { await pollWifi(); await pollScan(); }, 1500);
    }
    function stopSensing() {
      if (!state.sensing) return;
      state.sensing = false;
      if (state.timer) { clearInterval(state.timer); state.timer = null; }
    }

    // ---------- Boot ----------
    (async function init() {
      state.account = (global.currentAccount && global.currentAccount()) || null;
      const draft = loadDraft(state.account);
      if (draft) {
        restoreDraft(draft);
        setStatus('save-status', 'Borrador restaurado.', '#ffcf80');
      }
      if (state.account) {
        try {
          const resp = await global.WifixAPI.listWifiHeatmaps(state.account, { pageSize: '20' });
          state.previousList = Array.isArray(resp) ? resp : (resp.items || []);
          renderPreviousList();
        } catch (_) {}
      }
      paintMeter();
      renderRoomsList();
      renderDetectedList();
      saveBtn.disabled = state.rooms.length === 0;
    })();

    // Pausa cuando el form sale del viewport
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) startSensing();
        else stopSensing();
      }
    }, { threshold: 0.05 });
    io.observe(formEl);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') stopSensing();
      else if (formEl.isConnected && formEl.getBoundingClientRect().width > 0) startSensing();
    });
  }

  // --- Speedtest estilo Ookla --------------------------------------------------
  // Descubre servidores cercanos y los pinguea para que el técnico ELIJA contra
  // cuál medir (radiogroup seleccionable). Luego mide latencia con varias
  // muestras, descarga y sube con throughput en vivo contra el servidor elegido.
  // Si el servidor elegido no responde, el motor cae a Cloudflare (se avisa).
  // Si no se elige ninguno, el motor auto-selecciona el más cercano/mejor ping.
  function wireSpeedtestForm(formEl) {
    if (formEl.dataset.nativeWired === '1') return;
    formEl.dataset.nativeWired = '1';

    const panel = document.createElement('div');
    panel.className = 'speedtest-panel';
    panel.innerHTML = `
      <div class="speedtest-header">
        <span class="speedtest-label">Speedtest</span>
        <span class="speedtest-elapsed" data-slot="elapsed"></span>
      </div>

      <div class="speedtest-server-card">
        <div class="speedtest-server-row">
          <span class="speedtest-server-label">Servidor seleccionado</span>
          <span class="speedtest-server-name" data-slot="server-name">— pendiente —</span>
        </div>
        <button type="button" class="speedtest-server-toggle" data-action="toggle-servers" aria-expanded="false" aria-controls="speedtest-server-list">
          <span data-slot="server-count">0</span> servidores disponibles
          <span class="previous-caret" data-slot="servers-caret">▾</span>
        </button>
        <div class="speedtest-server-status" data-slot="discover-status" hidden></div>
        <button type="button" class="speedtest-server-refresh" data-action="discover-servers" hidden>↻ Buscar servidores</button>
        <div class="speedtest-server-list" id="speedtest-server-list" data-slot="server-list" role="radiogroup" aria-label="Servidores disponibles para el speedtest" hidden></div>
      </div>

      <div class="speedtest-gauges">
        <div class="speedtest-gauge">
          <span class="speedtest-gauge-icon">↓</span>
          <span class="speedtest-gauge-value" data-slot="dl">—</span>
          <span class="speedtest-gauge-unit">Mbps · descarga</span>
        </div>
        <div class="speedtest-gauge">
          <span class="speedtest-gauge-icon">↑</span>
          <span class="speedtest-gauge-value" data-slot="ul">—</span>
          <span class="speedtest-gauge-unit">Mbps · subida</span>
        </div>
      </div>
      <div class="speedtest-extras">
        <span data-slot="latency">Latencia —</span>
        <span data-slot="jitter">Jitter —</span>
        <span data-slot="loss">Loss —</span>
      </div>

      <div class="speedtest-progress"><div class="speedtest-progress-bar" data-slot="bar"></div></div>
      <button type="button" class="save-btn speedtest-run" data-action="run-speedtest">▶ Ejecutar speedtest</button>
      <div class="speedtest-status" data-slot="status">Tocá ejecutar para empezar — el test toma ~30 s.</div>`;
    formEl.insertBefore(panel, formEl.firstChild);

    const $ = (s) => panel.querySelector(`[data-slot="${s}"]`);
    const runBtn = panel.querySelector('[data-action="run-speedtest"]');
    const toggleBtn = panel.querySelector('[data-action="toggle-servers"]');
    const refreshBtn = panel.querySelector('[data-action="discover-servers"]');
    let testStartedAt = null;
    let elapsedTimer = null;

    // Estado del selector de servidores
    let availableServers = [];   // últimos servidores descubiertos
    let chosenServer = null;     // servidor elegido por el técnico (o el recomendado)
    let discovering = false;     // descubrimiento en curso

    function setProgress(pct, hue) {
      $('bar').style.width = `${Math.max(0, Math.min(100, pct))}%`;
      $('bar').style.background = hue || '#00e0ff';
    }
    function fmtElapsed(ms) {
      const s = Math.floor(ms / 1000);
      return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }

    // Latido del servidor elegido en la tarjeta de cabecera
    function setChosenName(label) {
      $('server-name').textContent = label || '— pendiente —';
    }

    // Marca visualmente el item elegido y sincroniza aria-checked + estado
    function markChosen(id) {
      chosenServer = availableServers.find((s) => s.id === id) || null;
      const items = $('server-list').querySelectorAll('.speedtest-server-item');
      items.forEach((it) => {
        const on = it.dataset.serverId === id;
        it.classList.toggle('selected', on);
        it.setAttribute('aria-checked', String(on));
        it.tabIndex = on ? 0 : -1; // patrón radiogroup: solo el elegido es tabbable
      });
      setChosenName(chosenServer ? chosenServer.label : null);
    }

    // Pinta la lista como radiogroup seleccionable. `recommendedId` recibe el badge.
    function renderServers(servers, recommendedId) {
      const list = $('server-list');
      $('server-count').textContent = String(servers.length);
      if (!servers.length) {
        list.innerHTML = '<div class="speedtest-server-empty">No se encontraron servidores.</div>';
        return;
      }
      list.innerHTML = servers.map((s) => {
        const ping = s.online && s.pingMs != null ? `${s.pingMs} ms` : 'sin conexión';
        const isChosen = chosenServer ? s.id === chosenServer.id : s.selected;
        const isRecommended = recommendedId != null ? s.id === recommendedId : s.selected;
        const cls = [
          'speedtest-server-item',
          isChosen ? 'selected' : '',
          s.online ? '' : 'is-offline',
        ].filter(Boolean).join(' ');
        const place = [s.city, s.country].filter(Boolean).join(', ');
        const sub = [safeText(s.sponsor || ''), safeText(place)].filter(Boolean).join(' · ');
        return `
          <div class="${cls}" role="radio" aria-checked="${isChosen}"
               tabindex="${isChosen ? 0 : -1}" data-server-id="${safeText(s.id)}"
               aria-label="${safeText(s.label)}${s.online ? '' : ', sin conexión'}">
            <div class="speedtest-server-info">
              <strong>${safeText(s.label)}</strong>
              ${sub ? `<span class="speedtest-server-sub">${sub}</span>` : ''}
              ${isRecommended ? '<span class="speedtest-server-badge">Recomendado · más cercano · mejor ping</span>' : ''}
            </div>
            <span class="speedtest-server-ping ${s.online ? '' : 'offline'}">${ping}</span>
          </div>`;
      }).join('');
    }

    // Abre/cierra la lista
    function setListOpen(open) {
      const list = $('server-list');
      list.hidden = !open;
      $('servers-caret').textContent = open ? '▴' : '▾';
      toggleBtn.setAttribute('aria-expanded', String(open));
    }

    // Descubre servidores (NO mide banda). Maneja carga / error / reintento.
    async function discoverServers({ openList = false } = {}) {
      if (discovering) return;
      discovering = true;
      refreshBtn.hidden = true;
      $('discover-status').hidden = false;
      $('discover-status').className = 'speedtest-server-status';
      $('discover-status').textContent = 'Buscando servidores…';
      if (openList) setListOpen(true);
      try {
        const { servers, selected } = await WifixNative.speedtestServers();
        availableServers = Array.isArray(servers) ? servers : [];
        const recommended = selected || availableServers.find((s) => s.selected) || availableServers[0] || null;
        // Pre-selección: el recomendado (online de menor ping / más cercano)
        chosenServer = recommended;
        renderServers(availableServers, recommended ? recommended.id : null);
        setChosenName(recommended ? recommended.label : null);
        $('discover-status').hidden = true;
        if (availableServers.length) setListOpen(openList || !$('server-list').hidden);
      } catch (err) {
        console.error('[Wifix] speedtestServers:', err);
        availableServers = [];
        chosenServer = null;
        $('discover-status').className = 'speedtest-server-status is-error';
        $('discover-status').textContent = `No se pudieron buscar servidores: ${err.message || err}`;
        refreshBtn.hidden = false;
        setChosenName(null);
      } finally {
        discovering = false;
      }
    }

    // Click sobre un item → elegirlo
    $('server-list').addEventListener('click', (ev) => {
      const item = ev.target.closest('.speedtest-server-item');
      if (!item || !item.dataset.serverId) return;
      markChosen(item.dataset.serverId);
    });

    // Navegación por teclado del radiogroup (flechas + espacio/enter)
    $('server-list').addEventListener('keydown', (ev) => {
      const items = Array.from($('server-list').querySelectorAll('.speedtest-server-item'));
      if (!items.length) return;
      const current = document.activeElement.closest('.speedtest-server-item');
      let idx = items.indexOf(current);
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowRight') {
        ev.preventDefault();
        idx = (idx + 1) % items.length;
        items[idx].focus(); markChosen(items[idx].dataset.serverId);
      } else if (ev.key === 'ArrowUp' || ev.key === 'ArrowLeft') {
        ev.preventDefault();
        idx = (idx - 1 + items.length) % items.length;
        items[idx].focus(); markChosen(items[idx].dataset.serverId);
      } else if ((ev.key === ' ' || ev.key === 'Enter') && current) {
        ev.preventDefault();
        markChosen(current.dataset.serverId);
      }
    });

    toggleBtn.addEventListener('click', () => {
      const willOpen = $('server-list').hidden;
      setListOpen(willOpen);
      // Si nunca se descubrió, dispara el descubrimiento al abrir
      if (willOpen && !availableServers.length && !discovering) discoverServers({ openList: true });
    });

    refreshBtn.addEventListener('click', () => discoverServers({ openList: true }));

    // Descubrimiento automático al cablear el form (no dispara el test pesado)
    discoverServers();

    runBtn.addEventListener('click', async () => {
      runBtn.disabled = true;
      runBtn.textContent = 'Midiendo…';
      $('status').style.color = 'rgba(180,210,255,0.7)';
      $('dl').textContent = '—';
      $('ul').textContent = '—';
      $('latency').textContent = 'Latencia —';
      $('jitter').textContent = 'Jitter —';
      $('loss').textContent = 'Loss —';
      setProgress(2);
      testStartedAt = performance.now();
      elapsedTimer = setInterval(() => {
        $('elapsed').textContent = fmtElapsed(performance.now() - testStartedAt);
      }, 250);

      try {
        // Mide contra el servidor elegido; si no hay (lista vacía / discovery
        // falló), se omite y el motor auto-elige el más cercano / mejor ping.
        const opts = {
          onProgress: (p) => {
            if (p.phase === 'discover') {
              $('status').textContent = 'Descubriendo servidores cercanos…';
              setProgress(4, '#6a5cff');
            } else if (p.phase === 'latency') {
              $('status').textContent = `Midiendo latencia (${Math.round((p.progress || 0) * 100)}%)…`;
              setProgress(8 + (p.progress || 0) * 7, '#6a5cff');
            } else if (p.phase === 'download') {
              const mbps = p.mbps != null ? p.mbps.toFixed(1) : '—';
              $('dl').textContent = mbps;
              $('status').textContent = `Descargando · ${mbps} Mbps · ${fmtElapsed(p.elapsedMs || 0)}`;
              setProgress(15 + (p.progress || 0) * 55, '#00e0ff');
            } else if (p.phase === 'upload') {
              $('status').textContent = `Subiendo · ${fmtElapsed(p.elapsedMs || 0)}`;
              if (p.mbps != null) $('ul').textContent = p.mbps.toFixed(1);
              setProgress(70 + (p.progress || 0) * 28, '#00ff9d');
            } else if (p.phase === 'done') {
              $('status').textContent = 'Listo.';
              setProgress(100, '#00ff9d');
            }
          },
        };
        if (chosenServer) opts.server = chosenServer;
        const r = await WifixNative.speedtest(opts);

        // latencyMs puede no ser finito (NaN/null al serializar) → mostrar "—"
        const latency = Number.isFinite(r.latencyMs) ? `${r.latencyMs} ms` : '—';

        // Mostrar resultado final — servidor honesto (sin "Cloudflare" hardcodeado)
        $('server-name').textContent = r.serverName || '— sin nombre —';
        // Refresca la lista con los datos del motor (pings actualizados), pero
        // conserva como elegido el servidor realmente medido.
        if (Array.isArray(r.servers) && r.servers.length) {
          availableServers = r.servers;
          if (r.selectedServer) chosenServer = r.selectedServer;
          renderServers(availableServers, chosenServer ? chosenServer.id : null);
        }
        $('dl').textContent = r.downloadMbps;
        $('ul').textContent = r.uploadMbps;
        $('latency').textContent = `Latencia ${latency}`;
        $('jitter').textContent = `Jitter ${r.jitterMs} ms`;
        $('loss').textContent = `Loss ${r.packetLossPercent}%`;

        const place = [r.city, r.country].filter(Boolean).join(', ');
        if (r.measuredVia === 'cloudflare-fallback') {
          // El servidor elegido no respondió: se cayó a Cloudflare. Avisar.
          $('status').style.color = '#d29922';
          $('status').textContent = `⚠ medido vía Cloudflare ${r.colo || ''} — el servidor no respondió · ↓ ${r.downloadMbps} / ↑ ${r.uploadMbps} Mbps · ${latency}`.trim();
        } else {
          $('status').style.color = '#3fb950';
          const via = [safeText(r.serverName), safeText(place)].filter(Boolean).join(' · ');
          $('status').textContent = `↓ ${r.downloadMbps} / ↑ ${r.uploadMbps} Mbps · ${latency} · ${via}`.trim();
        }

        setField(formEl, 'downloadMbps', r.downloadMbps);
        setField(formEl, 'uploadMbps', r.uploadMbps);
        setField(formEl, 'latencyMs', Number.isFinite(r.latencyMs) ? r.latencyMs : null);
        setField(formEl, 'jitterMs', r.jitterMs);
        setField(formEl, 'packetLossPercent', r.packetLossPercent);
        setField(formEl, 'serverName', r.serverName);
      } catch (err) {
        console.error('[Wifix] speedtest:', err);
        $('status').style.color = '#f85149';
        $('status').textContent = err.message || String(err);
        setProgress(0);
      } finally {
        if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
        runBtn.disabled = false;
        runBtn.textContent = '▶ Ejecutar speedtest';
      }
    });
  }

  // --------------------------------------------------------------------------
  // Helper compartido: toggle pantalla completa para cualquier consola en vivo
  // --------------------------------------------------------------------------
  function wireFullscreenToggle(formEl) {
    const consoleEl = formEl.querySelector('[data-slot="console"]');
    const fsBtn     = formEl.querySelector('[data-action="live-fullscreen"]');
    if (!fsBtn || !consoleEl) return;

    let closeBtn = null;

    fsBtn.addEventListener('click', () => {
      const on = consoleEl.classList.toggle('is-fullscreen');
      fsBtn.setAttribute('aria-pressed', String(on));
      fsBtn.textContent = on ? 'Cerrar' : 'Pantalla completa';
      document.body.classList.toggle('console-fullscreen-open', on);

      if (on) {
        // Inyectar botón cerrar flotante dentro de la consola
        closeBtn = document.createElement('button');
        closeBtn.className = 'live-console-close-btn';
        closeBtn.textContent = 'Cerrar';
        closeBtn.setAttribute('aria-label', 'Cerrar pantalla completa');
        closeBtn.addEventListener('click', () => fsBtn.click());
        consoleEl.insertBefore(closeBtn, consoleEl.firstChild);
        // Mantener scroll al fondo tras entrar en fullscreen
        consoleEl.scrollTop = consoleEl.scrollHeight;
      } else {
        if (closeBtn && closeBtn.parentNode === consoleEl) {
          consoleEl.removeChild(closeBtn);
        }
        closeBtn = null;
      }
    });
  }

  // --------------------------------------------------------------------------
  // Consola en vivo — Ping estilo CMD
  // --------------------------------------------------------------------------
  function wirePingLiveConsole(formEl) {
    if (formEl.dataset.liveWired === '1') return;
    formEl.dataset.liveWired = '1';

    const hostInput  = formEl.querySelector('[data-field="liveHost"]');
    const startBtn   = formEl.querySelector('[data-action="live-start"]');
    const stopBtn    = formEl.querySelector('[data-action="live-stop"]');
    const clearBtn   = formEl.querySelector('[data-action="live-clear"]');
    const output     = formEl.querySelector('[data-slot="console"]');
    const statsEl    = formEl.querySelector('[data-slot="stats"]');

    if (!startBtn || !output) return;

    let running = false;

    function appendLine(text, cls) {
      const line = document.createElement('div');
      line.className = 'console-line' + (cls ? ' ' + cls : '');
      line.textContent = text;
      output.appendChild(line);
      output.scrollTop = output.scrollHeight;
    }

    function updateStats(sent, received, times) {
      const lost     = sent - received;
      const pct      = sent > 0 ? Math.round((lost / sent) * 100) : 0;
      const min      = times.length ? Math.min(...times).toFixed(0) : '—';
      const max      = times.length ? Math.max(...times).toFixed(0) : '—';
      const avg      = times.length
        ? (times.reduce((a, b) => a + b, 0) / times.length).toFixed(0)
        : '—';
      statsEl.textContent =
        `Enviados: ${sent}  Recibidos: ${received}  Perdidos: ${lost} (${pct}%)` +
        (times.length ? `  min/prom/max: ${min}/${avg}/${max} ms` : '');
    }

    startBtn.addEventListener('click', async () => {
      const host = (hostInput ? hostInput.value.trim() : '') || '8.8.8.8';
      if (running) return;
      running = true;
      startBtn.disabled = true;
      stopBtn.disabled  = false;

      let sent = 0, received = 0;
      const times = [];

      appendLine(`Haciendo ping a ${host} con datos de 32 bytes:`, 'console-info');

      while (running) {
        sent++;
        let result;
        try {
          result = await WifixNative.pingOnce(host, { timeoutSec: 3 });
        } catch (err) {
          appendLine('Error al ejecutar ping: ' + (err.message || String(err)), 'console-error');
          running = false;
          break;
        }

        if (result.status === 'reply') {
          received++;
          const t = typeof result.timeMs === 'number' ? result.timeMs : NaN;
          if (!isNaN(t)) times.push(t);
          appendLine(
            `Respuesta desde ${result.from || host}: bytes=${result.bytes ?? 32} tiempo=${isNaN(t) ? '?' : t + 'ms'} TTL=${result.ttl ?? '?'}`,
            'console-ok'
          );
        } else if (result.status === 'timeout') {
          appendLine('Tiempo de espera agotado para esta solicitud.', 'console-warn');
        } else {
          appendLine('Host de destino inaccesible.', 'console-warn');
        }

        updateStats(sent, received, times);

        if (running) {
          await new Promise(r => setTimeout(r, 2500));
        }
      }

      // Bloque resumen
      const lost = sent - received;
      const pct  = sent > 0 ? Math.round((lost / sent) * 100) : 0;
      appendLine('', '');
      appendLine(`Estadísticas de ping para ${host}:`, 'console-info');
      appendLine(
        `    Paquetes: enviados=${sent}, recibidos=${received}, perdidos=${lost} (${pct}% perdidos)`,
        'console-info'
      );
      if (times.length) {
        const min = Math.min(...times).toFixed(0);
        const max = Math.max(...times).toFixed(0);
        const avg = (times.reduce((a, b) => a + b, 0) / times.length).toFixed(0);
        appendLine(
          `Tiempos aproximados ida y vuelta en ms: Mínimo=${min}ms, Máximo=${max}ms, Media=${avg}ms`,
          'console-info'
        );
      }

      startBtn.disabled = false;
      stopBtn.disabled  = true;
    });

    stopBtn.addEventListener('click', () => {
      running = false;
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        output.innerHTML = '';
        statsEl.textContent = '';
      });
    }

    wireFullscreenToggle(formEl);
  }

  // --------------------------------------------------------------------------
  // Consola en vivo — Traceroute estilo CMD
  // --------------------------------------------------------------------------
  function wireTracerouteLiveConsole(formEl) {
    if (formEl.dataset.liveWired === '1') return;
    formEl.dataset.liveWired = '1';

    const hostInput  = formEl.querySelector('[data-field="liveHost"]');
    const hopsInput  = formEl.querySelector('[data-field="liveMaxHops"]');
    const startBtn   = formEl.querySelector('[data-action="live-start"]');
    const stopBtn    = formEl.querySelector('[data-action="live-stop"]');
    const clearBtn   = formEl.querySelector('[data-action="live-clear"]');
    const output     = formEl.querySelector('[data-slot="console"]');

    if (!startBtn || !output) return;

    let running = false;

    function appendLine(text, cls) {
      const line = document.createElement('div');
      line.className = 'console-line' + (cls ? ' ' + cls : '');
      line.textContent = text;
      output.appendChild(line);
      output.scrollTop = output.scrollHeight;
    }

    startBtn.addEventListener('click', async () => {
      const host     = (hostInput ? hostInput.value.trim() : '') || '8.8.8.8';
      const maxHops  = Math.min(30, Math.max(20, parseInt((hopsInput ? hopsInput.value : '30'), 10) || 30));
      if (running) return;
      running = true;
      startBtn.disabled = true;
      stopBtn.disabled  = false;

      appendLine(`Traza de ruta a ${host} con máximo de ${maxHops} saltos:`, 'console-info');
      appendLine('', '');

      let reached = false;

      for (let ttl = 1; ttl <= maxHops && running; ttl++) {
        let result;
        try {
          result = await WifixNative.traceHop(host, ttl, { timeoutSec: 3 });
        } catch (err) {
          appendLine(`  ${ttl}    Error: ` + (err.message || String(err)), 'console-error');
          running = false;
          break;
        }

        if (result.status === 'timeout') {
          appendLine(`  ${String(ttl).padEnd(3)}   *    Tiempo de espera agotado.`, 'console-warn');
        } else {
          const rtt = typeof result.rttMs === 'number' ? result.rttMs.toFixed(0) + ' ms' : '? ms';
          appendLine(`  ${String(ttl).padEnd(3)}   ${rtt.padEnd(8)}   ${result.ip || '?'}`, 'console-ok');
        }

        if (result.status === 'reached') {
          reached = true;
          running = false;
          break;
        }

        if (running) {
          await new Promise(r => setTimeout(r, 400));
        }
      }

      appendLine('', '');
      appendLine(reached ? 'Traza completa.' : 'Traza detenida.', 'console-info');

      startBtn.disabled = false;
      stopBtn.disabled  = true;
    });

    stopBtn.addEventListener('click', () => {
      running = false;
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        output.innerHTML = '';
      });
    }

    wireFullscreenToggle(formEl);
  }

  // --------------------------------------------------------------------------
  // Mutation observer: cada vez que se renderiza un .tool-form, lo enganchamos.
  // --------------------------------------------------------------------------
  const FORM_HANDLERS = {
    ping: wirePingForm,
    traceroute: wireTracerouteForm,
    heatmap: wireHeatmapForm,
    speedtest: wireSpeedtestForm,
    'ping-live': wirePingLiveConsole,
    'traceroute-live': wireTracerouteLiveConsole
    // distance: removido — la medición de distancia ahora vive dentro del
    // Mapa de Calor (haversine continuo entre router anclado y GPS actual).
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
