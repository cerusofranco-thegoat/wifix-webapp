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
