/**
 * Smoke test de la capa de render nueva de la webapp, sin navegador:
 * carga api.js + app.js con un DOM mínimo y ejecuta los render del panel
 * ISP Monitor y del panel NAP contra los datos mock.
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function fakeEl() {
  const e = {
    _html: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    dataset: {},
    style: {},
    value: '',
    textContent: '',
    hidden: false,
    addEventListener() {},
    setAttribute() {},
    removeAttribute() {},
    getAttribute: () => null,
    querySelector: () => fakeEl(),
    querySelectorAll: () => [],
    appendChild() {},
    insertAdjacentHTML() {},
    focus() {},
    closest: () => fakeEl(),
    cloneNode: () => fakeEl(),
    remove() {},
    replaceChild() {},
    parentNode: null,
  };
  Object.defineProperty(e, 'innerHTML', {
    get() { return e._html; },
    set(v) { e._html = v; },
  });
  return e;
}

const documentStub = {
  getElementById: () => fakeEl(),
  querySelector: () => fakeEl(),
  querySelectorAll: () => [],
  createElement: () => fakeEl(),
  addEventListener() {},
  body: fakeEl(),
};

const windowStub = {
  addEventListener() {},
  dispatchEvent() {},
  location: { hostname: 'localhost', protocol: 'http:' },
  localStorage: {
    _d: {},
    getItem(k) { return this._d[k] ?? null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; },
  },
};

const ctx = {
  document: documentStub,
  localStorage: windowStub.localStorage,
  console,
  setTimeout,
  clearTimeout,
  fetch: async () => { throw new Error('sin red en el smoke test'); },
  CSS: { escape: (s) => String(s) },
  // Un contexto `vm` pelado no trae `URL` (el navegador y el WebView sí):
  // api.js lo usa para validar el override de la URL del backend.
  URL,
  navigator: { userAgent: 'node' },
  alert() {},
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
};
// En el navegador `window === globalThis`: replicarlo para que los IIFE que
// reciben `window` como `global` publiquen sus símbolos donde app.js los busca.
ctx.globalThis = ctx;
ctx.window = ctx;
ctx.self = ctx;
Object.assign(ctx, {
  addEventListener() {},
  dispatchEvent() {},
  location: windowStub.location,
});
vm.createContext(ctx);

const base = 'C:/Wifix App/wifix-webapp/';
for (const file of ['api.js', 'app.js']) {
  vm.runInContext(readFileSync(base + file, 'utf8'), ctx, { filename: file });
}

const fails = [];
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`);
    fails.push(name);
  }
}

/** Comprueba que un fragmento HTML tiene las etiquetas balanceadas. */
function balanced(html) {
  const voids = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'stop', 'use']);
  const stack = [];
  const re = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const [, closing, tag, , selfClose] = m;
    const name = tag.toLowerCase();
    if (voids.has(name) || selfClose) continue;
    if (closing) {
      if (stack.pop() !== name) return `cierre inesperado </${name}>`;
    } else {
      stack.push(name);
    }
  }
  return stack.length === 0 ? null : `sin cerrar: ${stack.join(', ')}`;
}

console.log('\n== Panel ISP Monitor ==');
const WifixAPI = ctx.WifixAPI;
WifixAPI.useRealApi = false;

const panelHtml = ctx.renderIspPanel('WX-123');
check('renderIspPanel devuelve HTML balanceado', balanced(panelHtml) === null, balanced(panelHtml));
check('renderIspPanel incluye el input de serial', panelHtml.includes('data-field="terminalId"'));
check('renderIspPanel guía qué código escanear', panelHtml.includes('GPON SN') && panelHtml.includes('D-SN'));

// --- Payload real: es exactamente lo que devolvió el backend contra la API de
// operadora para el ONT ZTE activo ZTEGD3F9BBE5 (Quito, red de acceso 9198),
// con las series recortadas a unas pocas muestras. Al ser GPON, el backend ya
// no consulta las cuatro series DOCSIS: llegan en `skipped`.
function realFixture() {
  const stamps = Array.from({ length: 288 }, (_, i) =>
    new Date(1787683133000 + i * 300000).toISOString());
  const docsisSkip = (scope, metric) => ({
    endpoint: `${scope}/${metric}`,
    reason: 'Métrica DOCSIS: la operadora solo la publica para HFC. Este equipo es GPON.',
  });
  return {
    id: 'ZTEGD3F9BBE5',
    terminal: {
      id: 'ZTEGD3F9BBE5',
      found: true,
      online: true,
      technology: 'GPON',
      city: 'Quito',
      networkIds: [9198],
      event: { active: false, description: null },
      drop: { detected: false, description: null },
      history: [
        { period: 'LastMonth', ids: ['ZTEGD0BB8294', 'ZTEGD3F9BBE5'], statuses: ['down', 'up'], drop: null, events: null },
        { period: 'LastHour', ids: ['ZTEGD3F9BBE5'], statuses: ['up'], drop: null, events: null },
        { period: 'LastDay', ids: ['ZTEGD3F9BBE5'], statuses: ['up'], drop: null, events: null },
        { period: 'LastWeek', ids: ['ZTEGD3F9BBE5'], statuses: ['up'], drop: null, events: null },
      ],
      // `device`, `ifIndex` e `index` son internos del monitoreo: la operadora
      // confirmó que no le sirven al técnico y el backend ya no los expone.
      fields: [],
      raw: null,
      fetchedAt: '2026-08-26T18:38:30.792Z',
    },
    status: {
      terminal: {
        id: 'ZTEGD3F9BBE5', scope: 'terminal', metric: 'status', keys: ['online'],
        // Una caída de 15 minutos (3 muestras) para que haya algo que contar.
        points: stamps.map((t, i) => ({ t, values: { online: i >= 100 && i < 103 ? 0 : 1 } })),
        recognized: true, raw: null, fetchedAt: '2026-08-26T18:38:30.792Z',
      },
      network: {
        id: 'ZTEGD3F9BBE5', scope: 'network', metric: 'status', keys: ['terminalsOnline'],
        points: stamps.map((t, i) => ({ t, values: { terminalsOnline: i >= 100 && i < 103 ? 17 : 18 } })),
        recognized: true, raw: null, fetchedAt: '2026-08-26T18:38:30.792Z',
      },
    },
    // GPON: las métricas DOCSIS ni se consultan.
    snr: { terminal: null, network: null },
    codewords: { terminal: null, network: null },
    errors: [],
    skipped: [
      docsisSkip('terminal', 'snr'), docsisSkip('network', 'snr'),
      docsisSkip('terminal', 'codewords'), docsisSkip('network', 'codewords'),
    ],
    window: { hours: 24, until: '2026-08-26T18:38:30.792Z' },
    fetchedAt: '2026-08-26T18:38:30.792Z',
  };
}

const real = realFixture();
const realHtml = ctx.renderIspDiagnostics(real);
check('payload real: HTML balanceado', balanced(realHtml) === null, balanced(realHtml));
check('payload real: equipo en línea', realHtml.includes('isp-badge ok'));
check('payload real: muestra tecnología y ciudad',
  realHtml.includes('GPON') && realHtml.includes('Quito'));
check('payload real: muestra la red de acceso, no un "nodo"',
  realHtml.includes('9198') && realHtml.includes('Puerto de OLT') && !realHtml.includes('>Nodo<'));
check('payload real: cuenta 1 caída', /isp-stat-value">1</.test(realHtml));
check('payload real: calcula el % en línea', /isp-stat-value">9[0-9](\.\d)?%</.test(realHtml),
  (realHtml.match(/isp-stat-value">[^<]*%/) || [])[0]);
check('payload real: agrupa 288 muestras en 48 celdas',
  (realHtml.match(/band-cell/g) || []).length === 48,
  String((realHtml.match(/band-cell/g) || []).length));
check('payload real: la caída sobrevive al agrupado', realHtml.includes('band-cell down'));
check('payload real: grafica los equipos en línea de la red de acceso',
  realHtml.includes('Equipos en línea · Puerto de OLT'));
check('payload real: aclara que no es un porcentaje de la red',
  realHtml.includes('no un porcentaje'));
check('payload real (fibra): no muestra NADA DOCSIS a un ONT',
  !realHtml.includes('DOCSIS') && !realHtml.includes('Señal a ruido') && !realHtml.includes('FEC'));
check('payload real: deja explícita la ventana de 24 h',
  realHtml.includes('últimas 24 h contadas desde ese instante'));
check('payload real: lista el historial del puerto',
  realHtml.includes('Último mes') && realHtml.includes('ZTEGD0BB8294'));
check('payload real: sin "undefined" ni "NaN"',
  !/>\s*(undefined|NaN)\s*</.test(realHtml) && !realHtml.includes('NaN,'),
  (realHtml.match(/NaN[^"]{0,20}/) || [])[0]);

console.log('\n== ISP Monitor por tecnología (GPON / HFC / no identificada) ==');
{
  const gpon = await WifixAPI.getTerminalDiagnostics('ZTEGD3F9BBE5', { technology: 'GPON' });
  check('mock GPON: technology/technologySource, gpon lleno y docsis null',
    gpon.technology === 'GPON' && gpon.technologySource === 'HINT' && gpon.gpon && gpon.docsis === null
    && gpon.outages && Array.isArray(gpon.outages.items) && gpon.uptime);
  const gh = ctx.renderIspDiagnostics(gpon);
  check('GPON: HTML balanceado', balanced(gh) === null, balanced(gh));
  check('GPON: sección "Señal óptica (GPON)" con Rx/Tx en dBm, rango OK y estado con texto',
    gh.includes('Señal óptica (GPON)') && gh.includes('Potencia recibida en el ONT (Rx)') && gh.includes('dBm')
    && gh.includes('Rango OK: -27 a -8 dBm') && /isp-range (ok|warn|bad)">[\s\S]*?(En rango|Al límite|Fuera de rango)/.test(gh)
    && gh.includes('Puerto PON') && gh.includes('ONU: En línea'));
  check('GPON: sin nada DOCSIS', !gh.includes('DOCSIS') && !gh.includes('dBmV') && !gh.includes('Señal a ruido'));
  check('GPON: badge Simulado (simulated / sources SIMULATED)', gh.includes('sim-badge') && gh.includes('Valor simulado'));
  check('caídas del backend: hora de Ecuador, duración y causa',
    gh.includes('Pérdida de señal óptica (LOS)') && gh.includes('>Causa<') && /Recuperado|Sigue sin conexión/.test(gh));

  const hfc = await WifixAPI.getTerminalDiagnostics('384C90A2DB11');
  const hh = ctx.renderIspDiagnostics(hfc);
  check('HFC por formato de MAC: bloque DOCSIS con potencias, SNR, FEC y canales',
    hfc.technology === 'HFC' && hfc.technologySource === 'ID_FORMAT' && hfc.gpon === null
    && hh.includes('Señal del cablemódem (DOCSIS)') && hh.includes('Potencia downstream') && hh.includes('dBmV')
    && hh.includes('SNR upstream') && hh.includes('FEC sin corregir') && hh.includes('Canales upstream')
    && hh.includes('<table class="isp-table">') && !hh.includes('Señal óptica'));
  check('HFC: sigue graficando las series SNR/FEC como antes', hh.includes('<svg class="chart-svg"') && hh.includes('Corregidos'));
  check('HFC: HTML balanceado', balanced(hh) === null, balanced(hh));

  const unk = await WifixAPI.getTerminalDiagnostics('EQUIPO-X-123');
  const uh = ctx.renderIspDiagnostics(unk);
  check('tecnología null: "No identificada" con selector HFC/GPON y sin métricas de ninguna',
    unk.technology === null && uh.includes('Tecnología no identificada') && uh.includes('data-tech="GPON"')
    && uh.includes('data-tech="HFC"') && !uh.includes('Señal óptica') && !uh.includes('Señal del cablemódem'));
  check('tecnología null: HTML balanceado', balanced(uh) === null, balanced(uh));

  check('pista de tecnología: serial de ONT → GPON; MAC → sin pista; elección manual manda',
    ctx._ispTechHint('ZTEGD3F9BBE5', '') === 'GPON' && ctx._ispTechHint('384C90A2DB11', '') === null
    && ctx._ispTechHint('384C90A2DB11', 'GPON') === 'GPON');
  let url = null;
  WifixAPI.useRealApi = true;
  const origFetch = ctx.fetch;
  ctx.fetch = async (u) => { url = String(u); return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}), text: async () => '{}' }; };
  await WifixAPI.getTerminalDiagnostics('ZTEGD3F9BBE5', { technology: 'ont' });
  ctx.fetch = origFetch;
  WifixAPI.useRealApi = false;
  check('real: /terminals/{id}/diagnostics?technology=GPON', /\/terminals\/ZTEGD3F9BBE5\/diagnostics\?technology=GPON$/.test(url || ''), url);
  check('rangos: valor bajo el mínimo es "Fuera de rango"; bajo warnBelow "Al límite"',
    ctx._ispRangeState(-28, { min: -27, max: -8, warnBelow: -25 }) === 'bad'
    && ctx._ispRangeState(-26, { min: -27, max: -8, warnBelow: -25 }) === 'warn'
    && ctx._ispRangeState(-20, { min: -27, max: -8, warnBelow: -25 }) === 'ok'
    && ctx._ispRangeState(null, { min: 0 }) === 'unknown');
}

console.log('\n== Fecha/hora común (America/Guayaquil) y caídas ==');
check('fmtDateTimeEc: "mar 29 sep 2026, 14:32:05" (UTC-5, coincide con Intl)',
  ctx.fmtDateTimeEc('2026-09-29T19:32:05Z') === 'mar 29 sep 2026, 14:32:05'
  && new Date('2026-09-29T19:32:05Z').toLocaleTimeString('es-EC', { timeZone: 'America/Guayaquil', hour12: false }) === '14:32:05',
  ctx.fmtDateTimeEc('2026-09-29T19:32:05Z'));
check('fmtDateTimeEc: cruce de medianoche en UTC cae el día anterior en Ecuador',
  ctx.fmtDateTimeEc('2026-09-30T03:10:00Z', { seconds: false }) === 'mar 29 sep 2026, 22:10');
check('fmtDateTimeEc: null → "—" y texto inválido tal cual',
  ctx.fmtDateTimeEc(null) === '—' && ctx.fmtDateTimeEc('ayer') === 'ayer');
{
  const now = Date.parse('2026-09-29T19:32:05Z');
  check('fmtRelative: segundos, minutos, horas y días',
    ctx.fmtRelative(now - 10000, now) === 'hace unos segundos'
    && ctx.fmtRelative(now - 12 * 60000, now) === 'hace 12 min'
    && ctx.fmtRelative(now - 80 * 60000, now) === 'hace 1 h 20 min'
    && ctx.fmtRelative(now - 3 * 3600000, now) === 'hace 3 h'
    && ctx.fmtRelative(now - 2 * 86400000, now) === 'hace 2 d');
  check('fmtDuration: 45 s / 15 min / 1 h 05 min / 2 d 3 h',
    ctx.fmtDuration(45000) === '45 s' && ctx.fmtDuration(900000) === '15 min'
    && ctx.fmtDuration(65 * 60000) === '1 h 05 min' && ctx.fmtDuration((51 * 60) * 60000) === '2 d 3 h');
  check('dateTimeHtml: <time datetime> + relativo',
    ctx.dateTimeHtml('2026-09-29T16:32:05Z', { now }).includes('datetime="2026-09-29T16:32:05.000Z"')
    && ctx.dateTimeHtml('2026-09-29T16:32:05Z', { now }).includes('(hace 3 h)'));
}
{
  const ev = ctx._ispOutageEvents(real.status.terminal);
  check('caídas: una, con inicio, recuperación y 15 min de duración',
    ev.length === 1 && ev[0].start === '2026-08-26T02:58:53.000Z' && ev[0].end === '2026-08-26T03:13:53.000Z'
    && ev[0].durationMs === 900000 && !ev[0].ongoing && ev[0].lastSeenOnline === '2026-08-26T02:53:53.000Z');
  check('caídas: la lista muestra hora de caída y de recuperación en hora de Ecuador',
    realHtml.includes('mar 25 ago 2026, 21:58:53') && realHtml.includes('mar 25 ago 2026, 22:13:53')
    && realHtml.includes('≈ 15 min') && realHtml.includes('Recuperado'));
  const enCurso = JSON.parse(JSON.stringify(real.status.terminal));
  enCurso.points.slice(-3).forEach((p) => { p.values.online = 0; });
  const evc = ctx._ispOutageEvents(enCurso);
  const htmlc = ctx.renderIspOutageTimeline(enCurso);
  check('caída en curso: ícono+texto "Sigue sin conexión" y duración mínima',
    evc.length === 2 && evc[1].ongoing && htmlc.includes('Sigue sin conexión') && htmlc.includes('al menos 10 min')
    && htmlc.indexOf('Caída en curso') < htmlc.indexOf('Caída del equipo'));
  const inicial = JSON.parse(JSON.stringify(real.status.terminal));
  inicial.points[0].values.online = 0;
  check('caída que ya venía de antes de la ventana se rotula',
    ctx.renderIspOutageTimeline(inicial).includes('Ya estaba caído al inicio'));
  const sin = JSON.parse(JSON.stringify(real.status.terminal));
  sin.points.forEach((p) => { p.values.online = 1; });
  check('sin caídas: mensaje explícito', ctx.renderIspOutageTimeline(sin).includes('Sin caídas'));
  check('caídas: HTML balanceado', balanced(htmlc) === null, balanced(htmlc));
}
check('eventos de red: fecha larga con <time> y estado con texto',
  (() => {
    const h = ctx.renderEventsList([{ type: 'Corte', description: 'x', status: 'PENDIENTE', occurredAt: '2026-09-29T19:32:05Z' }]);
    return h.includes('mar 29 sep 2026, 14:32:05') && h.includes('<time') && h.includes('PENDIENTE') && balanced(h) === null;
  })());

// --- `drop`: la operadora confirmó que es el único campo extra relevante de la
// ficha (informa si el monitoreo detectó una caída de red).
const conCaida = realFixture();
conCaida.terminal.drop = { detected: true, description: 'Caída detectada por el monitoreo' };
const caidaHtml = ctx.renderIspDiagnostics(conCaida);
check('drop detectado: se muestra como alerta',
  caidaHtml.includes('Caída de red detectada') && caidaHtml.includes('isp-event alert'));
check('drop sin detectar: no se muestra',
  !realHtml.includes('Caída de red detectada'));

// --- Cablemódem HFC: las series DOCSIS sí traen datos.
const diagnostics = await WifixAPI.getTerminalDiagnostics('B4042​1E15ADC'.replace(/​/g, ''));
check('mock HFC trae las 6 series con datos',
  ['status', 'snr', 'codewords'].every((m) => diagnostics[m].terminal.points.length > 0));
const hfcHtml = ctx.renderIspDiagnostics(diagnostics);
check('HFC: HTML balanceado', balanced(hfcHtml) === null, balanced(hfcHtml));
check('HFC: grafica SNR y FEC', hfcHtml.includes('Downstream') && hfcHtml.includes('Corregidos'));
check('HFC: pinta el gráfico SVG', hfcHtml.includes('<svg class="chart-svg"'));

// --- Cablemódem HFC real: SNR y codewords vienen por canal upstream.
// Payload tal como lo devolvió el backend para la MAC activa 384C90A2DB11.
function hfcChannelSeries(scope, metric) {
  const keys = metric === 'snr' ? ['snr'] : ['corrected', 'uncorrected'];
  const points = (base) => Array.from({ length: 12 }, (_, i) => ({
    t: new Date(1787772828000 + i * 300000).toISOString(),
    values: metric === 'snr'
      ? { snr: base - i * 0.1 }
      : { corrected: 0, uncorrected: 0 },
  }));
  const channels = [
    { label: 'Logical Upstream Channel 0/1.1/0', network: '2G-2 v', ifIndex: 5000018, keys, points: points(35.6) },
    { label: 'Logical Upstream Channel 0/1.0/0', network: '2G-2', ifIndex: 5000016, keys, points: points(35.1) },
  ];
  return {
    id: '384C90A2DB11', scope, metric, keys, points: channels[0].points,
    channels, recognized: true, raw: null, fetchedAt: '2026-08-26T19:40:00.000Z',
  };
}
const hfcReal = {
  id: '384C90A2DB11',
  terminal: {
    id: '384C90A2DB11', found: true, online: true, technology: 'HFC', city: 'Quito',
    networkIds: [168], event: { active: false, description: null },
    history: [{ period: 'LastMonth', ids: ['384C90A2DB11'], statuses: ['up'], drop: null, events: null }],
    fields: [{ key: 'device', path: 'device', value: 8661 }],
    raw: null, fetchedAt: '2026-08-26T19:40:00.000Z',
  },
  status: real.status,
  snr: { terminal: hfcChannelSeries('terminal', 'snr'), network: hfcChannelSeries('network', 'snr') },
  codewords: { terminal: hfcChannelSeries('terminal', 'codewords'), network: hfcChannelSeries('network', 'codewords') },
  errors: [],
  fetchedAt: '2026-08-26T19:40:00.000Z',
};
const hfcRealHtml = ctx.renderIspDiagnostics(hfcReal);
check('HFC real: HTML balanceado', balanced(hfcRealHtml) === null, balanced(hfcRealHtml));
check('HFC real: acorta el nombre del canal DOCSIS',
  hfcRealHtml.includes('Canal up 0/1.0/0') && hfcRealHtml.includes('2G-2 v'));
check('HFC real: SNR compara los 2 canales en un solo gráfico',
  (hfcRealHtml.match(/Canal up 0\/1\.\d\/0 · 2G-2/g) || []).length >= 4,
  String((hfcRealHtml.match(/Canal up/g) || []).length));
check('HFC real: FEC usa un gráfico por canal',
  hfcRealHtml.includes('Equipo del cliente · Canal up') && hfcRealHtml.includes('Corregidos'));
check('HFC real: sin "undefined" ni "NaN"',
  !/>\s*(undefined|NaN)\s*</.test(hfcRealHtml) && !hfcRealHtml.includes('NaN,'),
  (hfcRealHtml.match(/NaN[^"]{0,20}/) || [])[0]);
check('HFC real: valores todos en cero no rompen el gráfico',
  !hfcRealHtml.includes('Infinity'));

// --- Equipo caído + evento activo + fallo parcial de endpoints.
const broken = JSON.parse(JSON.stringify(real));
broken.terminal.online = false;
broken.terminal.event = { active: true, description: 'Corte de fibra troncal' };
broken.errors = [{ endpoint: 'network/snr', message: 'timeout' }];
const brokenHtml = ctx.renderIspDiagnostics(broken);
check('estado caído usa el badge de fallo', brokenHtml.includes('isp-badge fail'));
check('muestra el evento activo', brokenHtml.includes('Corte de fibra troncal'));
check('avisa de endpoints parciales', brokenHtml.includes('network/snr'));
check('HTML balanceado con evento', balanced(brokenHtml) === null, balanced(brokenHtml));

// --- Estado desconocido.
const unknown = JSON.parse(JSON.stringify(real));
unknown.terminal.online = null;
check('estado desconocido usa el badge neutro',
  ctx.renderIspDiagnostics(unknown).includes('isp-badge unknown'));

// --- Equipo que no está en ISP Monitor (204 en todo).
const notFound = { id: 'ZTEGD52E1A9B', terminal: { id: 'ZTEGD52E1A9B', found: false, online: null, technology: null, city: null, networkIds: [], event: null, history: [], fields: [], raw: null, fetchedAt: real.fetchedAt }, status: { terminal: null, network: null }, snr: { terminal: null, network: null }, codewords: { terminal: null, network: null }, errors: [], fetchedAt: real.fetchedAt };
const notFoundHtml = ctx.renderIspDiagnostics(notFound);
check('equipo sin datos: explica que puede ser el D-SN', notFoundHtml.includes('GPON SN'));
check('equipo sin datos: HTML balanceado', balanced(notFoundHtml) === null, balanced(notFoundHtml));

// --- Series vacías / formato desconocido.
const emptyData = JSON.parse(JSON.stringify(real));
emptyData.snr = { terminal: { keys: [], points: [], recognized: false, raw: { x: 1 } }, network: null };
emptyData.codewords = { terminal: null, network: null };
emptyData.status = { terminal: null, network: null };
const emptyHtml = ctx.renderIspDiagnostics(emptyData);
check('tolera series vacías sin romper', balanced(emptyHtml) === null, balanced(emptyHtml));

console.log('\n== Identificador del equipo (etiqueta ONT ZTE real) ==');
// Codigos tal como salen de la etiqueta del ZXHN G1611 de la foto.
const labelCodes = [
  'EN:0QPBQ2J00690',
  'MAC:3C-F9-F0-3C-DD-39',
  'GPON SN:ZTEGD52E1A9B',
  'D-SN:ZTE0QPBQ2J00956',
];
const picked = ctx._ispPickTerminalId(labelCodes);
check('elige el GPON SN por encima de MAC/D-SN/EN',
  picked && picked.id === 'ZTEGD52E1A9B' && picked.kind === 'GPON',
  JSON.stringify(picked));
check('sin GPON SN cae a la MAC',
  ctx._ispPickTerminalId(['EN:0QPBQ2J00690', 'MAC:3C-F9-F0-3C-DD-39']).id === '3CF9F03CDD39');
check('devuelve null si solo hay codigos que la API rechaza',
  ctx._ispPickTerminalId(['D-SN:ZTE0QPBQ2J00956', 'EN:0QPBQ2J00690']) === null);
check('acepta el serial ya limpio', ctx._ispIdLooksValid('ZTEGD52E1A9B'));
check('acepta MAC con separadores', ctx._ispIdLooksValid('3C:F9:F0:3C:DD:39'));
check('rechaza el D-SN', !ctx._ispIdLooksValid('ZTE0QPBQ2J00956'));
check('rechaza el EN', !ctx._ispIdLooksValid('0QPBQ2J00690'));

console.log('\n== Identificador leído por foto (OCR) ==');
// El OCR devuelve LÍNEAS, no valores limpios: hay que tokenizar y priorizar
// el código que viene detrás de su etiqueta impresa.
const ocrLines = [
  'ZXHN G1611',
  'EN:0QPBQ2J00690',
  'MAC:3C-F9-F0-3C-DD-39',
  'GPON SN:ZTEGD52E1A9B',
  'D-SN:ZTE0QPBQ2J00956',
];
const fromPhoto = ctx._ispPickTerminalIdFromText(ocrLines);
check('elige el GPON SN de la etiqueta fotografiada',
  fromPhoto && fromPhoto.id === 'ZTEGD52E1A9B' && fromPhoto.kind === 'GPON',
  JSON.stringify(fromPhoto));
check('marca que venía con su etiqueta', fromPhoto && fromPhoto.labeled === true);
check('no lo da por reparado si validó tal cual', fromPhoto && fromPhoto.repaired === false);

check('etiqueta sola y valor en el renglón siguiente',
  ctx._ispPickTerminalIdFromText(['GPON SN:', 'ZTEGD52E1A9B']).id === 'ZTEGD52E1A9B');
check('sin GPON SN cae a la MAC y la limpia',
  ctx._ispPickTerminalIdFromText(['MAC:3C-F9-F0-3C-DD-39']).id === '3CF9F03CDD39');
check('descarta el D-SN aunque sea lo único con forma larga',
  ctx._ispPickTerminalIdFromText(['D-SN:ZTE0QPBQ2J00956']) === null);
check('el EN no se cuela como MAC ni suelto',
  ctx._ispPickTerminalIdFromText(['EN:123456789012', 'D-SN:ZTE0QPBQ2J00956']) === null);
check('dos códigos en un mismo renglón no se pegan',
  ctx._ispPickTerminalIdFromText(['SN: HWTC90507FAA MAC: 3CF9F03CDD39']).id === 'HWTC90507FAA');
check('texto sin códigos devuelve null',
  ctx._ispPickTerminalIdFromText(['ZXHN G1611', 'HECHO EN CHINA', '100-240V']) === null);
check('entrada vacía no rompe',
  ctx._ispPickTerminalIdFromText([]) === null && ctx._ispPickTerminalIdFromText(null) === null);

// Confusiones típicas del OCR: solo se remapean letras que NO son hex válido.
check('corrige O por 0 en la cola hex y lo marca',
  ctx._ispPickTerminalIdFromText(['GPON SN:ZTEGD52E1A9O'] ).repaired === true);
check('B se respeta porque es hex válido',
  ctx._ispPickTerminalIdFromText(['GPON SN:ZTEGD52E1A9B']).id === 'ZTEGD52E1A9B');

console.log('\n== Gráficos ==');
const flat = ctx.renderLineChart([
  { label: 'Plano', points: Array.from({ length: 5 }, () => ({ t: '2026-08-26T10:00:00Z', v: 7 })) },
]);
check('serie plana no divide por cero', !flat.includes('NaN'), (flat.match(/NaN/) || [])[0]);
const withHoles = ctx.renderLineChart([
  { label: 'Con huecos', points: [{ t: '2026-08-26T10:00:00Z', v: 1 }, { t: '2026-08-26T11:00:00Z', v: undefined }, { t: '2026-08-26T12:00:00Z', v: 3 }] },
]);
check('serie con huecos no genera NaN', !withHoles.includes('NaN'), (withHoles.match(/NaN/) || [])[0]);
check('serie sin datos avisa', ctx.renderLineChart([{ label: 'x', points: [] }]).includes('Sin datos'));

console.log('\n== Panel NAP ==');
const napPanel = await ctx.loadNapPanel();
check('renderNapPanel HTML balanceado', balanced(napPanel) === null, balanced(napPanel));
check('pide coordenada antes de consultar', napPanel.includes('Captura tu ubicación'));

check('ofrece elegir el radio de búsqueda', napPanel.includes('data-action="nap-meters"'));
check('el radio no se consulta solo: hay botón explícito', napPanel.includes('data-action="nap-search"'));
check('solo dos radios: 280 m (instalación, default) y 500 m (extendido)',
  (napPanel.match(/data-action="nap-meters"/g) || []).length === 2
  && napPanel.includes('data-meters="280"') && napPanel.includes('data-meters="500"')
  && !napPanel.includes('data-meters="100"') && !napPanel.includes('data-meters="250"')
  && vm.runInContext('_napPanelState.meters', ctx) === 280
  && /data-meters="280"\s+aria-label="[^"]*"\s+aria-pressed="true"/.test(napPanel));
check('500 m rotulado como rango extendido / fuera del radio de instalación',
  napPanel.includes('rango extendido, fuera del radio de instalación'));
check('NAP a 300 m se marca fuera de radio; a 200 m no',
  ctx._napOutOfRadiusBadgeHtml({ distanceMeters: 300 }).includes('Fuera de radio de instalación')
  && ctx._napOutOfRadiusBadgeHtml({ distanceMeters: 200 }) === '');
check('mock: 280 m no trae NAPs fuera de radio; 500 m sí', await (async () => {
  const c = { latitude: -2.1685, longitude: -79.9189 };
  const a = await WifixAPI.getNearbyNaps(c, { meters: 280, maxRows: 20 });
  const b = await WifixAPI.getNearbyNaps(c, { meters: 500, maxRows: 20 });
  return a.naps.every((n) => n.distanceMeters <= 280) && b.naps.some((n) => n.distanceMeters > 280);
})());

// getNearbyNaps devuelve { naps, degraded }: el aviso de degradación viaja en
// el header X-Wifix-Degraded porque la respuesta del backend es un array.
const nearby = await WifixAPI.getNearbyNaps({ latitude: -2.1685, longitude: -79.9189 }, { meters: 280, maxRows: 5 });
check('getNearbyNaps devuelve { naps, degraded }',
  Array.isArray(nearby.naps) && 'degraded' in nearby);
check('mock de NAPs trae lat/lng y puertos libres',
  nearby.naps.every((n) => isFinite(n.latitude) && isFinite(n.longitude) && n.freePorts !== undefined));
check('mock de NAPs trae napId, red de acceso y fuente',
  nearby.naps.every((n) => Number.isFinite(n.napId) && typeof n.networkName === 'string' && n.source === 'FSM'));
check('maxRows recorta y avisa que la lista quedó truncada', await (async () => {
  const r = await WifixAPI.getNearbyNaps({ latitude: -2.1685, longitude: -79.9189 }, { meters: 500, maxRows: 5 });
  return r.naps.length === 5 && r.degraded && r.degraded.reason === 'TRUNCATED';
})());

check('la referencia de la NAP es el napId cuando existe',
  ctx._napRef(nearby.naps[0]) === String(nearby.naps[0].napId)
  && ctx._napRef({ napId: null, napCode: 'PL2KD9' }) === 'PL2KD9');

// Campo 8, paso 1: los ocupados llegan SIN estado (clientStatus null).
const ports = await WifixAPI.getNapPorts(String(nearby.naps[0].napId));
const portsHtml = ctx.renderPortsTable(ports);
check('renderPortsTable con detalle', portsHtml.includes('port-grid'));
check('los ocupados llegan sin estado consultado',
  ports.ports.filter((p) => p.occupied).every((p) => p.clientStatus === null && p.statusPending === true));
check('tercer estado visual "ocupado sin consultar"', portsHtml.includes('port-cell busy pending'));
check('la leyenda explica las cuatro categorías',
  ['Libre', 'Cancelado (reutilizable)', 'Ocupado (activo o suspendido)', 'Sin consultar']
    .every((t) => portsHtml.includes(t)));
check('ofrece consultar estados solo por acción explícita',
  portsHtml.includes('data-action="port-status"') && portsHtml.includes('Consultar estado de'));
check('renderPortsTable HTML balanceado', balanced(portsHtml) === null, balanced(portsHtml));

// ---- Color binario de la NAP (regla de Franco) ----------------------------
check('NAP 8/8 es roja', ctx._napColorClass({ totalPorts: 8, occupiedPorts: 8, freePorts: 0 }) === 'full');
check('NAP 7/8 es verde', ctx._napColorClass({ totalPorts: 8, occupiedPorts: 7, freePorts: 1 }) === 'free');
check('sin freePorts se calcula total - ocupados',
  ctx._napColorClass({ totalPorts: 8, occupiedPorts: 8 }) === 'full'
  && ctx._napColorClass({ totalPorts: 16, occupiedPorts: 3 }) === 'free');
check('sin total conocido queda neutro', ctx._napColorClass({ occupiedPorts: 2 }) === 'unknown');
const bar78 = ctx._napOccupancyBar({ totalPorts: 8, occupiedPorts: 7, freePorts: 1 });
check('texto "x/y ocupados · n libres" sin porcentaje',
  bar78.includes('7/8 ocupados · 1 libre') && !/\d+%\s*</.test(bar78));
check('mock: dentro de 100 m hay una NAP 8/8 y una 7/8',
  nearby.naps.some((n) => n.totalPorts === 8 && n.occupiedPorts === 8)
  && nearby.naps.some((n) => n.totalPorts === 8 && n.occupiedPorts === 7));
check('mock: el detalle de puertos cuadra con el listado',
  ports.totalPorts === nearby.naps[0].totalPorts && ports.occupiedPorts === nearby.naps[0].occupiedPorts);

// ---- Status por tap: la NAP llena trae algún cancelado ----------------------
const llena = nearby.naps.find((n) => n.totalPorts === 8 && n.occupiedPorts === 8);
const portsLlena = await WifixAPI.getNapPorts(String(llena.napId));
const cuentasLlena = portsLlena.ports.filter((p) => p.occupied).map((p) => p.clientAccountNumber);
const statusLlena = await WifixAPI.getAccountsStatusBatch(cuentasLlena);
check('mock: la NAP 8/8 trae al menos un cliente T', statusLlena.items.some((it) => it.statusCode === 'T'));
const fakeSlot = { querySelectorAll: () => [] };
ctx._applyPortStatuses(fakeSlot, statusLlena.items, portsLlena);
check('tras consultar, el cancelado queda como reutilizable',
  portsLlena.ports.some((p) => ctx._portState(p) === 'cancelado'));
const gridLlena = ctx.renderPortsTable(portsLlena);
check('celda cancelada: verde con marca reutilizable',
  gridLlena.includes('port-cell free reusable') && gridLlena.includes('Cancelado · reutilizable'));
check('celda activa/suspendida: roja con etiqueta del grupo',
  gridLlena.includes('port-cell busy status-activo') && gridLlena.includes('port-cell busy status-suspendido'));
check('celda con fallo de status sigue sin consultar',
  gridLlena.includes('port-cell busy pending'));
check('el color de la NAP 8/8 sigue rojo aunque tenga cancelados', ctx._napColorClass(llena) === 'full');

// ---- Resumen GPON: sugerido libre / cancelado ------------------------------
function fakeScope(naps, cache) {
  const summary = fakeEl();
  summary.querySelectorAll = () => [];
  return {
    _napData: naps, _napPortsCache: cache, _summary: summary,
    querySelector: (sel) => (sel === '[data-slot="gpon-summary"]' ? summary : null),
  };
}
const sc1 = fakeScope(nearby.naps, { [String(llena.napId)]: portsLlena });
vm.runInContext(`_napPanelState.selectedNap = '${llena.napId}'; _napPanelState.selectedPort = null;`, ctx);
await ctx._renderGponSummary(sc1);
check('NAP llena: sugiere el primer cancelado (reutilizable)',
  sc1._summary.innerHTML.includes('reutilizable, cliente cancelado'), sc1._summary.innerHTML.slice(0, 200));
check('NAP llena: ofrece elegir puertos cancelados',
  sc1._summary.innerHTML.includes('nap-port-opt reusable') && sc1._summary.innerHTML.includes('type="radio"'));
check('resumen GPON HTML balanceado', balanced(sc1._summary.innerHTML) === null, balanced(sc1._summary.innerHTML));
const siete = nearby.naps.find((n) => n.totalPorts === 8 && n.occupiedPorts === 7);
const sc2 = fakeScope(nearby.naps, {});
vm.runInContext(`_napPanelState.selectedNap = '${siete.napId}'; _napPanelState.selectedPort = null;`, ctx);
await ctx._renderGponSummary(sc2);
check('NAP 7/8: sugiere el puerto libre', /Puerto \d\d \(libre\)/.test(sc2._summary.innerHTML));
const llenaSinStatus = JSON.parse(JSON.stringify(await WifixAPI.getNapPorts(String(llena.napId))));
const sc3 = fakeScope(nearby.naps, { [String(llena.napId)]: llenaSinStatus });
vm.runInContext(`_napPanelState.selectedNap = '${llena.napId}'; _napPanelState.selectedPort = null;`, ctx);
await ctx._renderGponSummary(sc3);
check('NAP llena sin status: pide consultar, no inventa puerto',
  sc3._summary.innerHTML.includes('Consulta el estado de los clientes') && !sc3._summary.innerHTML.includes('type="radio"'));
vm.runInContext(`_napPanelState.selectedNap = null; _napPanelState.selectedPort = null;`, ctx);
check('renderPortsTable sin detalle muestra el aviso',
  ctx.renderPortsTable({ napCode: 'X', ports: [], detailAvailable: false, note: 'sin detalle' }).includes('sin detalle'));
check('camino TEC no ofrece consultar estados',
  !ctx.renderPortsTable(await WifixAPI.getNapPorts('PL2KD9')).includes('port-status-btn'));


console.log('\n== NAP del cliente (visita técnica) y mapa ==');
{
  const catPrevia = vm.runInContext('currentCategory', ctx);
  // --- Mock de GET /accounts/:n/current-nap -------------------------------
  const home = { latitude: -2.247946, longitude: -79.904161 };
  const cercanasHome = (await WifixAPI.getNearbyNaps(home, { meters: 500, maxRows: 20 })).naps;
  const found = await WifixAPI.getCurrentNap('35070291');
  check('getCurrentNap mock: 35070291 encontrada (puerto 7, equipo, status A)',
    found.found === true && found.portNumber === 7 && found.equipmentId === 'ZTEGD434832'
    && found.clientStatus && found.clientStatus.code === 'A' && found.nap && found.accountNumber === '35070291');
  const gemela = cercanasHome.find((n) => n.napId === found.nap.napId);
  check('getCurrentNap mock: la NAP coincide con mockNearbyNaps (id, código, coords y conteo)',
    !!gemela && gemela.napCode === found.nap.napCode && gemela.freePorts === found.nap.freePorts
    && Math.abs(gemela.latitude - found.nap.latitude) < 1e-9 && ctx._napColorClass(found.nap) === 'free');
  const found2 = await WifixAPI.getCurrentNap('40123456');
  check('getCurrentNap mock: 40123456 encontrada en la NAP llena (roja), Suspendido',
    found2.found === true && ctx._napColorClass(found2.nap) === 'full'
    && ctx.clientStatusGroup(found2.clientStatus.code).key === 'suspendido');
  const simulada = await WifixAPI.getCurrentNap('99999999');
  check('getCurrentNap mock: cuenta sin dato → NAP simulada (simulated, SIMULATED, CONTRACTED)',
    simulada.found === true && !!simulada.nap && simulada.simulated === true && simulada.source === 'SIMULATED'
    && simulada.assignment === 'CONTRACTED' && Number.isInteger(simulada.portNumber));
  check('getCurrentNap mock: NAP real con assignment CONTRACTED y sin marca de simulada',
    found.assignment === 'CONTRACTED' && found.simulated !== true && !ctx._napIsSimulated(found));
  const portsCliente = await WifixAPI.getNapPorts(String(found.nap.napId));
  check('mock: la grilla de la NAP del cliente trae su cuenta en el puerto 7',
    portsCliente.ports.some((p) => p.portNumber === 7 && p.occupied && p.clientAccountNumber === '35070291'));

  // --- Modo visita: una sola tarjeta + "Cambiar NAP" -----------------------
  let llamadas = 0;
  const getCurrentNapReal = WifixAPI.getCurrentNap;
  WifixAPI.getCurrentNap = async function (...args) { llamadas++; return getCurrentNapReal.apply(this, args); };

  ctx.selectModule('visitas');
  const visitaHtml = await ctx.loadNapPanel('35070291');
  const tarjetas = (visitaHtml.match(/class="nap-card /g) || []).length;
  check('visita: HTML balanceado', balanced(visitaHtml) === null, balanced(visitaHtml));
  check('visita: muestra UNA sola tarjeta "NAP del cliente"', tarjetas === 1 && visitaHtml.includes('nap-card nap-current'), `tarjetas=${tarjetas}`);
  check('visita: puerto del cliente resaltado, status y equipo',
    visitaHtml.includes('Puerto 07') && visitaHtml.includes('Activo') && visitaHtml.includes('ZTEGD434832'));
  {
    const portsReal = WifixAPI.getNapPorts;
    const pedidasV = [];
    WifixAPI.getNapPorts = async function (ref) { pedidasV.push(String(ref)); return portsReal.call(this, ref); };
    const panelV = { querySelector: () => null, querySelectorAll: () => [], addEventListener() {} };
    ctx._bootNapPanel({ querySelector: (sel) => (sel === '[data-panel="nap-gpon"]' ? panelV : null), isConnected: true });
    await new Promise((r) => setTimeout(r, 400));
    const refV = ctx._napRef(vm.runInContext('_napPanelState.currentNap.nap', ctx));
    check('visita: puertos de la NAP del cliente se piden solos al abrir (una vez) y quedan en caché',
      pedidasV.length === 1 && pedidasV[0] === refV && !!panelV._napPortsCache[refV]
      && panelV._napPortsState[refV].state === 'ok', `pedidas=${pedidasV.join(',')}`);
    check('visita: la tarjeta trae hueco de estado de puertos y aviso de reutilizables',
      visitaHtml.includes('data-slot="nap-ports-status"') && visitaHtml.includes('data-slot="nap-occ"')
      && visitaHtml.includes('data-slot="nap-reuse"'));
    WifixAPI.getNapPorts = portsReal;
  }
  check('visita: "Cómo llegar" y "Ver puertos" en la tarjeta del cliente',
    visitaHtml.includes('data-action="nap-directions"') && visitaHtml.includes('data-action="view-ports"'));
  check('visita: sin buscador por radio ni "Cambiar NAP"',
    !visitaHtml.includes('nap-toggle-nearby') && !visitaHtml.includes('Cambiar NAP')
    && !visitaHtml.includes('data-action="nap-search"') && !visitaHtml.includes('data-action="nap-meters"')
    && !visitaHtml.includes('data-slot="nap-nearby"') && !visitaHtml.includes('data-slot="nap-cards"'));
  check('visita: badge "Contratada" y sin badge "Simulado" en la NAP real',
    visitaHtml.includes('>Contratada<') && !visitaHtml.includes('sim-badge'));
  check('visita: hay contenedor de mapa', visitaHtml.includes('data-slot="nap-map"'));
  check('visita: loadNapPanel hace exactamente una llamada a current-nap', llamadas === 1, `llamadas=${llamadas}`);

  // --- Apertura real vía openDatosServicio (acordeón con DOM falso) ---------
  {
    const tick = () => new Promise((r) => setTimeout(r, 10));
    const pendientes = [];
    let llamadasOD = 0;
    WifixAPI.getCurrentNap = (cuenta) => {
      llamadasOD++;
      return new Promise((resolve) => pendientes.push({ cuenta, resolve }));
    };
    function servicioNode() {
      const abiertas = new Set();
      const head = fakeEl();
      head.addEventListener = (ev, fn) => { head._fn = fn; };
      const body = fakeEl();
      body.isConnected = true;
      const node = fakeEl();
      node.dataset = { id: 'naps' };
      node.classList = {
        toggle: (c) => (abiertas.has(c) ? abiertas.delete(c) : abiertas.add(c)),
        contains: (c) => abiertas.has(c),
        add: (c) => abiertas.add(c),
        remove: (c) => abiertas.delete(c),
      };
      node.querySelector = (sel) => (sel === '.servicio-head' ? head : sel === '[data-slot="body"]' ? body : fakeEl());
      return { node, body, click: () => head._fn() };
    }
    const servicioListEl = vm.runInContext('servicioList', ctx);
    const qsaOriginal = servicioListEl.querySelectorAll;
    const cuentaOriginal = vm.runInContext('accountInput.value', ctx);
    let actual = null;
    servicioListEl.querySelectorAll = (sel) => (sel === '.servicio-item' && actual ? [actual.node] : []);
    const abrirDatos = (cuenta) => {
      vm.runInContext(`accountInput.value = '${cuenta}'`, ctx);
      actual = servicioNode();
      ctx.openDatosServicio();
      return actual;
    };
    ctx.selectModule('visitas');

    const A = abrirDatos('35070291');
    A.click(); A.click(); A.click(); // abrir → cerrar → abrir antes de la respuesta
    check('openDatosServicio: abrir/cerrar/abrir antes de responder no duplica la carga',
      llamadasOD === 1, `llamadas=${llamadasOD}`);
    pendientes[0].resolve(await getCurrentNapReal.call(WifixAPI, '35070291'));
    await tick();
    check('openDatosServicio: al responder pinta la tarjeta del cliente',
      A.body.innerHTML.includes('nap-card nap-current') && A.body.dataset.loaded === '1');
    A.click(); A.click(); // cerrar y reabrir el panel ya cargado
    await tick();
    check('openDatosServicio: reabrir el panel cargado no vuelve a llamar', llamadasOD === 1, `llamadas=${llamadasOD}`);

    // Race: la respuesta de la cuenta anterior llega DESPUÉS de la vigente.
    const X = abrirDatos('40123456');
    X.click();
    X.body.isConnected = false; // Datos del Servicio se regenera para otra cuenta
    const Y = abrirDatos('35070291');
    Y.click();
    pendientes[2].resolve(await getCurrentNapReal.call(WifixAPI, '35070291'));
    await tick();
    pendientes[1].resolve(await getCurrentNapReal.call(WifixAPI, '40123456'));
    await tick();
    check('race: la respuesta tardía de otra cuenta se descarta (estado del panel vigente intacto)',
      vm.runInContext('_napPanelState.currentNap && _napPanelState.currentNap.accountNumber', ctx) === '35070291'
      && Y.body.innerHTML.includes('Puerto 07'));
    check('race: el panel obsoleto no se pinta ni se marca cargado',
      !X.body.innerHTML.includes('nap-card') && X.body.dataset.loaded !== '1');

    // Race directa sobre loadNapPanel: la primera apertura queda obsoleta.
    const p1 = ctx.loadNapPanel('40123456');
    const p2 = ctx.loadNapPanel('35070291');
    pendientes[4].resolve(await getCurrentNapReal.call(WifixAPI, '35070291'));
    const h2 = await p2;
    pendientes[3].resolve(await getCurrentNapReal.call(WifixAPI, '40123456'));
    const h1 = await p1;
    check('race: loadNapPanel obsoleto devuelve null y no pisa el estado',
      h1 === null && typeof h2 === 'string'
      && vm.runInContext('_napPanelState.currentNap.accountNumber', ctx) === '35070291');

    servicioListEl.querySelectorAll = qsaOriginal;
    vm.runInContext(`accountInput.value = '${cuentaOriginal || ''}'`, ctx);
    WifixAPI.getCurrentNap = async function (...args) { llamadas++; return getCurrentNapReal.apply(this, args); };
  }
  check('visita: la grilla marca el puerto del cliente',
    (() => {
      const data = JSON.parse(JSON.stringify(portsCliente));
      ctx._napMarkClientPort(String(found.nap.napId), data);
      const grid = ctx.renderPortsTable(data);
      return grid.includes('client-port') && grid.includes('puerto del cliente')
        && data.ports.filter((p) => p.isClientPort).length === 1;
    })());

  const portsOrig = WifixAPI.getNapPorts;
  let llamadasPorts = 0;
  WifixAPI.getNapPorts = async function (...a) { llamadasPorts++; return portsOrig.apply(this, a); };
  const simHtml = await ctx.loadNapPanel('99999999');
  ctx._bootNapPanel({ querySelector: () => fakeEl(), isConnected: true });
  check('visita con NAP simulada: tarjeta con badge "Simulado" y sin búsqueda',
    simHtml.includes('nap-card nap-current') && simHtml.includes('class="sim-badge"') && simHtml.includes('>Simulado<')
    && !simHtml.includes('data-action="nap-search"'));
  check('NAP simulada: sin "Ver puertos" ni grilla, y cero llamadas a /naps/{ref}/ports',
    !simHtml.includes('data-action="view-ports"') && !simHtml.includes('nap-ports-slot') && llamadasPorts === 0, `llamadas=${llamadasPorts}`);
  check('NAP simulada: usados/total, puerto, Cómo llegar y el motivo de la simulación',
    simHtml.includes('ocupados') && /Puerto \d\d/.test(simHtml) && simHtml.includes('data-action="nap-directions"')
    && simHtml.includes('NAP asignada simulada: la operadora no identificó la NAP de esta cuenta'));
  check('NAP simulada: estado "Activo (simulado)" sin duplicar el grupo',
    simHtml.includes('Activo (simulado)') && !simHtml.includes('(Activo (simulado))'));
  WifixAPI.getNapPorts = portsOrig;
  {
    const deg = await WifixAPI.getCurrentNap('99999999');
    deg.simulationReason = 'UPSTREAM_AUTH_ERROR';
    deg.degraded = { reason: 'FSM_AUTH', message: 'El acceso a FSM no está disponible: se muestra la NAP asignada del cliente de forma simulada.' };
    vm.runInContext('_napPanelState', ctx).currentNap = deg;
    const h = ctx._renderCurrentNapCard();
    check('NAP simulada por FSM caído: muestra el degraded del backend una sola vez',
      (h.match(/El acceso a FSM no está disponible/g) || []).length === 1 && !h.includes('NAP asignada simulada:'));
    deg.degraded = 'FSM_UNAVAILABLE';
    check('degraded como código suelto también se explica',
      ctx._renderCurrentNapCard().includes('FSM no está respondiendo'));
  }
  {
    const nfOrig = WifixAPI.getCurrentNap;
    WifixAPI.getCurrentNap = async () => ({ accountNumber: '1', found: false, nap: null, portNumber: null,
      equipmentId: null, clientStatus: null, searchedNaps: 3, reason: 'NOT_FOUND', brand: 'telenews' });
    const noHtml = await ctx.loadNapPanel('1');
    check('visita sin NAP (defensivo): aviso sin caer a la búsqueda de NAPs',
      noHtml.includes('No se encontró la NAP contratada del cliente') && !noHtml.includes('data-action="nap-search"')
      && !noHtml.includes('nap-current-retry'));
    WifixAPI.getCurrentNap = nfOrig;
  }

  const razones = { NO_COORDS: 'no tiene coordenadas', NOT_SUPPORTED: 'no soporta esta consulta' };
  for (const [reason, txt] of Object.entries(razones)) {
    WifixAPI.getCurrentNap = async () => ({ accountNumber: '1', found: false, nap: null, portNumber: null,
      equipmentId: null, clientStatus: null, searchedNaps: 0, reason, brand: 'telenews' });
    const h = await ctx.loadNapPanel('1');
    check(`visita ${reason}: aviso "${txt}"`, h.includes(txt));
  }
  WifixAPI.getCurrentNap = async () => { const e = new Error('No se pudo conectar'); e.code = 'NETWORK_ERROR'; throw e; };
  const errHtml = await ctx.loadNapPanel('35070291');
  check('visita con error de red: aviso + "Reintentar", sin búsqueda de NAPs',
    errHtml.includes('Sin conexión con el servidor') && errHtml.includes('data-action="nap-current-retry"')
    && !errHtml.includes('data-action="nap-search"'));
  WifixAPI.getCurrentNap = async function (...args) { llamadas++; return getCurrentNapReal.apply(this, args); };

  // --- Misma NAP en la tarjeta del cliente y en la lista: ambas grillas ------
  {
    const data = JSON.parse(JSON.stringify(portsCliente));
    const mk = (loaded) => { const e = fakeEl(); e.dataset = { portsFor: String(found.nap.napId), loaded: loaded ? '1' : '' }; return e; };
    const tocado = mk(true);
    const gemelo = mk(true);
    const sinCargar = mk(false);
    const panel = { querySelectorAll: (sel) => (sel === '.nap-ports-slot' ? [tocado, gemelo, sinCargar] : []) };
    tocado.closest = (sel) => (sel === '[data-panel="nap-gpon"]' ? panel : null);
    const cuentaCli = data.ports.find((p) => p.portNumber === 7).clientAccountNumber;
    ctx._applyPortStatuses(tocado, [{ accountNumber: cuentaCli, statusCode: 'A' }], data);
    check('estados: la otra grilla cargada de la misma NAP también se repinta',
      gemelo.innerHTML.includes('port-grid') && gemelo.innerHTML.includes('Activo') && sinCargar.innerHTML === '');
  }

  // --- Mapa caído: reintenta al volver la red --------------------------------
  {
    const sc = { isConnected: true, querySelector: () => null };
    vm.runInContext('_napMap.failed = true;', ctx);
    vm.runInContext('_napMap', ctx).scope = sc;
    ctx._napMapRetry();
    check('mapa caído: _napMapRetry limpia el fallo y reintenta', vm.runInContext('_napMap.failed', ctx) === false);
  }

  // --- Instalaciones: flujo actual (lista) + mapa, sin current-nap ----------
  llamadas = 0;
  ctx.selectModule('instalaciones');
  const instHtml = await ctx.loadNapPanel('35070291');
  check('instalación: no consulta current-nap', llamadas === 0, `llamadas=${llamadas}`);
  check('instalación: sin tarjeta del cliente ni "Cambiar NAP", con mapa y búsqueda',
    !instHtml.includes('nap-card nap-current') && !instHtml.includes('nap-toggle-nearby')
    && instHtml.includes('data-slot="nap-map"') && instHtml.includes('data-action="nap-search"'));
  WifixAPI.getCurrentNap = getCurrentNapReal;

  const slots = {
    '[data-slot="nap-cards"]': fakeEl(),
    '[data-slot="nap-map"]': fakeEl(),
    '[data-slot="nap-degraded"]': fakeEl(),
  };
  const instScope = {
    querySelector: (sel) => slots[sel] || null,
    querySelectorAll: () => [],
  };
  vm.runInContext('_napPanelState.coords = { latitude: -2.247946, longitude: -79.904161, accuracy: 5 }; _napPanelState.meters = 280; _napPanelState.maxRows = 5;', ctx);
  await ctx._napFetchAndRender(instScope);
  const listaHtml = slots['[data-slot="nap-cards"]'].innerHTML;
  const nLista = (listaHtml.match(/class="nap-card /g) || []).length;
  check('instalación: muestra la lista de NAPs cercanas (libres y llenas)',
    nLista > 1 && listaHtml.includes('nap-state-free') && listaHtml.includes('nap-state-full'), `tarjetas=${nLista}`);
  check('instalación: cada tarjeta con coordenada tiene "Cómo llegar"',
    (listaHtml.match(/data-action="nap-directions"/g) || []).length === nLista);
  check('sin Leaflet el mapa avisa y la lista sigue',
    slots['[data-slot="nap-map"]'].innerHTML.includes('Mapa no disponible sin conexión') && nLista > 1);
  check('NAP sin lat/lng: sin "Cómo llegar" ni botón de mapa',
    !ctx._napDirectionsBtnHtml({ napCode: 'X', latitude: null, longitude: null })
    && !ctx._napNameHtml({ napCode: 'X', latitude: null, longitude: -79 }, 'X').includes('button'));
  const popup = ctx._napMapPopupHtml({ napCode: 'NAP-1', latitude: -2.1, longitude: -79.9, totalPorts: 8, occupiedPorts: 7, freePorts: 1 });
  check('popup del mapa: código, "x/y ocupados · n libres" y Cómo llegar',
    popup.includes('NAP-1') && popup.includes('7/8 ocupados · 1 libre') && popup.includes('nap-directions'));
  check('constante de tiles OSM', vm.runInContext('NAP_MAP_TILE_URL', ctx) === 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');

  // --- Carga automática de puertos (lista de Instalaciones) ----------------
  {
    // La búsqueda anterior (instScope) dejó su carga de puertos en segundo plano.
    await new Promise((r) => setTimeout(r, 400));
    const portsReal = WifixAPI.getNapPorts;
    const pedidas = [];
    let enVuelo = 0;
    let maxVuelo = 0;
    WifixAPI.getNapPorts = async function (ref) {
      pedidas.push(String(ref));
      enVuelo++;
      maxVuelo = Math.max(maxVuelo, enVuelo);
      try {
        await new Promise((r) => setTimeout(r, 5));
        return await portsReal.call(this, ref);
      } finally { enVuelo--; }
    };
    const autoSlots = {
      '[data-slot="nap-cards"]': fakeEl(),
      '[data-slot="nap-map"]': fakeEl(),
      '[data-slot="nap-degraded"]': fakeEl(),
      '[data-slot="nap-ports-progress"]': fakeEl(),
    };
    const autoScope = { querySelector: (sel) => autoSlots[sel] || null, querySelectorAll: () => [] };
    vm.runInContext('_napPanelState.coords = { latitude: -2.247946, longitude: -79.904161, accuracy: 5 }; _napPanelState.meters = 280; _napPanelState.maxRows = 5;', ctx);
    await ctx._napFetchAndRender(autoScope);
    const listaAuto = vm.runInContext('_napPanelState.naps', ctx);
    const elegibles = ctx._napSortByDistance(listaAuto).filter(ctx._napPortsEligible).map((n) => ctx._napRef(n));
    // Espera a que termine la carga en segundo plano.
    for (let k = 0; k < 200 && (pedidas.length < elegibles.length || enVuelo > 0); k++) await new Promise((r) => setTimeout(r, 5));
    check('puertos automáticos: una consulta por NAP, sin tocar el botón',
      elegibles.length > 0 && pedidas.length === elegibles.length && new Set(pedidas).size === pedidas.length,
      `pedidas=${pedidas.length} elegibles=${elegibles.length}`);
    check('puertos automáticos: concurrencia limitada (≤ NAP_PORTS_AUTO_CONCURRENCY)',
      maxVuelo <= vm.runInContext('NAP_PORTS_AUTO_CONCURRENCY', ctx) && maxVuelo >= 1, `max=${maxVuelo}`);
    check('puertos automáticos: empiezan por la NAP más cercana',
      pedidas.slice(0, 2).every((r) => elegibles.slice(0, 2).includes(r)));
    check('puertos automáticos: estado ok por NAP y progreso final anunciado',
      elegibles.every((r) => (autoScope._napPortsState[r] || {}).state === 'ok')
      && /Puertos actualizados en \d+ NAP/.test(autoSlots['[data-slot="nap-ports-progress"]'].textContent));
    check('puertos automáticos: la ocupación de la tarjeta sale de la respuesta de puertos',
      listaAuto.filter(ctx._napPortsEligible).every((n) => {
        const d = autoScope._napPortsCache[ctx._napRef(n)];
        return d.detailAvailable === false || (n.occupiedPorts === d.occupiedPorts && n.totalPorts === d.totalPorts
          && n.freePorts === Math.max(0, d.totalPorts - d.occupiedPorts));
      }));
    const antes = pedidas.length;
    await ctx._napFetchAndRender(autoScope);
    await new Promise((r) => setTimeout(r, 30));
    check('puertos automáticos: repetir la búsqueda no vuelve a pedir NAPs ya consultadas (caché del panel)',
      pedidas.length === antes, `nuevas=${pedidas.length - antes}`);
    check('Ver puertos abre lo precargado (sale de la caché, sin llamada)',
      await (async () => {
        const r = elegibles[0];
        const n0 = pedidas.length;
        const d = await ctx._napPortsCached(autoScope, r);
        return d === autoScope._napPortsCache[r] && pedidas.length === n0;
      })());
    check('NAP simulada de la lista: no es elegible para /naps/{ref}/ports',
      !ctx._napPortsEligible({ napId: null, napCode: 'SIM-1', simulated: true })
      && !ctx._napPortsEligible({ napId: 5, source: 'SIMULATED' }) && !ctx._napPortsEligible({ napId: null, napCode: '' }));
    // Error por tarjeta: no tumba la lista y ofrece Reintentar.
    const errScope = { querySelector: () => null, querySelectorAll: () => [] };
    WifixAPI.getNapPorts = async () => { throw Object.assign(new Error('FSM no responde'), { code: 'UPSTREAM' }); };
    await ctx._napAutoLoadPorts(errScope, [{ napId: 901, napCode: 'E-1', totalPorts: 8, occupiedPorts: 2 }]);
    check('puertos automáticos: error por tarjeta con "Reintentar"',
      errScope._napPortsState['901'].state === 'error'
      && ctx._napPortsStatusHtml(errScope, '901').includes('data-action="nap-ports-retry"')
      && ctx._napPortsStatusHtml(errScope, '901').includes('FSM no responde'));
    WifixAPI.getNapPorts = portsReal;
  }
  vm.runInContext('_napPanelState.coords = null; _napPanelState.currentNap = null; _napPanelState.currentNapError = null; _napPanelState.naps = [];', ctx);
  ctx.selectModule(catPrevia);
}

console.log('\n== NAP contratada en Migraciones e Instalaciones intacta ==');
{
  const prev = vm.runInContext('currentCategory', ctx);
  let llamadasCN = 0;
  const cnOrig = WifixAPI.getCurrentNap;
  WifixAPI.getCurrentNap = async function (...args) { llamadasCN++; return cnOrig.apply(this, args); };
  ctx.selectModule('migraciones');
  const migHtml = await ctx.loadNapPanel('35070291');
  check('migración: consulta la NAP contratada (current-nap) una vez', llamadasCN === 1, `llamadas=${llamadasCN}`);
  check('migración: HTML balanceado', balanced(migHtml) === null, balanced(migHtml));
  check('migración: solo la NAP del cliente (código, puerto, ocupación, status, mapa, Cómo llegar)',
    (migHtml.match(/class="nap-card /g) || []).length === 1 && migHtml.includes('nap-card nap-current')
    && migHtml.includes('Puerto 07') && migHtml.includes('ocupados') && migHtml.includes('Activo')
    && migHtml.includes('data-slot="nap-map"') && migHtml.includes('data-action="nap-directions"'));
  check('migración: sin buscador de radios, sin GPS del técnico ni "Cambiar NAP"',
    !migHtml.includes('data-action="nap-search"') && !migHtml.includes('data-action="nap-meters"')
    && !migHtml.includes('data-action="nap-gps"') && !migHtml.includes('Cambiar NAP'));
  check('migración: título del panel = "NAP del cliente (contratada)"',
    ctx.servicioItemTitle(vm.runInContext('SERVICIO_ITEMS', ctx)[0]) === 'NAP del cliente (contratada)');
  check('_napUsesContractedNap: visitas y migraciones sí; instalaciones y cancelaciones no',
    ctx._napUsesContractedNap('visitas') && ctx._napUsesContractedNap('migraciones')
    && !ctx._napUsesContractedNap('instalaciones') && !ctx._napUsesContractedNap('cancelaciones'));
  llamadasCN = 0;
  ctx.selectModule('instalaciones');
  const instH = await ctx.loadNapPanel('35070291');
  check('instalación: sigue la lista 280/500 m sin current-nap, ahora con Casa cliente',
    llamadasCN === 0 && instH.includes('data-meters="280"') && instH.includes('data-meters="500"')
    && instH.includes('data-action="nap-search"') && instH.includes('data-slot="client-loc"')
    && instH.includes('data-action="client-loc-save"'));
  check('_napUsesClientLoc: instalaciones, visitas y migraciones sí; cancelaciones no',
    ctx._napUsesClientLoc('instalaciones') && ctx._napUsesClientLoc('visitas') && ctx._napUsesClientLoc('migraciones')
    && !ctx._napUsesClientLoc('cancelaciones'));
  vm.runInContext("_napPanelState.naps = [{ napId: 77, napCode: 'NAP-INST-1', latitude: -2.2476, longitude: -79.9046, totalPorts: 8, occupiedPorts: 3 }];"
    + " _napPanelState.selectedNap = '77'; _napPanelState.selectedPort = 4;", ctx);
  const refInst = ctx._clientLocRefNap();
  check('instalación: la NAP de referencia de Casa cliente es la elegida para GPON (y su puerto)',
    refInst.nap && refInst.nap.napCode === 'NAP-INST-1' && refInst.port === 4);
  vm.runInContext("_napPanelState.selectedNap = null; _napPanelState.selectedPort = null; _napPanelState.naps = [];", ctx);
  check('instalación sin NAP elegida: no inventa NAP de referencia',
    ctx._clientLocRefNap().nap === null && ctx._clientLocRefNap().port === null);
  check('instalación: título del panel sin cambios',
    ctx.servicioItemTitle(vm.runInContext('SERVICIO_ITEMS', ctx)[0]) === 'NAPs cercanas y seleccion GPON Xtreme');
  check('styles.css sin la regla muerta de "Cambiar NAP"',
    !readFileSync(base + 'styles.css', 'utf8').includes('nap-toggle-nearby'));
  check('app.js sin referencias muertas de "Cambiar NAP"',
    !/nap-toggle-nearby|showNearby|_napDistanceFromTech|_napRenderCurrent\b/.test(readFileSync(base + 'app.js', 'utf8')));
  WifixAPI.getCurrentNap = cnOrig;
  ctx.selectModule(prev);
}

console.log('\n== Ubicación "Casa cliente" (Visita técnica / Migración) ==');
{
  const prev = vm.runInContext('currentCategory', ctx);
  const cache = vm.runInContext('_pendingVisitCache', ctx);
  cache.clear();

  // --- Contrato del cuerpo del POST --------------------------------------
  const gpsDraft = { latitude: -2.2478, longitude: -79.9043, accuracyMeters: 7.84, source: 'GPS', capturedAt: '2026-09-30T15:00:00.000Z' };
  const p1 = ctx.buildClientLocationPayload(gpsDraft, { napCode: 'NAP-1', napPort: 7, taskId: 'ORDER/1/2026', notes: '  portón verde ' });
  check('payload GPS: campos del contrato',
    p1.latitude === -2.2478 && p1.longitude === -79.9043 && p1.accuracyMeters === 7.8 && p1.label === 'CASA_CLIENTE'
    && p1.source === 'GPS' && p1.napCode === 'NAP-1' && p1.napPort === 7 && p1.taskId === 'ORDER/1/2026'
    && p1.capturedAt === '2026-09-30T15:00:00.000Z' && p1.notes === 'portón verde', JSON.stringify(p1));
  check('payload: sin clientId/contractId ni accountNumber en el cuerpo',
    !('clientId' in p1) && !('contractId' in p1) && !('accountNumber' in p1));
  const p2 = ctx.buildClientLocationPayload({ latitude: -2.1, longitude: -79.8, accuracyMeters: 12, source: 'MANUAL' }, { napCode: null, napPort: null, taskId: null, notes: '' });
  check('payload manual: SIN accuracyMeters (el backend no acepta null), sin taskId/napCode/napPort/notes',
    p2.source === 'MANUAL' && !('accuracyMeters' in p2) && !('taskId' in p2) && !('napCode' in p2)
    && !('napPort' in p2) && !('notes' in p2) && typeof p2.capturedAt === 'string');
  const pFut = ctx.buildClientLocationPayload(Object.assign({}, gpsDraft, { capturedAt: new Date(Date.now() + 3600000).toISOString() }), {});
  check('payload: capturedAt futuro se corrige a "ahora" (el backend da 400)',
    new Date(pFut.capturedAt).getTime() <= Date.now());
  const pSinAcc = ctx.buildClientLocationPayload(Object.assign({}, gpsDraft, { accuracyMeters: null }), {});
  check('payload GPS sin precisión: se omite accuracyMeters', !('accuracyMeters' in pSinAcc));
  let rechazoNull = false;
  try { await WifixAPI.createClientLocation('35070291', Object.assign({}, p2, { accuracyMeters: null })); } catch (e) { rechazoNull = e.code === 'VALIDATION_ERROR'; }
  let rechazoCero = false;
  try { await WifixAPI.createClientLocation('35070291', Object.assign({}, p2, { latitude: 0, longitude: 0 })); } catch (e) { rechazoCero = e.code === 'VALIDATION_ERROR'; }
  check('mock POST con las reglas del backend: accuracyMeters null y (0,0) → 400', rechazoNull && rechazoCero);

  // --- Mock GET/POST ------------------------------------------------------
  const vacio = await WifixAPI.getClientLocation('35070291');
  check('mock GET client-location: { latest: null, items: [], registeredLocation }',
    vacio.latest === null && Array.isArray(vacio.items) && vacio.items.length === 0
    && vacio.registeredLocation && vacio.registeredLocation.latitude === -2.247946);

  // --- Render de la sección dentro de la tarjeta ---------------------------
  ctx.selectModule('visitas');
  const html0 = await ctx.loadNapPanel('35070291');
  check('tarjeta NAP del cliente: sección Casa cliente con título, botón GPS, manual, notas y Guardar deshabilitado',
    html0.includes('Ubicación · Casa cliente') && html0.includes('Capturar ubicación · Casa cliente')
    && html0.includes('data-action="client-loc-manual"') && html0.includes('aria-controls="clientLocManual"')
    && html0.includes('for="clientLocNotes"') && /data-action="client-loc-save"\s+disabled/.test(html0));
  check('sin captura guardada: estado vacío claro',
    html0.includes('Aún no hay ubicación de la casa del cliente guardada.'));
  check('la sección va DENTRO de la tarjeta de la NAP del cliente',
    html0.indexOf('data-slot="client-loc"') > html0.indexOf('nap-card nap-current'));
  check('sección HTML balanceada', balanced(html0) === null, balanced(html0));

  // Scope falso con los slots de la sección (los que el código consulta).
  function clientLocScope() {
    const slots = {};
    const attrsOf = (el) => {
      const a = {};
      el.setAttribute = (k, v) => { a[k] = String(v); };
      el.removeAttribute = (k) => { delete a[k]; };
      el.getAttribute = (k) => (k in a ? a[k] : null);
      return el;
    };
    ['[data-slot="client-loc-saved"]', '[data-slot="client-loc-draft"]', '[data-action="client-loc-save"]',
      '[data-action="client-loc-gps"]', '[data-slot="client-loc-status"]', '[data-field="client-loc-notes"]',
      '[data-slot="client-loc-manual"]', '[data-action="client-loc-manual"]', '[data-field="client-loc-lat"]',
      '[data-field="client-loc-lng"]', '[data-slot="client-loc-manual-error"]'].forEach((k) => { slots[k] = attrsOf(fakeEl()); });
    slots['[data-slot="client-loc-manual"]'].hidden = true;
    return { slots, querySelector: (sel) => slots[sel] || null, querySelectorAll: () => [] };
  }

  // GPS falla → error accesible y se abre el ingreso manual.
  ctx.WifixNative = { getCurrentPosition: async () => { throw new Error('Permiso de ubicación denegado'); } };
  const origErr = console.error;
  console.error = () => {};
  let sc = clientLocScope();
  await ctx._clientLocCaptureGps(sc, sc.slots['[data-action="client-loc-gps"]']);
  const stErr = sc.slots['[data-slot="client-loc-status"]'];
  check('GPS con error: mensaje con role="alert" y se ofrece el ingreso manual',
    stErr.textContent.includes('Permiso de ubicación denegado') && stErr.getAttribute('role') === 'alert'
    && sc.slots['[data-slot="client-loc-manual"]'].hidden === false
    && sc.slots['[data-action="client-loc-manual"]'].getAttribute('aria-expanded') === 'true');
  check('GPS con error: el botón vuelve a estar disponible',
    sc.slots['[data-action="client-loc-gps"]'].disabled === false
    && sc.slots['[data-action="client-loc-gps"]'].getAttribute('aria-busy') === null);

  // Manual inválido → aria-invalid + mensaje; válido → draft MANUAL.
  sc.slots['[data-field="client-loc-lat"]'].value = '123';
  sc.slots['[data-field="client-loc-lng"]'].value = '-79.9';
  sc.slots['[data-field="client-loc-lat"]'].value = '0';
  sc.slots['[data-field="client-loc-lng"]'].value = '0';
  check('manual (0,0): se rechaza en la app (el backend da 400)', ctx._clientLocUseManual(sc) === null
    && sc.slots['[data-slot="client-loc-manual-error"]'].textContent !== '');
  sc.slots['[data-field="client-loc-lat"]'].value = '123';
  sc.slots['[data-field="client-loc-lng"]'].value = '-79.9';
  check('manual inválido: no crea captura y marca aria-invalid',
    ctx._clientLocUseManual(sc) === null && sc.slots['[data-field="client-loc-lat"]'].getAttribute('aria-invalid') === 'true'
    && sc.slots['[data-slot="client-loc-manual-error"]'].textContent.includes('válidas'));
  sc.slots['[data-field="client-loc-lat"]'].value = '-2,2479';
  sc.slots['[data-field="client-loc-lng"]'].value = '-79.9042';
  const dm = ctx._clientLocUseManual(sc);
  check('manual válido (acepta coma decimal): captura MANUAL sin precisión',
    dm && dm.source === 'MANUAL' && dm.latitude === -2.2479 && dm.accuracyMeters === null
    && sc.slots['[data-slot="client-loc-draft"]'].innerHTML.includes('Ingresada manualmente'));

  // GPS ok → draft con precisión, distancia a la NAP y a la registrada.
  ctx.WifixNative = { getCurrentPosition: async () => ({ latitude: -2.247811, longitude: -79.904402, accuracy: 42.4 }) };
  sc = clientLocScope();
  await ctx._clientLocCaptureGps(sc, sc.slots['[data-action="client-loc-gps"]']);
  const draftHtml = sc.slots['[data-slot="client-loc-draft"]'].innerHTML;
  check('GPS ok: captura sin guardar con coords, precisión y aviso de precisión baja (texto)',
    draftHtml.includes('Nueva captura (sin guardar)') && draftHtml.includes('-2.247811, -79.904402')
    && draftHtml.includes('±42 m') && draftHtml.includes('precisión baja'));
  check('GPS ok: distancia a la NAP y a la ubicación registrada (calculadas en la app)',
    /data-field="client-loc-dist-nap">\d+(\.\d)? m de la NAP /.test(draftHtml)
    && /A \d+(\.\d)? m de la ubicación registrada del cliente/.test(draftHtml), draftHtml);
  check('GPS ok: Guardar se habilita', sc.slots['[data-action="client-loc-save"]'].disabled === false);
  const pts = ctx._napMapClientPoints();
  check('mapa: marcador Casa cliente (sin guardar) + ubicación registrada',
    pts.casa && pts.casa.unsaved === true && pts.registered && pts.registered.latitude === -2.247946);

  // Guardar → POST con el taskId de la visita pendiente y respuesta 201.
  let enviado = null;
  const createOrig = WifixAPI.createClientLocation;
  WifixAPI.createClientLocation = async function (cuenta, body) { enviado = { cuenta, body }; return createOrig.call(this, cuenta, body); };
  sc.slots['[data-field="client-loc-notes"]'].value = 'Casa esquinera';
  const saved = await ctx._clientLocSave(sc, sc.slots['[data-action="client-loc-save"]']);
  check('guardar: POST con cuenta, taskId de la visita pendiente, NAP y puerto del cliente',
    enviado && enviado.cuenta === '35070291' && enviado.body.taskId === 'ORDER/424900/2026'
    && enviado.body.napPort === 7 && typeof enviado.body.napCode === 'string' && enviado.body.source === 'GPS'
    && enviado.body.accuracyMeters === 42.4 && enviado.body.notes === 'Casa esquinera', JSON.stringify(enviado && enviado.body));
  const savedHtml = sc.slots['[data-slot="client-loc-saved"]'].innerHTML;
  check('guardar: muestra "Casa cliente guardada el <fecha> por <email>" con el formateador común',
    saved && savedHtml.includes('Casa cliente guardada el <time class="dt-abs"') && savedHtml.includes('franco@tulpasolutions.com')
    && savedHtml.includes('-2.247811, -79.904402'), savedHtml.slice(0, 300));
  check('guardar: distancias del backend a la NAP y a la registrada',
    savedHtml.includes(`${Math.round(saved.distanceToNapMeters)} m de la NAP`) && savedHtml.includes('de la ubicación registrada del cliente'));
  check('guardar: limpia la captura, deshabilita Guardar y avisa (status)',
    sc.slots['[data-slot="client-loc-draft"]'].innerHTML === '' && sc.slots['[data-action="client-loc-save"]'].disabled === true
    && sc.slots['[data-slot="client-loc-status"]'].textContent.includes('guardada')
    && sc.slots['[data-slot="client-loc-status"]'].getAttribute('role') === 'status'
    && sc.slots['[data-field="client-loc-notes"]'].value === '');
  check('guardar: el botón GPS pasa a "Recapturar"',
    sc.slots['[data-action="client-loc-gps"]'].textContent === 'Recapturar ubicación · Casa cliente');
  check('mapa: tras guardar, marcador Casa cliente (capturada)',
    ctx._napMapClientPoints().casa && ctx._napMapClientPoints().casa.unsaved === false);

  // Recaptura append-only: segunda captura = segundo registro.
  ctx.WifixNative = { getCurrentPosition: async () => ({ latitude: -2.24779, longitude: -79.90441, accuracy: 5 }) };
  await ctx._clientLocCaptureGps(sc, sc.slots['[data-action="client-loc-gps"]']);
  await ctx._clientLocSave(sc, sc.slots['[data-action="client-loc-save"]']);
  const lista = await WifixAPI.getClientLocation('35070291');
  check('recapturar es append-only: 2 registros, el último primero y el anterior intacto',
    lista.items.length === 2 && lista.latest.id === lista.items[0].id && lista.items[1].id === saved.id
    && lista.items[1].latitude === -2.247811);
  WifixAPI.createClientLocation = createOrig;

  // Reabrir el panel: carga la última captura guardada (GET).
  const html2 = await ctx.loadNapPanel('35070291');
  check('reabrir: muestra la última guardada, cuenta de capturas y "Recapturar"',
    html2.includes('Casa cliente guardada el') && html2.includes('2 capturas guardadas')
    && html2.includes('Recapturar ubicación · Casa cliente'));
  check('reabrir: HTML balanceado', balanced(html2) === null, balanced(html2));

  // Error al guardar: la captura se conserva y el error es accesible.
  const createOrig2 = WifixAPI.createClientLocation;
  WifixAPI.createClientLocation = async () => { const e = new Error('No se pudo conectar con el servidor'); e.code = 'NETWORK_ERROR'; throw e; };
  sc = clientLocScope();
  await ctx._clientLocCaptureGps(sc, sc.slots['[data-action="client-loc-gps"]']);
  await ctx._clientLocSave(sc, sc.slots['[data-action="client-loc-save"]']);
  check('error al guardar: role="alert", mensaje y la captura sigue lista para reintentar',
    sc.slots['[data-slot="client-loc-status"]'].getAttribute('role') === 'alert'
    && sc.slots['[data-slot="client-loc-status"]'].textContent.includes('No se pudo guardar')
    && vm.runInContext('_napPanelState.clientLoc.draft !== null', ctx)
    && sc.slots['[data-action="client-loc-save"]'].disabled === false);
  WifixAPI.createClientLocation = createOrig2;

  // Sin ubicación registrada de la operadora.
  const getOrig = WifixAPI.getClientLocation;
  WifixAPI.getClientLocation = async () => ({ latest: null, items: [], registeredLocation: null });
  await ctx.loadNapPanel('35070291');
  vm.runInContext("_napPanelState.clientLoc.draft = { latitude: -2.2478, longitude: -79.9044, accuracyMeters: 4, source: 'GPS', capturedAt: new Date().toISOString() }", ctx);
  check('registeredLocation null: "Sin ubicación registrada de la operadora para comparar"',
    ctx._clientLocDraftHtml().includes('Sin ubicación registrada de la operadora para comparar'));
  vm.runInContext("_napPanelState.clientLoc.registeredLocation = { latitude: -2.247946, longitude: -79.904161, source: 'MOCK' }", ctx);
  check('registeredLocation MOCK: la comparación dice "(de prueba)"',
    ctx._clientLocDraftHtml().includes('de la ubicación registrada del cliente (de prueba)'));
  vm.runInContext("_napPanelState.currentNap = null; _napPanelState.clientLoc.latest = { latitude: -2.2478, longitude: -79.9044, napLocation: { latitude: -2.2476, longitude: -79.9046, simulated: true } }", ctx);
  check('mapa sin current-nap: marcador de la NAP desde napLocation de la última captura',
    (() => { const nf = ctx._napMapClientPoints().napFallback; return nf && nf.latitude === -2.2476 && nf.simulated === true; })());
  // GET con error: aviso con Reintentar, la captura sigue disponible.
  WifixAPI.getClientLocation = async () => { throw new Error('Error interno del servidor'); };
  const html3 = await ctx.loadNapPanel('35070291');
  check('GET con error: aviso role="alert" con "Reintentar" y el botón de captura sigue',
    html3.includes('client-loc-error" role="alert"') && html3.includes('data-action="client-loc-reload"')
    && html3.includes('data-action="client-loc-gps"'));
  WifixAPI.getClientLocation = getOrig;
  console.error = origErr;

  // Migraciones también tiene la sección.
  ctx.selectModule('migraciones');
  const htmlMig = await ctx.loadNapPanel('35070291');
  check('migración: también tiene la sección Casa cliente', htmlMig.includes('data-slot="client-loc"'));

  // Backend real: rutas y método.
  const llamadas = [];
  WifixAPI.useRealApi = true;
  const origFetch = ctx.fetch;
  ctx.fetch = async (u, init) => {
    llamadas.push({ url: String(u), method: init && init.method, body: init && init.body });
    const body = init && init.method === 'POST' ? { id: 'x' } : { latest: null, items: [], registeredLocation: null };
    return { ok: true, status: init && init.method === 'POST' ? 201 : 200, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) };
  };
  await WifixAPI.getClientLocation('35070291');
  await WifixAPI.createClientLocation('35070291', p1);
  ctx.fetch = origFetch;
  WifixAPI.useRealApi = false;
  check('real: GET y POST /herramientas/v1/accounts/{n}/client-location con el cuerpo tal cual',
    /\/herramientas\/v1\/accounts\/35070291\/client-location$/.test(llamadas[0].url) && llamadas[0].method === 'GET'
    && /\/herramientas\/v1\/accounts\/35070291\/client-location$/.test(llamadas[1].url) && llamadas[1].method === 'POST'
    && JSON.stringify(JSON.parse(llamadas[1].body)) === JSON.stringify(p1), JSON.stringify(llamadas.map((l) => l.url)));

  delete ctx.WifixNative;
  cache.clear();
  vm.runInContext('_napPanelState.currentNap = null; _napPanelState.currentNapError = null; _napPanelState.clientLoc = _clientLocEmptyState();', ctx);
  ctx.selectModule(prev);
}

console.log('\n== Cómo llegar (native.js) ==');
{
  function nativeCtx(capacitor) {
    const abiertos = [];
    const c = {
      console,
      // Timers inertes: en modo Capacitor native.js programa tareas que
      // dejarían vivo el proceso del smoke test.
      setTimeout: () => 0,
      clearTimeout() {},
      setInterval: () => 0,
      clearInterval() {},
      navigator: { userAgent: 'node' },
      document: {
        readyState: 'complete',
        body: { querySelectorAll: () => [] },
        addEventListener() {},
        createElement: () => fakeEl(),
      },
      MutationObserver: class { observe() {} disconnect() {} },
      open: (url, target) => { abiertos.push({ url, target }); return null; },
      addEventListener() {},
    };
    if (capacitor) c.Capacitor = capacitor;
    c.window = c;
    c.globalThis = c;
    vm.createContext(c);
    vm.runInContext(readFileSync(base + 'native.js', 'utf8'), c, { filename: 'native.js' });
    return { c, abiertos };
  }
  const esperada = 'https://www.google.com/maps/dir/?api=1&destination=-2.247,-79.904&travelmode=walking';
  const nav = nativeCtx(null);
  check('directionsUrl arma la URL de Google Maps a pie', nav.c.WifixNative.directionsUrl(-2.247, -79.904) === esperada,
    nav.c.WifixNative.directionsUrl(-2.247, -79.904));
  check('directionsUrl rechaza coordenadas nulas o fuera de rango',
    nav.c.WifixNative.directionsUrl(null, -79) === null && nav.c.WifixNative.directionsUrl(95, 10) === null);
  await nav.c.WifixNative.openDirections('-2.247', '-79.904');
  check('navegador: openDirections abre la URL en pestaña nueva',
    nav.abiertos.length === 1 && nav.abiertos[0].url === esperada && nav.abiertos[0].target === '_blank');

  const sinPlugin = nativeCtx({ isNativePlatform: () => true, isPluginAvailable: () => false, Plugins: {} });
  await sinPlugin.c.WifixNative.openDirections(-2.247, -79.904);
  check('APK sin AppLauncher: window.open(url, "_system")',
    sinPlugin.abiertos.length === 1 && sinPlugin.abiertos[0].url === esperada && sinPlugin.abiertos[0].target === '_system');

  const lanzados = [];
  const conPlugin = nativeCtx({
    isNativePlatform: () => true,
    isPluginAvailable: (n) => n === 'AppLauncher',
    Plugins: { AppLauncher: { openUrl: async (o) => { lanzados.push(o.url); return { completed: true }; } } },
  });
  await conPlugin.c.WifixNative.openDirections(-2.247, -79.904);
  check('APK con AppLauncher: usa openUrl y no window.open',
    lanzados.length === 1 && lanzados[0] === esperada && conPlugin.abiertos.length === 0);

  let rechazo = false;
  try { await nav.c.WifixNative.openDirections(null, null); } catch (_) { rechazo = true; }
  check('openDirections sin coordenada falla con mensaje', rechazo);
}

console.log('\n== Estado del cliente (campo 7) ==');
const contract = await WifixAPI.getContractStatus('35070291');
const statusHtml = ctx.renderStatusFromContract(contract, '35070291');
check('contractId null se muestra como guion, no como "null"',
  !statusHtml.includes('null') && statusHtml.includes('—'));
check('muestra la descripción literal de la operadora', statusHtml.includes('Activo'));
check('muestra la última orden', statusHtml.includes('ORDER/424900/2026'));
check('agrupa los 5 estados + desconocido en Activo/Suspendido/Cancelado',
  ctx.statusTileClass('ACTIVA') === 'ok' && ctx.statusTileClass('SUSPENDIDA') === 'warn'
  && ctx.statusTileClass('TERMINADA') === 'fail' && ctx.statusTileClass('ORDENADA') === 'ok'
  && ctx.statusTileClass('PENDIENTE') === 'ok' && ctx.statusTileClass('DESCONOCIDA') === 'muted'
  && ctx.statusTileClass('LO QUE SEA') === 'muted');
check('clientStatusGroup acepta código o nombre',
  ['A', 'O', 'P', 'ACTIVA', 'ORDENADA', 'PENDIENTE', 'a'].every((c) => ctx.clientStatusGroup(c).key === 'activo')
  && ['S', 'SUSPENDIDA'].every((c) => ctx.clientStatusGroup(c).label === 'Suspendido')
  && ['T', 'TERMINADA'].every((c) => ctx.clientStatusGroup(c).label === 'Cancelado')
  && ['DESCONOCIDA', '', null, undefined, 'X'].every((c) => ctx.clientStatusGroup(c).key === 'sin-dato'));
check('el tile muestra la etiqueta del grupo, no el código crudo',
  statusHtml.includes('<span class="st-value">Activo</span>'));
check('status HTML balanceado', balanced(statusHtml) === null, balanced(statusHtml));

console.log('\n== Visitas pendientes y anteriores (campos 15/16) ==');
const visits = await WifixAPI.getVisits('35070291');
const visitsHtml = ctx.renderVisitsList(visits);
check('getVisits devuelve el sobre { items, pendingCount, totalOrders, scanned, truncated, brand }',
  Array.isArray(visits.items) && typeof visits.pendingCount === 'number'
  && typeof visits.totalOrders === 'number' && typeof visits.scanned === 'number'
  && typeof visits.truncated === 'boolean' && typeof visits.brand === 'string');
check('mock: nunca más de una visita PENDIENTE',
  visits.items.filter((t) => t.result === 'PENDIENTE').length === 1 && visits.pendingCount === 1);
check('mock: la pendiente es la primera y la más reciente',
  visits.items[0].result === 'PENDIENTE'
  && visits.items.slice(1).every((t) => t.occurredAt <= visits.items[0].occurredAt));
check('mock: el historial viene por fecha descendente',
  visits.items.slice(1).every((t, i, arr) => i === 0 || arr[i - 1].occurredAt >= t.occurredAt));
check('mock: mezcla SATISFACTORIA / INSATISFACTORIA / CANCELADA / REALIZADA',
  ['SATISFACTORIA', 'INSATISFACTORIA', 'CANCELADA', 'REALIZADA'].every((r) => visits.items.some((t) => t.result === r)));
const primerItem = visitsHtml.indexOf('<div class="event-item');
const itemPendiente = visitsHtml.indexOf('data-result="PENDIENTE"');
check('la pendiente se pinta primero',
  itemPendiente !== -1 && visitsHtml.lastIndexOf('<div class="event-item', itemPendiente) === primerItem);
check('la pendiente va destacada con su encabezado',
  /class="event-item visit-upcoming"[^>]*data-result="PENDIENTE"/.test(visitsHtml)
  && visitsHtml.indexOf('Próxima visita (pendiente)') < itemPendiente);
check('solo la pendiente lleva el destacado',
  (visitsHtml.match(/event-item visit-upcoming/g) || []).length === 1);
check('separador "Visitas anteriores" después de la pendiente',
  visitsHtml.indexOf('>Visitas anteriores<') > itemPendiente);
check('badges por resultado',
  /badge-pending">PENDIENTE</.test(visitsHtml) && /badge-resolved">SATISFACTORIA</.test(visitsHtml)
  && /badge-fail">INSATISFACTORIA</.test(visitsHtml) && /badge-neutral">CANCELADA</.test(visitsHtml)
  && /badge-neutral">REALIZADA</.test(visitsHtml));
check('REALIZADA aclara que el resultado no está verificado',
  visitsHtml.includes('Resultado no verificado'));
check('un resultado desconocido cae en neutro, no en rojo',
  ctx.visitBadgeClass('LO QUE SEA') === 'badge-neutral');
check('técnico null se muestra como guion', visitsHtml.includes('· —') && !visitsHtml.includes('null'));
check('ofrece cargar las notas bajo demanda', visitsHtml.includes('data-action="task-notes"'));
check('pinta el aviso de lista truncada del backend',
  visitsHtml.includes('detail-note') && visitsHtml.includes('Se revisaron las 10 órdenes'));
check('visitas HTML balanceado', balanced(visitsHtml) === null, balanced(visitsHtml));
const soloAnteriores = ctx.renderVisitsList({ items: visits.items.slice(1), pendingCount: 0 });
check('sin pendiente no hay destacado ni encabezado de pendiente',
  !soloAnteriores.includes('visit-upcoming') && !soloAnteriores.includes('Próxima visita'));
const soloPendiente = ctx.renderVisitsList({ items: visits.items.slice(0, 1), pendingCount: 1 });
check('solo la pendiente: sin separador de anteriores',
  soloPendiente.includes('Próxima visita') && !soloPendiente.includes('>Visitas anteriores<'));
check('estado vacío', ctx.renderVisitsList({ items: [] }).includes('Sin visitas registradas.'));
check('tolera el array desnudo', ctx.renderVisitsList([]).includes('Sin visitas registradas.'));
check('api.js ya no expone las rutas viejas',
  typeof WifixAPI.getPreviousVisits === 'undefined' && typeof WifixAPI.getUnsatisfactoryTasks === 'undefined');
const notes = ctx.renderWorkOrderNotes(await WifixAPI.getWorkOrderTasks('ORDER/424900/2026'));
check('renderiza las notas de cierre', notes.includes('task-note-date') && notes.includes('ONT'));
check('notas HTML balanceado', balanced(notes) === null, balanced(notes));

console.log('\n== Visitas con registros de la app (include=records) ==');
{
  const conReg = await WifixAPI.getVisits('35070291', { includeRecords: true });
  check('mock include=records: cada visita trae checklist de 10 tipos (con clientLocation, napAssignment y deviceValidation)',
    conReg.items.every((t) => t.records && t.records.checklist.length === 10
      && t.records.checklist.some((c) => c.type === 'clientLocation' && c.label === 'Ubicación casa cliente')
      && t.records.checklist.some((c) => c.type === 'napAssignment' && c.label === 'NAP elegida (instalación)')
      && t.records.checklist.some((c) => c.type === 'deviceValidation' && c.label === 'Validación de equipo vs plan'))
    && conReg.recordsSummary);
  const html = ctx.renderVisitsList(conReg);
  check('visitas anteriores: muestran las validaciones de equipo (bloqueada con mensaje y apta)',
    html.includes('Validación de equipo vs plan') && html.includes('>Validación de equipo<')
    && html.includes('>Bloqueado<') && html.includes('>Apto<') && html.includes('ZTEGD0BB8294')
    && html.includes('plan 600 Mbps (simulado)') && html.includes('Franco Ceruso'));
  check('visitas con registros: HTML balanceado', balanced(html) === null, balanced(html));
  check('anteriores como tarjetas expandibles (<details>)',
    (html.match(/<details class="visit-card"/g) || []).length === conReg.items.length - 1);
  check('checklist con ícono y texto: Hecho / No hecho',
    html.includes('visit-check is-done') && html.includes('>Hecho<') && html.includes('>No hecho<'));
  check('speedtest externo: fuente, deviceName y badge Simulado',
    html.includes('Dispositivo externo · Medidor Xtrim 10G') && html.includes('sim-badge'));
  check('speedtest de la app se distingue del externo', html.includes('Speedtest — App'));
  check('ping (promedio/pérdida), traceroute (saltos), WiFi (dBm), distancia y equipo retirado',
    html.includes('promedio <strong>12.3 ms</strong>') && html.includes('pérdida <strong>0 %</strong>')
    && html.includes('4 saltos') && html.includes('sin respuesta') && html.includes('-41 dBm')
    && html.includes('142.7 m') && html.includes('ZTEGD0BB8294'));
  check('visita anterior: registro "Ubicación casa cliente" con coords, precisión y distancias',
    html.includes('>Ubicación casa cliente<') && html.includes('-2.247811, -79.904402') && html.includes('GPS ±7 m')
    && html.includes('<strong>41 m</strong> de la NAP NAP-GYE-0412') && html.includes('<strong>31 m</strong> de la ubicación registrada'));
  check('fechas creada/finalizada con el formateador común',
    html.includes('>Creada<') && html.includes('>Finalizada<') && /<time class="dt-abs"/.test(html));
  check('vínculo por tarea / por horario indicado sutilmente',
    html.includes('por horario') && html.includes('Registros vinculados por'));
  check('sin contadores "0 registros"', !/\b0 registros\b/.test(html));
  const soloPend = ctx.renderVisitsList({ items: conReg.items.slice(0, 1) });
  check('sin visitas anteriores no hay sección de anteriores',
    !soloPend.includes('Visitas anteriores') && !soloPend.includes('visit-card'));
  check('"Historial de la app" eliminado',
    !vm.runInContext('SERVICIO_ITEMS', ctx).some((i) => i.id === 'history')
    && typeof WifixAPI.getAccountToolHistory === 'undefined');

  let url = null;
  WifixAPI.useRealApi = true;
  const origFetch = ctx.fetch;
  ctx.fetch = async (u) => { url = String(u); return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ items: [] }), text: async () => '{"items":[]}' }; };
  await WifixAPI.getVisits('35070291', { includeRecords: true });
  ctx.fetch = origFetch;
  WifixAPI.useRealApi = false;
  check('real: GET /accounts/{n}/visits?include=records', /\/accounts\/35070291\/visits\?include=records$/.test(url || ''), url);
}

console.log('\n== Vínculo taskId de la visita en curso ==');
{
  const cache = vm.runInContext('_pendingVisitCache', ctx);
  cache.clear();
  const ping = await WifixAPI.createPingTest('35070291', { target: '8.8.8.8' });
  check('POST de herramientas: taskId = workOrder de la visita pendiente',
    ping.taskId === 'ORDER/424900/2026', ping.taskId);
  check('ya no se manda visitId de prueba', !('visitId' in ping));
  const ret = await WifixAPI.createRetiredEquipment('35070291', { serialValue: 'X', equipmentModelId: 'm', removalReasonCode: 'DANADO' });
  check('equipos retirados también llevan el taskId', ret.taskId === 'ORDER/424900/2026');
  const explicito = await WifixAPI.createPingTest('35070291', { target: '1.1.1.1', taskId: 'TASK/1/2026' });
  check('un taskId explícito manda sobre el resolver', explicito.taskId === 'TASK/1/2026');
  cache.clear();
  const origGet = WifixAPI.getVisits;
  WifixAPI.getVisits = async () => ({ items: [{ result: 'SATISFACTORIA', workOrder: 'ORDER/9/2026' }] });
  const sinPend = await WifixAPI.createPingTest('35070291', { target: '8.8.8.8' });
  check('sin visita pendiente no se manda taskId (el backend asocia por horario)', !('taskId' in sinPend));
  cache.clear();
  WifixAPI.getVisits = async () => { throw new Error('sin red'); };
  const origWarn = console.warn;
  console.warn = () => {};
  const conFallo = await WifixAPI.createPingTest('35070291', { target: '8.8.8.8' });
  console.warn = origWarn;
  check('si /visits falla, el registro se guarda igual sin taskId', !('taskId' in conFallo) && conFallo.target === '8.8.8.8');
  WifixAPI.getVisits = origGet;
  cache.clear();
  vm.runInContext("_napPanelState.taskId = 'TASK/999999/2026'", ctx);
  const noNap = await WifixAPI.createSpeedtest('35070291', { downloadMbps: 1, uploadMbps: 1 });
  check('nunca usa el TASK/… generado por el panel NAP', noNap.taskId === 'ORDER/424900/2026');
  vm.runInContext('_napPanelState.taskId = null', ctx);
  cache.clear();
}

console.log('\n== Integración FSM ==');
const health = await WifixAPI.getFsmHealth();
check('health informa modo, marca por defecto y marcas',
  typeof health.mode === 'string' && typeof health.defaultBrand === 'string' && Array.isArray(health.brands));

// `brands[].available` habla solo del token del conector: en modo fixture el
// backend manda requiresToken:false y el banner amarillo NO debe salir.
const sinMarcas = { brands: [{ brand: 'telenews', available: false, reason: 'token vencido' }] };
check('sin token y sin marcas disponibles, se avisa (backend viejo sin requiresToken)',
  ctx.fsmHealthNeedsWarning(sinMarcas) === true);
check('modo fixture (requiresToken:false) NO pinta el banner de operadora caída',
  ctx.fsmHealthNeedsWarning({ ...sinMarcas, requiresToken: false, fixtureAccount: '35070291' }) === false);
check('requiresToken:true sigue avisando si no hay marcas',
  ctx.fsmHealthNeedsWarning({ ...sinMarcas, requiresToken: true }) === true);
check('con una marca disponible nunca se avisa',
  ctx.fsmHealthNeedsWarning({ brands: [{ brand: 'telenews', available: true }] }) === false);
check('sin health no se avisa nada',
  ctx.fsmHealthNeedsWarning(null) === false);
WifixAPI.setBrand('seteinfo');
check('la marca se guarda y se lee', WifixAPI.getBrand() === 'seteinfo');
WifixAPI.setBrand(null);
check('la marca se puede limpiar (usa el default del backend)', WifixAPI.getBrand() === null);
const batch = await WifixAPI.getAccountsStatusBatch(['35070291', '35070291', '71398253']);
check('status-batch deduplica las cuentas', batch.items.length === 2);
const muchas = Array.from({ length: 27 }, (_, i) => String(40001000 + i));
const batchBig = await WifixAPI.getAccountsStatusBatch(muchas);
check('status-batch parte en lotes y devuelve todas', batchBig.items.length === 27);
check('un fallo aislado no tumba el lote',
  batchBig.items.some((it) => it.error) && batchBig.items.some((it) => it.statusCode));
check('UPSTREAM_AUTH_ERROR se pinta como aviso, no como error rojo',
  ctx.renderPanelError({ code: 'UPSTREAM_AUTH_ERROR', message: 'token vencido' }).includes('detail-warning'));
check('otros errores siguen siendo error',
  ctx.renderPanelError({ code: 'CONNECTOR_ERROR', message: 'boom' }).includes('detail-error'));

console.log('\n== Perfil del cliente (campos 1-5) ==');
const profile = await WifixAPI.getClientProfile('35070291');
check('el perfil trae correo y coordenada del domicilio',
  typeof profile.email === 'string' && isFinite(profile.latitude) && isFinite(profile.longitude));
check('los campos simulados se marcan como tales',
  ctx.sourceBadge(profile, 'planName').includes('simulado') && ctx.sourceBadge(profile, 'fullName') === '');

console.log('\n== URL del backend configurable ==');
// Con PUBLIC_BACKEND_URL rellenada, la resolución automática en localhost/APK
// apunta al backend público del VPS; el LAN queda solo como fallback si la
// constante vuelve a vaciarse.
const AUTO_URL = 'https://api-wifix.portaltulpa.com/herramientas/v1';
const OVERRIDE_KEY = 'wifix.backend.url';
ctx.localStorage.removeItem(OVERRIDE_KEY);
check('sin override, en localhost/APK resuelve al backend público del VPS',
  WifixAPI.getBaseUrl() === AUTO_URL, WifixAPI.getBaseUrl());
check('el override válido gana sobre la resolución automática',
  WifixAPI.setBaseUrl('https://wifix.example.com/herramientas/v1') === 'https://wifix.example.com/herramientas/v1' &&
  WifixAPI.getBaseUrl() === 'https://wifix.example.com/herramientas/v1');
check('baseUrl no es decorativo: el getter refleja el override',
  WifixAPI.baseUrl === 'https://wifix.example.com/herramientas/v1');
check('la barra final del override se normaliza',
  WifixAPI.setBaseUrl('https://wifix.example.com/api/') === 'https://wifix.example.com/api');
check('un override sin esquema http/https se rechaza sin pisar el anterior',
  WifixAPI.setBaseUrl('192.168.1.5:8080') === null &&
  WifixAPI.getBaseUrlOverride() === 'https://wifix.example.com/api');
check('un override con esquema peligroso se rechaza',
  WifixAPI.setBaseUrl('javascript:alert(1)') === null &&
  WifixAPI.getBaseUrlOverride() === 'https://wifix.example.com/api');
check('override vacío borra el override y vuelve al automático',
  WifixAPI.setBaseUrl('') === null && WifixAPI.getBaseUrl() === AUTO_URL);

console.log('\n== Errores de red en español ==');
WifixAPI.useRealApi = true;
let netErr = null;
try {
  await WifixAPI.login('tec@tulpasolutions.com', 'x');
} catch (e) {
  netErr = e;
}
WifixAPI.useRealApi = false;
check('un fallo de fetch se traduce a NETWORK_ERROR',
  netErr && netErr.code === 'NETWORK_ERROR', netErr && netErr.code);
check('el mensaje de red está en español, no "Failed to fetch"',
  netErr && /No se pudo conectar con el servidor/.test(netErr.message), netErr && netErr.message);

console.log('\n== Confirmar cuenta: modo limitado ==');
check('503 de la operadora habilita el modo limitado',
  ctx.isUpstreamOrNetworkFailure({ code: 'UPSTREAM_AUTH_ERROR' }) === true);
check('HTTP 503/502/504 habilitan el modo limitado',
  ['HTTP_503', 'HTTP_502', 'HTTP_504'].every((c) => ctx.isUpstreamOrNetworkFailure({ code: c }) === true));
check('un fallo de red habilita el modo limitado',
  ctx.isUpstreamOrNetworkFailure({ code: 'NETWORK_ERROR' }) === true);
check('404 (cuenta inexistente) NO habilita el modo limitado',
  ctx.isUpstreamOrNetworkFailure({ code: 'HTTP_404', message: 'La cuenta no existe.' }) === false);
check('un error de validación NO habilita el modo limitado',
  ctx.isUpstreamOrNetworkFailure({ code: 'VALIDATION_ERROR' }) === false);

console.log('\n== Módulos del menú (qué secciones ve cada uno) ==');
// Tabla aprobada por Franco: sub-tarjetas visibles y paneles de Datos del
// Servicio por módulo. `null` en servicio = la tarjeta no se muestra.
// El orden de las claves es el orden esperado de las tarjetas en index.html.
const MODULE_TABLE = {
  instalaciones: {
    title: 'Instalaciones',
    cards: ['personales', 'servicio', 'equipo', 'herramientas', 'retirados'],
    servicio: ['naps', 'events'],
  },
  migraciones: {
    title: 'Migraciones',
    cards: ['personales', 'servicio', 'equipo', 'herramientas', 'retirados'],
    servicio: ['naps', 'events'],
  },
  visitas: {
    title: 'Visitas técnicas',
    cards: ['personales', 'servicio', 'equipo', 'red', 'herramientas', 'retirados'],
    servicio: ['naps', 'status', 'isp', 'events', 'visits'],
  },
  cancelaciones: {
    title: 'Cancelación de servicio',
    cards: ['personales', 'retirados'],
    servicio: null,
  },
};

// Sub-tarjetas falsas con atributos reales, para ver qué deja visible y
// habilitado app.js. Las `const` del script se leen desde el contexto vm.
function fakeSubCard(sub) {
  const el = fakeEl();
  const attrs = { 'aria-disabled': 'true', tabindex: '-1' };
  el.dataset = { sub };
  el.setAttribute = (k, v) => { attrs[k] = String(v); };
  el.removeAttribute = (k) => { delete attrs[k]; };
  el.getAttribute = (k) => (k in attrs ? attrs[k] : null);
  return el;
}
const ALL_SUBS = ['personales', 'servicio', 'equipo', 'red', 'herramientas', 'retirados'];
const fakeSubCards = ALL_SUBS.map(fakeSubCard);
const fakeGrid = fakeEl();
fakeGrid.querySelectorAll = () => fakeSubCards;
const subscreenEl = vm.runInContext('subscreen', ctx);
subscreenEl.querySelectorAll = () => fakeSubCards;
subscreenEl.querySelector = () => fakeGrid;
vm.runInContext('accountInput', ctx).value = '35070291';
const servicioListEl = vm.runInContext('servicioList', ctx);

check('las tarjetas del menú en index.html coinciden con los módulos',
  (() => {
    const html = readFileSync(base + 'index.html', 'utf8');
    const types = [...html.matchAll(/class="category-card" data-type="([^"]+)"/g)].map((m) => m[1]);
    return types.length === 4 && JSON.stringify(types) === JSON.stringify(Object.keys(MODULE_TABLE));
  })());
check('el menú y MODULES tienen los mismos 4 módulos',
  JSON.stringify(vm.runInContext('Object.keys(MODULES)', ctx).slice().sort())
    === JSON.stringify(Object.keys(MODULE_TABLE).sort()));
check('las tarjetas del menú muestran el título de su módulo', (() => {
  const html = readFileSync(base + 'index.html', 'utf8');
  return Object.entries(MODULE_TABLE).every(([mod, { title }]) => {
    const block = html.split(`data-type="${mod}"`)[1] || '';
    const h3 = block.match(/<h3>([^<]+)<\/h3>/);
    return h3 && h3[1] === title;
  });
})());
check('ya no queda el texto combinado "Visitas técnicas / Migraciones"',
  !readFileSync(base + 'index.html', 'utf8').includes('Visitas técnicas / Migraciones'));

const subHeadingEl = vm.runInContext('subHeading', ctx);
for (const [mod, expected] of Object.entries(MODULE_TABLE)) {
  check(`${mod}: el módulo existe`, ctx.selectModule(mod) === true);
  check(`${mod}: título del submenú`,
    subHeadingEl.textContent === expected.title, subHeadingEl.textContent);
  // Simula la confirmación de cuenta para ver qué se habilita.
  ctx.enableSubCards();
  const visible = fakeSubCards.filter((c) => !c.hidden).map((c) => c.dataset.sub);
  check(`${mod}: sub-tarjetas visibles`,
    JSON.stringify(visible) === JSON.stringify(expected.cards), visible.join(','));
  check(`${mod}: las ocultas llevan aria-hidden y siguen deshabilitadas`,
    fakeSubCards.filter((c) => c.hidden).every((c) =>
      c.getAttribute('aria-hidden') === 'true' && c.getAttribute('aria-disabled') === 'true'));
  check(`${mod}: solo se habilitan las visibles`,
    fakeSubCards.filter((c) => !c.hidden).every((c) =>
      c.getAttribute('aria-disabled') === null && c.getAttribute('aria-hidden') === null));

  if (expected.servicio) {
    servicioListEl.innerHTML = '';
    ctx.openDatosServicio();
    const rendered = [...servicioListEl.innerHTML.matchAll(/data-id="([^"]+)"/g)].map((m) => m[1]);
    check(`${mod}: paneles de Datos del Servicio`,
      JSON.stringify(rendered) === JSON.stringify(expected.servicio), rendered.join(','));
  } else {
    check(`${mod}: sin tarjeta de Datos del Servicio`, !visible.includes('servicio'));
  }
}

check('cambiar de módulo resetea la cuenta confirmada', (() => {
  ctx.selectModule('visitas');
  vm.runInContext("validatedAccount = '35070291'", ctx);
  ctx.selectModule('cancelaciones');
  return vm.runInContext('validatedAccount', ctx) === null;
})());
check('reabrir el mismo módulo conserva la cuenta confirmada', (() => {
  vm.runInContext("validatedAccount = '35070291'", ctx);
  ctx.selectModule('cancelaciones');
  return vm.runInContext('validatedAccount', ctx) === '35070291';
})());
check('Datos del Servicio: un solo panel de visitas con el título nuevo', (() => {
  ctx.selectModule('visitas');
  ctx.enableSubCards();
  ctx.openDatosServicio();
  const html = servicioListEl.innerHTML;
  // Deja el módulo como estaba: la verificación siguiente depende de él.
  ctx.selectModule('cancelaciones');
  return (html.match(/data-id="visits"/g) || []).length === 1
    && html.includes('Visitas pendientes y anteriores')
    && !html.includes('data-id="unsat"') && !html.includes('insatisfactorias');
})());
check('ningún módulo referencia el panel eliminado "unsat"',
  vm.runInContext('Object.values(MODULES).every((m) => !(m.servicio || []).includes("unsat"))', ctx)
  && vm.runInContext('SERVICIO_ITEMS.every((i) => i.id !== "unsat")', ctx));
check('un módulo desconocido se ignora',
  ctx.selectModule('asistencia') === false && vm.runInContext('currentCategory', ctx) === 'cancelaciones');

console.log('\n== Nombre del módulo en las pantallas internas ==');
{
  const LABELS = { instalaciones: 'Instalaciones', migraciones: 'Migraciones', visitas: 'Visita técnica', cancelaciones: 'Cancelación' };
  const html = readFileSync(base + 'index.html', 'utf8');
  const detalles = [...html.matchAll(/<section class="detailscreen" id="([^"]+)"[\s\S]*?<\/section>/g)];
  check('cada pantalla interna tiene su eyebrow marcado con data-module-eyebrow',
    detalles.length === 6 && detalles.every((m) => m[0].includes('class="sub-eyebrow" data-module-eyebrow')),
    detalles.map((m) => m[1]).join(','));
  check('index.html ya no tiene eyebrows fijos (Diagnóstico/Registro/id viejo)',
    !/sub-eyebrow">(Instalaciones|Diagnóstico|Registro)</.test(html) && !html.includes('detailEyebrow'));
  check('app.js sin referencias muertas a detailEyebrow', !readFileSync(base + 'app.js', 'utf8').includes('detailEyebrow'));
  // Eyebrows falsos: selectModule tiene que pintarlos todos.
  const eyebrows = [fakeEl(), fakeEl(), fakeEl(), fakeEl(), fakeEl(), fakeEl()];
  const qsaDoc = documentStub.querySelectorAll;
  documentStub.querySelectorAll = (sel) => (sel === '[data-module-eyebrow]' ? eyebrows : qsaDoc(sel));
  const prev = vm.runInContext('currentCategory', ctx);
  for (const [mod, label] of Object.entries(LABELS)) {
    check(`moduleLabel(${mod}) = "${label}"`, ctx.moduleLabel(mod) === label, ctx.moduleLabel(mod));
    ctx.selectModule(mod);
    check(`${mod}: todos los eyebrows internos muestran "${label}"`,
      eyebrows.every((e) => e.textContent === label), eyebrows.map((e) => e.textContent).join('|'));
  }
  check('visita técnica y migraciones ya no dicen "Instalaciones"', (() => {
    ctx.selectModule('visitas');
    const v = eyebrows.every((e) => e.textContent !== 'Instalaciones');
    ctx.selectModule('migraciones');
    return v && eyebrows.every((e) => e.textContent === 'Migraciones');
  })());
  check('moduleLabel sin argumento usa el módulo vigente', ctx.moduleLabel() === 'Migraciones');
  documentStub.querySelectorAll = qsaDoc;
  ctx.selectModule(prev);
}

console.log('\n== Sin chip de marca ==');
{
  const html = readFileSync(base + 'index.html', 'utf8');
  const css = readFileSync(base + 'styles.css', 'utf8');
  const js = readFileSync(base + 'app.js', 'utf8');
  check('index.html no tiene huecos de chip de marca',
    !html.includes('brand-chip') && !html.includes('data-slot="brand-chip"'));
  check('app.js ya no pinta el chip ni el selector de marca',
    !/brand-chip|brand-menu|renderBrandChips/.test(js) && typeof ctx.renderBrandChips === 'undefined');
  check('styles.css sin reglas muertas del chip de marca', !/\.brand-(chip|menu)/.test(css));
  // Abrir las pantallas con un contenedor que registre lo pintado: ningún
  // hueco debería recibir el chip.
  const pintado = [];
  const origQSA = ctx.document.querySelectorAll;
  ctx.document.querySelectorAll = (sel) => { pintado.push(sel); return origQSA(sel); };
  ctx.selectModule('visitas');
  ctx.openDatosServicio();
  await ctx.openDatosPersonales();
  ctx.document.querySelectorAll = origQSA;
  check('abrir Datos del Servicio / Personales no busca huecos de marca',
    !pintado.some((sel) => String(sel).includes('brand')), pintado.join(' | '));
  check('Datos del Servicio no pinta "Marca"',
    !servicioListEl.innerHTML.includes('brand-chip') && !/>\s*Marca\s*</.test(servicioListEl.innerHTML));
}

console.log('\n== Whitelist de clientes Xtrim en Confirmar cuenta ==');
{
  const api = ctx.WifixAPI;
  const input = vm.runInContext('accountInput', ctx);
  const feedback = vm.runInContext('confirmAccountFeedback', ctx);
  const line = vm.runInContext('confirmAccountWhitelist', ctx);
  const cache = vm.runInContext('whitelistCache', ctx);
  const attrs = {};
  let focused = 0;
  input.setAttribute = (k, v) => { attrs[k] = String(v); };
  input.removeAttribute = (k) => { delete attrs[k]; };
  input.getAttribute = (k) => (k in attrs ? attrs[k] : null);
  input.focus = () => { focused += 1; };

  // Los fallos simulados loguean warn/error a propósito: se silencian acá.
  const origWarn = console.warn;
  const origError = console.error;
  console.warn = () => {};
  console.error = () => {};
  const origCheck = api.checkWhitelist;
  const origProfile = api.getClientProfile;
  let calls = 0;

  // Confirma `cuenta` en `mod`. `impl` reemplaza a checkWhitelist (null = mock).
  async function confirmWith(cuenta, mod, impl, opts = {}) {
    ctx.selectModule(mod);
    input.value = cuenta;
    ctx.invalidateAccountCache();
    if (!opts.keepCache) cache.clear();
    focused = 0;
    calls = 0;
    api.checkWhitelist = async function (n) {
      calls += 1;
      return impl ? impl(n) : origCheck.call(api, n);
    };
    await ctx.confirmAccountFlow();
    return {
      feedback: feedback.textContent,
      feedbackClass: feedback.className,
      line: line.innerHTML,
      lineClass: line.className,
      lineHidden: line.hidden,
      validated: vm.runInContext('validatedAccount', ctx),
      calls,
      focused,
      invalid: attrs['aria-invalid'] || null,
    };
  }

  check('mock whitelist: 35070291 ACTIVO / 40123456 EXTRA / 35070288 mora / resto fuera', await (async () => {
    const a = await origCheck.call(api, '35070291');
    const b = await origCheck.call(api, '40123456');
    const c = await origCheck.call(api, '35070288');
    const d = await origCheck.call(api, '99999999');
    return a.listed === true && a.status === 'ACTIVO' && a.enforce === true
      && b.listed === true && b.source === 'EXTRA'
      && c.status === 'SUSPENDIDO' && /^Mora/.test(c.accessType)
      && d.listed === false && d.enforce === true && !!d.importedAt;
  })());

  const activo = await confirmWith('35070291', 'instalaciones', null);
  check('listed activo: confirma la cuenta', activo.validated === '35070291'
    && activo.feedbackClass.includes('success'), activo.feedback);
  check('listed activo: chip verde "Cliente Xtrim · Activo" + ciudad',
    activo.line.includes('wl-chip ok') && activo.line.includes('Cliente Xtrim · Activo')
    && activo.line.includes('GUAYAQUIL') && !activo.lineHidden, activo.line);
  check('listed activo: sin mora si accessType no es "Mora…"', !activo.line.includes('wl-mora'));
  check('listed activo: una sola llamada a la whitelist', activo.calls === 1, String(activo.calls));

  const susp = await confirmWith('35070288', 'visitas', null);
  check('listed suspendido: confirma igual', susp.validated === '35070288');
  check('listed suspendido: chip ámbar + mora visible',
    susp.line.includes('wl-chip warn') && susp.line.includes('Cliente Xtrim · Suspendido')
    && susp.line.includes('wl-mora') && susp.line.includes('Mora Dia 31'), susp.line);

  const ordenado = await confirmWith('11110000', 'instalaciones', (n) => ({
    accountNumber: n, listed: true, source: 'IMPORT', status: 'ORDENADO', city: 'QUITO',
    accessType: 'Normal', importedAt: '2026-09-24T14:30:00.000Z', enforce: true,
  }));
  check('listed ORDENADO cuenta como Activo (con el matiz)',
    ordenado.line.includes('wl-chip ok') && ordenado.line.includes('Activo (Ordenado)'), ordenado.line);

  const bloq = await confirmWith('99999999', 'instalaciones', null);
  check('no listed + enforce: NO confirma', bloq.validated === null);
  check('no listed + enforce: mensaje con cuenta y fecha en hora Ecuador',
    bloq.feedback === 'La cuenta 99999999 no está en la base de clientes de Xtrim (actualizada al 24/09/2026 09:30). Verifica el número.'
    && bloq.feedbackClass.includes('error'), bloq.feedback);
  check('no listed + enforce: el mensaje va en el contenedor role="alert"',
    /id="confirmAccountFeedback"[^>]*role="alert"|role="alert"[^>]*id="confirmAccountFeedback"/
      .test(readFileSync(base + 'index.html', 'utf8')));
  check('no listed + enforce: foco en el campo de cuenta marcado aria-invalid',
    bloq.focused === 1 && bloq.invalid === 'true', `focus=${bloq.focused} invalid=${bloq.invalid}`);
  check('no listed + enforce: sin línea de whitelist aparte', bloq.lineHidden === true);
  let profileCalls = 0;
  api.getClientProfile = async function (n) { profileCalls += 1; return origProfile.call(api, n); };
  const bloq2 = await confirmWith('99999999', 'migraciones', null);
  api.getClientProfile = origProfile;
  check('no listed + enforce: también bloquea en Migraciones', bloq2.validated === null);
  check('el perfil se pide en paralelo (no espera a la whitelist)', profileCalls === 1);

  const cancel = await confirmWith('99999999', 'cancelaciones', null);
  check('no listed en Cancelaciones: NO bloquea', cancel.validated === '99999999'
    && cancel.feedbackClass.includes('success'), cancel.feedback);
  check('no listed en Cancelaciones: aviso informativo', cancel.lineClass.includes('is-info')
    && cancel.line.includes('cancelación') && cancel.focused === 0 && cancel.invalid === null, cancel.line);

  const soft = await confirmWith('99999999', 'instalaciones', (n) => ({
    accountNumber: n, listed: false, importedAt: '2026-09-24T14:30:00.000Z', enforce: false,
  }));
  check('no listed + enforce:false: avisa pero confirma', soft.validated === '99999999'
    && soft.lineClass.includes('is-warning') && soft.line.includes('no está en la base de clientes de Xtrim'),
    soft.line);

  const empty = await confirmWith('99999999', 'instalaciones', (n) => ({
    accountNumber: n, listed: null, reason: 'WHITELIST_EMPTY', importedAt: null, enforce: false,
  }));
  check('lista vacía: no bloquea y avisa discreto', empty.validated === '99999999'
    && empty.lineClass.includes('is-muted') && empty.line.includes('No se pudo validar contra la base de clientes'));
  check('lista vacía: no se cachea (se reintenta en la próxima)', !cache.has('99999999'));

  const e404 = await confirmWith('99999999', 'instalaciones', () => {
    const e = new Error('Not Found'); e.code = 'HTTP_404'; throw e;
  });
  check('404 (backend sin la ruta): no bloquea', e404.validated === '99999999'
    && e404.line.includes('No se pudo validar'));

  const eRed = await confirmWith('99999999', 'instalaciones', () => {
    const e = new Error('Sin red'); e.code = 'NETWORK_ERROR'; throw e;
  });
  check('error de red: no bloquea', eRed.validated === '99999999' && eRed.line.includes('No se pudo validar'));

  // Modo limitado (503 de la operadora) intacto + whitelist en paralelo.
  api.getClientProfile = async () => { const e = new Error('Operadora caída'); e.code = 'HTTP_503'; throw e; };
  const lim = await confirmWith('35070291', 'instalaciones', null);
  const limErr = await confirmWith('99999998', 'instalaciones', () => { throw new Error('500'); });
  const limBloq = await confirmWith('99999997', 'instalaciones', null);
  api.getClientProfile = origProfile;
  check('503 + listed: modo limitado intacto y chip visible',
    lim.validated === '35070291' && lim.feedback.includes('modo limitado') && lim.line.includes('Cliente Xtrim'));
  check('503 + whitelist caída: modo limitado, sin bloqueo',
    limErr.validated === '99999998' && limErr.feedback.includes('modo limitado') && limErr.line.includes('No se pudo validar'));
  check('503 + no listed enforce: la whitelist bloquea igual', limBloq.validated === null
    && limBloq.feedback.includes('no está en la base de clientes'));

  // Cache por cuenta: re-confirmar y re-renderizar no repite la llamada.
  await confirmWith('35070291', 'instalaciones', null);
  const again = await confirmWith('35070291', 'instalaciones', null, { keepCache: true });
  check('re-confirmar la misma cuenta usa la cache (0 llamadas nuevas)', again.calls === 0
    && again.line.includes('Cliente Xtrim'), String(again.calls));
  ctx.renderWhitelistLine(ctx.whitelistOutcome({ ok: true, body: { listed: true, status: 'ACTIVO' } }, 'instalaciones'), '35070291');
  check('re-renderizar no llama a la whitelist', calls === 0);
  check('dos confirmaciones simultáneas: una sola llamada', await (async () => {
    cache.clear();
    let n = 0;
    api.checkWhitelist = async (c) => { n += 1; return origCheck.call(api, c); };
    input.value = '40123456';
    await Promise.all([ctx.confirmAccountFlow(), ctx.confirmAccountFlow()]);
    return n === 1;
  })());

  api.checkWhitelist = origCheck;
  // Ruta real: GET /accounts/:n/whitelist y 404 → "no se pudo validar".
  const origFetch = ctx.fetch;
  let pedido = null;
  ctx.fetch = async (url, init) => { pedido = { url, init }; return { ok: false, status: 404, json: async () => null }; };
  api.useRealApi = true;
  const real = await api.checkWhitelist('35070291').then(() => 'ok', (e) => e.code);
  api.useRealApi = false;
  ctx.fetch = origFetch;
  check('API real: GET /accounts/:n/whitelist y 404 se propaga como error',
    pedido && pedido.init.method === 'GET' && /\/accounts\/35070291\/whitelist$/.test(pedido.url) && real === 'HTTP_404',
    pedido && pedido.url);

  api.checkWhitelist = origCheck;
  cache.clear();
  console.warn = origWarn;
  console.error = origError;
  input.value = '';
  ctx.invalidateAccountCache();
  ctx.selectModule('instalaciones');
}

console.log('\n== Identidad del cliente con FSM sin datos (client-profile) ==');
{
  const api = ctx.WifixAPI;
  const detail = vm.runInContext('detailList', ctx);
  const sinFsm = await api.getClientProfile('50000001');
  const conWl = await api.getClientProfile('50000002');
  const normal = await api.getClientProfile('35070291');

  check('mock 50000001: identidad null + degraded FSM_NO_DATA',
    ['fullName', 'address', 'phones', 'email', 'latitude', 'longitude'].every((k) => sinFsm[k] === null)
    && sinFsm.degraded && sinFsm.degraded.reason === 'FSM_NO_DATA' && sinFsm.sources.fullName === 'NONE');
  check('mock 50000002: nombre de la whitelist',
    conWl.fullName && conWl.sources.fullName === 'WHITELIST' && conWl.address === null
    && /base de clientes Xtrim/.test(conWl.degraded.message));

  ctx.renderClientProfile(sinFsm, '50000001');
  const hSin = detail.innerHTML;
  check('Datos Personales sin FSM: HTML balanceado', balanced(hSin) === null, balanced(hSin));
  check('Datos Personales sin FSM: "Sin datos en FSM" en nombre, dirección, teléfonos y correo',
    (hSin.match(/class="no-fsm-data">Sin datos en FSM</g) || []).length === 4);
  check('Datos Personales sin FSM: sin "undefined", "null" ni guion vacío en identidad',
    !/undefined|>null</.test(hSin) && !/detail-value">—</.test(hSin));
  check('Datos Personales sin FSM: aviso informativo con el message del backend',
    hSin.includes('class="profile-degraded-note" role="status">Sin datos en FSM para esta cuenta.<'));
  check('Datos Personales sin FSM: plan simulado conserva su aviso', hSin.includes('>simulado<'));

  ctx.renderClientProfile(conWl, '50000002');
  const hWl = detail.innerHTML;
  check('nombre WHITELIST: se muestra con la etiqueta "Base Xtrim"',
    hWl.includes('source-badge whitelist') && hWl.includes('>Base Xtrim<')
    && hWl.includes(conWl.fullName));
  check('nombre WHITELIST: el resto de la identidad dice "Sin datos en FSM"',
    (hWl.match(/Sin datos en FSM</g) || []).length === 3);
  check('nombre WHITELIST: aviso con "nombre tomado de la base de clientes Xtrim"',
    hWl.includes('nombre tomado de la base de clientes Xtrim'));

  ctx.renderClientProfile(normal, '35070291');
  const hOk = detail.innerHTML;
  check('perfil completo: sin "Sin datos en FSM", sin aviso ni etiqueta Base Xtrim',
    !hOk.includes('Sin datos en FSM') && !hOk.includes('profile-degraded-note') && !hOk.includes('Base Xtrim'));
  check('sources MOCK en identidad conserva el aviso "simulado"', (() => {
    ctx.renderClientProfile(Object.assign({}, normal, { sources: Object.assign({}, normal.sources, { fullName: 'MOCK' }) }), '35070291');
    return /Nombres y Apellidos <span class="source-badge"[^>]*>simulado</.test(detail.innerHTML);
  })());
  check('perfil con campos ausentes (undefined) no rompe', (() => {
    ctx.renderClientProfile({ accountNumber: '1' }, '1');
    return (detail.innerHTML.match(/Sin datos en FSM</g) || []).length === 4 && !detail.innerHTML.includes('undefined');
  })());

  check('profileDisplayName: null → "Sin datos en FSM"',
    ctx.profileDisplayName(sinFsm) === 'Sin datos en FSM' && ctx.profileDisplayName(conWl) === conWl.fullName
    && ctx.profileDisplayName(null) === 'Sin datos en FSM');
  check('profileHomeCoords: null/undefined/texto → null (nunca 0,0)',
    ctx.profileHomeCoords(sinFsm) === null && ctx.profileHomeCoords({}) === null
    && ctx.profileHomeCoords({ latitude: '1', longitude: '2' }) === null
    && ctx.profileHomeCoords({ latitude: null, longitude: -79.9 }) === null
    && JSON.stringify(ctx.profileHomeCoords(normal)) === JSON.stringify({ latitude: normal.latitude, longitude: normal.longitude }));

  // Confirmar cuenta con identidad null: confirma y el feedback no dice "null".
  const input = vm.runInContext('accountInput', ctx);
  const feedback = vm.runInContext('confirmAccountFeedback', ctx);
  ctx.selectModule('instalaciones');
  input.value = '50000001';
  ctx.invalidateAccountCache();
  await ctx.confirmAccountFlow();
  check('Confirmar cuenta sin FSM: confirma con "Sin datos en FSM"',
    vm.runInContext('validatedAccount', ctx) === '50000001'
    && feedback.textContent.startsWith('Cuenta confirmada — Sin datos en FSM'), feedback.textContent);

  // Panel NAP en Visitas: sin coords del domicilio no hay casa ni coords falsas.
  ctx.selectModule('visitas');
  input.value = '50000001';
  vm.runInContext("validatedAccount = '50000001'", ctx);
  ctx.validatedProfileForSmoke = sinFsm;
  vm.runInContext('validatedProfile = validatedProfileForSmoke', ctx);
  const prevCoords = vm.runInContext('_napPanelState.coords', ctx);
  vm.runInContext('_napPanelState.coords = null', ctx);
  const napHtml = await ctx.loadNapPanel('50000001');
  const st = vm.runInContext('_napPanelState', ctx);
  check('NAP sin coords del domicilio: homeCoords null', st.homeCoords === null);
  check('NAP sin coords: current-nap responde NO_COORDS y se muestra el aviso',
    st.currentNap && st.currentNap.reason === 'NO_COORDS'
    && String(napHtml).includes('no tiene coordenadas registradas'), st.currentNap && st.currentNap.reason);
  check('NAP sin coords: el formulario no precarga lat/lng inventadas',
    !/value="0"/.test(String(napHtml)) && !String(napHtml).includes('undefined'));
  vm.runInContext('_napPanelState.coords = ' + JSON.stringify(prevCoords), ctx);
  ctx.invalidateAccountCache();
  input.value = '';
  ctx.selectModule('instalaciones');
}

console.log('\n== Ingreso por cédula/RUC (POST /accounts/lookup) ==');
{
  const api = ctx.WifixAPI;
  const html = readFileSync(base + 'index.html', 'utf8');
  check('selector "Ingresar por": cuenta, cédula/RUC y orden FSM deshabilitada con "Próximamente"',
    html.includes('role="radiogroup"') && html.includes('data-mode="account"') && html.includes('data-mode="document"')
    && /data-mode="order"[^>]*aria-disabled="true"/.test(html) && html.includes('Próximamente'));
  const dos = await api.lookupAccountsByDocument('912345678');   // 9 dígitos → se restituye el 0
  check('mock lookup: cédula con 2 cuentas, sin devolver el documento',
    dos.by === 'document' && dos.documentKind === 'CEDULA' && dos.count === 2
    && !JSON.stringify(dos).includes('0912345678'));
  check('mock lookup: RUC y sin coincidencias',
    (await api.lookupAccountsByDocument('0990012345001')).documentKind === 'RUC'
    && (await api.lookupAccountsByDocument('1799999999')).matches.length === 0);

  let enviado = null;
  const origFetch = ctx.fetch;
  api.useRealApi = true;
  ctx.fetch = async (url, init) => { enviado = { url: String(url), init }; return { ok: true, status: 200, headers: { get: () => null }, json: async () => dos, text: async () => JSON.stringify(dos) }; };
  try { await api.lookupAccountsByDocument('0912345678'); } catch (_) { /* solo interesa la petición */ }
  api.useRealApi = false;
  ctx.fetch = origFetch;
  check('lookup real: POST con el documento en el cuerpo, nunca en la URL',
    enviado && enviado.init.method === 'POST' && /\/accounts\/lookup$/.test(enviado.url)
    && !enviado.url.includes('0912345678') && JSON.parse(enviado.init.body).document === '0912345678',
    enviado && enviado.url);

  const multi = ctx.lookupOutcome(dos, 'instalaciones');
  const lista = ctx.lookupResultsHtml(multi);
  check('varias cuentas: lista para elegir con cuenta, estado, ciudad y tipo',
    multi.kind === 'multiple' && balanced(lista) === null
    && lista.includes('data-account="35070291"') && lista.includes('Suspendido') && lista.includes('GUAYAQUIL')
    && lista.includes('RESIDENCIAL'));
  check('una cuenta: sigue el flujo normal', ctx.lookupOutcome({ matches: [dos.matches[0]] }).kind === 'single');
  check('cero cuentas: mensaje claro (y distinto en Cancelaciones)',
    ctx.lookupOutcome({ matches: [] }, 'instalaciones').message.includes('No hay cuentas')
    && ctx.lookupOutcome({ matches: [] }, 'cancelaciones').message.includes('cancelados'));
  check('base vacía: WHITELIST_EMPTY se explica',
    ctx.lookupOutcome({ matches: [], reason: 'WHITELIST_EMPTY' }).kind === 'empty-db');

  // Flujo completo: 1 match → confirma esa cuenta con la whitelist de siempre.
  const origWarn = console.warn;
  console.warn = () => {};
  ctx.selectModule('instalaciones');
  ctx.setEntryMode('document');
  const input = vm.runInContext('accountInput', ctx);
  input.value = '0923456789';
  await ctx.lookupByDocumentFlow();
  check('1 match: pasa a modo cuenta, deja el nº de cuenta (no la cédula) y confirma',
    vm.runInContext('accountEntryMode', ctx) === 'account' && input.value === '40123456'
    && vm.runInContext('validatedAccount', ctx) === '40123456');
  ctx.setEntryMode('document');
  input.value = '1799999999';
  await ctx.lookupByDocumentFlow();
  const fb = vm.runInContext('confirmAccountFeedback', ctx);
  check('0 matches: no confirma nada y avisa', fb.textContent.includes('No hay cuentas')
    && vm.runInContext('validatedAccount', ctx) === null);
  ctx.setEntryMode('account');
  input.value = '';
  ctx.invalidateAccountCache();
  console.warn = origWarn;
}

console.log('\n== Speedtest con dispositivo externo (simulado) ==');
{
  const html = ctx.externalSpeedtestHtml();
  check('flujo externo: HTML balanceado', balanced(html) === null, balanced(html));
  check('flujo externo: badge "Simulado" y botón "Conectar dispositivo de medición"',
    html.includes('class="sim-badge"') && html.includes('Simulado') && html.includes('Conectar dispositivo de medición'));
  check('flujo externo: sin selector de servidores ni botón de speedtest nativo',
    !/servidor/i.test(html) && !html.includes('run-speedtest') && !html.includes('data-tool="speedtest"'));
  check('flujo externo: progreso accesible y resultados anunciados',
    html.includes('role="progressbar"') && html.includes('aria-live="polite"'));
  const item = vm.runInContext('HERRAMIENTAS_ITEMS.find((x) => x.id === "speedtest")', ctx);
  check('Herramientas: el ítem de velocidad usa el flujo externo y no el guardado genérico',
    item && item.render === ctx.externalSpeedtestHtml && item.wire === ctx.wireExternalSpeedtest && !item.save);

  const plan = { downMbps: 500, upMbps: 250 };
  const seq = [0, 0.999];
  const bajo = ctx._extSpeedSimulatedResult(plan, () => seq[0]);
  const alto = ctx._extSpeedSimulatedResult(plan, () => seq[1]);
  check('resultado simulado realista: plan ± variación, LAN de baja latencia, enlace 10 Gb/s',
    bajo.downloadMbps >= 465 && alto.downloadMbps <= 515 && bajo.uploadMbps >= 230 && alto.uploadMbps <= 255
    && bajo.latencyMs >= 2.5 && alto.latencyMs <= 8.5 && alto.jitterMs <= 1.8
    && bajo.packetLossPercent === 0 && bajo.linkSpeedMbps === 10000,
    JSON.stringify({ bajo, alto }));

  const device = vm.runInContext('EXT_SPEED_SIM_DEVICE', ctx);
  const payload = ctx.buildExternalSpeedtestPayload(bajo, device, { taskId: 'TASK/123456/2026', simulated: true, planKnown: true });
  check('payload: campos propios del contrato (source, simulated, deviceName/deviceId, taskId, measuredAt)',
    payload.source === 'external-device' && payload.simulated === true
    && payload.deviceName === 'Medidor Xtrim 10G' && payload.deviceId === device.deviceId
    && payload.taskId === 'TASK/123456/2026' && payload.measuredAt === bajo.measuredAt
    && payload.downloadMbps === bajo.downloadMbps && payload.uploadMbps === bajo.uploadMbps);
  check('payload: sin campos fuera del contrato ni marca metida en serverName; notes legible',
    !('serverName' in payload) && !('serverId' in payload) && !('linkSpeedMbps' in payload) && !('deviceModel' in payload)
    && payload.notes.includes('Medidor Xtrim 10G') && payload.notes.includes('10 Gb/s'));
  check('payload: bajada/subida topadas a 10000 Mbps',
    ctx.buildExternalSpeedtestPayload(Object.assign({}, bajo, { downloadMbps: 12000 }), device, {}).downloadMbps === 10000);
  const sinTarea = ctx.buildExternalSpeedtestPayload(bajo, device, { taskId: null });
  check('payload sin tarea: no inventa taskId', !('taskId' in sinTarea) && !sinTarea.notes.includes('tarea'));
  const guardado = await WifixAPI.createSpeedtest('35070291', payload);
  check('se guarda con el mecanismo existente (createSpeedtest) conservando la marca',
    guardado.accountNumber === '35070291' && guardado.simulated === true && guardado.source === 'external-device'
    && guardado.measuredAt === bajo.measuredAt);
  const t0 = Date.now();
  const medido = await vm.runInContext('extSpeedDriver', ctx).measure({ plan, onProgress: () => {} });
  check('driver simulado: mide y devuelve el contrato del dispositivo',
    medido.downloadMbps > 0 && medido.uploadMbps > 0 && typeof medido.measuredAt === 'string' && Date.now() - t0 < 10000);
}

console.log('\n== Red Interna: módulos medidos (mock de navegador) ==');
{
  // Contexto propio con native.js (modo navegador → wrappers con datos
  // simulados), además de api.js y app.js.
  const rc = {
    console: { log() {}, info() {}, warn() {}, error() {} },
    setTimeout, clearTimeout,
    fetch: async () => { throw new Error('sin red en el smoke test'); },
    CSS: { escape: (s) => String(s) }, URL, navigator: { userAgent: 'node' }, alert() {},
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    MutationObserver: class { observe() {} disconnect() {} },
    localStorage: windowStub.localStorage,
    document: Object.assign({}, documentStub, { readyState: 'complete', body: fakeEl() }),
    addEventListener() {}, dispatchEvent() {}, location: windowStub.location,
  };
  rc.window = rc; rc.globalThis = rc; rc.self = rc;
  vm.createContext(rc);
  for (const file of ['api.js', 'native.js', 'app.js']) {
    vm.runInContext(readFileSync(base + file, 'utf8'), rc, { filename: file });
  }
  rc.WifixAPI.useRealApi = false;

  // --- Lógica pura portada (datos de demo.js de Wifix Remote) ---------------
  check('bandas y canales 2.4/5 GHz como el origen',
    rc.bandFromFrequency(2437) === '2.4GHz' && rc.channelFromFrequency(2437) === 6 && rc.channelFromFrequency(2484) === 14
    && rc.bandFromFrequency(5180) === '5GHz' && rc.channelFromFrequency(5180) === 36 && rc.channelFromFrequency(5885) === 177);
  check('6 GHz soportado (corrección consciente del origen)',
    rc.bandFromFrequency(6115) === '6GHz' && rc.channelFromFrequency(6115) === 33 && rc.channelFromFrequency(5935) === 2);
  const crowded = rc.computeChannelSaturation({ frequencyMhz: 2437, bssid: 'own', channelWidthMhz: 20 },
    [2437, 2437, 2442, 2412, 2462, 2432, 5180].map((f, i) => ({ frequencyMhz: f, bssid: 'b' + i, channelWidthMhz: 20 })));
  check('saturación: mismo canal ×2 + solapadas, otras bandas fuera, sugeridos sin el propio',
    crowded.sameChannelCount === 2 && crowded.overlappingCount === 4 && crowded.levelClass === 'bad'
    && crowded.levelLabel === 'Alta' && JSON.stringify(crowded.suggested) === '[1,11]' && crowded.perChannel[6] === 2,
    JSON.stringify(crowded));
  check('saturación sin frecuencia propia → error del origen',
    rc.computeChannelSaturation({}, []).error === 'No se pudo determinar la frecuencia de su red.');
  const norm = rc.normalizeWifis([
    { ssid: 'Casa', bssid: 'a', signalDbm: -70, frequencyMhz: 5180 },
    { ssid: 'Casa', bssid: 'b', signalDbm: -50, frequencyMhz: 5180, isConnected: false },
    { ssid: 'Casa', bssid: 'c', signalDbm: -60, frequencyMhz: 2412, isConnected: true },
    { ssid: '', bssid: 'd', signalDbm: -40, frequencyMhz: 2412 },
    { ssid: '\\x00', bssid: 'e', signalDbm: -40, frequencyMhz: 2412 },
  ]);
  check('normalizeWifis: SSID|banda, mayor señal, ocultos fuera, orden por señal',
    norm.length === 2 && norm[0].bssid === 'b' && norm[0].bssidCount === 2 && norm[1].band === '2.4GHz' && norm[1].anyConnected === true);
  check('seguridad desde capabilities (WPA3/WPA2/WPA/WEP/Abierta + WPS)',
    ['[RSN-SAE-CCMP][ESS]', '[WPA2-PSK-CCMP][ESS][WPS]', '[WPA-PSK-TKIP]', '[WEP]', '[ESS]']
      .map((x) => rc.wifiSecurity(x).label).join() === 'WPA3,WPA2,WPA,WEP,Abierta' && rc.wifiSecurity('[WPS]').wps === true);
  const st = rc.statsFromRtts([10, 12, 14], 5);
  check('statsFromRtts: forma stat del origen (pérdida, jitter poblacional, redondeo 0.1)',
    st.avg === 12 && st.time === 12 && st.min === 10 && st.max === 14 && st.packetLoss === 40 && st.stddev === 1.6
    && st.sent === 5 && st.received === 3 && st.samples.length === 3);
  check('latencia: umbrales 30/80 ms',
    rc.latencyLevel(30).cls === 'good' && rc.latencyLevel(80).cls === 'warn' && rc.latencyLevel(80.1).cls === 'bad'
    && rc.latencyLevel(null).cls === 'bad');
  check('tipos: nombre, puertos, banner y fabricante (literal del origen)',
    rc.guessDeviceType('B866V2M-XTRIM') === 'Router' && rc.typeFromName('65" QLED') === 'AndroidTV'
    && rc.guessTypeByPorts([9100, 445]) === 'Impresora' && rc.guessTypeByBanner({ server: 'GoAhead-Webs' }) === 'Router'
    && rc.nameFromBanner({ title: '401 Unauthorized' }) === null && rc.typeFromVendor('Hikvision') === 'Cámara');
  check('fabricante solo con MAC real y sin bit local (MAC aleatoria → null)',
    rc.vendorFromMac('00:1b:21:aa:bb:cc') === 'Intel Corporate' && rc.vendorFromMac('02:00:00:00:00:00') === null
    && rc.vendorFromMac('da:a1:19:00:00:01') === null);
  const merged = rc.mergeDiscovery([{ ip: '192.168.1.5', name: null, deviceType: 'PC' }],
    { '192.168.1.5': { name: 'Sala TV', type: 'AndroidTV' }, '192.168.1.9': { name: 'localhost', type: null }, '10.0.0.2': { name: 'X' } },
    '192.168.1.20');
  check('mergeDiscovery: nombre si falta, tipo de discover pisa, solo-discover de la /24, nombres basura fuera',
    merged.length === 2 && merged[0].name === 'Sala TV' && merged[0].deviceType === 'AndroidTV' && merged[1].ip === '192.168.1.9'
    && merged[1].name === null);

  // --- UI: cuerpo de acordeón con slots persistentes ------------------------
  function riBody() {
    const slots = {};
    const btn = fakeEl();
    let onClick = null;
    btn.addEventListener = (ev, fn) => { if (ev === 'click') onClick = fn; };
    btn.disabled = false;
    return {
      slots, btn, click: () => onClick && onClick(),
      querySelector(sel) {
        if (sel === '[data-action="ri-run"]') return btn;
        const m = /data-slot="([^"]+)"/.exec(sel);
        if (m) { slots[m[1]] = slots[m[1]] || fakeEl(); return slots[m[1]]; }
        return fakeEl();
      },
    };
  }
  vm.runInContext("accountInput.value = '35070291'", rc);
  rc.openRedInterna();
  const redHtml = vm.runInContext('redList.innerHTML', rc);
  const posMed = redHtml.indexOf('Saturación de canal');
  const posMock = redHtml.indexOf('mock-notice');
  check('Red Interna: 4 módulos medidos arriba, en orden, y el aviso simulado debajo de ellos',
    posMed > -1 && posMed < redHtml.indexOf('Dispositivos conectados') && redHtml.indexOf('Dispositivos conectados') < redHtml.indexOf('Redes cercanas')
    && redHtml.indexOf('Redes cercanas') < redHtml.indexOf('>Latencia<') && redHtml.indexOf('>Latencia<') < posMock
    && posMock < redHtml.indexOf('Cambiar SSID y contraseña'));
  check('Red Interna: el ítem simulado "Equipos en la red local (DHCP)" ya no está; los demás siguen',
    !redHtml.includes('Equipos en la red local') && redHtml.includes('Dispositivos WiFi por banda') && redHtml.includes('aria-expanded="false"'));
  check('Red Interna: HTML balanceado', balanced(redHtml) === null, balanced(redHtml));

  const satBody = riBody();
  const sh = rc.riShellHtml('sat');
  check('shell del módulo: progreso accesible (aria-live + progressbar) y botón con texto',
    sh.includes('aria-live="polite"') && sh.includes('role="progressbar"') && sh.includes('Escanear canales') && balanced(sh) === null);
  let scans = 0;
  const realScan = rc.WifixNative.scanNetworks;
  rc.WifixNative.scanNetworks = async () => { scans++; return realScan(); };
  await rc.riMount('sat', satBody);
  const satHtml = satBody.slots.result.innerHTML;
  check('Saturación (mock): nivel, canal, KPIs, barras SVG con canal propio y sugeridos',
    satHtml.includes('Saturación media') && satHtml.includes('status-tile warn') && satHtml.includes('ri-bar own')
    && satHtml.includes('ri-chip') && satHtml.includes('role="img"') && satHtml.includes('mock-notice') && balanced(satHtml) === null,
    balanced(satHtml));

  const nearBody = riBody();
  await rc.riMount('nearby', nearBody);
  const nearHtml = nearBody.slots.result.innerHTML;
  check('Saturación y Redes cercanas comparten UN solo escaneo', scans === 1, `escaneos: ${scans}`);
  check('Redes cercanas (mock): agrupadas por banda, RSSI clasificado, seguridad, conectado, toggle accesible',
    nearHtml.includes('2.4 GHz') && nearHtml.includes('6 GHz') && nearHtml.includes('ap-rssi rssi-') && nearHtml.includes('WPA3')
    && nearHtml.includes('Conectado') && nearHtml.includes('aria-pressed="true"') && !nearHtml.includes('(red oculta)')
    && balanced(nearHtml) === null, balanced(nearHtml));
  vm.runInContext("_riState.nearbyMode = 'all'", rc);
  vm.runInContext("riRender('nearby')", rc);
  check('Redes cercanas: "Ver todos los BSSID" muestra cada BSSID (incluye la oculta)',
    nearBody.slots.result.innerHTML.includes('(red oculta)') && nearBody.slots.result.innerHTML.includes('12</strong> BSSID'));
  vm.runInContext("_riState.nearbyMode = 'grouped'", rc);

  // fromCache y escaneo vacío → avisos.
  rc.WifixNative.scanNetworks = async () => ({ simulated: true, fromCache: true, accessPoints: [] });
  satBody.click();
  await vm.runInContext('_riState.running.sat', rc);
  const satCache = satBody.slots.result.innerHTML;
  check('aviso de caché (4 escaneos / 2 min) y de ubicación apagada con scan vacío',
    satCache.includes('4 escaneos cada 2 minutos') && satCache.includes('ubicación del sistema está apagada'));
  check('re-escaneo de Saturación actualiza Redes cercanas con el mismo scan',
    nearBody.slots.result.innerHTML.includes('ubicación del sistema está apagada'));
  rc.WifixNative.scanNetworks = realScan;

  const devBody = riBody();
  const progresos = [];
  const realSweep = rc.WifixNative.sweepSubnet;
  rc.WifixNative.sweepSubnet = (o, cb) => realSweep(o, (p) => { progresos.push(p); cb(p); });
  await rc.riMount('devices', devBody);
  rc.WifixNative.sweepSubnet = realSweep;
  const devHtml = devBody.slots.result.innerHTML;
  check('Dispositivos: progreso del barrido (lanProgress) llega a la UI',
    progresos.length > 3 && progresos[progresos.length - 1].done === 254);
  check('Dispositivos (mock): Router primero, iconos por tipo, IP mono, fabricante/MAC, pastilla RTT, aviso de MAC',
    devHtml.indexOf('B866V2M-XTRIM') < devHtml.indexOf('DESKTOP-DEMO') && devHtml.includes('ri-dev-icon')
    && devHtml.includes('ri-ip') && devHtml.includes('Intel Corporate') && devHtml.includes('MAC 00:1B:21')
    && devHtml.includes('ri-pill ri-good') && devHtml.includes('Android 10') && devHtml.includes('Chromecast Sala')
    && !devHtml.includes('otra subred') && devHtml.includes('Este teléfono') && balanced(devHtml) === null, balanced(devHtml));

  const latBody = riBody();
  await rc.riMount('latency', latBody);
  const latHtml = latBody.slots.result.innerHTML;
  check('Latencia (mock): tiles Router/Google/ISP + Internet, min/máx/jitter/pérdida y gráfico de muestras',
    latHtml.includes('>Router<') && latHtml.includes('>Google<') && latHtml.includes('>ISP<') && latHtml.includes('Internet (HTTP)')
    && latHtml.includes('jitter') && latHtml.includes('pérdida') && latHtml.includes('chart-svg') && balanced(latHtml) === null,
    balanced(latHtml));
  check('Latencia simulada: no ofrece guardar en la visita', !latHtml.includes('ri-save-latency') && latHtml.includes('no se guardan'));

  // Fallback ICMP → TCP cuando el ICMP pierde el 100 %.
  const realIcmp = rc.WifixNative.icmpPing;
  rc.WifixNative.icmpPing = async (host, o) => ({ transmitted: o.count, received: 0, samples: [] });
  const fb = await rc.measureLatencyTarget('192.168.1.1', { icmpCount: 5, tcpPorts: [80, 443, 8080, 53, 22], tcpCount: 5, tcpTimeoutMs: 1500 });
  rc.WifixNative.icmpPing = realIcmp;
  check('ICMP sin respuesta → TCP-ping con el puerto que respondió', fb.method === 'TCP' && fb.port === 80 && fb.stat.avg > 0);

  const res = await rc.runLatencyTest(() => {});
  const pls = rc.buildLatencyPingPayloads(res);
  check('payload de latencia = PingTestInput (un registro por destino, sin nulls)',
    pls.length === 3 && pls.every((p) => p.target && p.packetsSent >= p.packetsReceived && p.notes.startsWith('Red Interna')
      && Object.values(p).every((v) => v !== null && v !== undefined)));
  const guardado = await rc.WifixAPI.createPingTest('35070291', pls[0]);
  check('se guarda con el mecanismo existente (createPingTest)', guardado.accountNumber === '35070291' && guardado.target === pls[0].target);

  // Reabrir Red Interna con la misma cuenta reutiliza el resultado reciente.
  let barridos = 0;
  rc.WifixNative.sweepSubnet = async () => { barridos++; return { alive: [] }; };
  const devBody2 = riBody();
  await rc.riMount('devices', devBody2);
  check('reabrir: reutiliza el resultado reciente sin volver a barrer la red',
    barridos === 0 && devBody2.slots.result.innerHTML.includes('B866V2M-XTRIM'));
  rc.WifixNative.sweepSubnet = realSweep;

  // Error de red (sin WiFi) → estado de error, no excepción.
  const realNet = rc.WifixNative.getNetConfig;
  rc.WifixNative.getNetConfig = async () => { throw new Error('No hay conexión WiFi activa: conéctese a la red del cliente y reintente.'); };
  devBody2.click();
  await vm.runInContext('_riState.running.devices', rc);
  rc.WifixNative.getNetConfig = realNet;
  check('sin WiFi: estado de error con el mensaje del plugin',
    devBody2.slots.result.innerHTML.includes('detail-error') && devBody2.slots.result.innerHTML.includes('No hay conexión WiFi activa'));
}

console.log('\n== Red Interna: wrappers nativos (plugin NetworkTools falso) ==');
{
  const llamadas = [];
  const listeners = {};
  const removidos = [];
  const plugin = {
    async getNetConfig() { llamadas.push(['getNetConfig']); return { deviceIp: '10.1.1.5', gatewayIp: '10.1.1.1', prefixLength: 24, netmask: '255.255.255.0', dns: [], interfaceName: 'wlan0', source: 'LinkProperties' }; },
    async tcpPing(o) { llamadas.push(['tcpPing', o]); return { avg: 4, min: 3, max: 5, time: 4, packetLoss: 0, stddev: 0.5, sent: 5, received: 5, samples: [3, 4, 5, 4, 4], stat: { avg: 4 }, respondsTcp: true, openPort: 443, openPorts: [443], host: o.host }; },
    async sweepSubnet(o) {
      llamadas.push(['sweepSubnet', o]);
      (listeners.lanProgress || []).forEach((fn) => fn({ phase: 'sweep', done: 128, total: 254 }));
      return { alive: [{ ip: '10.1.1.1', rttMs: 1.2, openPorts: [80], respondsTcp: true }], subnet: '10.1.1.0/24', durationMs: 9000 };
    },
    async probeHosts(o) {
      llamadas.push(['probeHosts', o]);
      (listeners.lanProgress || []).forEach((fn) => fn({ phase: 'probe', done: 1, total: 1 }));
      return { results: [{ ip: '10.1.1.1', openPorts: [80], respondsTcp: true, stat: { avg: 1.5 }, mdnsName: null, netbiosName: null, netbiosMac: null, ptrName: null, banner: null }] };
    },
    async discoverNetwork(o) { llamadas.push(['discoverNetwork', o]); return { '10.1.1.7': { name: 'Sala', type: 'Chromecast', source: 'mdns', manufacturer: null, model: null } }; },
    async addListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); return { remove: async () => { removidos.push(ev); } }; },
  };
  const c = {
    console: { log() {}, info() {}, warn() {}, error() {} },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    navigator: { userAgent: 'node' },
    document: { readyState: 'complete', body: { querySelectorAll: () => [] }, addEventListener() {}, createElement: () => fakeEl() },
    MutationObserver: class { observe() {} disconnect() {} },
    addEventListener() {},
    Capacitor: { isNativePlatform: () => true, Plugins: { NetworkTools: plugin } },
  };
  c.window = c; c.globalThis = c;
  vm.createContext(c);
  vm.runInContext(readFileSync(base + 'native.js', 'utf8'), c, { filename: 'native.js' });
  const N = c.WifixNative;
  check('APK: netSimulated() es false con el plugin presente', N.netSimulated() === false);
  const nc = await N.getNetConfig();
  check('APK: getNetConfig va al plugin (sin marca simulated)', nc.gatewayIp === '10.1.1.1' && !nc.simulated);
  const progreso = [];
  const sw = await N.sweepSubnet({}, (p) => progreso.push(p));
  const swArgs = llamadas.find((l) => l[0] === 'sweepSubnet')[1];
  check('APK: sweepSubnet con los defaults del contrato y lanProgress reenviado; listener retirado',
    sw.alive.length === 1 && swArgs.timeoutMs === 600 && swArgs.batchSize === 32 && swArgs.ports.includes(62078)
    && progreso.length === 1 && progreso[0].done === 128 && removidos.includes('lanProgress'));
  const pr = await N.probeHosts(['10.1.1.1'], '10.1.1.1', () => {});
  check('APK: probeHosts desenvuelve {results:[...]} y manda gatewayIp',
    Array.isArray(pr) && pr.length === 1 && llamadas.find((l) => l[0] === 'probeHosts')[1].gatewayIp === '10.1.1.1');
  const tp = await N.tcpPing('8.8.8.8', { ports: [443], count: 6, timeoutMs: 2000 });
  check('APK: tcpPing pasa {host, ports, count, timeoutMs} y conserva stat + openPort',
    tp.avg === 4 && tp.openPort === 443 && JSON.stringify(llamadas.find((l) => l[0] === 'tcpPing')[1]) === JSON.stringify({ host: '8.8.8.8', ports: [443], count: 6, timeoutMs: 2000 }));
  const disc = await N.discoverNetwork();
  check('APK: discoverNetwork con mdnsMs/ssdpMs 6000 y mapa por IP',
    disc['10.1.1.7'].type === 'Chromecast' && llamadas.find((l) => l[0] === 'discoverNetwork')[1].mdnsMs === 6000);
  let msg = '';
  try { await N.scanNetworks(); } catch (e) { msg = e.message; }
  check('APK anterior al contrato: método ausente → mensaje para actualizar la app', /no incluye "scanAccessPoints"/.test(msg), msg);
}

console.log('\n== Equipo a instalar: validación de capacidad vs plan ==');
{
  const run = (code) => vm.runInContext(code, ctx);
  const A = ctx.WifixAPI;
  A.useRealApi = false;

  // --- index.html: tarjeta, pantalla y banner ---------------------------------
  const html = readFileSync(base + 'index.html', 'utf8');
  check('index.html: tarjeta "Equipo a instalar" con slot de estado',
    html.includes('data-sub="equipo"') && html.includes('data-slot="equipo-status"'));
  check('index.html: pantalla detailEquipo con chip y cuerpo',
    html.includes('id="detailEquipo"') && html.includes('id="equipoChip"') && html.includes('id="equipoBody"'));
  check('index.html: banner de bloqueo con role="alert"',
    /id="deviceBlockBanner" role="alert"/.test(html));

  // --- Catálogo mock = 19 modelos Moderno del Excel ---------------------------
  const cat = (await A.getDeviceCatalog()).items;
  const byModel = Object.fromEntries(cat.map((d) => [d.model, d]));
  check('catálogo mock: 19 modelos, ningún Obsoleto (Linksys/Netgear/TRENDnet...)',
    cat.length === 19 && !cat.some((d) => /LINKSYS|NETGEAR|TRENDNET|SAGEMCOM|TOTO|TL-WR741ND/i.test(d.model)));
  const keys = ['model', 'displayName', 'brand', 'deviceType', 'category', 'wifiTech', 'ethernetMaxMbps', 'wifiMaxMbps', 'wifiStatus', 'serialPrefixes'];
  check('catálogo mock: forma exacta del contrato',
    cat.every((d) => JSON.stringify(Object.keys(d).sort()) === JSON.stringify(keys.slice().sort()) && Array.isArray(d.serialPrefixes)));
  check('catálogo mock: N/A → none/null, "300 DESACTIVADO" → disabled/300, numérico → enabled',
    byModel['ONT HUR 2001'].wifiStatus === 'none' && byModel['ONT HUR 2001'].wifiMaxMbps === null
    && byModel['ZXHN F660'].wifiStatus === 'disabled' && byModel['ZXHN F660'].wifiMaxMbps === 300
    && byModel['ZXHN F670L'].wifiStatus === 'enabled' && byModel['ZXHN F670L'].wifiMaxMbps === 500);
  check('catálogo mock: XGS-PON F8605P 2500/1800 y display del Excel',
    byModel['ONT ZTE XGS-PON ZXHN F8605P'].ethernetMaxMbps === 2500 && byModel['ONT ZTE XGS-PON ZXHN F8605P'].wifiMaxMbps === 1800
    && byModel['ONT ZTE XGS-PON ZXHN F8605P'].displayName === 'ONT XGS-PON ZXHN F8605P');
  check('catálogo mock: prefijos ZTEG/ZTEL/HWTC/BWH/STGU/XPON',
    byModel['ZXHN F601'].serialPrefixes[0] === 'ZTEG' && byModel['ROUTER ZXHN H3601P V9 WIFI 6'].serialPrefixes[0] === 'ZTEL'
    && byModel['ONT OptiXstar HG8145X6'].serialPrefixes[0] === 'HWTC' && byModel['AX3 QUAD CORE WIFI 6'].serialPrefixes[0] === 'BWH'
    && byModel['ONU300G-1G'].serialPrefixes[0] === 'STGU' && byModel['ONU Bridge TXG-B2000'].serialPrefixes[0] === 'XPON');

  // --- Regla pura ----------------------------------------------------------------
  const ev = (m, plan) => ctx.evaluateDeviceCapacity(m ? byModel[m] : null, plan);
  check('regla: F670L con 200 → ok', ev('ZXHN F670L', 200).result === 'ok');
  check('regla: F670L con 600 → blocked solo por WiFi (500 < 600)', (() => {
    const r = ev('ZXHN F670L', 600);
    return r.result === 'blocked' && r.reasons.length === 1 && r.reasons[0].kind === 'wifi'
      && r.reasons[0].deviceMbps === 500 && r.reasons[0].planMbps === 600;
  })());
  check('regla: F670L con 1500 → ethernet Y wifi', (() => {
    const r = ev('ZXHN F670L', 1500);
    return r.result === 'blocked' && r.reasons.map((x) => x.kind).join() === 'ethernet,wifi';
  })());
  check('regla: powerline con 200 → blocked por Ethernet (100), WiFi 300 no bloquea', (() => {
    const r = ev('POWER LINE TP-LINK TLWPA4220 STARTER KIT', 200);
    return r.result === 'blocked' && r.reasons.length === 1 && r.reasons[0].kind === 'ethernet' && r.reasons[0].deviceMbps === 100;
  })());
  check('regla: WiFi none/disabled solo evalúa Ethernet (HUR 2001 y F660 con 600 → ok)',
    ev('ONT HUR 2001', 600).result === 'ok' && ev('ZXHN F660', 600).result === 'ok');
  check('regla: fuera de catálogo → blocked not_in_catalog (aunque no haya plan)',
    ev(null, 200).reasons[0].kind === 'not_in_catalog' && ev(null, null).result === 'blocked');
  check('regla: sin plan → unknown_plan', ev('ZXHN F670L', null).result === 'unknown_plan' && ev('ZXHN F670L', 0).result === 'unknown_plan');
  check('regla: XGS-PON con 1500 → ok', ev('ONT ZTE XGS-PON ZXHN F8605P', 1500).result === 'ok');

  // --- Serial, marca y modelo ---------------------------------------------------
  const pre = (lines) => ctx.devPreselectModel(ctx.devMatchModelsFromText(lines, cat));
  check('OCR "ZXHN F670L" preselecciona F670L (no F670Y)', pre(['ZTE', 'ZXHN F670L', 'GPON SN: ZTEGD0BB8294']) === 'ZXHN F670L');
  check('OCR "HG8145X6" preselecciona la OptiXstar', pre(['HUAWEI', 'OptiXstar HG8145X6']) === 'ONT OptiXstar HG8145X6');
  check('OCR "F8605P" preselecciona el XGS-PON', pre(['ZXHN F8605P', 'XGS-PON']) === 'ONT ZTE XGS-PON ZXHN F8605P');
  check('OCR "ZXHN F6600P" gana F6600P sobre F6600 y F660', pre(['ZXHN F6600P']) === 'ONT ZTE ZXHN F6600P');
  check('OCR "ZXHN F660" no confunde con F6600', pre(['Model: ZXHN F660']) === 'ZXHN F660');
  check('OCR "AX3" ambiguo (dual/quad) → sin preselección', pre(['HUAWEI WiFi AX3']) === null);
  check('OCR sin modelo → sin preselección', pre(['GPON SN: ZTEGD0BB8294', 'MAC 001122334455']) === null);
  const pk = ctx.devPickSerial(['ZXHN F670L', 'GPON SN: ZTEGD0BB8294', 'D-SN: ZTE0QH8M1234567'], cat);
  check('serial: elige el GPON SN con prefijo del catálogo, no el nombre del modelo',
    pk.serial === 'ZTEGD0BB8294' && pk.confidence === 'ok', JSON.stringify(pk));
  check('serial: Huawei en hex (48575443…) se reconoce como HWTC',
    ctx.devSerialPrefix('48575443A1B2C3D4', cat) === 'HWTC');
  check('serial: sin prefijo conocido → mejor esfuerzo marcado para verificar',
    ctx.devPickSerial(['SN: 9X81QW77'], cat).confidence === 'warn');
  check('serial: nada legible → vacío', ctx.devPickSerial([], cat).serial === '');
  check('lista corta: ZTEG → 10 ONT ZTE; STGU → 3; ZTEL → router ZTE',
    ctx.devShortlist(cat, 'ZTEGD0BB8294', []).length === 10
    && ctx.devShortlist(cat, 'STGU12345678', []).length === 3
    && ctx.devShortlist(cat, 'ZTEL1234567890AB', []).map((d) => d.model).join() === 'ROUTER ZXHN H3601P V9 WIFI 6');
  check('lista corta: lo leído en la etiqueta va primero',
    ctx.devShortlist(cat, 'ZTEGD0BB8294', ctx.devMatchModelsFromText(['ZXHN F670L'], cat))[0].model === 'ZXHN F670L');
  check('lista corta: serial sin marca → vacía (la UI muestra todos)', ctx.devShortlist(cat, 'ABCD1234', []).length === 0);

  // --- Flujo con el mock: POST + veredicto + bloqueo ----------------------------
  ctx.selectModule('instalaciones');
  async function validate(account, model, extra = {}) {
    const dev = run(`devNewDraft(${JSON.stringify(account)}, currentCategory, null)`);
    dev.catalog = cat;
    const profile = await A.getClientProfile(account);
    dev.plan = Object.assign(ctx.devPlanFromProfile(profile), { loading: false, error: null });
    dev.serial = extra.serial || 'ZTEGD0BB8294';
    dev.serialSource = 'barcode';
    dev.model = model;
    if (extra.otherModel) dev.otherModel = extra.otherModel;
    const v = await ctx.devSubmitValidation(dev);
    return { dev, v };
  }
  const ok = await validate('35070291', 'ZXHN F670L');
  const vOk = ok.v;
  const contractKeys = ['id', 'result', 'planMbps', 'planSource', 'device', 'reasons', 'message', 'createdAt'];
  check('mock ok: forma del contrato (201) con plan simulado de 200',
    vOk && contractKeys.every((k) => k in vOk) && vOk.result === 'ok' && vOk.planMbps === 200 && vOk.planSource === 'simulated'
    && vOk.device.model === 'ZXHN F670L' && vOk.reasons.length === 0 && typeof vOk.message === 'string', JSON.stringify(vOk));
  check('mock ok: el POST lleva el taskId de la visita en curso y serialSource', vOk.taskId && vOk.serialSource === 'barcode');
  check('ok: módulo completado y la guardia no bloquea', ctx.devStateFor('35070291').status === 'ok' && ctx.deviceRecordGuard('35070291') === null);
  const okHtml = ctx.devScreenHtml(ok.dev);
  check('ok: tarjeta verde "módulo completado" con aria (role=status) y HTML balanceado',
    okHtml.includes('dev-verdict is-ok') && okHtml.includes('role="status"') && okHtml.includes('módulo completado')
    && okHtml.includes('aria-live="polite"') && balanced(okHtml) === null, balanced(okHtml));

  const wifi = await validate('40000600', 'ZXHN F670L');
  check('mock blocked wifi: plan 600, razón wifi 500, mensaje del contrato con "600 Mbps"',
    wifi.v.result === 'blocked' && wifi.v.reasons.length === 1 && wifi.v.reasons[0].kind === 'wifi'
    && wifi.v.reasons[0].deviceMbps === 500 && wifi.v.message.startsWith('Advertencia: el dispositivo que usted está instalando no es el correcto')
    && wifi.v.message.includes('(600 Mbps)'), JSON.stringify(wifi.v));

  const eth = await validate('35070291', 'POWER LINE TP-LINK TLWPA4220 STARTER KIT', { serial: 'TPLK12345678' });
  check('mock blocked ethernet: powerline 100 < 200',
    eth.v.result === 'blocked' && eth.v.reasons.map((r) => r.kind).join() === 'ethernet' && eth.v.reasons[0].deviceMbps === 100);

  // Bloqueo REAL: con la cuenta bloqueada no se guarda ningún registro de la visita.
  const msgOf = async (p) => { try { await p; return null; } catch (e) { return e; } };
  const e1 = await msgOf(A.createSpeedtest('35070291', { downloadMbps: 100, uploadMbps: 50 }));
  const e2 = await msgOf(A.createRetiredEquipment('35070291', { serialValue: 'X', equipmentModelId: 'em-01', removalReasonCode: 'DANO_FISICO' }));
  const e3 = await msgOf(A.createClientLocation('35070291', { latitude: -2.2, longitude: -79.9, label: 'CASA_CLIENTE', source: 'GPS' }));
  const e4 = await msgOf(A.createPingTest('35070291', { target: '8.8.8.8' }));
  const e5 = await msgOf(A.createWifiHeatmap('35070291', { rooms: [] }));
  check('bloqueo: speedtest, retiro, casa cliente, ping y señal WiFi rechazados con DEVICE_BLOCKED',
    [e1, e2, e3, e4, e5].every((e) => e && e.code === 'DEVICE_BLOCKED' && e.message === run('DEVICE_BLOCK_GUARD_MSG')),
    [e1, e2, e3, e4, e5].map((e) => e && e.code).join());
  check('bloqueo: otra cuenta sin validar no se bloquea',
    (await msgOf(A.createSpeedtest('40123456', { downloadMbps: 1, uploadMbps: 1 }))) === null);
  ctx.selectModule('cancelaciones');
  check('bloqueo: en Cancelaciones (sin equipo a instalar) no aplica', ctx.deviceRecordGuard('35070291') === null);
  ctx.selectModule('migraciones');
  check('bloqueo: es por categoría (Migraciones de la misma cuenta no hereda el de Instalaciones)', ctx.deviceRecordGuard('35070291') === null);
  ctx.selectModule('instalaciones');
  check('bloqueo: al volver a Instalaciones sigue bloqueado', ctx.deviceRecordGuard('35070291') !== null);

  const blkHtml = ctx.devScreenHtml(eth.dev);
  check('bloqueado: alerta roja (role=alert) con el mensaje del servidor',
    blkHtml.includes('dev-verdict is-blocked') && blkHtml.includes('role="alert"') && blkHtml.includes(ctx.escapeHtml(eth.v.message)));
  check('bloqueado: única acción "Escanear otro equipo" (sin validar/guardar ni inputs)',
    (blkHtml.match(/data-action="/g) || []).length === 1 && blkHtml.includes('data-action="dev-rescan"')
    && blkHtml.includes('Escanear otro equipo') && !blkHtml.includes('dev-validate') && !blkHtml.includes('data-field="devSerial"'));
  check('bloqueado: tiles plan vs equipo (Ethernet en rojo) y HTML balanceado',
    blkHtml.includes('status-tile fail') && blkHtml.includes('Plan contratado') && balanced(blkHtml) === null, balanced(blkHtml));

  // Banner del menú de la categoría.
  const banner = fakeEl();
  const realGet = documentStub.getElementById;
  documentStub.getElementById = (id) => (id === 'deviceBlockBanner' ? banner : realGet(id));
  run("validatedAccount = '35070291'");
  ctx.devRefreshIndicators();
  check('bloqueado: banner visible en el menú de la categoría con acceso al módulo',
    banner.hidden === false && banner.innerHTML.includes('Flujo bloqueado') && banner.innerHTML.includes('data-action="open-equipo"'));

  // "Escanear otro equipo": el formulario vuelve, pero el bloqueo sigue hasta un ok.
  eth.dev.rescanning = true;
  const rescanHtml = ctx.devScreenHtml(eth.dev);
  check('reescaneo: formulario con aviso de bloqueo vigente y la guardia sigue activa',
    rescanHtml.includes('dev-still-blocked') && rescanHtml.includes('data-field="devSerial"') && ctx.deviceRecordGuard('35070291') !== null
    && balanced(rescanHtml) === null, balanced(rescanHtml));

  // Reabrir la app / reconfirmar: el bloqueo vuelve desde el historial del servidor.
  run('_devStates.clear()');
  check('sin estado local la guardia no bloquea (antes de sincronizar)', ctx.deviceRecordGuard('35070291') === null);
  await ctx.devSyncFromServer('35070291', 'instalaciones');
  check('sincronización: el último veredicto del servidor (blocked) se restaura', ctx.devStateFor('35070291').status === 'blocked');

  // Un equipo apto desbloquea.
  const fix = await validate('35070291', 'ONT ZTE ZXHN F6600P');
  ctx.devRefreshIndicators();
  check('equipo apto después del bloqueo → ok, guardia libre, banner oculto',
    fix.v.result === 'ok' && ctx.deviceRecordGuard('35070291') === null && banner.hidden === true);
  check('con el bloqueo levantado los registros se guardan de nuevo',
    (await msgOf(A.createSpeedtest('35070291', { downloadMbps: 100, uploadMbps: 50 }))) === null);
  documentStub.getElementById = realGet;

  const ethBoth = await validate('40001000', 'POWER LINE TP-LINK TLWPA4220 STARTER KIT', { serial: 'TPLK12345678' });
  check('mock blocked ethernet+wifi con plan 1000 (powerline 100/300)', ethBoth.v.reasons.map((r) => r.kind).join() === 'ethernet,wifi');
  const f670at1000 = await validate('40001000', 'ZXHN F670L');
  check('mock plan 1000: F670L bloquea solo por WiFi (Ethernet 1000 = plan)',
    f670at1000.v.reasons.map((r) => r.kind).join() === 'wifi');
  const byDisplay = await validate('40001000', 'ont xgs-pon  zxhn f8605p');
  check('mock: acepta displayName sin mayúsculas/espacios (F8605P) y trae technician{id,email,name}',
    byDisplay.v.result === 'ok' && byDisplay.v.device.model === 'ONT ZTE XGS-PON ZXHN F8605P'
    && byDisplay.v.technician && 'name' in byDisplay.v.technician && byDisplay.v.accountNumber === '40001000'
    && byDisplay.v.category === 'instalaciones');
  const nicPlan = await validate('40000000', run('DEVICE_OTHER_MODEL'), { otherModel: 'ROUTER XYZ' });
  check('not_in_catalog tiene prioridad sobre unknown_plan', nicPlan.v.result === 'blocked' && nicPlan.v.reasons[0].kind === 'not_in_catalog');
  await validate('40000000', 'ZXHN F670L');

  const nic = await validate('35070291', run('DEVICE_OTHER_MODEL'), { serial: 'TPLK99887766', otherModel: 'ROUTER TP-LINK ARCHER C6' });
  check('mock not_in_catalog: modelo escrito a mano → blocked, device null, mensaje de no homologado',
    nic.v.result === 'blocked' && nic.v.device === null && nic.v.reasons[0].kind === 'not_in_catalog'
    && nic.v.model === 'ROUTER TP-LINK ARCHER C6' && /no está homologado/.test(nic.v.message));
  check('not_in_catalog: también bloquea el flujo', ctx.deviceRecordGuard('35070291') !== null);
  await validate('35070291', 'ZXHN F670L');

  const unk = await validate('40000000', 'ZXHN F670L');
  const unkHtml = ctx.devScreenHtml(unk.dev);
  check('mock unknown_plan: planMbps null, no bloquea, aviso ámbar',
    unk.v.result === 'unknown_plan' && unk.v.planMbps === null && ctx.deviceRecordGuard('40000000') === null
    && unkHtml.includes('dev-verdict is-warn') && balanced(unkHtml) === null);

  const bad = await msgOf(A.createDeviceValidation('35070291', { serial: 'ZTEG1', model: 'ZXHN F670L', category: 'cancelaciones' }));
  check('mock 400: categoría fuera del contrato', bad && bad.code === 'VALIDATION_ERROR');
  check('validar otro equipo NO pasa por la guardia (es la salida del bloqueo)', (() => {
    const src = readFileSync(base + 'api.js', 'utf8');
    const body = src.slice(src.indexOf('async createDeviceValidation'), src.indexOf('async listDeviceValidations'));
    return !body.includes('assertRecordAllowed') && !body.includes('withVisitContext');
  })());

  // --- Payload, historial y formulario --------------------------------------------
  check('payload: { serial normalizado, model, category, serialSource } sin extras',
    JSON.stringify(ctx.buildDeviceValidationPayload({ serial: 'ztegd0bb 8294', model: 'ZXHN F670L', category: 'visitas', serialSource: 'ocr' }))
      === JSON.stringify({ serial: 'ZTEGD0BB8294', model: 'ZXHN F670L', category: 'visitas', serialSource: 'ocr' })
    && ctx.buildDeviceValidationPayload({ serial: 'ZTEG12345678', model: 'X', category: 'cancelaciones' }) === null
    && ctx.buildDeviceValidationPayload({ serial: 'ZT', model: 'X', category: 'visitas' }) === null);
  const now = Date.parse('2026-10-01T15:00:00Z');
  const hist = [
    { result: 'ok', category: 'instalaciones', createdAt: '2026-10-01T14:00:00Z' },
    { result: 'blocked', category: 'instalaciones', createdAt: '2026-10-01T14:30:00Z' },
    { result: 'ok', category: 'visitas', createdAt: '2026-10-01T14:50:00Z' },
    { result: 'blocked', category: 'instalaciones', createdAt: '2026-09-29T10:00:00Z' },
  ];
  check('historial: último de la categoría dentro de 12 h; lo viejo y otras categorías no cuentan',
    ctx.devLatestFromHistory(hist, 'instalaciones', now).result === 'blocked'
    && ctx.devLatestFromHistory(hist, 'visitas', now).result === 'ok'
    && ctx.devLatestFromHistory(hist.slice(3), 'instalaciones', now) === null);

  ctx.selectModule('visitas');
  const draft = run("devNewDraft('40000600', 'visitas', null)");
  draft.catalog = cat;
  draft.plan = Object.assign(ctx.devPlanFromProfile(await A.getClientProfile('40000600')), { loading: false, error: null });
  ctx.devApplyCapture(draft, ['ZTE', 'ZXHN F670L', 'GPON SN: ZTEGD0BB8294'], 'ocr');
  check('captura OCR: serial + modelo preseleccionado + fuente ocr',
    draft.serial === 'ZTEGD0BB8294' && draft.model === 'ZXHN F670L' && draft.serialSource === 'ocr');
  const formHtml = ctx.devScreenHtml(draft);
  check('formulario: label del serial, fieldset con legend, lista corta + "Ver todos" y "no está en la lista"',
    formHtml.includes('aria-labelledby="devSerialLabel"') && formHtml.includes('<legend') && formHtml.includes('data-action="dev-show-all"')
    && formHtml.includes('Ver todos los modelos (19)') && formHtml.includes('El modelo no está en la lista')
    && formHtml.includes('Leído en la etiqueta'));
  check('formulario: plan con badge "simulado" (como Datos personales) y vista previa no apto por WiFi',
    formHtml.includes('source-badge') && formHtml.includes('>simulado<') && formHtml.includes('Vista previa: no apto')
    && formHtml.includes('status-tile fail'));
  check('formulario: navegador sin escáner nativo → solo "Tomar foto" + nota', !formHtml.includes('data-action="dev-scan"')
    && formHtml.includes('data-action="dev-photo"') && formHtml.includes('Escaneo disponible solo en la app'));
  check('formulario: botón Validar habilitado y HTML balanceado',
    /data-action="dev-validate"(?![^>]*disabled)/.test(formHtml) && balanced(formHtml) === null, balanced(formHtml));
  const empty = run("devNewDraft('40000600', 'visitas', null)");
  empty.catalog = cat;
  const emptyHtml = ctx.devScreenHtml(empty);
  check('formulario vacío: Validar deshabilitado con el motivo (aria-describedby)',
    /data-action="dev-validate" disabled/.test(emptyHtml) && emptyHtml.includes('Falta el número de serie'));
  const loading = run("devNewDraft('40000600', 'visitas', null)");
  check('estado de carga del catálogo y del plan', ctx.devScreenHtml(loading).includes('Cargando catálogo de equipos')
    && ctx.devScreenHtml(loading).includes('Cargando…'));
  loading.catalogError = 'No se pudo cargar el catálogo de equipos: sin red';
  check('estado de error del catálogo con Reintentar', ctx.devScreenHtml(loading).includes('data-action="dev-retry-catalog"'));
  ctx.selectModule('cancelaciones');
}

console.log('\n== Prohibiciones del contrato ==');
const fuentes =['api.js', 'app.js'].map((f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8'));
check('la webapp nunca envía withStatus',
  !fuentes.some((s) => /withStatus\s*[=:]/.test(s) || s.includes("'withStatus'") || s.includes('withStatus=1')));
check('no hay import/export en los archivos planos',
  !fuentes.some((s) => /^\s*(import|export)\s/m.test(s)));

console.log(fails.length === 0 ? '\nTODO OK\n' : `\n${fails.length} FALLOS: ${fails.join(', ')}\n`);
process.exitCode = fails.length === 0 ? 0 : 1;
