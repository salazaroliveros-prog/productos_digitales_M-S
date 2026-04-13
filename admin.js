const state = {
  session: null,
  inventarioRows: [],
  comprobantesRows: [],
  comprobantePreview: {
    index: -1,
    zoom: 1,
    rotation: 0,
  },
  historialRows: [],
  historialView: {
    sortKey: 'fecha',
    sortDir: 'desc',
    page: 1,
    pageSize: 20,
  },
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
  invAdjustPct: document.getElementById('inv-adjust-pct'),
  invAdjustIncludePct: document.getElementById('inv-adjust-include-pct'),
  invAdjustApply: document.getElementById('inv-adjust-apply'),
  disenoForm: document.getElementById('admin-diseno-form'),
  ventas: document.getElementById('admin-ventas'),
  kpis: document.getElementById('admin-kpis'),
  metricas: document.getElementById('admin-metricas'),
  topDisenos: document.getElementById('admin-top-disenos'),
  consultas: document.getElementById('admin-consultas'),
  leads: document.getElementById('admin-leads'),
  comprobantes: document.getElementById('admin-comprobantes'),
  compSummary: document.getElementById('comp-summary'),
  compRefresh: document.getElementById('comp-refresh'),
  compPreviewModal: document.getElementById('comp-preview-modal'),
  compPreviewBody: document.getElementById('comp-preview-body'),
  compPreviewClose: document.getElementById('comp-preview-close'),
  compPreviewPrev: document.getElementById('comp-preview-prev'),
  compPreviewNext: document.getElementById('comp-preview-next'),
  compPreviewZoomIn: document.getElementById('comp-preview-zoom-in'),
  compPreviewZoomOut: document.getElementById('comp-preview-zoom-out'),
  compPreviewRotate: document.getElementById('comp-preview-rotate'),
  compPreviewReset: document.getElementById('comp-preview-reset'),
  metDesde: document.getElementById('met-desde'),
  metHasta: document.getElementById('met-hasta'),
  refresh: document.getElementById('admin-refresh'),
  histDestino: document.getElementById('hist-destino'),
  histDesde: document.getElementById('hist-desde'),
  histHasta: document.getElementById('hist-hasta'),
  histEstado: document.getElementById('hist-estado'),
  histSearch: document.getElementById('hist-search'),
  histPageSize: document.getElementById('hist-page-size'),
  histPageLabel: document.getElementById('hist-page-label'),
  histPagePrev: document.getElementById('hist-page-prev'),
  histPageNext: document.getElementById('hist-page-next'),
  histFiltrar: document.getElementById('hist-filtrar'),
  histExport: document.getElementById('hist-export'),
  historialSummary: document.getElementById('historial-summary'),
  historialTable: document.getElementById('historial-table'),
  historial: document.getElementById('admin-historial'),
  smtpStatus: document.getElementById('smtp-status'),
  smtpSummary: document.getElementById('smtp-summary'),
  smtpTable: document.getElementById('smtp-table'),
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
const money = new Intl.NumberFormat('es-GT', {
  style: 'currency',
  currency: 'GTQ',
  maximumFractionDigits: 2,
});

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
    topComprobanteId:
      Array.isArray(state.comprobantesRows) && state.comprobantesRows.length > 0
        ? String(state.comprobantesRows[0].id || 'none')
        : 'none',
  };
}

function shouldActivateFastMode(previousSnapshot, currentSnapshot) {
  if (!previousSnapshot || !currentSnapshot) return false;
  const hasNewLead = currentSnapshot.topLeadId !== previousSnapshot.topLeadId;
  const hasNewQuote = currentSnapshot.cotizacionesCliente > previousSnapshot.cotizacionesCliente;
  const hasNewComprobante = currentSnapshot.topComprobanteId !== previousSnapshot.topComprobanteId;
  return hasNewLead || hasNewQuote || hasNewComprobante;
}

function getFastModeReason(previousSnapshot, currentSnapshot) {
  if (!previousSnapshot || !currentSnapshot) return '';

  const hasNewLead = currentSnapshot.topLeadId !== previousSnapshot.topLeadId;
  const hasNewQuote = currentSnapshot.cotizacionesCliente > previousSnapshot.cotizacionesCliente;
  const hasNewComprobante = currentSnapshot.topComprobanteId !== previousSnapshot.topComprobanteId;

  if (hasNewLead && hasNewQuote) return 'nuevo lead y nueva cotizacion';
  if (hasNewComprobante && hasNewLead) return 'nuevo comprobante y lead';
  if (hasNewComprobante) return 'nuevo comprobante';

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
    const [, metricas, leads] = await Promise.all([loadVentas(), loadMetricas(), loadLeads(), loadComprobantes()]);
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
  const groups = {
    tarifas: {
      title: 'Tarifas por m2 (parametricas)',
      desc: 'Define rangos base por tipo de vivienda y obra publica. Estas tarifas mueven la calculadora anual.',
      items: [],
    },
    factores: {
      title: 'Factores porcentuales',
      desc: 'Prestaciones, indirectos y fletes. Se aplican como porcentaje sobre el subtotal base.',
      items: [],
    },
    manoObra: {
      title: 'Jornales de mano de obra',
      desc: 'Valores de referencia para cuadrillas y analisis de costo local.',
      items: [],
    },
    materiales: {
      title: 'Materiales base',
      desc: 'Precios unitarios de insumos constructivos. Ajustalos conforme mercado local.',
      items: [],
    },
  };

  const classifyItem = (item) => {
    const id = String(item.id || '');
    if (id.startsWith('RATE-')) return 'tarifas';
    if (id.startsWith('FAC-')) return 'factores';
    if (id.startsWith('LAB-')) return 'manoObra';
    return 'materiales';
  };

  const renderValue = (value, isPct) => {
    const number = Number(value || 0);
    return isPct ? Number((number * 100).toFixed(3)) : number;
  };

  const previewRange = (item, isPct) => {
    const low = Number(item.costoMaterial || 0);
    const high = Number(item.costoManoObra || 0);
    if (isPct) {
      return `${(low * 100).toFixed(2)}% - ${(high * 100).toFixed(2)}%`;
    }
    return `${money.format(low)} - ${money.format(high)}`;
  };

  items.forEach((item) => {
    const key = classifyItem(item);
    groups[key].items.push(item);
  });

  const order = ['tarifas', 'factores', 'manoObra', 'materiales'];
  el.inventario.innerHTML = order
    .map((key) => {
      const group = groups[key];
      if (!group.items.length) return '';

      const cards = group.items
        .map((item) => {
          const isPct = String(item.unidad || '').toLowerCase() === 'pct';
          return `
          <article class="form-card inventory-card">
            <p class="mini-label">${isPct ? 'factor porcentual' : `unidad ${escapeHtml(item.unidad || '-')}`}</p>
            <h3>${escapeHtml(item.nombre)} (${escapeHtml(item.id)})</h3>
            <p class="inventory-meta">Rango actual: ${escapeHtml(previewRange(item, isPct))}</p>
            <div class="inline-form">
              <div class="field">
                <label>${isPct ? 'Valor minimo (%)' : 'Valor base'}</label>
                <input id="mat-${item.id}" data-unit="${isPct ? 'pct' : 'abs'}" type="number" step="0.01" value="${renderValue(item.costoMaterial, isPct)}" />
              </div>
              <div class="field">
                <label>${isPct ? 'Valor maximo (%)' : 'Valor tope'}</label>
                <input id="mo-${item.id}" data-unit="${isPct ? 'pct' : 'abs'}" type="number" step="0.01" value="${renderValue(item.costoManoObra, isPct)}" />
              </div>
              <button class="btn primary" data-save-mat="${item.id}" type="button">Guardar</button>
            </div>
          </article>
        `;
        })
        .join('');

      return `
        <section class="inventory-section">
          <div class="section-headline">
            <div>
              <span class="mini-label">Parametros editables</span>
              <h3>${escapeHtml(group.title)}</h3>
              <p>${escapeHtml(group.desc)}</p>
            </div>
          </div>
          <div class="catalog-grid">${cards}</div>
        </section>
      `;
    })
    .join('');

  document.querySelectorAll('[data-save-mat]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-save-mat');
      const matInput = document.getElementById(`mat-${id}`);
      const moInput = document.getElementById(`mo-${id}`);
      const isPct = matInput?.dataset.unit === 'pct';

      const costoMaterialRaw = Number(matInput?.value || 0);
      const costoManoObraRaw = Number(moInput?.value || 0);
      const costoMaterial = isPct ? costoMaterialRaw / 100 : costoMaterialRaw;
      const costoManoObra = isPct ? costoManoObraRaw / 100 : costoManoObraRaw;

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

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('es-GT');
}

function renderSmtpStatus(data = {}) {
  const smtp = data.smtp || data || {};
  const test = data.test || null;

  const configured = Boolean(smtp.configured);
  const transport = configured ? 'Configurado' : 'Incompleto';
  const secure = smtp.secure ? 'Si' : 'No';
  const host = smtp.host || '-';
  const from = smtp.from || '-';

  if (el.smtpSummary) {
    el.smtpSummary.innerHTML = [
      { label: 'Estado SMTP', value: transport },
      { label: 'Host', value: host },
      { label: 'Puerto', value: smtp.port ?? '-' },
      { label: 'Seguro TLS', value: secure },
      { label: 'Remitente', value: from, span2: true },
      { label: 'Ultima prueba', value: test ? (test.sent ? 'Enviada' : 'Simulada') : 'Sin prueba', span2: true },
    ]
      .map(
        (item) => `
        <article class="metric ${item.span2 ? 'span-2' : ''}">
          <h4>${item.label}</h4>
          <p>${escapeHtml(item.value)}</p>
        </article>
      `
      )
      .join('');
  }

  if (el.smtpTable) {
    el.smtpTable.innerHTML = `
      <table class="admin-table">
        <thead>
          <tr><th>Parametro</th><th>Valor</th></tr>
        </thead>
        <tbody>
          <tr><td>configured</td><td><span class="status-pill ${configured ? 'ok' : 'warn'}">${configured ? 'true' : 'false'}</span></td></tr>
          <tr><td>host</td><td>${escapeHtml(host)}</td></tr>
          <tr><td>port</td><td>${escapeHtml(smtp.port ?? '-')}</td></tr>
          <tr><td>secure</td><td>${escapeHtml(secure)}</td></tr>
          <tr><td>from</td><td>${escapeHtml(from)}</td></tr>
          <tr><td>userConfigured</td><td>${escapeHtml(Boolean(smtp.userConfigured))}</td></tr>
          <tr><td>passConfigured</td><td>${escapeHtml(Boolean(smtp.passConfigured))}</td></tr>
        </tbody>
      </table>
    `;
  }

  el.smtpStatus.textContent = JSON.stringify(data, null, 2);
}

function normalizeHistorialEstado(row = {}) {
  const estado = String(row.estado || '').toLowerCase();
  if (row.reenviado) return 'reenviado';
  if (estado.includes('error') || estado.includes('fall')) return 'error';
  return 'ok';
}

function getFilteredHistorialRows() {
  const estado = String(el.histEstado?.value || '').trim();
  const search = String(el.histSearch?.value || '').trim().toLowerCase();

  return state.historialRows.filter((row) => {
    const rowEstado = normalizeHistorialEstado(row);
    if (estado && rowEstado !== estado) {
      return false;
    }

    if (search) {
      const haystack = `${row.ventaId || ''} ${row.destino || ''}`.toLowerCase();
      if (!haystack.includes(search)) {
        return false;
      }
    }

    return true;
  });
}

function getSortValue(row = {}, key = 'fecha') {
  if (key === 'fecha') {
    return new Date(row.fecha || 0).getTime();
  }
  if (key === 'estado') {
    return normalizeHistorialEstado(row);
  }
  return String(row[key] || '').toLowerCase();
}

function getSortedHistorialRows(rows = []) {
  const { sortKey, sortDir } = state.historialView;
  const factor = sortDir === 'asc' ? 1 : -1;

  return [...rows].sort((a, b) => {
    const left = getSortValue(a, sortKey);
    const right = getSortValue(b, sortKey);
    if (left === right) return 0;
    return left > right ? factor : -factor;
  });
}

function updateHistorialPager(totalRows) {
  const pageSize = Number(state.historialView.pageSize || 20);
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  state.historialView.page = Math.min(Math.max(1, state.historialView.page), totalPages);

  if (el.histPageLabel) {
    el.histPageLabel.textContent = `Pagina ${state.historialView.page} de ${totalPages} · ${totalRows} registros`;
  }
  if (el.histPagePrev) {
    el.histPagePrev.disabled = state.historialView.page <= 1;
  }
  if (el.histPageNext) {
    el.histPageNext.disabled = state.historialView.page >= totalPages;
  }

  return { pageSize, totalPages };
}

function getHistorialSortLabel(key) {
  if (state.historialView.sortKey !== key) return '';
  return state.historialView.sortDir === 'asc' ? ' ▲' : ' ▼';
}

function csvCell(value) {
  const text = String(value ?? '');
  if (text.includes('"') || text.includes(',') || text.includes('\n')) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function buildHistorialCsv(rows = []) {
  const header = ['fecha', 'ventaId', 'destino', 'accion', 'modoEnvio', 'estado', 'solicitadoPor'];
  const lines = [header.join(',')];

  rows.forEach((row) => {
    const line = [
      formatDateTime(row.fecha),
      row.ventaId || '',
      row.destino || '',
      row.accion || '',
      row.modoEnvio || '',
      normalizeHistorialEstado(row),
      row.solicitadoPor || '',
    ].map(csvCell);
    lines.push(line.join(','));
  });

  return lines.join('\n');
}

function renderHistorial(rows = []) {
  if (el.historialSummary) {
    const okCount = rows.filter((row) => normalizeHistorialEstado(row) === 'ok').length;
    const errorCount = rows.filter((row) => normalizeHistorialEstado(row) === 'error').length;
    const reenviados = rows.filter((row) => Boolean(row.reenviado)).length;
    const envioReal = rows.filter((row) => Boolean(row.envioReal)).length;

    el.historialSummary.innerHTML = [
      { label: 'Registros filtrados', value: rows.length },
      { label: 'Exitosos', value: okCount },
      { label: 'Con error', value: errorCount },
      { label: 'Reenvios', value: reenviados },
      { label: 'Envio SMTP real', value: envioReal },
    ]
      .map(
        (item) => `
        <article class="metric">
          <h4>${item.label}</h4>
          <p>${escapeHtml(item.value)}</p>
        </article>
      `
      )
      .join('');
  }

  if (!el.historialTable) return;

  if (!rows.length) {
    updateHistorialPager(0);
    el.historialTable.innerHTML = '<p>No hay registros para el filtro actual.</p>';
    return;
  }

  const sortedRows = getSortedHistorialRows(rows);
  const { pageSize } = updateHistorialPager(sortedRows.length);
  const offset = (state.historialView.page - 1) * pageSize;
  const pagedRows = sortedRows.slice(offset, offset + pageSize);

  const body = pagedRows
    .map((row) => {
      const estado = normalizeHistorialEstado(row);
      return `
      <tr>
        <td>${escapeHtml(formatDateTime(row.fecha))}</td>
        <td>${escapeHtml(row.ventaId || '-')}</td>
        <td>${escapeHtml(row.destino || '-')}</td>
        <td>${escapeHtml(row.accion || '-')}</td>
        <td>${escapeHtml(row.modoEnvio || '-')}</td>
        <td><span class="status-pill ${estado === 'ok' ? 'ok' : estado === 'error' ? 'error' : 'warn'}">${escapeHtml(estado)}</span></td>
        <td>${escapeHtml(row.solicitadoPor || '-')}</td>
      </tr>
    `;
    })
    .join('');

  el.historialTable.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr>
          <th><button type="button" class="table-sort ${state.historialView.sortKey === 'fecha' ? 'is-active' : ''}" data-sort-key="fecha">Fecha${getHistorialSortLabel('fecha')}</button></th>
          <th><button type="button" class="table-sort ${state.historialView.sortKey === 'ventaId' ? 'is-active' : ''}" data-sort-key="ventaId">Venta${getHistorialSortLabel('ventaId')}</button></th>
          <th><button type="button" class="table-sort ${state.historialView.sortKey === 'destino' ? 'is-active' : ''}" data-sort-key="destino">Destino${getHistorialSortLabel('destino')}</button></th>
          <th><button type="button" class="table-sort ${state.historialView.sortKey === 'accion' ? 'is-active' : ''}" data-sort-key="accion">Accion${getHistorialSortLabel('accion')}</button></th>
          <th><button type="button" class="table-sort ${state.historialView.sortKey === 'modoEnvio' ? 'is-active' : ''}" data-sort-key="modoEnvio">Modo${getHistorialSortLabel('modoEnvio')}</button></th>
          <th><button type="button" class="table-sort ${state.historialView.sortKey === 'estado' ? 'is-active' : ''}" data-sort-key="estado">Estado${getHistorialSortLabel('estado')}</button></th>
          <th><button type="button" class="table-sort ${state.historialView.sortKey === 'solicitadoPor' ? 'is-active' : ''}" data-sort-key="solicitadoPor">Solicitado por${getHistorialSortLabel('solicitadoPor')}</button></th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

function refreshHistorialView() {
  renderHistorial(getFilteredHistorialRows());
}

function resetHistorialToFirstPage() {
  state.historialView.page = 1;
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
  state.inventarioRows = Array.isArray(inv) ? inv : [];
  renderInventario(inv);
}

async function applyAnnualInventoryAdjustment() {
  const pct = Number(el.invAdjustPct?.value || 0);
  if (!Number.isFinite(pct)) {
    throw new Error('Porcentaje anual invalido');
  }

  if (!state.inventarioRows.length) {
    throw new Error('Inventario vacio, recarga la seccion');
  }

  const includePctFactors = Boolean(el.invAdjustIncludePct?.checked);
  const multiplier = 1 + pct / 100;

  const targets = state.inventarioRows.filter((item) => {
    const isPct = String(item.unidad || '').toLowerCase() === 'pct';
    return includePctFactors || !isPct;
  });

  if (!targets.length) {
    throw new Error('No hay registros para actualizar con la configuracion seleccionada');
  }

  if (!confirm(`Aplicar ajuste anual de ${pct.toFixed(2)}% a ${targets.length} registros?`)) {
    return;
  }

  await Promise.all(
    targets.map((item) => {
      const costoMaterial = Number((Number(item.costoMaterial || 0) * multiplier).toFixed(6));
      const costoManoObra = Number((Number(item.costoManoObra || 0) * multiplier).toFixed(6));
      return adminRequest(`/api/integracion/appsheet/materiales/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ costoMaterial, costoManoObra, region: item.region || 'Jutiapa' }),
      });
    })
  );

  await loadInventario();
  showToast(`Ajuste anual aplicado a ${targets.length} registros`);
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

function normalizeComprobanteEstado(value) {
  const estado = String(value || '').toLowerCase();
  if (estado.includes('valid')) return 'validado';
  if (estado.includes('rechaz')) return 'rechazado';
  return 'pendiente-validacion';
}

function closeComprobantePreview() {
  if (!el.compPreviewModal || !el.compPreviewBody) return;
  el.compPreviewBody.innerHTML = '';
  el.compPreviewModal.classList.add('hidden');
  state.comprobantePreview.index = -1;
  state.comprobantePreview.zoom = 1;
  state.comprobantePreview.rotation = 0;
}

function applyPreviewImageTransform() {
  const image = el.compPreviewBody?.querySelector('.comp-preview-image');
  if (!image) return false;

  const { zoom, rotation } = state.comprobantePreview;
  image.style.transform = `scale(${zoom}) rotate(${rotation}deg)`;
  image.style.transformOrigin = 'center center';
  return true;
}

function renderCurrentComprobantePreview() {
  if (!el.compPreviewModal || !el.compPreviewBody) return;
  const current = state.comprobantesRows[state.comprobantePreview.index];
  if (!current) return;

  const cleanPath = String(current.filePath || '').trim().replace(/\\/g, '/');
  if (!cleanPath) {
    showToast('Comprobante sin ruta de archivo', true);
    return;
  }

  const safeUrl = cleanPath.startsWith('/') ? cleanPath : `/${cleanPath}`;
  const type = String(current.mimeType || '').toLowerCase();

  if (type.includes('pdf') || safeUrl.toLowerCase().endsWith('.pdf')) {
    el.compPreviewBody.innerHTML = `
      <iframe src="${encodeURI(safeUrl)}" title="Vista previa PDF" class="comp-preview-frame"></iframe>
      <p><strong>${escapeHtml(current.id || '')}</strong> · ${escapeHtml(current.nombre || '')}</p>
      <p><a href="${encodeURI(safeUrl)}" target="_blank" rel="noreferrer noopener">Abrir PDF en nueva pestana</a></p>
    `;
  } else {
    el.compPreviewBody.innerHTML = `
      <img src="${encodeURI(safeUrl)}" alt="Comprobante" class="comp-preview-image" />
      <p><strong>${escapeHtml(current.id || '')}</strong> · ${escapeHtml(current.nombre || '')}</p>
      <p><a href="${encodeURI(safeUrl)}" target="_blank" rel="noreferrer noopener">Abrir imagen en nueva pestana</a></p>
    `;
    applyPreviewImageTransform();
  }

  el.compPreviewModal.classList.remove('hidden');
}

function stepComprobantePreview(direction = 1) {
  if (!state.comprobantesRows.length) return;
  const total = state.comprobantesRows.length;
  const next = (state.comprobantePreview.index + direction + total) % total;
  state.comprobantePreview.index = next;
  state.comprobantePreview.zoom = 1;
  state.comprobantePreview.rotation = 0;
  renderCurrentComprobantePreview();
}

function openComprobantePreview(comprobanteId) {
  if (!el.compPreviewModal || !el.compPreviewBody) return;

  const index = state.comprobantesRows.findIndex((item) => item.id === comprobanteId);
  if (index < 0) {
    showToast('Comprobante no encontrado', true);
    return;
  }

  state.comprobantePreview.index = index;
  state.comprobantePreview.zoom = 1;
  state.comprobantePreview.rotation = 0;
  renderCurrentComprobantePreview();
}

function renderComprobantes(rows = []) {
  state.comprobantesRows = Array.isArray(rows) ? rows : [];
  const all = state.comprobantesRows;
  const pendientes = all.filter((item) => normalizeComprobanteEstado(item.estado) === 'pendiente-validacion').length;
  const validados = all.filter((item) => normalizeComprobanteEstado(item.estado) === 'validado').length;
  const rechazados = all.filter((item) => normalizeComprobanteEstado(item.estado) === 'rechazado').length;

  if (el.compSummary) {
    el.compSummary.innerHTML = [
      { label: 'Total', value: all.length },
      { label: 'Pendientes', value: pendientes },
      { label: 'Validados', value: validados },
      { label: 'Rechazados', value: rechazados },
    ]
      .map(
        (card) => `
        <article class="metric">
          <h4>${card.label}</h4>
          <p>${card.value}</p>
        </article>
      `
      )
      .join('');
  }

  if (!el.comprobantes) return;
  if (!all.length) {
    el.comprobantes.innerHTML = '<p>No hay comprobantes cargados.</p>';
    return;
  }

  const body = all
    .slice(0, 30)
    .map((item) => {
      const estado = normalizeComprobanteEstado(item.estado);
      return `
      <tr>
        <td>${escapeHtml((item.fecha || '').replace('T', ' ').slice(0, 16))}</td>
        <td>${escapeHtml(item.id || '')}</td>
        <td>${escapeHtml(item.nombre || '')}</td>
        <td>${escapeHtml(item.telefono || '')}</td>
        <td>${escapeHtml(item.paqueteNombre || item.paqueteId || '-')}</td>
        <td><span class="status-pill ${estado === 'validado' ? 'ok' : estado === 'rechazado' ? 'error' : 'warn'}">${escapeHtml(estado)}</span></td>
        <td>
          <div class="inline-actions">
            <button type="button" class="btn ghost" data-comp-preview-id="${escapeHtml(item.id || '')}">VER</button>
            <button type="button" class="btn success" data-comp-action="validar" data-comp-id="${escapeHtml(item.id)}">VALIDAR</button>
            <button type="button" class="btn danger" data-comp-action="rechazar" data-comp-id="${escapeHtml(item.id)}">RECHAZAR</button>
          </div>
        </td>
      </tr>
    `;
    })
    .join('');

  el.comprobantes.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr><th>Fecha</th><th>ID</th><th>Cliente</th><th>Telefono</th><th>Paquete</th><th>Estado</th><th>Accion</th></tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

async function loadComprobantes() {
  const data = await adminRequest('/api/integracion/appsheet/comprobantes');
  renderComprobantes(data);
  return data;
}

async function updateComprobanteEstado(comprobanteId, estado) {
  const current = state.comprobantesRows.find((item) => item.id === comprobanteId);
  if (!current) {
    throw new Error('Comprobante no encontrado');
  }

  const notas = prompt(`Notas para ${estado} (${comprobanteId})`, '') || '';
  const ventaId = prompt('Venta ID relacionada (opcional, para activar entrega):', current.ventaId || '') || '';

  await adminRequest(`/api/integracion/appsheet/comprobantes/${encodeURIComponent(comprobanteId)}/validar`, {
    method: 'PATCH',
    body: JSON.stringify({
      estado,
      validadoPor: state.session?.username || 'admin-web',
      notas,
      ventaId,
    }),
  });

  await loadComprobantes();
  showToast(`Comprobante ${comprobanteId} actualizado: ${estado}`);
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
  state.historialRows = Array.isArray(historial) ? historial : [];
  resetHistorialToFirstPage();
  refreshHistorialView();
  el.historial.textContent = JSON.stringify(historial.slice(0, 30), null, 2);
}

async function loadSmtpStatus() {
  const status = await adminRequest('/api/integracion/appsheet/smtp-status');
  renderSmtpStatus(status);
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

  renderSmtpStatus(result);
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
      loadComprobantes(),
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
el.compRefresh?.addEventListener('click', async () => {
  try {
    await loadComprobantes();
    showToast('Comprobantes actualizados');
  } catch (error) {
    showToast(error.message, true);
  }
});
el.compPreviewClose?.addEventListener('click', closeComprobantePreview);
el.compPreviewModal?.addEventListener('click', (event) => {
  if (event.target === el.compPreviewModal) {
    closeComprobantePreview();
  }
});
el.compPreviewPrev?.addEventListener('click', () => stepComprobantePreview(-1));
el.compPreviewNext?.addEventListener('click', () => stepComprobantePreview(1));
el.compPreviewZoomIn?.addEventListener('click', () => {
  state.comprobantePreview.zoom = Math.min(3, Number((state.comprobantePreview.zoom + 0.2).toFixed(2)));
  if (!applyPreviewImageTransform()) {
    showToast('Zoom disponible solo para imagenes', true);
  }
});
el.compPreviewZoomOut?.addEventListener('click', () => {
  state.comprobantePreview.zoom = Math.max(0.4, Number((state.comprobantePreview.zoom - 0.2).toFixed(2)));
  if (!applyPreviewImageTransform()) {
    showToast('Zoom disponible solo para imagenes', true);
  }
});
el.compPreviewRotate?.addEventListener('click', () => {
  state.comprobantePreview.rotation = (state.comprobantePreview.rotation + 90) % 360;
  if (!applyPreviewImageTransform()) {
    showToast('Rotacion disponible solo para imagenes', true);
  }
});
el.compPreviewReset?.addEventListener('click', () => {
  state.comprobantePreview.zoom = 1;
  state.comprobantePreview.rotation = 0;
  if (!applyPreviewImageTransform()) {
    renderCurrentComprobantePreview();
  }
});
el.comprobantes?.addEventListener('click', async (event) => {
  const preview = event.target.closest('[data-comp-preview-id]');
  if (preview) {
    const comprobanteId = preview.getAttribute('data-comp-preview-id') || '';
    openComprobantePreview(comprobanteId);
    return;
  }

  const target = event.target.closest('[data-comp-action]');
  if (!target) return;

  const action = target.getAttribute('data-comp-action');
  const comprobanteId = target.getAttribute('data-comp-id');
  if (!comprobanteId) return;

  try {
    if (action === 'validar') {
      await updateComprobanteEstado(comprobanteId, 'validado');
      return;
    }
    if (action === 'rechazar') {
      await updateComprobanteEstado(comprobanteId, 'rechazado');
    }
  } catch (error) {
    showToast(error.message, true);
  }
});
el.invAdjustApply?.addEventListener('click', async () => {
  try {
    await applyAnnualInventoryAdjustment();
  } catch (error) {
    showToast(error.message, true);
  }
});
el.histFiltrar.addEventListener('click', loadHistorial);
el.histEstado?.addEventListener('change', () => {
  resetHistorialToFirstPage();
  refreshHistorialView();
});
el.histSearch?.addEventListener('input', () => {
  resetHistorialToFirstPage();
  refreshHistorialView();
});
el.histPageSize?.addEventListener('change', () => {
  state.historialView.pageSize = Number(el.histPageSize.value || 20);
  resetHistorialToFirstPage();
  refreshHistorialView();
});
el.histPagePrev?.addEventListener('click', () => {
  state.historialView.page = Math.max(1, state.historialView.page - 1);
  refreshHistorialView();
});
el.histPageNext?.addEventListener('click', () => {
  state.historialView.page = state.historialView.page + 1;
  refreshHistorialView();
});
el.historialTable?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-sort-key]');
  if (!button) return;
  const nextKey = String(button.getAttribute('data-sort-key') || '').trim();
  if (!nextKey) return;

  if (state.historialView.sortKey === nextKey) {
    state.historialView.sortDir = state.historialView.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    state.historialView.sortKey = nextKey;
    state.historialView.sortDir = nextKey === 'fecha' ? 'desc' : 'asc';
  }

  resetHistorialToFirstPage();
  refreshHistorialView();
});
el.histExport.addEventListener('click', () => {
  try {
    const rows = getSortedHistorialRows(getFilteredHistorialRows());
    const csv = buildHistorialCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'historial-credenciales-filtrado.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    showToast(`CSV exportado (${rows.length} registros)`);
  } catch (error) {
    showToast(error.message, true);
  }
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
