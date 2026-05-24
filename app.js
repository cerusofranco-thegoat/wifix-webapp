const cards = document.querySelectorAll('.category-card');
const subscreen = document.getElementById('subscreen');
const subHeading = document.getElementById('subHeading');
const subEyebrow = document.getElementById('subEyebrow');
const backBtn = document.getElementById('backBtn');
const subCards = document.querySelectorAll('.sub-card');

const detailPersonales = document.getElementById('detailPersonales');
const detailEyebrow = document.getElementById('detailEyebrow');
const accountChip = document.getElementById('accountChip');
const detailList = document.getElementById('detailList');
const backFromPersonales = document.getElementById('backFromPersonales');

const detailServicio = document.getElementById('detailServicio');
const servicioChip = document.getElementById('servicioChip');
const servicioList = document.getElementById('servicioList');
const backFromServicio = document.getElementById('backFromServicio');

const labels = {
  instalaciones: { eyebrow: 'Categoría', title: 'Instalaciones' },
  visitas:       { eyebrow: 'Categoría', title: 'Visitas Técnicas' },
};

let currentCategory = 'instalaciones';

cards.forEach(card => {
  card.addEventListener('click', () => {
    const type = card.dataset.type;
    currentCategory = type;
    const meta = labels[type];
    if (meta) {
      subEyebrow.textContent = meta.eyebrow;
      subHeading.textContent = meta.title;
    }
    subscreen.classList.add('open');
    subscreen.setAttribute('aria-hidden', 'false');
    console.log(`[Wifix] Categoría seleccionada: ${type}`);
  });
});

backBtn.addEventListener('click', () => {
  subscreen.classList.remove('open');
  subscreen.setAttribute('aria-hidden', 'true');
});

// === Account input ===
const accountInput = document.getElementById('accountInput');
const clearAccount = document.getElementById('clearAccount');
const inputWrap = accountInput.closest('.input-wrap');

accountInput.addEventListener('input', () => {
  inputWrap.classList.toggle('has-value', accountInput.value.length > 0);
});
clearAccount.addEventListener('click', () => {
  accountInput.value = '';
  inputWrap.classList.remove('has-value');
  accountInput.focus();
});

// === Sub categories ===
subCards.forEach(card => {
  card.addEventListener('click', () => {
    const sub = card.dataset.sub;
    console.log(`[Wifix] Subcategoría seleccionada: ${sub}`);
    if (sub === 'personales') openDatosPersonales();
    if (sub === 'servicio' && currentCategory === 'instalaciones') openDatosServicio();
    if (sub === 'herramientas') openHerramientas();
    if (sub === 'retirados') openRetirados();
  });
});

backFromPersonales.addEventListener('click', () => {
  detailPersonales.classList.remove('open');
  detailPersonales.setAttribute('aria-hidden', 'true');
});

backFromServicio.addEventListener('click', () => {
  detailServicio.classList.remove('open');
  detailServicio.setAttribute('aria-hidden', 'true');
});

// === Herramientas + Equipos Retirados ===
const detailHerramientas = document.getElementById('detailHerramientas');
const herramientasChip = document.getElementById('herramientasChip');
const herramientasList = document.getElementById('herramientasList');
const backFromHerramientas = document.getElementById('backFromHerramientas');

const detailRetirados = document.getElementById('detailRetirados');
const retiradosChip = document.getElementById('retiradosChip');
const retiradosForm = document.getElementById('retiradosForm');
const backFromRetirados = document.getElementById('backFromRetirados');

backFromHerramientas.addEventListener('click', () => {
  detailHerramientas.classList.remove('open');
  detailHerramientas.setAttribute('aria-hidden', 'true');
});
backFromRetirados.addEventListener('click', () => {
  detailRetirados.classList.remove('open');
  detailRetirados.setAttribute('aria-hidden', 'true');
});

function currentAccount() {
  return (accountInput.value || '').trim();
}

function showSaveFeedback(button, message, success) {
  const original = button.textContent;
  button.textContent = message;
  button.classList.remove('ok', 'fail');
  button.classList.add(success ? 'ok' : 'fail');
  button.disabled = true;
  setTimeout(() => {
    button.textContent = original;
    button.classList.remove('ok', 'fail');
    button.disabled = false;
  }, 2200);
}

function num(value) {
  if (value === '' || value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function nonEmpty(value) {
  if (value === '' || value === null || value === undefined) return undefined;
  return String(value).trim() || undefined;
}

const TOOL_ICONS = {
  distance: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h18"/><path d="M3 8l-2 4 2 4M21 8l2 4-2 4"/></svg>',
  speed:    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 18 0"/><path d="M12 12l4-3"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></svg>',
  heatmap:  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8a4 4 0 0 1 8 0"/><path d="M3 14a4 4 0 0 1 8 0"/><path d="M13 11a4 4 0 0 1 8 0"/><circle cx="6" cy="20" r="1.2" fill="currentColor"/></svg>',
  ping:     '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="10"/></svg>',
  trace:    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="6" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="18" r="2"/><path d="M7 6h3l2 4M14 12h3l2 4"/></svg>',
  chev:     SERVICIO_ICONS.chev,
};

// --- Renderers de formularios de cada herramienta ---
function distanceFormHtml() {
  return `
    <div class="tool-form" data-tool="distance">
      <label class="form-row"><span class="form-label">Distancia (metros) *</span>
        <input type="number" step="0.01" min="0" data-field="distanceMeters" placeholder="142.7"></label>
      <div class="form-grid-2">
        <label class="form-row"><span class="form-label">Latitud inicio</span>
          <input type="number" step="any" data-field="startLat" placeholder="-0.180653"></label>
        <label class="form-row"><span class="form-label">Longitud inicio</span>
          <input type="number" step="any" data-field="startLng" placeholder="-78.467834"></label>
      </div>
      <div class="form-grid-2">
        <label class="form-row"><span class="form-label">Latitud fin</span>
          <input type="number" step="any" data-field="endLat" placeholder="-0.180700"></label>
        <label class="form-row"><span class="form-label">Longitud fin</span>
          <input type="number" step="any" data-field="endLng" placeholder="-78.468000"></label>
      </div>
      <label class="form-row"><span class="form-label">Notas</span>
        <textarea data-field="notes" rows="2" placeholder="Casa al poste"></textarea></label>
      <button class="save-btn" data-action="save">Guardar medición</button>
    </div>`;
}

function speedtestFormHtml() {
  return `
    <div class="tool-form" data-tool="speedtest">
      <div class="form-grid-2">
        <label class="form-row"><span class="form-label">Descarga (Mbps) *</span>
          <input type="number" step="0.1" min="0" data-field="downloadMbps" placeholder="185.4"></label>
        <label class="form-row"><span class="form-label">Subida (Mbps) *</span>
          <input type="number" step="0.1" min="0" data-field="uploadMbps" placeholder="92.1"></label>
      </div>
      <div class="form-grid-2">
        <label class="form-row"><span class="form-label">Latencia (ms)</span>
          <input type="number" step="0.1" data-field="latencyMs" placeholder="11.3"></label>
        <label class="form-row"><span class="form-label">Jitter (ms)</span>
          <input type="number" step="0.1" data-field="jitterMs" placeholder="1.8"></label>
      </div>
      <label class="form-row"><span class="form-label">Pérdida de paquetes (%)</span>
        <input type="number" step="0.1" min="0" max="100" data-field="packetLossPercent" placeholder="0"></label>
      <label class="form-row"><span class="form-label">Servidor / ISP</span>
        <input type="text" data-field="serverName" placeholder="Servidor Quito"></label>
      <label class="form-row"><span class="form-label">Notas</span>
        <textarea data-field="notes" rows="2"></textarea></label>
      <button class="save-btn" data-action="save">Guardar speedtest</button>
    </div>`;
}

function heatmapFormHtml() {
  return `
    <div class="tool-form" data-tool="heatmap">
      <label class="form-row"><span class="form-label">Etiqueta del relevamiento</span>
        <input type="text" data-field="label" placeholder="Piso 1"></label>
      <div class="rooms-list" data-slot="rooms"></div>
      <button class="add-row-btn" data-action="add-room">+ Agregar habitación</button>
      <label class="form-row"><span class="form-label">Notas generales</span>
        <textarea data-field="notes" rows="2"></textarea></label>
      <button class="save-btn" data-action="save">Guardar mapa de calor</button>
    </div>`;
}

function roomRowHtml(index) {
  return `
    <div class="room-row" data-room-index="${index}">
      <div class="room-row-head">
        <span class="form-label">Habitación ${index + 1}</span>
        <button class="row-remove" data-action="remove-room">×</button>
      </div>
      <div class="form-grid-2">
        <label class="form-row"><span class="form-label">Nombre *</span>
          <input type="text" data-field="roomName" placeholder="Dormitorio"></label>
        <label class="form-row"><span class="form-label">Piso</span>
          <input type="number" step="1" min="1" value="1" data-field="floor"></label>
      </div>
      <label class="form-row"><span class="form-label">signalDbm * (-120 a 0)</span>
        <input type="number" step="1" min="-120" max="0" data-field="signalDbm" placeholder="-58"></label>
    </div>`;
}

function pingFormHtml() {
  return `
    <div class="tool-form" data-tool="ping">
      <label class="form-row"><span class="form-label">Target (IP o URL) *</span>
        <input type="text" data-field="target" placeholder="8.8.8.8"></label>
      <div class="form-grid-2">
        <label class="form-row"><span class="form-label">Paquetes enviados</span>
          <input type="number" step="1" min="0" data-field="packetsSent" placeholder="10"></label>
        <label class="form-row"><span class="form-label">Paquetes recibidos</span>
          <input type="number" step="1" min="0" data-field="packetsReceived" placeholder="10"></label>
      </div>
      <div class="form-grid-2">
        <label class="form-row"><span class="form-label">Latencia mín (ms)</span>
          <input type="number" step="0.1" data-field="minLatencyMs"></label>
        <label class="form-row"><span class="form-label">Latencia prom (ms)</span>
          <input type="number" step="0.1" data-field="avgLatencyMs"></label>
      </div>
      <label class="form-row"><span class="form-label">Latencia máx (ms)</span>
        <input type="number" step="0.1" data-field="maxLatencyMs"></label>
      <label class="form-row"><span class="form-label">Habitación (si asocias a mapa de calor)</span>
        <input type="text" data-field="roomName" placeholder="Sala"></label>
      <button class="save-btn" data-action="save">Guardar ping</button>
    </div>`;
}

function tracerouteFormHtml() {
  return `
    <div class="tool-form" data-tool="traceroute">
      <label class="form-row"><span class="form-label">Target *</span>
        <input type="text" data-field="target" placeholder="www.example.com"></label>
      <div class="hops-list" data-slot="hops"></div>
      <button class="add-row-btn" data-action="add-hop">+ Agregar salto</button>
      <label class="form-row"><span class="form-label">Notas</span>
        <textarea data-field="notes" rows="2"></textarea></label>
      <button class="save-btn" data-action="save">Guardar traceroute</button>
    </div>`;
}

function hopRowHtml(index) {
  return `
    <div class="hop-row" data-hop-index="${index}">
      <div class="hop-row-head">
        <span class="form-label">Salto ${index + 1}</span>
        <button class="row-remove" data-action="remove-hop">×</button>
      </div>
      <div class="form-grid-3">
        <label class="form-row"><span class="form-label">#</span>
          <input type="number" step="1" min="1" value="${index + 1}" data-field="hopNumber"></label>
        <label class="form-row"><span class="form-label">Host / IP</span>
          <input type="text" data-field="host" placeholder="10.0.0.1"></label>
        <label class="form-row"><span class="form-label">Latencia (ms)</span>
          <input type="number" step="0.1" data-field="latencyMs"></label>
      </div>
    </div>`;
}

// --- Recolectores: leen el DOM del formulario y devuelven el payload ---
function collectFields(formEl) {
  const out = {};
  formEl.querySelectorAll(':scope > .form-row [data-field], :scope > .form-grid-2 [data-field], :scope > .form-grid-3 [data-field]').forEach(el => {
    out[el.dataset.field] = el.value;
  });
  return out;
}
function collectRows(listEl, perRow) {
  return Array.from(listEl.children).map(perRow);
}

function collectDistance(formEl) {
  const f = collectFields(formEl);
  const payload = { distanceMeters: num(f.distanceMeters) };
  if (num(f.startLat) !== undefined && num(f.startLng) !== undefined) {
    payload.startPoint = { latitude: num(f.startLat), longitude: num(f.startLng) };
  }
  if (num(f.endLat) !== undefined && num(f.endLng) !== undefined) {
    payload.endPoint = { latitude: num(f.endLat), longitude: num(f.endLng) };
  }
  if (nonEmpty(f.notes)) payload.notes = nonEmpty(f.notes);
  return payload;
}
function collectSpeedtest(formEl) {
  const f = collectFields(formEl);
  const payload = { downloadMbps: num(f.downloadMbps), uploadMbps: num(f.uploadMbps) };
  ['latencyMs', 'jitterMs', 'packetLossPercent'].forEach(k => {
    if (num(f[k]) !== undefined) payload[k] = num(f[k]);
  });
  if (nonEmpty(f.serverName)) payload.serverName = nonEmpty(f.serverName);
  if (nonEmpty(f.notes)) payload.notes = nonEmpty(f.notes);
  return payload;
}
function collectHeatmap(formEl) {
  const f = collectFields(formEl);
  const roomsEl = formEl.querySelector('[data-slot="rooms"]');
  const rooms = collectRows(roomsEl, (row) => {
    const get = (k) => row.querySelector(`[data-field="${k}"]`).value;
    return {
      roomName: nonEmpty(get('roomName')),
      floor: num(get('floor')) || 1,
      signalDbm: num(get('signalDbm')),
      measuredAt: new Date().toISOString(),
    };
  });
  const payload = { rooms };
  if (nonEmpty(f.label)) payload.label = nonEmpty(f.label);
  if (nonEmpty(f.notes)) payload.notes = nonEmpty(f.notes);
  return payload;
}
function collectPing(formEl) {
  const f = collectFields(formEl);
  const payload = { target: nonEmpty(f.target) };
  ['packetsSent','packetsReceived','minLatencyMs','avgLatencyMs','maxLatencyMs'].forEach(k => {
    if (num(f[k]) !== undefined) payload[k] = num(f[k]);
  });
  if (nonEmpty(f.roomName)) payload.roomName = nonEmpty(f.roomName);
  return payload;
}
function collectTraceroute(formEl) {
  const f = collectFields(formEl);
  const hopsEl = formEl.querySelector('[data-slot="hops"]');
  const hops = collectRows(hopsEl, (row) => {
    const get = (k) => row.querySelector(`[data-field="${k}"]`).value;
    return {
      hopNumber: num(get('hopNumber')),
      host: nonEmpty(get('host')) || null,
      latencyMs: num(get('latencyMs')),
    };
  });
  const payload = { target: nonEmpty(f.target), hops };
  if (nonEmpty(f.notes)) payload.notes = nonEmpty(f.notes);
  return payload;
}

const HERRAMIENTAS_ITEMS = [
  { id: 'distance', title: 'Medición de Distancia', icon: TOOL_ICONS.distance,
    render: distanceFormHtml,
    collect: collectDistance,
    save: (acct, payload) => WifixAPI.createDistanceMeasurement(acct, payload) },
  { id: 'speedtest', title: 'Test de Velocidad', icon: TOOL_ICONS.speed,
    render: speedtestFormHtml,
    collect: collectSpeedtest,
    save: (acct, payload) => WifixAPI.createSpeedtest(acct, payload) },
  { id: 'heatmap', title: 'Mapa de Calor WiFi', icon: TOOL_ICONS.heatmap,
    render: heatmapFormHtml,
    collect: collectHeatmap,
    save: (acct, payload) => WifixAPI.createWifiHeatmap(acct, payload) },
  { id: 'ping', title: 'Ping', icon: TOOL_ICONS.ping,
    render: pingFormHtml,
    collect: collectPing,
    save: (acct, payload) => WifixAPI.createPingTest(acct, payload) },
  { id: 'traceroute', title: 'Traceroute', icon: TOOL_ICONS.trace,
    render: tracerouteFormHtml,
    collect: collectTraceroute,
    save: (acct, payload) => WifixAPI.createTracerouteTest(acct, payload) },
];

function openHerramientas() {
  const cuenta = currentAccount() || `WX-${randInt(100000, 999999)}`;
  herramientasChip.textContent = cuenta;

  herramientasList.innerHTML = HERRAMIENTAS_ITEMS.map(item => `
    <div class="servicio-item" data-id="${item.id}">
      <button class="servicio-head" type="button">
        <div class="servicio-icon">${item.icon}</div>
        <div class="servicio-title">${item.title}</div>
        <div class="servicio-chev">${TOOL_ICONS.chev}</div>
      </button>
      <div class="servicio-body">
        <div class="servicio-body-inner" data-slot="body"></div>
      </div>
    </div>`).join('');

  herramientasList.querySelectorAll('.servicio-item').forEach(node => {
    const id = node.dataset.id;
    const item = HERRAMIENTAS_ITEMS.find(x => x.id === id);
    const head = node.querySelector('.servicio-head');
    const body = node.querySelector('[data-slot="body"]');

    head.addEventListener('click', () => {
      const wasOpen = node.classList.contains('open');
      if (!wasOpen && !body.dataset.rendered) {
        body.innerHTML = item.render();
        body.dataset.rendered = '1';
        wireToolForm(body, item);
      }
      node.classList.toggle('open');
    });
  });

  detailHerramientas.classList.add('open');
  detailHerramientas.setAttribute('aria-hidden', 'false');
}

function wireToolForm(bodyEl, item) {
  const formEl = bodyEl.querySelector('.tool-form');
  if (!formEl) return;

  // habitaciones (heatmap) y saltos (traceroute) dinámicos
  const roomsSlot = formEl.querySelector('[data-slot="rooms"]');
  const hopsSlot = formEl.querySelector('[data-slot="hops"]');
  if (roomsSlot) {
    let idx = 0;
    const addRoom = () => {
      roomsSlot.insertAdjacentHTML('beforeend', roomRowHtml(idx));
      idx++;
    };
    addRoom();
    formEl.querySelector('[data-action="add-room"]').addEventListener('click', addRoom);
    roomsSlot.addEventListener('click', (ev) => {
      if (ev.target.matches('[data-action="remove-room"]')) {
        const row = ev.target.closest('.room-row');
        if (roomsSlot.children.length > 1) row.remove();
      }
    });
  }
  if (hopsSlot) {
    let idx = 0;
    const addHop = () => {
      hopsSlot.insertAdjacentHTML('beforeend', hopRowHtml(idx));
      idx++;
    };
    addHop();
    formEl.querySelector('[data-action="add-hop"]').addEventListener('click', addHop);
    hopsSlot.addEventListener('click', (ev) => {
      if (ev.target.matches('[data-action="remove-hop"]')) {
        const row = ev.target.closest('.hop-row');
        if (hopsSlot.children.length > 1) row.remove();
      }
    });
  }

  const saveBtn = formEl.querySelector('[data-action="save"]');
  saveBtn.addEventListener('click', async () => {
    const cuenta = currentAccount();
    if (!cuenta) {
      showSaveFeedback(saveBtn, 'Falta nº de cuenta', false);
      return;
    }
    let payload;
    try {
      payload = item.collect(formEl);
    } catch (err) {
      console.error('[Wifix]', err);
      showSaveFeedback(saveBtn, 'Datos inválidos', false);
      return;
    }
    try {
      const saved = await item.save(cuenta, payload);
      console.log(`[Wifix] ${item.id} guardado:`, saved);
      showSaveFeedback(saveBtn, '✓ Guardado', true);
    } catch (err) {
      console.error('[Wifix] error al guardar:', err);
      showSaveFeedback(saveBtn, '✗ ' + (err.message || 'Error'), false);
    }
  });
}

// === Equipos Retirados ===
async function openRetirados() {
  const cuenta = currentAccount() || `WX-${randInt(100000, 999999)}`;
  retiradosChip.textContent = cuenta;

  retiradosForm.innerHTML = `
    <div class="tool-form" data-form="retired">
      <label class="form-row"><span class="form-label">Número de serie *</span>
        <input type="text" data-field="serialValue" placeholder="48575443A1B2C3D4"></label>
      <label class="form-row"><span class="form-label">Modelo del equipo *</span>
        <select data-field="equipmentModelId"><option value="">Cargando...</option></select></label>
      <label class="form-row"><span class="form-label">Motivo de retiro *</span>
        <select data-field="removalReasonCode"><option value="">Cargando...</option></select></label>
      <label class="form-row"><span class="form-label">Observaciones</span>
        <textarea data-field="observations" rows="3" placeholder="Detalles del retiro"></textarea></label>
      <label class="form-row"><span class="form-label">Foto del código de barras (opcional)</span>
        <input type="file" accept="image/jpeg,image/png" data-field="barcodePhoto"></label>
      <div class="barcode-status" data-slot="barcodeStatus"></div>
      <button class="save-btn" data-action="save">Guardar retiro</button>
    </div>`;

  const formEl = retiradosForm.querySelector('[data-form="retired"]');
  const modelSel = formEl.querySelector('[data-field="equipmentModelId"]');
  const reasonSel = formEl.querySelector('[data-field="removalReasonCode"]');
  const fileInput = formEl.querySelector('[data-field="barcodePhoto"]');
  const barcodeStatus = formEl.querySelector('[data-slot="barcodeStatus"]');
  const saveBtn = formEl.querySelector('[data-action="save"]');

  try {
    const [models, reasons] = await Promise.all([
      WifixAPI.listEquipmentModels(),
      WifixAPI.listRemovalReasons(),
    ]);
    modelSel.innerHTML = `<option value="">Selecciona un modelo</option>` +
      models.filter(m => m.active).map(m =>
        `<option value="${m.id}">${m.name} (${m.serialFieldType})</option>`).join('');
    reasonSel.innerHTML = `<option value="">Selecciona un motivo</option>` +
      reasons.filter(r => r.active).map(r =>
        `<option value="${r.code}">${r.label}</option>`).join('');
  } catch (err) {
    console.error('[Wifix] catálogos:', err);
    modelSel.innerHTML = `<option value="">No se pudo cargar</option>`;
    reasonSel.innerHTML = `<option value="">No se pudo cargar</option>`;
  }

  let uploadedPhotoId = null;
  fileInput.addEventListener('change', async () => {
    uploadedPhotoId = null;
    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      barcodeStatus.textContent = '';
      return;
    }
    barcodeStatus.textContent = 'Subiendo foto...';
    try {
      const media = await WifixAPI.uploadMedia(file);
      uploadedPhotoId = media.id;
      barcodeStatus.textContent = `✓ Foto cargada (${Math.round((media.sizeBytes || file.size) / 1024)} KB)`;
      barcodeStatus.classList.add('ok');
      barcodeStatus.classList.remove('fail');
    } catch (err) {
      console.error('[Wifix] upload media:', err);
      barcodeStatus.textContent = `✗ ${err.message || 'No se pudo subir la foto.'}`;
      barcodeStatus.classList.add('fail');
      barcodeStatus.classList.remove('ok');
    }
  });

  saveBtn.addEventListener('click', async () => {
    const acct = currentAccount();
    if (!acct) {
      showSaveFeedback(saveBtn, 'Falta nº de cuenta', false);
      return;
    }
    const serial = nonEmpty(formEl.querySelector('[data-field="serialValue"]').value);
    const modelId = modelSel.value;
    const reasonCode = reasonSel.value;
    if (!serial || !modelId || !reasonCode) {
      showSaveFeedback(saveBtn, 'Completa serie, modelo y motivo', false);
      return;
    }
    const payload = {
      serialValue: serial,
      equipmentModelId: modelId,
      removalReasonCode: reasonCode,
      observations: nonEmpty(formEl.querySelector('[data-field="observations"]').value),
    };
    if (uploadedPhotoId) payload.barcodePhotoId = uploadedPhotoId;

    try {
      const saved = await WifixAPI.createRetiredEquipment(acct, payload);
      console.log('[Wifix] retiro guardado:', saved);
      showSaveFeedback(saveBtn, '✓ Guardado', true);
    } catch (err) {
      console.error('[Wifix] retiro error:', err);
      showSaveFeedback(saveBtn, '✗ ' + (err.message || 'Error'), false);
    }
  });

  detailRetirados.classList.add('open');
  detailRetirados.setAttribute('aria-hidden', 'false');
}

// === Mock data generation ===
const NOMBRES = ['Carlos','María','Luis','Andrea','José','Patricia','Daniel','Lucía','Ricardo','Camila','Andrés','Sofía','Diego','Valentina'];
const APELLIDOS = ['González','Rodríguez','Pérez','Martínez','Hernández','López','García','Sánchez','Ramírez','Torres','Vargas','Castillo','Mendoza'];
const CALLES = ['Av. Bolívar','Calle Sucre','Av. Libertador','Calle Las Flores','Av. Universidad','Calle Comercio','Av. Principal','Calle Real'];
const SECTORES = ['Sector El Carmen','Urb. La Trinidad','Sector Centro','Urb. Los Pinos','Sector Las Acacias','Urb. El Mirador'];
const PLANES = [
  { nombre: 'Plan Fibra Hogar', velocidad: '100 Mbps' },
  { nombre: 'Plan Fibra Plus',  velocidad: '200 Mbps' },
  { nombre: 'Plan Fibra Pro',   velocidad: '300 Mbps' },
  { nombre: 'Plan Fibra Ultra', velocidad: '500 Mbps' },
  { nombre: 'Plan Fibra Max',   velocidad: '1 Gbps'   },
];

const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randCoord = (base, spread) => (base + (Math.random() - 0.5) * spread).toFixed(6);

function generateClientData(accountNumber) {
  const plan = pick(PLANES);
  return {
    nombre: `${pick(NOMBRES)} ${pick(NOMBRES)} ${pick(APELLIDOS)} ${pick(APELLIDOS)}`,
    direccion: `${pick(CALLES)} #${randInt(10, 999)}, ${pick(SECTORES)}, Caracas`,
    telefonos: [
      `+58 ${randInt(412, 426)}-${randInt(100, 999)}.${randInt(1000, 9999)}`,
      `+58 ${randInt(212, 245)}-${randInt(100, 999)}.${randInt(1000, 9999)}`,
    ],
    coordenadas: `${randCoord(10.4806, 0.3)}, ${randCoord(-66.9036, 0.3)}`,
    plan: plan.nombre,
    velocidad: plan.velocidad,
    cuenta: accountNumber || `WX-${randInt(100000, 999999)}`,
  };
}

const ICONS = {
  user: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>',
  pin:  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s7-7.5 7-13a7 7 0 1 0-14 0c0 5.5 7 13 7 13z"/><circle cx="12" cy="9" r="2.5"/></svg>',
  phone:'<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L7.9 9.7a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2z"/></svg>',
  coord:'<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18"/></svg>',
  plan: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7H4a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1z"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>',
  speed:'<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 18 0"/><path d="M12 12l4-3"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></svg>',
};

function renderRow(icon, label, value, opts = {}) {
  const cls = opts.mono ? 'detail-value mono' : 'detail-value';
  const hl  = opts.highlight ? ' highlight' : '';
  return `
    <div class="detail-row">
      <div class="detail-icon">${icon}</div>
      <div class="detail-body">
        <span class="detail-label">${label}</span>
        <span class="${cls}${hl}">${value}</span>
      </div>
    </div>`;
}

function openDatosPersonales() {
  const data = generateClientData(accountInput.value.trim());
  accountChip.textContent = data.cuenta;
  detailEyebrow.textContent = labels[currentCategory].title;

  detailList.innerHTML = [
    renderRow(ICONS.user,  'Nombres y Apellidos', data.nombre),
    renderRow(ICONS.pin,   'Dirección', data.direccion),
    renderRow(ICONS.phone, 'Teléfonos', data.telefonos.join('<br/>')),
    renderRow(ICONS.coord, 'Coordenadas', data.coordenadas, { mono: true }),
    renderRow(ICONS.plan,  'Plan Contratado', data.plan, { highlight: true }),
    renderRow(ICONS.speed, 'Velocidad de Internet', data.velocidad, { highlight: true }),
  ].join('');

  detailPersonales.classList.add('open');
  detailPersonales.setAttribute('aria-hidden', 'false');
}

// === Datos del Servicio (Instalaciones) ===

const SERVICIO_ICONS = {
  nap:   '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s7-7.5 7-13a7 7 0 1 0-14 0c0 5.5 7 13 7 13z"/><circle cx="12" cy="9" r="2"/></svg>',
  user:  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>',
  ports: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M19 10h.01M7 14h.01M11 14h.01M15 14h.01M19 14h.01"/></svg>',
  alert: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.7L2 18a2 2 0 0 0 1.7 3h16.6A2 2 0 0 0 22 18L13.7 3.7a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
  note:  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h4"/></svg>',
  history:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 8v5l3 2"/></svg>',
  camera:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h3l2-3h8l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="4"/></svg>',
  chev:  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
};

const NAP_PREFIX = ['NAP-CCS','NAP-EST','NAP-LIB','NAP-CTR','NAP-ACA','NAP-MIR'];
const TECNICOS = ['J. Pérez','M. Rodríguez','C. Hernández','L. García','D. Sánchez','A. Torres'];
const MOTIVOS = [
  'Cliente no se encontraba en domicilio',
  'Falla en equipo CPE del cliente',
  'Sin señal en NAP - requiere fusión',
  'Caja de empalme con humedad',
  'Cable drop cortado por terceros',
  'ONT con fallo de sincronización',
  'Cliente solicitó reagendar visita',
];
const OBSERVACIONES_CIERRE = [
  'Se realizó limpieza de conectores SC/APC',
  'Reemplazo de patch cord en cliente',
  'Configuración de WiFi 2.4/5GHz reiniciada',
  'Drop tensado y asegurado con grapas',
  'ONT reseteada a valores de fábrica',
  'Cliente educado sobre uso del router',
];
const EVENTOS_NODO = [
  { tipo:'Corte general', desc:'Mantenimiento programado en OLT' },
  { tipo:'Fluctuación de potencia', desc:'Caída de batería en gabinete' },
  { tipo:'Fibra dañada', desc:'Corte por obra civil cercana' },
  { tipo:'Splitter saturado', desc:'NAP requiere balance de carga' },
];
const FOTO_LABELS = ['ONT','NAP','Drop','Roseta','Caja','Speedtest','Acta','Frontal'];

function pad(n, len = 2) { return String(n).padStart(len, '0'); }
function randomDate(daysBack) {
  const d = new Date(Date.now() - Math.random() * daysBack * 86400000);
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear().toString().slice(-2)}`;
}

function buildNapsMock() {
  return Array.from({ length: 3 }, () => {
    const total = 16;
    const ocupados = randInt(4, 14);
    return {
      nombre: `${pick(NAP_PREFIX)}-${randInt(100,999)}`,
      distancia: `${randInt(35, 280)} m`,
      ocupados,
      total,
    };
  }).sort((a,b) => parseInt(a.distancia) - parseInt(b.distancia));
}
function buildPortsMock() {
  const total = 16;
  const occ = new Set();
  while (occ.size < randInt(6, 13)) occ.add(randInt(1, total));
  return Array.from({ length: total }, (_, i) => ({
    n: i + 1,
    busy: occ.has(i + 1),
  }));
}
function buildEventosMock() {
  return Array.from({ length: 3 }, () => {
    const e = pick(EVENTOS_NODO);
    const states = ['resolved','pending','fail'];
    return { ...e, fecha: randomDate(90), estado: pick(states) };
  });
}
function buildVisitasMock() {
  return Array.from({ length: 3 }, () => ({
    fecha: randomDate(180),
    tecnico: pick(TECNICOS),
    motivo: pick(MOTIVOS),
    observacion: pick(OBSERVACIONES_CIERRE),
    estado: pick(['fail','resolved','pending']),
  }));
}
function buildFotosMock() {
  const seeds = ['fiber','tech','cable','router','optic','tools','network','tower'];
  return Array.from({ length: 6 }, (_, i) => ({
    label: pick(FOTO_LABELS),
    url: `https://picsum.photos/seed/${pick(seeds)}${randInt(1,9999)}/200/200`,
  }));
}

function renderNaps(naps) {
  return naps.map(n => `
    <div class="nap-card">
      <div class="nap-head">
        <span class="nap-name">${n.nombre}</span>
        <span class="nap-distance">${n.distancia} · ${n.ocupados}/${n.total} puertos</span>
      </div>
    </div>
  `).join('');
}
function renderStatus() {
  const saldo = randInt(0, 80);
  const saldoOk = saldo < 30;
  return `
    <div class="status-grid">
      <div class="status-tile ok">
        <span class="st-label">Estado</span>
        <span class="st-value">ACTIVO</span>
      </div>
      <div class="status-tile">
        <span class="st-label">Tipo Cliente</span>
        <span class="st-value">${pick(['HOGAR','PYME','VIP'])}</span>
      </div>
      <div class="status-tile ${saldoOk ? 'ok' : 'warn'}">
        <span class="st-label">Saldo</span>
        <span class="st-value">$${saldo}.00</span>
      </div>
      <div class="status-tile">
        <span class="st-label">Últ. pago</span>
        <span class="st-value">${randomDate(60)}</span>
      </div>
    </div>
    <div class="mini-row" style="margin-top:10px">
      <span class="mr-label">Contrato</span>
      <span class="mr-value">CTR-${randInt(10000,99999)}</span>
    </div>
    <div class="mini-row">
      <span class="mr-label">Inicio servicio</span>
      <span class="mr-value">${randomDate(900)}</span>
    </div>`;
}
function renderPorts(ports) {
  const nap = `${pick(NAP_PREFIX)}-${randInt(100,999)}`;
  const ocupados = ports.filter(p => p.busy).length;
  return `
    <div class="mini-row">
      <span class="mr-label">NAP seleccionado</span>
      <span class="mr-value">${nap}</span>
    </div>
    <div class="mini-row">
      <span class="mr-label">Ocupación</span>
      <span class="mr-value">${ocupados}/${ports.length}</span>
    </div>
    <div class="port-grid">
      ${ports.map(p => `<div class="port-cell ${p.busy ? 'busy' : 'free'}">${pad(p.n)}</div>`).join('')}
    </div>
    <div class="port-legend">
      <span><span class="dot free"></span>Libre</span>
      <span><span class="dot busy"></span>Ocupado</span>
    </div>`;
}
function renderEventos(evts) {
  const badge = e => e === 'resolved' ? 'badge-resolved'
                  : e === 'pending'  ? 'badge-pending'
                  : 'badge-fail';
  const label = e => e === 'resolved' ? 'Resuelto'
                  : e === 'pending'  ? 'Pendiente'
                  : 'Falla';
  return evts.map(ev => `
    <div class="event-item">
      <span class="event-date">${ev.fecha}</span>
      <div class="event-body">
        <span class="event-badge ${badge(ev.estado)}">${label(ev.estado)}</span>
        <span class="event-title">${ev.tipo}</span>
        <span class="event-desc">${ev.desc}</span>
      </div>
    </div>`).join('');
}
function renderVisitas(visitas, useObservacion) {
  const badge = e => e === 'resolved' ? 'badge-resolved'
                  : e === 'pending'  ? 'badge-pending'
                  : 'badge-fail';
  const label = e => e === 'resolved' ? 'Cerrada OK'
                  : e === 'pending'  ? 'Pendiente'
                  : 'Insatisfactoria';
  return visitas.map(v => `
    <div class="event-item">
      <span class="event-date">${v.fecha}</span>
      <div class="event-body">
        <span class="event-badge ${badge(v.estado)}">${label(v.estado)}</span>
        <span class="event-title">${v.tecnico} · ${v.motivo}</span>
        <span class="event-desc">${useObservacion ? v.observacion : v.motivo}</span>
      </div>
    </div>`).join('');
}
function renderFotos(fotos) {
  return `
    <div class="mini-row">
      <span class="mr-label">Fotos registradas</span>
      <span class="mr-value">${fotos.length}</span>
    </div>
    <div class="photo-grid">
      ${fotos.map(f => `<div class="photo-thumb" style="background-image:url('${f.url}')" data-label="${f.label}"></div>`).join('')}
    </div>`;
}

const SERVICIO_ITEMS = [
  { id:'naps',     icon: SERVICIO_ICONS.nap,    title:'NAPs cercanas, distancia y puertos ocupados',
    render: () => renderNaps(buildNapsMock()) },
  { id:'status',   icon: SERVICIO_ICONS.user,   title:'Status del cliente por contrato/cuenta',
    render: () => renderStatus() },
  { id:'puertos',  icon: SERVICIO_ICONS.ports,  title:'Puertos ocupados por NAP',
    render: () => renderPorts(buildPortsMock()) },
  { id:'danos',    icon: SERVICIO_ICONS.alert,  title:'Daños (eventos) en el nodo',
    render: () => renderEventos(buildEventosMock()) },
  { id:'insat',    icon: SERVICIO_ICONS.note,   title:'Observación de cierre en tareas insatisfactorias',
    render: () => renderVisitas(buildVisitasMock().map(v => ({...v, estado:'fail'})), true) },
  { id:'visitas',  icon: SERVICIO_ICONS.history,title:'Motivos y observaciones de visitas anteriores',
    render: () => renderVisitas(buildVisitasMock(), true) },
  { id:'fotos',    icon: SERVICIO_ICONS.camera, title:'Registro de fotos en contrato/cuenta',
    render: () => renderFotos(buildFotosMock()) },
];

function openDatosServicio() {
  const cuenta = accountInput.value.trim() || `WX-${randInt(100000, 999999)}`;
  servicioChip.textContent = cuenta;

  servicioList.innerHTML = SERVICIO_ITEMS.map(item => `
    <div class="servicio-item" data-id="${item.id}">
      <button class="servicio-head" type="button">
        <div class="servicio-icon">${item.icon}</div>
        <div class="servicio-title">${item.title}</div>
        <div class="servicio-chev">${SERVICIO_ICONS.chev}</div>
      </button>
      <div class="servicio-body">
        <div class="servicio-body-inner" data-slot="body"></div>
      </div>
    </div>
  `).join('');

  servicioList.querySelectorAll('.servicio-item').forEach(node => {
    const id = node.dataset.id;
    const item = SERVICIO_ITEMS.find(x => x.id === id);
    const head = node.querySelector('.servicio-head');
    const body = node.querySelector('[data-slot="body"]');

    head.addEventListener('click', () => {
      const wasOpen = node.classList.contains('open');
      if (!wasOpen) body.innerHTML = item.render();
      node.classList.toggle('open');
    });
  });

  detailServicio.classList.add('open');
  detailServicio.setAttribute('aria-hidden', 'false');
}
