// ===========================================================================
// asistencia.js — Cliente del técnico para Asistencia Remota (Wifix).
// Módulo independiente: no modifica nada de Herramientas/Instalaciones.
// Requiere api.js y native.js cargados antes que este archivo.
// ===========================================================================
(function (global) {
  'use strict';

  // =========================================================================
  // 1. CONFIGURACIÓN DE RED
  // =========================================================================

  /**
   * Calcula la base URL del backend de asistencia derivando el host igual
   * que hace api.js (puerto 8080, protocolo del host actual).
   * En APK (file:// o localhost) usamos la IP LAN configurada en native.js.
   */
  const ASISTENCIA_LAN_HOST = 'http://192.168.1.172:8080';
  const GATEWAY_FALLBACK    = '192.168.1.1';
  const HEARTBEAT_INTERVAL_MS = 30000;   // 30 s — el server cierra a los 60 s sin HB

  function asistenciaBaseUrl() {
    try {
      const host  = (window.location.hostname || '').toLowerCase();
      const proto = window.location.protocol;
      const inApk = proto === 'file:' || host === 'localhost' || host === '127.0.0.1' || host === '';
      if (inApk) return `${ASISTENCIA_LAN_HOST}/asistencia/v1`;
      const httpProto = proto === 'https:' ? 'https:' : 'http:';
      return `${httpProto}//${host}:8080/asistencia/v1`;
    } catch (_) {
      return `${ASISTENCIA_LAN_HOST}/asistencia/v1`;
    }
  }

  function asistenciaWsBase() {
    try {
      const host  = (window.location.hostname || '').toLowerCase();
      const proto = window.location.protocol;
      const inApk = proto === 'file:' || host === 'localhost' || host === '127.0.0.1' || host === '';
      if (inApk) {
        const wsHost = ASISTENCIA_LAN_HOST.replace(/^https?:\/\//, '');
        return `ws://${wsHost}/asistencia/v1`;
      }
      const wsProto = proto === 'https:' ? 'wss:' : 'ws:';
      return `${wsProto}//${host}:8080/asistencia/v1`;
    } catch (_) {
      return `ws://192.168.1.172:8080/asistencia/v1`;
    }
  }

  /** Token JWT guardado por WifixAPI en localStorage. */
  function getToken() {
    return localStorage.getItem('wifix_token') || '';
  }

  /** Intenta resolver el gateway LAN del cliente.
   *  En APK usa WifixNative.getWifiInfo() si está disponible.
   *  Si no, devuelve el fallback configurable. */
  async function resolveGateway() {
    try {
      if (global.WifixNative && typeof global.WifixNative.getWifiInfo === 'function') {
        const info = await global.WifixNative.getWifiInfo();
        if (info && info.gateway) return info.gateway;
      }
    } catch (_) { /* silencioso */ }
    return GATEWAY_FALLBACK;
  }

  // =========================================================================
  // 2. ESTADO INTERNO
  // =========================================================================
  const state = {
    session:       null,   // { id, status, accountNumber, ... }
    signalWs:      null,   // WebSocket de señalización
    tunnelWs:      null,   // WebSocket del túnel del broker
    heartbeatTimer: null,
    reconnectTimer: null,
    reconnectDelay: 1000,
    jitsiApi:      null,   // instancia JitsiMeetExternalAPI
    pendingStreams: {},     // { [streamId]: { method, path, headers, bodyChunks[] } }
    gateway:       GATEWAY_FALLBACK,
  };

  // =========================================================================
  // 3. HELPERS DOM
  // =========================================================================

  /** Versión de escapeHtml local para no depender de app.js. */
  function esc(s) {
    return String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  /** Foco al primer elemento focusable de la pantalla. */
  function focusFirst(el) {
    const focusable = el.querySelector(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusable) focusable.focus({ preventScroll: true });
  }

  // =========================================================================
  // 4. REFERENCIAS DOM — se resuelven una sola vez cuando el DOM está listo
  // =========================================================================
  let els = {};

  function resolveEls() {
    els = {
      screen:           document.getElementById('detailAsistencia'),
      backBtn:          document.getElementById('backFromAsistencia'),
      // Formulario inicial
      formStep:         document.getElementById('asist-form-step'),
      accountInput:     document.getElementById('asist-account-input'),
      consentCheck:     document.getElementById('asist-consent'),
      motivoInput:      document.getElementById('asist-motivo'),
      startBtn:         document.getElementById('asist-start-btn'),
      formError:        document.getElementById('asist-form-error'),
      // Panel de sesión activa
      sessionPanel:     document.getElementById('asist-session-panel'),
      sessionAccount:   document.getElementById('asist-session-account'),
      statusBadge:      document.getElementById('asist-status-badge'),
      agentPresence:    document.getElementById('asist-agent-presence'),
      timelineList:     document.getElementById('asist-timeline'),
      chatList:         document.getElementById('asist-chat-list'),
      chatInput:        document.getElementById('asist-chat-input'),
      chatSendBtn:      document.getElementById('asist-chat-send'),
      videoSection:     document.getElementById('asist-video-section'),
      videoBtn:         document.getElementById('asist-video-btn'),
      videoContainer:   document.getElementById('asist-video-container'),
      tunnelStatus:     document.getElementById('asist-tunnel-status'),
    };
  }

  // =========================================================================
  // 5. ESTADO DE LA UI
  // =========================================================================

  function showFormStep() {
    if (els.formStep)    els.formStep.hidden    = false;
    if (els.sessionPanel) els.sessionPanel.hidden = true;
  }

  function showSessionPanel(session) {
    if (els.formStep)     els.formStep.hidden     = true;
    if (els.sessionPanel) els.sessionPanel.hidden  = false;
    if (els.sessionAccount) els.sessionAccount.textContent = session.accountNumber || '—';
    updateStatusBadge(session.status);
  }

  const STATUS_LABELS = {
    REQUESTED:   'Solicitada',
    QUEUED:      'En cola',
    ASSIGNED:    'Asignada',
    ACTIVE:      'Activa',
    ON_HOLD:     'En espera',
    RESOLVED:    'Resuelta',
    UNRESOLVED:  'No resuelta',
    CANCELLED:   'Cancelada',
    EXPIRED:     'Expirada',
  };
  const STATUS_CLASS = {
    REQUESTED:   'asist-badge--queued',
    QUEUED:      'asist-badge--queued',
    ASSIGNED:    'asist-badge--assigned',
    ACTIVE:      'asist-badge--active',
    ON_HOLD:     'asist-badge--hold',
    RESOLVED:    'asist-badge--resolved',
    UNRESOLVED:  'asist-badge--fail',
    CANCELLED:   'asist-badge--fail',
    EXPIRED:     'asist-badge--fail',
  };

  function updateStatusBadge(status) {
    if (!els.statusBadge) return;
    els.statusBadge.textContent = STATUS_LABELS[status] || status || '—';
    els.statusBadge.className = 'asist-status-badge ' + (STATUS_CLASS[status] || '');
  }

  function setAgentPresence(online) {
    if (!els.agentPresence) return;
    els.agentPresence.textContent = online ? 'Agente conectado' : 'Agente desconectado';
    els.agentPresence.className = 'asist-agent-presence ' + (online ? 'online' : 'offline');
  }

  /** Agrega una entrada al timeline con aria-live. */
  function addTimeline(text, type) {
    if (!els.timelineList) return;
    const item = document.createElement('div');
    item.className = 'asist-timeline-item asist-tl--' + (type || 'info');
    item.textContent = text;
    els.timelineList.appendChild(item);
    item.scrollIntoView({ block: 'nearest' });
  }

  /** Muestra un error en el formulario sin alert(). */
  function showFormError(msg) {
    if (!els.formError) return;
    els.formError.textContent = msg;
    els.formError.hidden = false;
  }
  function clearFormError() {
    if (!els.formError) return;
    els.formError.textContent = '';
    els.formError.hidden = true;
  }

  // =========================================================================
  // 6. SEÑALIZACIÓN WebSocket
  // =========================================================================

  function openSignaling(sessionId) {
    const wsBase  = asistenciaWsBase();
    const token   = getToken();
    const url     = `${wsBase}/ws?token=${encodeURIComponent(token)}`;

    if (state.signalWs) {
      try { state.signalWs.close(1000, 'reiniciar'); } catch (_) {}
      state.signalWs = null;
    }

    console.log('[Asistencia] Conectando señalización:', url);
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      console.error('[Asistencia] Error al abrir WS:', err);
      addTimeline('No se pudo conectar al servidor de señalización.', 'error');
      return;
    }
    state.signalWs = ws;

    ws.addEventListener('open', () => {
      console.log('[Asistencia] WS señalización abierto.');
      state.reconnectDelay = 1000;
      // Registrar como técnico
      wsSend(ws, { type: 'REGISTER_TECHNICIAN', sessionId });
      // Heartbeat cada 30 s
      clearInterval(state.heartbeatTimer);
      state.heartbeatTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          wsSend(ws, { type: 'HEARTBEAT' });
        }
      }, HEARTBEAT_INTERVAL_MS);
    });

    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      handleSignalingMessage(msg);
    });

    ws.addEventListener('close', (ev) => {
      console.warn('[Asistencia] WS señalización cerrado:', ev.code, ev.reason);
      clearInterval(state.heartbeatTimer);
      // No reconectar si fue cierre limpio o la sesión terminó
      const sessionDone = state.session &&
        ['RESOLVED', 'UNRESOLVED', 'CANCELLED', 'EXPIRED'].includes(state.session.status);
      if (!ev.wasClean && !sessionDone) {
        scheduleReconnect(sessionId);
      }
    });

    ws.addEventListener('error', () => {
      console.error('[Asistencia] WS señalización error.');
    });
  }

  function scheduleReconnect(sessionId) {
    clearTimeout(state.reconnectTimer);
    const delay = Math.min(state.reconnectDelay, 30000);
    console.log(`[Asistencia] Reconectando en ${delay} ms…`);
    state.reconnectTimer = setTimeout(() => {
      state.reconnectDelay = Math.min(delay * 2, 30000);
      openSignaling(sessionId);
    }, delay);
  }

  function wsSend(ws, obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  function handleSignalingMessage(msg) {
    switch (msg.type) {

      case 'SESSION_STATE_CHANGED': {
        const s = msg.session || {};
        state.session = { ...state.session, ...s };
        updateStatusBadge(s.status);
        addTimeline(`Estado: ${STATUS_LABELS[s.status] || s.status}`, 'state');
        break;
      }

      case 'PEER_PRESENCE': {
        if (msg.role === 'AGENT') {
          setAgentPresence(!!msg.online);
          addTimeline(msg.online ? 'Agente se conectó.' : 'Agente se desconectó.', 'info');
        }
        break;
      }

      case 'CHAT_MESSAGE': {
        appendChatBubble(msg.from, msg.text, msg.at, false);
        break;
      }

      case 'ACTION_RESULT': {
        const a = msg.action || {};
        addTimeline(
          `Accion ACS — ${esc(a.action || '?')}: ${esc(a.status || '?')}`,
          a.status === 'SUCCESS' ? 'ok' : 'warn'
        );
        break;
      }

      case 'REMOTE_SESSION_READY': {
        addTimeline('Sesion remota lista. Abriendo tunel del router…', 'info');
        openBrokerTunnel(state.session && state.session.id);
        break;
      }

      case 'ERROR': {
        addTimeline(`Error del servidor: ${esc(msg.message || msg.code || 'Desconocido')}`, 'error');
        break;
      }

      default:
        console.log('[Asistencia] Mensaje WS sin manejar:', msg.type);
    }
  }

  // =========================================================================
  // 7. CHAT
  // =========================================================================

  function appendChatBubble(from, text, at, isSelf) {
    if (!els.chatList) return;
    const bubble = document.createElement('div');
    bubble.className = 'asist-bubble ' + (isSelf ? 'asist-bubble--self' : 'asist-bubble--other');
    const timestamp = at ? new Date(at).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' }) : '';
    bubble.innerHTML = `
      <span class="asist-bubble-from">${esc(isSelf ? 'Tú' : (from || 'Agente'))}</span>
      <span class="asist-bubble-text">${esc(text)}</span>
      ${timestamp ? `<span class="asist-bubble-time">${esc(timestamp)}</span>` : ''}`;
    els.chatList.appendChild(bubble);
    bubble.scrollIntoView({ block: 'nearest' });
  }

  function sendChatMessage() {
    const text = (els.chatInput && els.chatInput.value.trim()) || '';
    if (!text || !state.session) return;
    wsSend(state.signalWs, {
      type: 'CHAT_MESSAGE',
      sessionId: state.session.id,
      text,
    });
    appendChatBubble('Tú', text, new Date().toISOString(), true);
    els.chatInput.value = '';
    els.chatInput.focus();
  }

  // =========================================================================
  // 8. REST — crear sesión y video
  // =========================================================================

  async function createSession(accountNumber, reason, consent) {
    const base  = asistenciaBaseUrl();
    const token = getToken();
    const body  = { accountNumber, consent };
    if (reason) body.reason = reason;

    const res = await fetch(`${base}/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      let errMsg = `Error ${res.status}`;
      try {
        const err = await res.json();
        errMsg = err.message || err.error || errMsg;
      } catch (_) {}
      throw new Error(errMsg);
    }
    const data = await res.json();
    return data.session;
  }

  async function requestVideo(sessionId) {
    const base  = asistenciaBaseUrl();
    const token = getToken();
    const res   = await fetch(`${base}/sessions/${encodeURIComponent(sessionId)}/video`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });
    if (!res.ok) {
      let errMsg = `Error ${res.status}`;
      try { const e = await res.json(); errMsg = e.message || e.error || errMsg; } catch (_) {}
      throw new Error(errMsg);
    }
    return res.json(); // { roomName, domain, jwt }
  }

  // =========================================================================
  // 9. VIDEO (Jitsi) con fallo elegante
  // =========================================================================

  function loadJitsiScript(domain) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-jitsi-domain="${CSS.escape(domain)}"]`);
      if (existing) {
        if (!global.JitsiMeetExternalAPI) {
          existing.remove();
        } else {
          resolve();
          return;
        }
      }
      const script = document.createElement('script');
      script.src   = `https://${domain}/external_api.js`;
      script.async = true;
      script.setAttribute('data-jitsi-domain', domain);
      script.onload  = () => resolve();
      script.onerror = () => reject(new Error(`No se pudo cargar Jitsi desde ${domain}`));
      document.head.appendChild(script);
    });
  }

  async function mountJitsi(roomName, domain, jwt) {
    const container = els.videoContainer;
    if (!container) return;

    // Disponer instancia previa
    if (state.jitsiApi) {
      try { state.jitsiApi.dispose(); } catch (_) {}
      state.jitsiApi = null;
    }

    container.innerHTML = '<div class="asist-video-loading">Conectando video…</div>';

    try {
      await loadJitsiScript(domain);

      if (!global.JitsiMeetExternalAPI) {
        throw new Error('JitsiMeetExternalAPI no disponible tras cargar el script.');
      }

      const jitsiNode = document.createElement('div');
      jitsiNode.className = 'asist-jitsi-frame';
      container.innerHTML = '';
      container.appendChild(jitsiNode);

      state.jitsiApi = new global.JitsiMeetExternalAPI(domain, {
        roomName,
        jwt,
        parentNode: jitsiNode,
        configOverwrite: {
          startWithAudioMuted: false,
          startWithVideoMuted: false,
          prejoinPageEnabled:  false,
        },
        interfaceConfigOverwrite: {
          SHOW_JITSI_WATERMARK: false,
          TOOLBAR_BUTTONS: ['microphone', 'camera', 'hangup', 'chat'],
        },
      });

      state.jitsiApi.addEventListeners({
        videoConferenceLeft: () => {
          container.innerHTML = '<div class="asist-video-placeholder">Video finalizado.</div>';
          state.jitsiApi = null;
          if (els.videoBtn) {
            els.videoBtn.disabled = false;
            els.videoBtn.textContent = 'Iniciar video';
          }
        },
      });

    } catch (err) {
      console.error('[Asistencia] Error Jitsi:', err);
      container.innerHTML = `
        <div class="asist-video-error" role="alert">
          <span>Video no disponible (servidor Jitsi no alcanzable en este entorno)</span>
          <button class="add-row-btn asist-jitsi-retry" type="button">Reintentar</button>
        </div>`;
      const retryBtn = container.querySelector('.asist-jitsi-retry');
      if (retryBtn) {
        retryBtn.focus();
        retryBtn.addEventListener('click', () => {
          const sid = state.session && state.session.id;
          if (!sid) return;
          startVideo(sid);
        }, { once: true });
      }
    }
  }

  async function startVideo(sessionId) {
    if (els.videoBtn) {
      els.videoBtn.disabled = true;
      els.videoBtn.textContent = 'Conectando…';
    }
    try {
      const { roomName, domain, jwt } = await requestVideo(sessionId);
      await mountJitsi(roomName, domain, jwt);
    } catch (err) {
      console.error('[Asistencia] Error solicitando video:', err);
      if (els.videoContainer) {
        els.videoContainer.innerHTML = `
          <div class="asist-video-error" role="alert">
            <span>No se pudo iniciar video: ${esc(err.message || 'Error desconocido')}</span>
          </div>`;
      }
      if (els.videoBtn) {
        els.videoBtn.disabled = false;
        els.videoBtn.textContent = 'Iniciar video';
      }
    }
  }

  // =========================================================================
  // 10. TÚNEL DEL BROKER (panel del router)
  // =========================================================================

  function openBrokerTunnel(sessionId) {
    if (!sessionId) return;

    const wsBase = asistenciaWsBase();
    const token  = getToken();
    const url    = `${wsBase}/broker/tunnel?token=${encodeURIComponent(token)}`;

    if (state.tunnelWs) {
      try { state.tunnelWs.close(1000, 'nueva sesión'); } catch (_) {}
      state.tunnelWs = null;
    }

    let ws;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      console.error('[Asistencia] Error abriendo túnel:', err);
      setTunnelStatus('Error al abrir el túnel del broker.', 'error');
      return;
    }
    state.tunnelWs  = ws;
    state.pendingStreams = {};

    ws.addEventListener('open', () => {
      console.log('[Asistencia] Túnel abierto. Registrando…');
      wsSend(ws, { type: 'REGISTER_TUNNEL', sessionId });
      setTunnelStatus('Túnel activo — panel del router disponible.', 'ok');
    });

    ws.addEventListener('message', (ev) => {
      let frame;
      try { frame = JSON.parse(ev.data); } catch (_) { return; }
      handleTunnelFrame(ws, frame);
    });

    ws.addEventListener('close', () => {
      console.warn('[Asistencia] Túnel cerrado.');
      setTunnelStatus('Túnel cerrado.', 'warn');
    });

    ws.addEventListener('error', () => {
      console.error('[Asistencia] Error en el túnel.');
      setTunnelStatus('Error en el túnel del broker.', 'error');
    });
  }

  function setTunnelStatus(msg, level) {
    if (!els.tunnelStatus) return;
    els.tunnelStatus.textContent = msg;
    els.tunnelStatus.className   = 'asist-tunnel-status asist-tunnel--' + (level || 'info');
    els.tunnelStatus.hidden      = false;
  }

  // -------------------------------------------------------------------------
  // Manejo de tramas del broker
  // -------------------------------------------------------------------------

  function handleTunnelFrame(ws, frame) {
    switch (frame.type) {

      case 'OPEN_STREAM': {
        // Iniciamos acumulación del body del request del agente.
        state.pendingStreams[frame.streamId] = {
          method:  frame.method  || 'GET',
          path:    frame.path    || '/',
          headers: frame.headers || {},
          bodyChunks: [],
        };
        break;
      }

      case 'DATA': {
        const s = state.pendingStreams[frame.streamId];
        if (s && frame.data) {
          s.bodyChunks.push(frame.data);
        }
        break;
      }

      case 'END_STREAM': {
        const s = state.pendingStreams[frame.streamId];
        if (s) {
          delete state.pendingStreams[frame.streamId];
          executeTunnelRequest(ws, frame.streamId, s);
        }
        break;
      }

      case 'PING': {
        wsSend(ws, { type: 'PONG', at: frame.at });
        break;
      }

      case 'ERROR': {
        console.error('[Tunel] Error del broker:', frame.code, frame.message);
        break;
      }

      default:
        console.log('[Tunel] Trama desconocida:', frame.type);
    }
  }

  /**
   * Ejecuta el request HTTP al panel del router del cliente.
   * Intenta CapacitorHttp (APK nativo, sin CORS) y hace fallback a fetch.
   * Ante cualquier falla de red, responde con ERROR al broker.
   */
  async function executeTunnelRequest(ws, streamId, s) {
    const gateway = state.gateway || GATEWAY_FALLBACK;
    const targetUrl = `http://${gateway}${s.path}`;

    // Body del request: decodificar los chunks base64 y concatenar.
    let requestBody = null;
    if (s.bodyChunks.length > 0 && s.method !== 'GET' && s.method !== 'HEAD') {
      try {
        const parts = s.bodyChunks.map((chunk) => {
          const bin   = atob(chunk);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          return bytes;
        });
        const total  = parts.reduce((acc, p) => acc + p.length, 0);
        const merged = new Uint8Array(total);
        let offset   = 0;
        for (const p of parts) { merged.set(p, offset); offset += p.length; }
        requestBody = merged.buffer;
      } catch (_) {
        requestBody = null;
      }
    }

    try {
      let status, responseHeaders, responseBodyBuffer;

      // --- Rama Capacitor (APK): usa CapacitorHttp para evitar CORS/mixed-content ---
      const Http = global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.CapacitorHttp;
      if (Http) {
        const res = await Http.request({
          url:     targetUrl,
          method:  s.method,
          headers: s.headers || {},
          data:    requestBody ? Array.from(new Uint8Array(requestBody)) : undefined,
          responseType: 'arraybuffer',
        });
        status          = res.status;
        responseHeaders = res.headers || {};
        responseBodyBuffer = res.data instanceof ArrayBuffer
          ? res.data
          : (typeof res.data === 'string'
              ? new TextEncoder().encode(res.data).buffer
              : new ArrayBuffer(0));
      } else {
        // --- Rama navegador: fetch estándar (puede fallar por CORS/mixed-content) ---
        const fetchOpts = {
          method:  s.method,
          headers: s.headers || {},
          body:    requestBody || undefined,
          mode:    'no-cors',   // evita crash completo; la respuesta será opaque
        };
        const res           = await fetch(targetUrl, fetchOpts);
        status              = res.status || 200;
        responseHeaders     = {};
        res.headers.forEach((v, k) => { responseHeaders[k] = v; });
        responseBodyBuffer  = await res.arrayBuffer();
      }

      // --- Enviar RESPONSE al broker ---
      wsSend(ws, { type: 'RESPONSE', streamId, status, headers: responseHeaders });

      // --- Enviar DATA en chunks de 64 KB ---
      const CHUNK = 64 * 1024;
      const view  = new Uint8Array(responseBodyBuffer);
      for (let offset = 0; offset < view.length; offset += CHUNK) {
        const slice     = view.slice(offset, offset + CHUNK);
        const b64chunk  = btoa(String.fromCharCode(...slice));
        wsSend(ws, { type: 'DATA', streamId, data: b64chunk });
      }

      // --- Fin de stream ---
      wsSend(ws, { type: 'END_STREAM', streamId });

    } catch (err) {
      console.error('[Tunel] Error al alcanzar el router:', err);
      wsSend(ws, {
        type:      'ERROR',
        streamId,
        code:      'UNREACHABLE',
        message:   `No se pudo alcanzar el router en ${targetUrl}: ${err.message || 'Error de red'}`,
      });
    }
  }

  // =========================================================================
  // 11. LIMPIEZA AL SALIR
  // =========================================================================

  function closeConnections() {
    clearInterval(state.heartbeatTimer);
    clearTimeout(state.reconnectTimer);

    if (state.signalWs) {
      try { state.signalWs.close(1000, 'usuario salió'); } catch (_) {}
      state.signalWs = null;
    }
    if (state.tunnelWs) {
      try { state.tunnelWs.close(1000, 'usuario salió'); } catch (_) {}
      state.tunnelWs = null;
    }
    if (state.jitsiApi) {
      try { state.jitsiApi.dispose(); } catch (_) {}
      state.jitsiApi = null;
    }
    state.session       = null;
    state.pendingStreams = {};
  }

  // =========================================================================
  // 12. APERTURA DE LA PANTALLA
  // =========================================================================

  function openAsistencia() {
    resolveEls();

    // Resolver gateway en background
    resolveGateway().then((gw) => { state.gateway = gw; });

    // Resetear al estado inicial
    closeConnections();
    showFormStep();

    if (els.accountInput) els.accountInput.value = '';
    if (els.consentCheck) els.consentCheck.checked = false;
    if (els.motivoInput)  els.motivoInput.value = '';
    clearFormError();
    if (els.timelineList) els.timelineList.innerHTML = '';
    if (els.chatList)     els.chatList.innerHTML = '';
    if (els.chatInput)    els.chatInput.value = '';
    if (els.videoContainer) {
      els.videoContainer.innerHTML = '<div class="asist-video-placeholder">Video disponible cuando la sesión esté activa.</div>';
    }
    if (els.tunnelStatus) els.tunnelStatus.hidden = true;
    if (els.agentPresence) {
      els.agentPresence.textContent = 'Agente desconectado';
      els.agentPresence.className = 'asist-agent-presence offline';
    }

    const screen = els.screen;
    if (screen) {
      screen.classList.add('open');
      screen.setAttribute('aria-hidden', 'false');
      // Mover foco al primer elemento interactivo
      requestAnimationFrame(() => focusFirst(screen));
    }
  }

  // =========================================================================
  // 13. HANDLERS DE LA PANTALLA (se conectan una sola vez)
  // =========================================================================

  let _handlersConnected = false;

  function connectHandlers() {
    if (_handlersConnected) return;
    _handlersConnected = true;

    resolveEls();

    // Botón Volver — regresa a #subscreenVisitas (el sub-menú que lo abrió)
    if (els.backBtn) {
      els.backBtn.addEventListener('click', () => {
        closeConnections();
        const screen = els.screen;
        if (screen) {
          screen.classList.remove('open');
          screen.setAttribute('aria-hidden', 'true');
        }
        // Restaurar foco al sub-menú de Visitas y a la sub-card que abrió esta pantalla
        const parentMenu = document.getElementById('subscreenVisitas');
        if (parentMenu) {
          const asistCard = parentMenu.querySelector('[data-sub-visitas="asistencia"]');
          if (asistCard) asistCard.focus({ preventScroll: true });
        }
      });
    }

    // Botón "Iniciar asistencia"
    if (els.startBtn) {
      els.startBtn.addEventListener('click', async () => {
        clearFormError();
        const account = (els.accountInput && els.accountInput.value.trim()) || '';
        const consent = els.consentCheck && els.consentCheck.checked;
        const motivo  = (els.motivoInput && els.motivoInput.value.trim()) || '';

        if (!account) {
          showFormError('Ingresa el número de cuenta del cliente.');
          els.accountInput && els.accountInput.focus();
          return;
        }
        if (!consent) {
          showFormError('El cliente debe otorgar su consentimiento antes de continuar.');
          els.consentCheck && els.consentCheck.focus();
          return;
        }

        els.startBtn.disabled    = true;
        els.startBtn.textContent = 'Iniciando…';

        try {
          const session = await createSession(account, motivo || undefined, true);
          state.session = session;
          showSessionPanel(session);
          addTimeline('Sesión creada. Conectando al servidor…', 'info');
          openSignaling(session.id);
        } catch (err) {
          console.error('[Asistencia] createSession:', err);
          showFormError(err.message || 'No se pudo iniciar la sesión.');
        } finally {
          els.startBtn.disabled    = false;
          els.startBtn.textContent = 'Iniciar asistencia';
        }
      });
    }

    // Botón Enviar chat
    if (els.chatSendBtn) {
      els.chatSendBtn.addEventListener('click', sendChatMessage);
    }
    if (els.chatInput) {
      els.chatInput.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && !ev.shiftKey) {
          ev.preventDefault();
          sendChatMessage();
        }
      });
    }

    // Botón Iniciar video
    if (els.videoBtn) {
      els.videoBtn.addEventListener('click', () => {
        const sid = state.session && state.session.id;
        if (!sid) return;
        startVideo(sid);
      });
    }
  }

  // =========================================================================
  // 14. PUNTO DE ENTRADA PÚBLICO
  // =========================================================================

  /**
   * Expone openAsistencia() globalmente para que app.js lo pueda llamar
   * desde el handler de la categoría "visitas".
   */
  global.AsistenciaCliente = {
    open: openAsistencia,
    _connectHandlers: connectHandlers,
  };

  // Conectar handlers en DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', connectHandlers);
  } else {
    connectHandlers();
  }

  // Cerrar conexiones WS cuando el usuario hace logout o la sesión expira.
  // app.js cierra la pantalla visualmente; aquí limpiamos el estado de red.
  window.addEventListener('wifix:unauthorized', () => {
    closeConnections();
  });

}(window));
