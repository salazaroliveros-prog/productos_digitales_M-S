const currency = new Intl.NumberFormat('es-GT', {
  style: 'currency',
  currency: 'GTQ',
  maximumFractionDigits: 2,
});

const STORAGE_TOKEN_KEY = 'wmms_client_token';

const state = {
  disenos: [],
  cotizaciones: {},
  session: {
    token: localStorage.getItem(STORAGE_TOKEN_KEY) || '',
    profile: null,
  },
};

const el = {
  catalogo: document.getElementById('catalogo-grid'),
  dashboard: document.getElementById('dashboard-grid'),
  leadForm: document.getElementById('lead-form'),
  ventaForm: document.getElementById('venta-form'),
  ventaDiseno: document.getElementById('venta-diseno'),
  accessForm: document.getElementById('access-form'),
  registerForm: document.getElementById('register-form'),
  accessStatus: document.getElementById('access-status'),
  logoutBtn: document.getElementById('logout-btn'),
  toast: document.getElementById('toast'),
};

function showToast(message, isError = false) {
  el.toast.textContent = message;
  el.toast.className = `toast ${isError ? 'error' : 'ok'}`;
  el.toast.style.opacity = '1';
  setTimeout(() => {
    el.toast.style.opacity = '0';
  }, 2600);
}

function setClientSession(token, profile = null) {
  state.session.token = token || '';
  state.session.profile = profile;
  if (state.session.token) {
    localStorage.setItem(STORAGE_TOKEN_KEY, state.session.token);
  } else {
    localStorage.removeItem(STORAGE_TOKEN_KEY);
  }
  renderAccessStatus();
}

function renderAccessStatus() {
  const profile = state.session.profile;
  if (!profile) {
    el.accessStatus.textContent = 'Modo publico: solo contenido abierto.';
    return;
  }

  const compras = profile.comprasPagadas?.map((item) => item.disenoId || item).filter(Boolean) || [];
  const comprasText = compras.length > 0 ? compras.join(', ') : 'sin compras pagadas';
  el.accessStatus.textContent = `Cliente: ${profile.email} | Nivel: ${profile.nivelAcceso} | Compras: ${comprasText}`;
}

async function request(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (state.session.token) {
    headers.Authorization = `Bearer ${state.session.token}`;
  }

  const response = await fetch(url, {
    headers,
    ...options,
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || 'Error de solicitud');
  }
  return body;
}

function cardTemplate(diseno) {
  const locked = Boolean(diseno.bloqueado);
  const lockBadge = locked ? '<span class="badge lock">Premium bloqueado</span>' : '';
  const imageBlock = diseno.imagenBase64
    ? `<figure class="card-media"><img src="${diseno.imagenBase64}" alt="Render ${diseno.nombre}" loading="lazy" /></figure>`
    : '';

  return `
    <article class="card ${locked ? 'locked' : ''}">
      ${imageBlock}
      <div class="card-head">
        <span class="badge">${diseno.categoria}</span>
        ${lockBadge}
        <h3>${diseno.nombre}</h3>
        <p>${diseno.descripcion}</p>
      </div>

      <dl class="meta">
        <div><dt>Dimensiones</dt><dd>${diseno.dimensiones}</dd></div>
        <div><dt>Area base</dt><dd>${diseno.areaBaseM2} m2</dd></div>
        <div><dt>Estilo</dt><dd>${diseno.estilo}</dd></div>
      </dl>

      <ul class="includes">
        ${diseno.incluye.map((item) => `<li>${item}</li>`).join('')}
      </ul>

      <div class="quote-controls">
        <label for="area-${diseno.id}">Area para cotizar</label>
        <input id="area-${diseno.id}" type="range" min="40" max="600" step="1" value="${Math.round(diseno.areaBaseM2)}" data-diseno-id="${diseno.id}" class="area-range" ${locked ? 'disabled' : ''} />
        <div class="range-row">
          <span id="area-value-${diseno.id}">${Math.round(diseno.areaBaseM2)} m2</span>
          <button type="button" class="btn ghost btn-cotizar" data-diseno-id="${diseno.id}" ${locked ? 'disabled' : ''}>Calcular</button>
        </div>
      </div>

      <div class="quote-result" id="quote-${diseno.id}">
        <div><span>Materiales</span><strong>${currency.format(0)}</strong></div>
        <div><span>Mano de obra</span><strong>${currency.format(0)}</strong></div>
        <div class="total"><span>Total</span><strong>${currency.format(0)}</strong></div>
      </div>

      <div class="actions">
        <button type="button" class="btn primary btn-whatsapp" data-diseno-id="${diseno.id}" ${locked ? 'disabled' : ''}>WhatsApp</button>
        <button type="button" class="btn" data-fill-venta="${diseno.id}">Registrar venta</button>
      </div>
    </article>
  `;
}

function renderCatalogo() {
  el.catalogo.innerHTML = state.disenos.map(cardTemplate).join('');

  document.querySelectorAll('.area-range').forEach((input) => {
    input.addEventListener('input', (event) => {
      const target = event.currentTarget;
      const disenoId = target.dataset.disenoId;
      const value = Number(target.value);
      const areaLabel = document.getElementById(`area-value-${disenoId}`);
      areaLabel.textContent = `${value} m2`;
    });
  });

  document.querySelectorAll('.btn-cotizar').forEach((button) => {
    button.addEventListener('click', () => {
      const disenoId = button.dataset.disenoId;
      const diseno = state.disenos.find((item) => item.id === disenoId);
      if (diseno?.bloqueado) {
        showToast('Contenido premium bloqueado para este cliente.', true);
        return;
      }

      const area = Number(document.getElementById(`area-${disenoId}`).value);
      cotizar(disenoId, area);
    });
  });

  document.querySelectorAll('.btn-whatsapp').forEach((button) => {
    button.addEventListener('click', () => {
      const disenoId = button.dataset.disenoId;
      const diseno = state.disenos.find((item) => item.id === disenoId);
      if (diseno?.bloqueado) {
        showToast('Producto premium bloqueado. Debe existir compra pagada.', true);
        return;
      }

      const quote = state.cotizaciones[disenoId];
      const total = quote ? currency.format(quote.total) : 'por cotizar';
      const text = encodeURIComponent(
        `Hola CONSTRUCTORA WM/M&S, me interesa ${diseno.nombre}. Total estimado: ${total}. Quiero informacion para continuar.`
      );
      window.open(`https://wa.me/?text=${text}`, '_blank');
    });
  });

  document.querySelectorAll('[data-fill-venta]').forEach((button) => {
    button.addEventListener('click', () => {
      el.ventaDiseno.value = button.dataset.fillVenta;
      el.ventaDiseno.scrollIntoView({ behavior: 'smooth', block: 'center' });
      showToast('Diseno cargado en formulario de venta');
    });
  });
}

function updateQuoteView(disenoId, quote) {
  const quoteContainer = document.getElementById(`quote-${disenoId}`);
  if (!quoteContainer) return;

  quoteContainer.innerHTML = `
    <div><span>Materiales</span><strong>${currency.format(quote.totalMateriales)}</strong></div>
    <div><span>Mano de obra</span><strong>${currency.format(quote.totalManoObra)}</strong></div>
    <div class="total"><span>Total</span><strong>${currency.format(quote.total)}</strong></div>
  `;
}

async function cotizar(disenoId, areaM2) {
  try {
    const quote = await request('/api/cotizar', {
      method: 'POST',
      body: JSON.stringify({ disenoId, areaM2, wasteFactor: 0.05 }),
    });
    state.cotizaciones[disenoId] = quote;
    updateQuoteView(disenoId, quote);
    showToast(`Cotizacion actualizada para ${quote.disenoNombre}`);
  } catch (error) {
    showToast(error.message, true);
  }
}

async function loadDisenos() {
  state.disenos = await request('/api/disenos');
  renderCatalogo();

  el.ventaDiseno.innerHTML = '<option value="">Selecciona un producto</option>';
  state.disenos.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = `${item.nombre} (${item.categoria})`;
    el.ventaDiseno.appendChild(option);
  });
}

async function loadDashboard() {
  const dashboard = await request('/api/dashboard');
  const channels = Object.entries(dashboard.porCanal || {})
    .map(([key, value]) => `<li><span>${key}</span><strong>${value}</strong></li>`)
    .join('');

  el.dashboard.innerHTML = `
    <article class="metric">
      <h4>Ingresos (pagado)</h4>
      <p>${currency.format(dashboard.ingresos || 0)}</p>
    </article>
    <article class="metric">
      <h4>Ventas registradas</h4>
      <p>${dashboard.totalVentas || 0}</p>
    </article>
    <article class="metric">
      <h4>Leads capturados</h4>
      <p>${dashboard.totalLeads || 0}</p>
    </article>
    <article class="metric">
      <h4>Conversion aprox.</h4>
      <p>${dashboard.conversionAprox || 0}%</p>
    </article>
    <article class="metric span-2">
      <h4>Ventas por canal</h4>
      <ul class="channels">${channels || '<li>Sin datos</li>'}</ul>
    </article>
  `;
}

async function refreshSessionFromToken() {
  if (!state.session.token) {
    setClientSession('', null);
    return;
  }

  try {
    const profile = await request('/api/auth/me');
    setClientSession(state.session.token, profile);
  } catch (_error) {
    setClientSession('', null);
  }
}

function bindForms() {
  el.leadForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(el.leadForm);
    try {
      await request('/api/leads', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(formData.entries())),
      });
      el.leadForm.reset();
      await loadDashboard();
      showToast('Lead registrado correctamente');
    } catch (error) {
      showToast(error.message, true);
    }
  });

  el.ventaForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(el.ventaForm);
    const payload = Object.fromEntries(formData.entries());

    const quote = state.cotizaciones[payload.disenoId];
    if (!payload.monto && quote) {
      payload.monto = quote.total;
    }

    try {
      const ventaResponse = await request('/api/ventas', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      el.ventaForm.reset();
      await loadDashboard();
      if (ventaResponse.entregaAutomatica && ventaResponse.venta?.enlaceEntrega) {
        showToast('Venta pagada: enlace de entrega generado automaticamente');
      } else {
        showToast('Venta registrada correctamente');
      }
    } catch (error) {
      showToast(error.message, true);
    }
  });

  el.accessForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(el.accessForm);
    const email = String(formData.get('email') || '').trim();

    try {
      const login = await request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setClientSession(login.token, {
        email: login.cliente.email,
        nivelAcceso: login.cliente.nivelAcceso,
        comprasPagadas: login.cliente.comprasPagadas,
      });
      await loadDisenos();
      showToast(`Sesion iniciada para ${login.cliente.email}`);
    } catch (error) {
      showToast(`${error.message}. Si aun no tienes cuenta, usa el registro rapido.`, true);
    }
  });

  el.registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(el.registerForm);
    const payload = Object.fromEntries(formData.entries());

    try {
      const registro = await request('/api/auth/registro', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (registro.token && registro.cliente) {
        setClientSession(registro.token, {
          email: registro.cliente.email,
          nivelAcceso: registro.cliente.nivelAcceso,
          comprasPagadas: registro.cliente.comprasPagadas,
        });
        await loadDisenos();
        showToast('Cliente existente detectado. Sesion iniciada automaticamente.');
        return;
      }

      const accessEmail = document.getElementById('access-email');
      accessEmail.value = payload.email || '';
      el.registerForm.reset();
      await loadDashboard();
      showToast(registro.mensaje || 'Registro guardado. Puedes continuar con productos publicos.');
    } catch (error) {
      showToast(error.message, true);
    }
  });

  el.logoutBtn.addEventListener('click', async () => {
    setClientSession('', null);
    await loadDisenos();
    showToast('Sesion cerrada. Modo publico activo.');
  });
}

async function bootstrap() {
  try {
    await request('/api/health');
    await refreshSessionFromToken();
    await Promise.all([loadDisenos(), loadDashboard()]);
    bindForms();
    showToast('Sistema listo: CONSTRUCTORA WM/M&S');
  } catch (error) {
    showToast(`Error de inicio: ${error.message}`, true);
  }
}

bootstrap();
