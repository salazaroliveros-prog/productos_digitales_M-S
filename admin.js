const state = {
  session: null,
  realtime: {
    enabled: true,
    intervalMs: 3000,
    fastIntervalMs: 1000,
    fastModeUntil: 0,
    fastModeReason: '',
    timer: null,
    inFlight: false,
    lastSyncAt: null,
    lastSignature: null,
  },
};

const el = {
  authStatus: document.getElementById('admin-auth-status'),
  realtimeStatus: document.getElementById('admin-realtime-status'),
  realtimeToggle: document.getElementById('admin-realtime-toggle'),
  lockedNote: document.getElementById('admin-locked-note'),
  logoutBtn: document.getElementById('admin-logout-btn'),
  inventario: document.getElementById('admin-inventario'),
  disenoForm: document.getElementById('admin-diseno-form'),
  ventas: document.getElementById('admin-ventas'),
  kpis: document.getElementById('admin-kpis'),
  metricas: document.getElementById('admin-metricas'),
  topDisenos: document.getElementById('admin-top-disenos'),
  consultas: document.getElementById('admin-consultas'),
  leads: document.getElementById('admin-leads'),
  metDesde: document.getElementById('met-desde'),
  metHasta: document.getElementById('met-hasta'),
  refresh: document.getElementById('admin-refresh'),
  histDestino: document.getElementById('hist-destino'),
  histDesde: document.getElementById('hist-desde'),
  histHasta: document.getElementById('hist-hasta'),
  histFiltrar: document.getElementById('hist-filtrar'),
  histExport: document.getElementById('hist-export'),
  historial: document.getElementById('admin-historial'),
  smtpStatus: document.getElementById('smtp-status'),
  smtpStatusBtn: document.getElementById('smtp-status-btn'),
  smtpTestTo: document.getElementById('smtp-test-to'),
  smtpTestBtn: document.getElementById('smtp-test-btn'),
  paqForm: document.getElementById('paq-form'),
  paqListado: document.getElementById('paq-listado'),
  paqCotizarId: document.getElementById('paq-cotizar-id'),
  paqCotizarBtn: document.getElementById('paq-cotizar-btn'),
  paqCotizacion: document.getElementById('paq-cotizacion'),
  toast: document.getElementById('toast'),
};

const privateSections = Array.from(document.querySelectorAll('.admin-private'));

function showToast(message, isError = false) {
  el.toast.textContent = message;
  el.toast.className = `toast ${isError ? 'error' : 'ok'}`;
  el.toast.style.opacity = '1';
  setTimeout(() => {
    el.toast.style.opacity = '0';
  }, 2600);
}

function setAdminLockState(isUnlocked) {
  privateSections.forEach((section) => {
    section.classList.toggle('hidden', !isUnlocked);
  });

  if (el.lockedNote) {
    el.lockedNote.classList.toggle('hidden', isUnlocked);
  }
}

function updateRealtimeStatusLabel() {
  if (!el.realtimeStatus || !el.realtimeToggle) return;

  const enabled = state.realtime.enabled;
  const fastMode = enabled && Date.now() < state.realtime.fastModeUntil;
  const modeText = fastMode ? ` (modo rapido${state.realtime.fastModeReason ? `: ${state.realtime.fastModeReason}` : ''})` : '';
  const stamp = state.realtime.lastSyncAt
    ? ` · ultima sync ${new Date(state.realtime.lastSyncAt).toLocaleTimeString('es-GT')}`
    : '';

  el.realtimeStatus.textContent = enabled
    ? `Tiempo real: activo cada ${Math.round(state.realtime.intervalMs / 1000)}s${modeText}${stamp}`
    : 'Tiempo real: pausado';
  el.realtimeToggle.textContent = enabled ? 'Pausar tiempo real' : 'Activar tiempo real';
}

function getRealtimeIntervalMs() {
  return Date.now() < state.realtime.fastModeUntil ? state.realtime.fastIntervalMs : state.realtime.intervalMs;
}

function createRealtimeSnapshot(metricas = {}, leads = []) {
  const resumen = metricas.resumen || {};
  return {
    cotizacionesCliente: Number(resumen.cotizacionesCliente || 0),
    topLeadId: Array.isArray(leads) && leads.length > 0 ? String(leads[0].id || 'none') : 'none',
  };
}

function shouldActivateFastMode(previousSnapshot, currentSnapshot) {
  if (!previousSnapshot || !currentSnapshot) return false;
  const hasNewLead = currentSnapshot.topLeadId !== previousSnapshot.topLeadId;
  const hasNewQuote = currentSnapshot.cotizacionesCliente > previousSnapshot.cotizacionesCliente;
  return hasNewLead || hasNewQuote;
}

function getFastModeReason(previousSnapshot, currentSnapshot) {
  if (!previousSnapshot || !currentSnapshot) return '';

  const hasNewLead = currentSnapshot.topLeadId !== previousSnapshot.topLeadId;
  const hasNewQuote = currentSnapshot.cotizacionesCliente > previousSnapshot.cotizacionesCliente;

  if (hasNewLead && hasNewQuote) return 'nuevo lead y nueva cotizacion';
  if (hasNewLead) return 'nuevo lead';
  if (hasNewQuote) return 'nueva cotizacion';
  return '';
}

function scheduleRealtimeNextTick() {
  stopRealtime();
  if (!state.realtime.enabled) {
    updateRealtimeStatusLabel();
    return;
  }

  const waitMs = getRealtimeIntervalMs();
  state.realtime.timer = setTimeout(refreshRealtimeTick, waitMs);
  updateRealtimeStatusLabel();
}

async function refreshRealtimeTick() {
  if (!state.session || !state.realtime.enabled) {
    return;
  }

  if (state.realtime.inFlight) {
    scheduleRealtimeNextTick();
    return;
  }

  state.realtime.inFlight = true;
  try {
    const [, metricas, leads] = await Promise.all([loadVentas(), loadMetricas(), loadLeads()]);
    const snapshot = createRealtimeSnapshot(metricas, leads);
    const fastModeReason = getFastModeReason(state.realtime.lastSignature, snapshot);

    if (shouldActivateFastMode(state.realtime.lastSignature, snapshot)) {
      state.realtime.fastModeUntil = Date.now() + 12000;
      state.realtime.fastModeReason = fastModeReason;
    } else if (Date.now() >= state.realtime.fastModeUntil) {
      state.realtime.fastModeReason = '';
    }

    state.realtime.lastSignature = snapshot;
    state.realtime.lastSyncAt = Date.now();
    updateRealtimeStatusLabel();
  } catch (_error) {
  } finally {
    state.realtime.inFlight = false;
    if (state.realtime.enabled) {
      scheduleRealtimeNextTick();
    }
  }
}

function startRealtime() {
  if (!state.realtime.enabled) {
    stopRealtime();
    updateRealtimeStatusLabel();
    return;
  }
  scheduleRealtimeNextTick();
}

function stopRealtime() {
  if (state.realtime.timer) {
    clearTimeout(state.realtime.timer);
    state.realtime.timer = null;
  }
}

async function adminRequest(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  const response = await fetch(url, { ...options, headers, credentials: 'same-origin' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || 'Error admin');
  }
  return body;
}

function renderInventario(items) {
  el.inventario.innerHTML = items
    .map(
      (item) => `
      <div class="form-card">
        <h3>${item.nombre} (${item.id})</h3>
        <div class="inline-form">
          <div class="field"><label>Material</label><input id="mat-${item.id}" type="number" step="0.01" value="${item.costoMaterial}" /></div>
          <div class="field"><label>Mano obra</label><input id="mo-${item.id}" type="number" step="0.01" value="${item.costoManoObra}" /></div>
          <button class="btn primary" data-save-mat="${item.id}" type="button">Guardar</button>
        </div>
      </div>
    `
    )
    .join('');

  document.querySelectorAll('[data-save-mat]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-save-mat');
      const costoMaterial = Number(document.getElementById(`mat-${id}`).value || 0);
      const costoManoObra = Number(document.getElementById(`mo-${id}`).value || 0);
      try {
        await adminRequest(`/api/integracion/appsheet/materiales/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ costoMaterial, costoManoObra, region: 'Jutiapa' }),
        });
        showToast(`Precio actualizado ${id}`);
      } catch (error) {
        showToast(error.message, true);
      }
    });
  });
}

function renderVentas(ventas) {
  el.ventas.innerHTML = ventas
    .slice(0, 25)
    .map(
      (v) => `
      <div class="form-card">
        <h3>${v.id} · ${v.clienteNombre || ''}</h3>
        <p>${v.clienteEmail || ''} · ${v.disenoId} · ${v.estadoPago} · Acceso: ${v.accesoApp ? 'activo' : 'inactivo'}</p>
        <div class="inline-form">
          <button class="btn primary" data-pay="${v.id}" type="button">Pago verificado</button>
          <button class="btn ghost" data-regen="${v.id}" type="button">Regenerar acceso</button>
          <button class="btn" data-resend="${v.id}" type="button">Reenviar credenciales</button>
            <button class="btn danger" data-revoke="${v.id}" type="button">Revocar acceso</button>
        </div>
      </div>
    `
    )
    .join('');

  document.querySelectorAll('[data-pay]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-pay');
      try {
        await adminRequest(`/api/integracion/appsheet/ventas/${id}/pago-verificado`, {
          method: 'PATCH',
          body: JSON.stringify({ enviarCredenciales: true }),
        });
        showToast(`Pago verificado ${id}`);
        await loadVentas();
      } catch (error) {
        showToast(error.message, true);
      }
    });
  });

  document.querySelectorAll('[data-regen]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-regen');
      try {
        await adminRequest(`/api/integracion/appsheet/ventas/${id}/regenerar-acceso`, { method: 'POST' });
        showToast(`Acceso regenerado ${id}`);
      } catch (error) {
        showToast(error.message, true);
      }
    });
  });

  document.querySelectorAll('[data-resend]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-resend');
      try {
        await adminRequest(`/api/integracion/appsheet/ventas/${id}/reenviar-credenciales`, {
          method: 'POST',
          body: JSON.stringify({ regenerarAcceso: false, solicitadoPor: 'admin-web' }),
        });
        showToast(`Credenciales reenviadas ${id}`);
        await loadHistorial();
      } catch (error) {
        showToast(error.message, true);
      }
    });
  });

  document.querySelectorAll('[data-revoke]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-revoke');
      if (!confirm(`¿Revocar acceso de ${id}? Esto invalida todos sus tokens activos al instante.`)) return;
      try {
        const result = await adminRequest(`/api/integracion/appsheet/ventas/${id}/revocar-acceso`, { method: 'PATCH' });
        showToast(`Acceso revocado. Tokens invalidados: ${result.tokensRevocados}`);
        await loadVentas();
      } catch (error) {
        showToast(error.message, true);
      }
    });
  });
}

function parseItemsJson(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return [];
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('Items debe ser un arreglo JSON');
  }
  return parsed;
}

function renderKpis(resumen = {}) {
  const canalItems =
    Object.entries(resumen.ventasPorCanal || {})
      .map(([canal, cant]) => `${canal}: ${cant}`)
      .join(' · ') || '—';

  const cards = [
    { label: 'Ventas pagadas',       value: resumen.ventasPagadas ?? 0 },
    { label: 'Ventas pendientes',    value: resumen.ventasPendientes ?? 0 },
    { label: 'Ingresos pagados',     value: `Q${Number(resumen.ingresosPagados || 0).toFixed(2)}` },
    { label: 'Pipeline (pendiente)', value: `Q${Number(resumen.montoPipeline || 0).toFixed(2)}` },
    { label: 'Utilidad neta',        value: `Q${Number(resumen.utilidadNetaTotal || 0).toFixed(2)}` },
    { label: 'Margen promedio',      value: `${Number(resumen.margenPromedioPorcentaje || 0).toFixed(2)}%` },
    { label: 'Tasa conversion',      value: `${Number(resumen.tasaConversion || 0).toFixed(1)}%` },
    { label: 'Ticket promedio',      value: `Q${Number(resumen.ticketPromedio || 0).toFixed(2)}` },
    { label: 'Consultas registradas',value: resumen.consultasRegistradas ?? 0 },
    { label: 'Vistas de pagina',     value: resumen.vistasPagina ?? 0 },
    { label: 'Cotizaciones cliente', value: resumen.cotizacionesCliente ?? 0 },
    { label: 'Clicks WhatsApp',      value: resumen.clicksWhatsapp ?? 0 },
    { label: 'Registros cliente',    value: resumen.registrosCliente ?? 0 },
    { label: 'Accesos cliente',      value: resumen.accesosCliente ?? 0 },
    { label: 'Leads comerciales',    value: resumen.leadsComerciales ?? 0 },
    { label: 'Envios credenciales',  value: resumen.enviosCredenciales ?? 0 },
    { label: 'Reenvios credenciales',value: resumen.reenviosCredenciales ?? 0 },
    { label: 'Envios SMTP reales',   value: resumen.enviosCredencialesReales ?? 0 },
    { label: 'Ventas por canal',     value: canalItems, span2: true },
  ];

  el.kpis.innerHTML = cards
    .map(
      (card) => `
      <article class="metric${card.span2 ? ' span-2' : ''}">
        <h4>${card.label}</h4>
        <p>${card.value}</p>
      </article>
    `
    )
    .join('');
}

function renderTopDisenos(items = []) {
  if (!Array.isArray(items) || items.length === 0) {
    el.topDisenos.innerHTML = '<p>No hay datos de ranking para el rango seleccionado.</p>';
    return;
  }

  const rows = items
    .slice(0, 10)
    .map(
      (item, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${item.disenoId || ''}</td>
        <td>${item.disenoNombre || '-'}</td>
        <td>${item.consultas || 0}</td>
      </tr>
    `
    )
    .join('');

  el.topDisenos.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr><th>#</th><th>ID</th><th>Diseno</th><th>Consultas</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderPaquetes(paquetes) {
  el.paqListado.innerHTML = paquetes
    .slice(0, 30)
    .map(
      (p) => `
      <div class="form-card">
        <h3>${p.id} · ${p.nombre}</h3>
        <p>Estrategia: ${p.estrategia || 'bundle'} · Activo: ${Boolean(p.activo)}</p>
        <p>Lista: Q${p.precioLista || 0} · Final: Q${p.precioFinal || 0} · Descuento: ${p.descuentoPct || 0}%</p>
        <div class="inline-form">
          <button class="btn ghost" data-edit-paq="${p.id}" type="button">Cargar en formulario</button>
          <button class="btn" data-quote-paq="${p.id}" type="button">Cotizar</button>
        </div>
      </div>
    `
    )
    .join('');

  document.querySelectorAll('[data-edit-paq]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-edit-paq');
      const paquete = paquetes.find((x) => x.id === id);
      if (!paquete) return;
      document.getElementById('paq-id').value = paquete.id || '';
      document.getElementById('paq-nombre').value = paquete.nombre || '';
      document.getElementById('paq-estrategia').value = paquete.estrategia || 'bundle';
      document.getElementById('paq-descuento').value = Number(paquete.descuentoPct || 0);
      document.getElementById('paq-items').value = JSON.stringify(paquete.items || [], null, 2);
      showToast(`Paquete ${id} cargado`);
    });
  });

  document.querySelectorAll('[data-quote-paq]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-quote-paq');
      await cotizarPaquete(id);
    });
  });
}

async function loadPaquetes() {
  const paquetes = await adminRequest('/api/integracion/appsheet/paquetes');
  renderPaquetes(paquetes);
}

async function guardarPaqueteDesdeFormulario() {
  const id = String(document.getElementById('paq-id').value || '').trim();
  const nombre = String(document.getElementById('paq-nombre').value || '').trim();
  const estrategia = String(document.getElementById('paq-estrategia').value || 'bundle').trim();
  const descuentoPct = Number(document.getElementById('paq-descuento').value || 0);
  const items = parseItemsJson(document.getElementById('paq-items').value);

  if (!nombre) {
    throw new Error('Nombre de paquete requerido');
  }

  const payload = {
    id,
    nombre,
    estrategia,
    descuentoPct,
    items,
    activo: true,
    descripcion: '',
  };

  if (id) {
    await adminRequest(`/api/integracion/appsheet/paquetes/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    showToast(`Paquete ${id} actualizado`);
  } else {
    const created = await adminRequest('/api/integracion/appsheet/paquetes', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    document.getElementById('paq-id').value = created.id || '';
    showToast(`Paquete ${created.id || ''} creado`);
  }

  await loadPaquetes();
}

async function cotizarPaquete(id) {
  if (!id) {
    throw new Error('ID de paquete requerido para cotizar');
  }
  const result = await adminRequest('/api/paquetes/cotizar', {
    method: 'POST',
    body: JSON.stringify({ paqueteId: id }),
  });
  el.paqCotizacion.textContent = JSON.stringify(result, null, 2);
  el.paqCotizarId.value = id;
}

async function loadInventario() {
  const inv = await adminRequest('/api/integracion/appsheet/inventario');
  renderInventario(inv);
}

async function loadVentas() {
  const ventas = await adminRequest('/api/integracion/appsheet/ventas');
  renderVentas(ventas);
  return ventas;
}

async function loadMetricas() {
  const desde = String(el.metDesde.value || '').trim();
  const hasta = String(el.metHasta.value || '').trim();
  const query = new URLSearchParams();
  if (desde) query.set('desde', desde);
  if (hasta) query.set('hasta', hasta);
  const suffix = query.toString() ? `?${query.toString()}` : '';

  const metricas = await adminRequest(`/api/integracion/appsheet/metricas${suffix}`);
  renderKpis(metricas.resumen || {});
  renderTopDisenos(metricas.disenosMasConsultados || []);
  el.metricas.textContent = JSON.stringify(metricas.resumen, null, 2);

  const consultas = Array.isArray(metricas.ultimasConsultas) ? metricas.ultimasConsultas : [];
  if (consultas.length === 0) {
    el.consultas.innerHTML = '<p>No hay consultas para el rango seleccionado.</p>';
    return;
  }

  const rows = consultas
    .slice(0, 20)
    .map(
      (q) => `
      <tr>
        <td>${(q.fecha || '').replace('T', ' ').slice(0, 16)}</td>
        <td>${q.evento || ''}</td>
        <td>${q.disenoId || ''}</td>
        <td>${q.detalle || '-'}</td>
        <td>${q.areaM2 || '-'}</td>
        <td>${q.canal || ''}</td>
        <td>${q.origen || ''}</td>
        <td>${q.clienteEmail || '-'}</td>
      </tr>
    `
    )
    .join('');

  el.consultas.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr><th>Fecha</th><th>Evento</th><th>Diseno</th><th>Detalle</th><th>Area</th><th>Canal</th><th>Origen</th><th>Cliente</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  return metricas;
}

function renderLeads(leads = []) {
  if (!Array.isArray(leads) || leads.length === 0) {
    el.leads.innerHTML = '<p>No hay leads recientes.</p>';
    return;
  }

  const rows = leads
    .slice(0, 20)
    .map(
      (lead) => `
      <tr>
        <td>${(lead.fecha || '').replace('T', ' ').slice(0, 16)}</td>
        <td>${lead.nombre || ''}</td>
        <td>${lead.email || '-'}</td>
        <td>${lead.telefono || '-'}</td>
        <td>${lead.interes || '-'}</td>
        <td>${lead.estado || '-'}</td>
      </tr>
    `
    )
    .join('');

  el.leads.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr><th>Fecha</th><th>Nombre</th><th>Email</th><th>Telefono</th><th>Interes</th><th>Estado</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

async function loadLeads() {
  const leads = await adminRequest('/api/integracion/appsheet/leads');
  renderLeads(leads);
  return leads;
}

async function loadHistorial() {
  const destino = String(el.histDestino.value || '').trim();
  const desde = String(el.histDesde.value || '').trim();
  const hasta = String(el.histHasta.value || '').trim();
  const query = new URLSearchParams();
  if (destino) query.set('destino', destino);
  if (desde) query.set('desde', desde);
  if (hasta) query.set('hasta', hasta);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const historial = await adminRequest(`/api/integracion/appsheet/historial-credenciales${suffix}`);
  el.historial.textContent = JSON.stringify(historial.slice(0, 30), null, 2);
}

async function loadSmtpStatus() {
  const status = await adminRequest('/api/integracion/appsheet/smtp-status');
  el.smtpStatus.textContent = JSON.stringify(status, null, 2);
}

async function sendSmtpTest() {
  const to = String(el.smtpTestTo.value || '').trim();
  if (!to) {
    throw new Error('Correo de prueba requerido');
  }

  const result = await adminRequest('/api/integracion/appsheet/smtp-test', {
    method: 'POST',
    body: JSON.stringify({ to }),
  });

  el.smtpStatus.textContent = JSON.stringify(result, null, 2);
}

async function connectAdmin() {
  try {
    const session = await adminRequest('/api/admin/session');
    state.session = session;
    el.authStatus.textContent = `Sesion activa: ${session.username}`;
    setAdminLockState(true);
    const [, , metricas, leads] = await Promise.all([
      loadInventario(),
      loadVentas(),
      loadMetricas(),
      loadLeads(),
      loadHistorial(),
      loadPaquetes(),
      loadSmtpStatus(),
    ]);
    state.realtime.lastSignature = createRealtimeSnapshot(metricas, leads);
    state.realtime.lastSyncAt = Date.now();
    startRealtime();
    showToast('Back-office conectado');
  } catch (error) {
    state.session = null;
    el.authStatus.textContent = 'Error de autenticacion';
    setAdminLockState(false);
    stopRealtime();
    updateRealtimeStatusLabel();
    showToast(error.message, true);
  }
}

el.disenoForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(el.disenoForm);
  const payload = Object.fromEntries(formData.entries());
  payload.precioKit = Number(payload.precioKit || 0);
  payload.areaBaseM2 = 100;
  payload.incluye = [];
  payload.insumos = [];
  payload.canales = ['AppSheet'];

  try {
    await adminRequest('/api/integracion/appsheet/disenos/cargar', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    el.disenoForm.reset();
    showToast('Diseno guardado');
  } catch (error) {
    showToast(error.message, true);
  }
});

el.refresh.addEventListener('click', loadMetricas);
el.histFiltrar.addEventListener('click', loadHistorial);
el.histExport.addEventListener('click', () => {
  const destino = String(el.histDestino.value || '').trim();
  const desde = String(el.histDesde.value || '').trim();
  const hasta = String(el.histHasta.value || '').trim();
  const query = new URLSearchParams();
  if (destino) query.set('destino', destino);
  if (desde) query.set('desde', desde);
  if (hasta) query.set('hasta', hasta);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const url = `/api/integracion/looker/historial-credenciales.csv${suffix}`;
  fetch(url, { credentials: 'same-origin' })
    .then((res) => res.text())
    .then((csv) => {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'historial-credenciales.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      showToast('CSV exportado');
    })
    .catch((error) => showToast(error.message, true));
});

el.paqForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await guardarPaqueteDesdeFormulario();
  } catch (error) {
    showToast(error.message, true);
  }
});

el.paqCotizarBtn.addEventListener('click', async () => {
  try {
    await cotizarPaquete(String(el.paqCotizarId.value || '').trim());
  } catch (error) {
    showToast(error.message, true);
  }
});

el.smtpStatusBtn.addEventListener('click', async () => {
  try {
    await loadSmtpStatus();
    showToast('Estado SMTP actualizado');
  } catch (error) {
    showToast(error.message, true);
  }
});

el.smtpTestBtn.addEventListener('click', async () => {
  try {
    await sendSmtpTest();
    showToast('Prueba SMTP ejecutada');
  } catch (error) {
    showToast(error.message, true);
  }
});

el.realtimeToggle.addEventListener('click', () => {
  state.realtime.enabled = !state.realtime.enabled;
  if (state.realtime.enabled) {
    startRealtime();
    showToast('Tiempo real activado');
  } else {
    stopRealtime();
    updateRealtimeStatusLabel();
    showToast('Tiempo real pausado');
  }
});

el.logoutBtn.addEventListener('click', async () => {
  try {
    await adminRequest('/api/admin/logout', { method: 'POST' });
  } catch (_error) {
  } finally {
    stopRealtime();
    window.location.href = '/admin-login.html';
  }
});

(function bootstrap() {
  setAdminLockState(false);
  updateRealtimeStatusLabel();
  connectAdmin();
})();
