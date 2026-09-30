/**
 * Smoke test del motor de speedtest de native.js, sin teléfono ni red:
 * carga native.js en un DOM mínimo y le enchufa un NetworkTools falso que
 * simula lo que devuelve el plugin nativo (307 del servidor, 429 de
 * Cloudflare, subida con muestras imposibles…).
 *
 * Cubre la orquestación JS, NO la medición en sí: los Mbps los calcula
 * NetworkToolsPlugin.java y eso sólo se verifica en un APK real.
 *
 * OJO: desde que la velocidad la mide un dispositivo externo, este motor
 * (WifixNative.speedtest / speedtestServers) quedó DESCONECTADO de la UI.
 * El test se conserva mientras el puente siga en native.js; si se borra el
 * motor, borrar también este script y `npm run smoke:speedtest`.
 *
 *   node scripts/smoke-speedtest.mjs
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// --- DOM mínimo -------------------------------------------------------------
function fakeEl() {
  return {
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    dataset: {},
    style: {},
    textContent: '',
    innerHTML: '',
    hidden: false,
    addEventListener() {},
    setAttribute() {},
    removeAttribute() {},
    getAttribute: () => null,
    querySelector: () => fakeEl(),
    querySelectorAll: () => [],
    appendChild() {},
    insertAdjacentHTML() {},
    closest: () => null,
    remove() {},
  };
}

const documentStub = {
  readyState: 'complete',
  body: Object.assign(fakeEl(), { querySelectorAll: () => [] }),
  createElement: () => fakeEl(),
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
};

class MutationObserverStub { observe() {} disconnect() {} }

// --- Carga de native.js en un contexto aislado -------------------------------
function loadNative(networkTools, capacitorHttp) {
  const win = {};
  const ctx = {
    window: win,
    document: documentStub,
    MutationObserver: MutationObserverStub,
    setTimeout, clearTimeout, setInterval, clearInterval,
    console,
    performance: { now: () => Date.now() },
    navigator: { userAgent: 'node' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  };
  ctx.globalThis = ctx;
  win.document = documentStub;
  win.addEventListener = () => {};
  win.Capacitor = {
    isNativePlatform: () => true,
    Plugins: { NetworkTools: networkTools, CapacitorHttp: capacitorHttp },
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../native.js', import.meta.url), 'utf8'), ctx);
  return win.WifixNative;
}

// --- Plugin nativo falso ----------------------------------------------------
// probe(url) → true si ese endpoint "responde 200"; download/upload(url) →
// objeto tal cual lo resuelve el plugin.
function fakePlugin({ probeOk, download, upload }) {
  const calls = { ping: [], download: [], upload: [] };
  return {
    calls,
    async addListener() { return { remove() {} }; },
    async httpPing({ url }) {
      calls.ping.push(url);
      return probeOk(url)
        ? { ok: true, avgMs: 12, minMs: 10, jitterMs: 1, packetLossPercent: 0 }
        : { ok: false, avgMs: null, minMs: null, jitterMs: 0, packetLossPercent: 100 };
    },
    async downloadTest(opts) { calls.download.push(opts); return download(opts, calls.download.length); },
    async uploadTest(opts) { calls.upload.push(opts); return upload(opts, calls.upload.length); },
  };
}

const SERVER = {
  id: '1234',
  label: 'XTRIM · Guayaquil, Ecuador',
  sponsor: 'XTRIM',
  city: 'Guayaquil',
  country: 'Ecuador',
  host: 'speedtest.xtrim.ec:8080',
  url: 'https://speedtest.xtrim.ec:8080/speedtest/upload.php',
};

const OK_DOWN = { downloadMbps: 940, downloadBytes: 1.7e9, downloadElapsedMs: 15200 };
const DEAD_DOWN = { downloadMbps: 0, downloadBytes: 0, downloadElapsedMs: 2100, downloadFirstHttpCode: 307 };
const OK_UP = { uploadMbps: 480, uploadBytes: 9e8, uploadElapsedMs: 15100, uploadSamples: 22 };

// --- Runner -----------------------------------------------------------------
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FALLA ${name}\n         ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

console.log('\n== Sondeo del endpoint de bajada ==');

await test('usa /download?size= cuando el .jpg no responde', async () => {
  const plugin = fakePlugin({
    probeOk: (u) => u.includes('/download?'),
    download: () => OK_DOWN,
    upload: () => OK_UP,
  });
  const r = await loadNative(plugin).speedtest({ server: SERVER });
  assert(r.downloadEndpoint.includes('/download?'), `endpoint elegido: ${r.downloadEndpoint}`);
  assert(r.measuredVia === 'server', 'debería medir contra el servidor');
  assert(plugin.calls.download[0].url === r.downloadEndpoint, 'el test usó otro endpoint que el sondeado');
});

await test('cae al random4000x4000.jpg si /download no existe', async () => {
  const plugin = fakePlugin({
    probeOk: (u) => u.includes('random350x350.jpg'),
    download: () => OK_DOWN,
    upload: () => OK_UP,
  });
  const r = await loadNative(plugin).speedtest({ server: SERVER });
  assert(r.downloadEndpoint.includes('random4000x4000.jpg'), `endpoint elegido: ${r.downloadEndpoint}`);
});

await test('prueba también la variante http cuando https no sirve el asset', async () => {
  const plugin = fakePlugin({
    probeOk: (u) => u.startsWith('http://'),
    download: () => OK_DOWN,
    upload: () => OK_UP,
  });
  const r = await loadNative(plugin).speedtest({ server: SERVER });
  assert(r.downloadEndpoint.startsWith('http://'), `endpoint elegido: ${r.downloadEndpoint}`);
});

console.log('\n== Fallback a Cloudflare ==');

await test('Cloudflare se llama con pocas conexiones y requests grandes', async () => {
  const plugin = fakePlugin({
    probeOk: () => false,
    download: (o) => (o.url.includes('cloudflare') ? { ...OK_DOWN, colo: 'GYE' } : DEAD_DOWN),
    upload: () => OK_UP,
  });
  const r = await loadNative(plugin).speedtest({ server: SERVER });
  const cf = plugin.calls.download.find((c) => c.url.includes('cloudflare'));
  assert(r.measuredVia === 'cloudflare-fallback', 'debería etiquetar el fallback');
  assert(cf.parallelStreams <= 4, `streams contra CF: ${cf.parallelStreams}`);
  assert(/bytes=1048576\d\d/.test(cf.url), `tamaño por request: ${cf.url}`);
});

await test('un 429 de Cloudflare se reintenta una vez, con menos conexiones', async () => {
  const plugin = fakePlugin({
    probeOk: () => false,
    download: (o, n) => {
      if (!o.url.includes('cloudflare')) return DEAD_DOWN;
      return n === 2
        ? { downloadMbps: 0, downloadBytes: 0, downloadElapsedMs: 800, downloadFirstHttpCode: 429 }
        : OK_DOWN;
    },
    upload: () => OK_UP,
  });
  const r = await loadNative(plugin).speedtest({ server: SERVER });
  const cf = plugin.calls.download.filter((c) => c.url.includes('cloudflare'));
  assert(cf.length === 2, `llamadas a CF: ${cf.length}`);
  assert(cf[1].parallelStreams < cf[0].parallelStreams, 'el reintento debería usar menos conexiones');
  assert(r.downloadMbps === 940, 'el reintento exitoso debería mandar');
});

await test('no reintenta Cloudflare si el fallo no es 429', async () => {
  const plugin = fakePlugin({
    probeOk: () => false,
    download: (o) => (o.url.includes('cloudflare')
      ? { downloadMbps: 0, downloadBytes: 0, downloadElapsedMs: 900, downloadFirstHttpCode: 503 }
      : DEAD_DOWN),
    upload: () => OK_UP,
  });
  let msg = '';
  try { await loadNative(plugin).speedtest({ server: SERVER }); }
  catch (e) { msg = e.message; }
  assert(plugin.calls.download.filter((c) => c.url.includes('cloudflare')).length === 1,
    'un 503 no se reintenta');
  assert(msg.includes('503'), `mensaje: ${msg}`);
});

console.log('\n== Mensajes de error accionables ==');

await test('bajada muerta explica el 429 y sugiere otro servidor', async () => {
  const plugin = fakePlugin({
    probeOk: () => false,
    download: () => ({ downloadMbps: 0, downloadBytes: 0, downloadElapsedMs: 900, downloadFirstHttpCode: 429 }),
    upload: () => OK_UP,
  });
  let msg = '';
  try { await loadNative(plugin).speedtest({ server: SERVER }); }
  catch (e) { msg = e.message; }
  assert(msg.includes('rate-limit (429)'), `mensaje: ${msg}`);
  assert(msg.includes('ningún endpoint de bajada respondió'), `mensaje: ${msg}`);
  assert(msg.includes('Probá otro servidor'), `mensaje: ${msg}`);
});

console.log('\n== Subida con mediciones imposibles ==');

await test('una subida marcada como imposible cae a Cloudflare, no se muestra', async () => {
  const plugin = fakePlugin({
    probeOk: () => true,
    download: () => OK_DOWN,
    upload: (o) => (o.url.includes('cloudflare')
      ? OK_UP
      : { uploadMbps: 0, uploadBytes: 0, uploadElapsedMs: 15000, uploadImplausible: true,
          uploadDiscardedImplausible: 9 }),
  });
  const r = await loadNative(plugin).speedtest({ server: SERVER });
  assert(r.uploadMbps === 480, `subida reportada: ${r.uploadMbps}`);
  assert(r.measuredVia === 'cloudflare-fallback', 'debería etiquetar el fallback');
});

await test('si tampoco Cloudflare sube, el error dice que las muestras eran imposibles', async () => {
  const plugin = fakePlugin({
    probeOk: () => true,
    download: () => OK_DOWN,
    upload: () => ({ uploadMbps: 0, uploadBytes: 0, uploadElapsedMs: 15000, uploadImplausible: true }),
  });
  let msg = '';
  try { await loadNative(plugin).speedtest({ server: SERVER }); }
  catch (e) { msg = e.message; }
  assert(msg.includes('imposibles'), `mensaje: ${msg}`);
});

console.log(failed === 0 ? '\nTODO OK\n' : `\n${failed} PRUEBA(S) FALLIDA(S)\n`);
process.exit(failed === 0 ? 0 : 1);
