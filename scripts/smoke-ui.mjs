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
check('payload real: explica que DOCSIS no se consultó en fibra',
  realHtml.includes('solo la publica para HFC') && realHtml.includes('No se consultó'));
check('payload real: deja explícita la ventana de 24 h',
  realHtml.includes('últimas 24 h contadas desde ese instante'));
check('payload real: lista el historial del puerto',
  realHtml.includes('Último mes') && realHtml.includes('ZTEGD0BB8294'));
check('payload real: sin "undefined" ni "NaN"',
  !/>\s*(undefined|NaN)\s*</.test(realHtml) && !realHtml.includes('NaN,'),
  (realHtml.match(/NaN[^"]{0,20}/) || [])[0]);

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
  const notFound = await WifixAPI.getCurrentNap('99999999');
  check('getCurrentNap mock: cuenta desconocida → NOT_FOUND con nap null',
    notFound.found === false && notFound.nap === null && notFound.portNumber === null
    && notFound.reason === 'NOT_FOUND' && typeof notFound.searchedNaps === 'number');
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
  check('visita: "Cómo llegar" y "Ver puertos" en la tarjeta del cliente',
    visitaHtml.includes('data-action="nap-directions"') && visitaHtml.includes('data-action="view-ports"'));
  check('visita: la búsqueda por radio queda oculta tras "Cambiar NAP"',
    visitaHtml.includes('data-action="nap-toggle-nearby"') && /data-slot="nap-nearby" hidden/.test(visitaHtml)
    && visitaHtml.includes('aria-expanded="false"'));
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

  const noHtml = await ctx.loadNapPanel('99999999');
  check('visita sin NAP: aviso breve y cae al flujo de NAPs cercanas',
    noHtml.includes('No se encontró la NAP del cliente') && !noHtml.includes('nap-toggle-nearby')
    && !/data-slot="nap-nearby" hidden/.test(noHtml) && noHtml.includes('data-action="nap-search"'));

  const razones = { NO_COORDS: 'no tiene coordenadas', NOT_SUPPORTED: 'no soporta esta consulta' };
  for (const [reason, txt] of Object.entries(razones)) {
    WifixAPI.getCurrentNap = async () => ({ accountNumber: '1', found: false, nap: null, portNumber: null,
      equipmentId: null, clientStatus: null, searchedNaps: 0, reason, brand: 'telenews' });
    const h = await ctx.loadNapPanel('1');
    check(`visita ${reason}: aviso "${txt}"`, h.includes(txt));
  }
  WifixAPI.getCurrentNap = async () => { const e = new Error('No se pudo conectar'); e.code = 'NETWORK_ERROR'; throw e; };
  const errHtml = await ctx.loadNapPanel('35070291');
  check('visita con error de red: aviso y flujo normal',
    errHtml.includes('Sin conexión con el servidor') && errHtml.includes('data-action="nap-search"'));
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
  vm.runInContext('_napPanelState.coords = null; _napPanelState.currentNap = null; _napPanelState.currentNapError = null; _napPanelState.naps = []; _napPanelState.showNearby = true;', ctx);
  ctx.selectModule(catPrevia);
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
  check('mock include=records: cada visita trae checklist de 7 tipos',
    conReg.items.every((t) => t.records && t.records.checklist.length === 7) && conReg.recordsSummary);
  const html = ctx.renderVisitsList(conReg);
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
    cards: ['personales', 'servicio', 'herramientas', 'retirados'],
    servicio: ['naps', 'events'],
  },
  migraciones: {
    title: 'Migraciones',
    cards: ['personales', 'servicio', 'herramientas', 'retirados'],
    servicio: ['naps', 'events'],
  },
  visitas: {
    title: 'Visitas técnicas',
    cards: ['personales', 'servicio', 'red', 'herramientas', 'retirados'],
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
const ALL_SUBS = ['personales', 'servicio', 'red', 'herramientas', 'retirados'];
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

console.log('\n== Prohibiciones del contrato ==');
const fuentes =['api.js', 'app.js'].map((f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8'));
check('la webapp nunca envía withStatus',
  !fuentes.some((s) => /withStatus\s*[=:]/.test(s) || s.includes("'withStatus'") || s.includes('withStatus=1')));
check('no hay import/export en los archivos planos',
  !fuentes.some((s) => /^\s*(import|export)\s/m.test(s)));

console.log(fails.length === 0 ? '\nTODO OK\n' : `\n${fails.length} FALLOS: ${fails.join(', ')}\n`);
process.exitCode = fails.length === 0 ? 0 : 1;
