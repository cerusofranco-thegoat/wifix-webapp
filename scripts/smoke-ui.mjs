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

const naps = await WifixAPI.getNearbyNaps({ latitude: -2.1685, longitude: -79.9189 });
check('mock de NAPs trae lat/lng y puertos libres',
  naps.every((n) => isFinite(n.latitude) && isFinite(n.longitude) && n.freePorts !== undefined));

const ports = await WifixAPI.getNapPorts('PL2KD9');
check('renderPortsTable con detalle', ctx.renderPortsTable(ports).includes('port-grid'));
check('renderPortsTable sin detalle muestra el aviso',
  ctx.renderPortsTable({ napCode: 'X', ports: [], detailAvailable: false, note: 'sin detalle' }).includes('sin detalle'));

console.log(fails.length === 0 ? '\nTODO OK\n' : `\n${fails.length} FALLOS: ${fails.join(', ')}\n`);
process.exitCode = fails.length === 0 ? 0 : 1;
