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

const debounceTimers = {};
let revealObserver = null;

const el = {
  catalogo: document.getElementById('catalogo-grid'),
  dashboard: document.getElementById('dashboard-grid'),
  leadForm: document.getElementById('lead-form'),
  accessForm: document.getElementById('access-form'),
  registerForm: document.getElementById('register-form'),
  accessStatus: document.getElementById('access-status'),
  logoutBtn: document.getElementById('logout-btn'),
  toast: document.getElementById('toast'),
  m2Slider: document.getElementById('m2Slider'),
  areaLabel: document.getElementById('areaLabel'),
  costoMat: document.getElementById('costoMat'),
  costoMO: document.getElementById('costoMO'),
  heroImage: document.getElementById('heroImage'),
  heroTitle: document.getElementById('heroTitle'),
  heroDesc: document.getElementById('heroDesc'),
  btnConstruirFuturo: document.getElementById('btnConstruirFuturo'),
  preciosFuente: document.getElementById('preciosFuente'),
};

const VITRINA_DEFAULT_RATES = { mat: 850.5, mo: 450, source: 'fallback-local' };
let vitrinaDisenoSeleccionado = null;
let vitrinaRates = { ...VITRINA_DEFAULT_RATES };

function showToast(message, isError = false) {
  if (!el.toast) {
    return;
  }
  el.toast.textContent = message;
  el.toast.className = `toast ${isError ? 'error' : 'ok'}`;
  el.toast.style.opacity = '1';
  setTimeout(() => {
    el.toast.style.opacity = '0';
  }, 2600);
}

function setSpotlightPosition(target, event) {
  const rect = target.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  target.style.setProperty('--mx', `${x}px`);
  target.style.setProperty('--my', `${y}px`);
}

function bindSpotlightEffects(scope = document) {
  const interactiveCards = Array.from(scope.querySelectorAll('.card, .route-card, .shell-section'));
  interactiveCards.forEach((node) => {
    if (node.dataset.spotlightBound === '1') return;
    node.dataset.spotlightBound = '1';
    node.addEventListener('pointermove', (event) => setSpotlightPosition(node, event));
  });
}

function registerRevealItems(scope = document) {
  const targets = Array.from(scope.querySelectorAll('.shell-section, .route-card, .card, .form-card, .metric'));
  if (!targets.length) return;

  if (!revealObserver) {
    revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          revealObserver.unobserve(entry.target);
        });
      },
      { threshold: 0.12 }
    );
  }

  targets.forEach((node, index) => {
    if (node.dataset.revealBound === '1') return;
    node.dataset.revealBound = '1';
    node.classList.add('reveal-item');
    node.style.transitionDelay = `${Math.min(index * 35, 260)}ms`;
    revealObserver.observe(node);
  });
}

function initInteractiveUi(scope = document) {
  bindSpotlightEffects(scope);
  registerRevealItems(scope);
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
  if (!el.accessStatus) {
    return;
  }

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
    : '<figure class="card-media card-media-placeholder"></figure>';

  return `
    <article class="card surgical-card ${locked ? 'locked' : ''}">
      ${imageBlock}
      <div class="card-head">
        <span class="badge">${diseno.categoria}</span>
        ${lockBadge}
        <h3>${diseno.nombre}</h3>
        <p>${diseno.descripcion}</p>
      </div>

      <dl class="meta surgical-meta">
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
        <div class="total"><span>Presupuesto estimado</span><strong>${currency.format(0)}</strong></div>
      </div>

      <div class="actions">
        <button type="button" class="btn primary btn-whatsapp" data-diseno-id="${diseno.id}" ${locked ? 'disabled' : ''}>Solicitar por WhatsApp</button>
        <button type="button" class="btn ghost" data-lead-diseno="${diseno.id}">Ver detalles</button>
      </div>
    </article>
  `;
}

function renderCatalogo() {
  if (!el.catalogo) {
    return;
  }

  el.catalogo.innerHTML = state.disenos.map(cardTemplate).join('');
  initInteractiveUi(el.catalogo);

  document.querySelectorAll('.area-range').forEach((input) => {
    input.addEventListener('input', (event) => {
      const target = event.currentTarget;
      const disenoId = target.dataset.disenoId;
      const value = Number(target.value);
      const areaLabel = document.getElementById(`area-value-${disenoId}`);
      areaLabel.textContent = `${value} m2`;

      const diseno = state.disenos.find((item) => item.id === disenoId);
      if (!diseno || diseno.bloqueado) return;

      clearTimeout(debounceTimers[disenoId]);
      debounceTimers[disenoId] = setTimeout(() => {
        cotizar(disenoId, value);
      }, 400);
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
    button.addEventListener('click', async () => {
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
      await sendTelemetry({
        disenoId,
        evento: 'click-whatsapp',
        detalle: `Intento de contacto por WhatsApp para ${diseno.nombre}`,
        origen: 'catalogo',
        canal: 'WhatsApp',
        areaM2: Number(document.getElementById(`area-${disenoId}`)?.value || 0),
      }, true);
      window.open(`https://wa.me/?text=${text}`, '_blank');
    });
  });

  document.querySelectorAll('[data-lead-diseno]').forEach((button) => {
    button.addEventListener('click', async () => {
      const disenoId = button.dataset.leadDiseno;
      const diseno = state.disenos.find((item) => item.id === disenoId);
      if (!diseno) {
        return;
      }
      await sendTelemetry({
        disenoId: diseno.id,
        evento: 'ver-detalles',
        detalle: `Apertura de detalle para ${diseno.nombre}`,
        origen: 'catalogo',
        canal: 'Web',
      }, true);
      const params = new URLSearchParams({
        disenoId: diseno.id,
        interes: diseno.categoria || '',
        mensaje: `Solicito informacion detallada sobre ${diseno.nombre} (${diseno.id}).`,
      });
      window.location.href = `./contacto.html?${params.toString()}`;
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

async function sendTelemetry(payload = {}, useKeepalive = false) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (state.session.token) {
      headers.Authorization = `Bearer ${state.session.token}`;
    }

    await fetch('/api/telemetria/consulta', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      keepalive: useKeepalive,
    });
  } catch (_error) {
  }
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
  if (!el.catalogo) {
    return;
  }
  state.disenos = await request('/api/disenos');
  renderCatalogo();
}

function renderVitrinaBootstrapQuote(areaM2) {
  if (!el.areaLabel || !el.costoMat || !el.costoMO) {
    return;
  }

  const matTotal = areaM2 * vitrinaRates.mat;
  const moTotal = areaM2 * vitrinaRates.mo;

  el.areaLabel.innerText = String(areaM2);
  el.costoMat.innerText = `Q ${Math.round(matTotal).toLocaleString('en-US')}`;
  el.costoMO.innerText = `Q ${Math.round(moTotal).toLocaleString('en-US')}`;

  if (el.preciosFuente) {
    const sourceLabel = vitrinaRates.source === 'mongo-stitch'
      ? 'Mongo Atlas (Precios_Jutiapa)'
      : 'Fallback local';
    el.preciosFuente.innerText = `Tarifas base por m2: Materiales Q ${vitrinaRates.mat.toFixed(2)} | Mano de obra Q ${vitrinaRates.mo.toFixed(2)} (${sourceLabel})`;
  }
}

function computeVitrinaRatesFromPrecios(precios) {
  if (!Array.isArray(precios) || precios.length === 0) {
    return { ...VITRINA_DEFAULT_RATES };
  }

  const byId = new Map(precios.map((item) => [String(item.id || ''), item]));
  const preferred = ['RATE-RS-01', 'RATE-IS-01', 'RATE-RL-01'];
  const direct = preferred.map((id) => byId.get(id)).find(Boolean);

  const rateCandidates = precios.filter((item) => {
    const unidad = String(item.unidad || '').toLowerCase();
    const id = String(item.id || '').toUpperCase();
    return unidad === 'm2' && id.startsWith('RATE-');
  });

  const selected = direct || rateCandidates[0];
  if (!selected) {
    return { ...VITRINA_DEFAULT_RATES };
  }

  const mat = Number(selected.costoMaterial || 0);
  const mo = Number(selected.costoManoObra || 0);

  if (!Number.isFinite(mat) || !Number.isFinite(mo) || mat <= 0 || mo <= 0) {
    return { ...VITRINA_DEFAULT_RATES };
  }

  return {
    mat,
    mo,
    source: 'mongo-stitch',
  };
}

async function fetchVitrinaRatesFromMongo() {
  try {
    const precios = await request('/api/stitch/precios-jutiapa');
    return computeVitrinaRatesFromPrecios(precios);
  } catch (_error) {
    return { ...VITRINA_DEFAULT_RATES };
  }
}

async function initBootstrapVitrina() {
  if (!el.m2Slider) {
    return;
  }

  vitrinaRates = await fetchVitrinaRatesFromMongo();

  let disenos = [];
  try {
    disenos = await request('/api/disenos');
  } catch (_error) {
    disenos = [];
  }

  vitrinaDisenoSeleccionado = disenos.find((item) => item.id === 'DIS-001') || disenos[0] || null;

  if (vitrinaDisenoSeleccionado) {
    if (el.heroImage && vitrinaDisenoSeleccionado.imagenBase64) {
      el.heroImage.src = vitrinaDisenoSeleccionado.imagenBase64;
    }

    if (el.heroTitle) {
      const area = Math.round(vitrinaDisenoSeleccionado.areaBaseM2 || 120);
      el.heroTitle.innerText = `${vitrinaDisenoSeleccionado.nombre} (${area}m2)`;
    }

    if (el.heroDesc) {
      el.heroDesc.innerText = vitrinaDisenoSeleccionado.descripcion || 'Diseno optimizado para necesidades residenciales.';
    }

    const defaultArea = Math.min(400, Math.max(50, Math.round(vitrinaDisenoSeleccionado.areaBaseM2 || 120)));
    el.m2Slider.value = String(defaultArea);
  }

  const currentArea = Number(el.m2Slider.value || 120);
  renderVitrinaBootstrapQuote(currentArea);

  el.m2Slider.addEventListener('input', (event) => {
    const m2 = Number(event.target.value || 120);
    renderVitrinaBootstrapQuote(m2);
  });

  if (el.btnConstruirFuturo) {
    el.btnConstruirFuturo.addEventListener('click', () => {
      const nombre = vitrinaDisenoSeleccionado?.nombre || 'diseno residencial';
      const text = encodeURIComponent(
        `Hola WM/M&S, quiero comprar el paquete para ${nombre}.`
      );
      window.location.href = `https://wa.me/502XXXXXXXX?text=${text}`;
    });
  }
}

async function loadDashboard() {
  if (!el.dashboard) {
    return;
  }

  const dashboard = await request('/api/dashboard');
  const channels = Object.entries(dashboard.porCanal || {})
    .map(([key, value]) => `<li><span>${key}</span><strong>${value}</strong></li>`)
    .join('');

  el.dashboard.innerHTML = `
    <article class="metric trust-metric">
      <h4>Ingresos verificados</h4>
      <p>${currency.format(dashboard.ingresos || 0)}</p>
    </article>
    <article class="metric trust-metric">
      <h4>Operaciones registradas</h4>
      <p>${dashboard.totalVentas || 0}</p>
    </article>
    <article class="metric trust-metric">
      <h4>Clientes interesados</h4>
      <p>${dashboard.totalLeads || 0}</p>
    </article>
    <article class="metric trust-metric">
      <h4>Conversion aprox.</h4>
      <p>${dashboard.conversionAprox || 0}%</p>
    </article>
    <article class="metric span-2 trust-metric channels-metric">
      <h4>Canales de entrada</h4>
      <ul class="channels">${channels || '<li>Sin datos</li>'}</ul>
    </article>
  `;
  initInteractiveUi(el.dashboard);
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

function hydrateLeadFormFromQuery() {
  if (!el.leadForm) {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const interes = params.get('interes');
  const mensaje = params.get('mensaje');
  const disenoId = params.get('disenoId');
  const leadInteres = document.getElementById('lead-interes');
  const leadMensaje = document.getElementById('lead-mensaje');

  if (leadInteres && interes) {
    leadInteres.value = interes;
  }

  if (leadMensaje && mensaje) {
    leadMensaje.value = mensaje;
  }

  if (disenoId) {
    showToast(`Producto precargado para seguimiento: ${disenoId}`);
  }
}

function bindForms() {
  if (el.leadForm) {
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
  }

  if (el.accessForm) {
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
  }

  if (el.registerForm) {
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
        if (accessEmail) {
          accessEmail.value = payload.email || '';
        }
        el.registerForm.reset();
        await loadDashboard();
        showToast(registro.mensaje || 'Registro guardado. Puedes continuar con productos publicos.');
      } catch (error) {
        showToast(error.message, true);
      }
    });
  }

  if (el.logoutBtn) {
    el.logoutBtn.addEventListener('click', async () => {
      setClientSession('', null);
      await loadDisenos();
      showToast('Sesion cerrada. Modo publico activo.');
    });
  }
}

async function bootstrap() {
  try {
    await request('/api/health');
    await refreshSessionFromToken();
    await Promise.all([loadDisenos(), loadDashboard(), initBootstrapVitrina()]);
    await sendTelemetry({
      evento: 'vista-pagina',
      detalle: window.location.pathname.replace('/', '') || 'index.html',
      origen: window.location.pathname.replace('/', '') || 'index',
      canal: 'Web',
    }, true);
    hydrateLeadFormFromQuery();
    bindForms();
    initInteractiveUi(document);
    showToast('Sistema listo: CONSTRUCTORA WM/M&S');
  } catch (error) {
    showToast(`Error de inicio: ${error.message}`, true);
  }
}

bootstrap();
