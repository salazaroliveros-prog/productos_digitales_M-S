const gtq = new Intl.NumberFormat('es-GT', {
  style: 'currency',
  currency: 'GTQ',
  maximumFractionDigits: 2,
});

const flowState = {
  disenos: [],
  selectedDiseno: null,
  quoteTimer: null,
};

function getById(id) {
  return document.getElementById(id);
}

function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

function showMiniToast(message, isError = false) {
  const toast = getById('flow-toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast ${isError ? 'error' : 'ok'}`;
  toast.style.opacity = '1';
  setTimeout(() => {
    toast.style.opacity = '0';
  }, 2600);
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body,
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || 'Solicitud invalida');
  }
  return body;
}

async function loadDisenos() {
  try {
    const disenos = await apiRequest('/api/disenos');
    flowState.disenos = Array.isArray(disenos) ? disenos : [];
  } catch (_error) {
    flowState.disenos = [];
  }
}

function getFlowCatalogItems() {
  const prioritized = ['DIS-001', 'DIS-RS-001', 'DIS-RL-001'];
  const items = prioritized
    .map((id) => flowState.disenos.find((item) => item.id === id))
    .filter(Boolean);

  if (items.length >= 3) return items;
  return flowState.disenos.slice(0, 3);
}

function styleLabelByIndex(index) {
  if (index === 0) return 'Moderno Loft';
  if (index === 1) return 'Tradicional Colonial';
  return 'Urbano Duplex';
}

function renderLandingCatalog() {
  const target = getById('landing-list');
  if (!target) return;

  const items = getFlowCatalogItems();
  if (!items.length) {
    target.innerHTML = '<p>No hay disenos disponibles por ahora.</p>';
    return;
  }

  target.innerHTML = items
    .map((item, index) => {
      const image = item.imagenBase64
        ? `<img src="${item.imagenBase64}" alt="${item.nombre}" loading="lazy" />`
        : '<div class="landing-thumb-fallback"></div>';

      return `
      <article class="landing-item">
        <div class="landing-thumb">${image}</div>
        <div class="landing-copy">
          <h3>${styleLabelByIndex(index)}</h3>
          <p>${item.nombre}</p>
        </div>
        <a class="btn cta-orange" href="./calculadora.html?disenoId=${encodeURIComponent(item.id)}">COTIZAR AHORA</a>
      </article>
    `;
    })
    .join('');
}

async function updateCalculatorQuote() {
  const diseno = flowState.selectedDiseno;
  const slider = getById('calc-area');
  const areaValue = getById('calc-area-value');
  const materialValue = getById('calc-materiales');
  const manoObraValue = getById('calc-mano-obra');
  const totalValue = getById('calc-total');

  if (!diseno || !slider || !areaValue || !materialValue || !manoObraValue || !totalValue) return;

  const area = Number(slider.value || 120);
  areaValue.textContent = `${area} m2`;

  try {
    const quote = await apiRequest('/api/cotizar', {
      method: 'POST',
      body: JSON.stringify({ disenoId: diseno.id, areaM2: area, wasteFactor: 0.05, canal: 'Web' }),
    });

    materialValue.textContent = gtq.format(quote.totalMateriales || 0);
    manoObraValue.textContent = gtq.format(quote.totalManoObra || 0);
    totalValue.textContent = gtq.format(quote.total || 0);
  } catch (error) {
    showMiniToast(error.message, true);
  }
}

async function setupCalculatorScreen() {
  const title = getById('calc-diseno');
  const slider = getById('calc-area');
  if (!title || !slider) return;

  await loadDisenos();
  const disenoId = getQueryParam('disenoId') || 'DIS-001';
  flowState.selectedDiseno = flowState.disenos.find((item) => item.id === disenoId) || flowState.disenos[0] || null;

  if (!flowState.selectedDiseno) {
    title.textContent = 'Diseno no disponible';
    return;
  }

  title.textContent = flowState.selectedDiseno.nombre;
  slider.value = Math.max(40, Math.round(flowState.selectedDiseno.areaBaseM2 || 120));

  slider.addEventListener('input', () => {
    clearTimeout(flowState.quoteTimer);
    flowState.quoteTimer = setTimeout(updateCalculatorQuote, 220);
  });

  getById('go-packages')?.addEventListener('click', () => {
    window.location.href = './paquetes.html';
  });

  await updateCalculatorQuote();
}

function setupPackageScreen() {
  const buttons = Array.from(document.querySelectorAll('[data-package-id]'));
  if (!buttons.length) return;

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const packageId = button.getAttribute('data-package-id');
      const packagePrice = button.getAttribute('data-package-price');
      const packageName = button.getAttribute('data-package-name');

      localStorage.setItem('wmms_selected_package', JSON.stringify({
        id: packageId,
        price: Number(packagePrice || 0),
        name: packageName || '',
      }));

      window.location.href = './pago.html';
    });
  });
}

function getSelectedPackage() {
  try {
    const raw = localStorage.getItem('wmms_selected_package');
    return raw ? JSON.parse(raw) : null;
  } catch (_error) {
    return null;
  }
}

function appendChatMessage(message, role = 'bot') {
  const chat = getById('pago-chat');
  if (!chat) return;
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${role}`;
  bubble.textContent = message;
  chat.appendChild(bubble);
  chat.scrollTop = chat.scrollHeight;
}

function setupPaymentScreen() {
  const packageInfo = getById('pago-paquete');
  const form = getById('pago-form');
  const selected = getSelectedPackage();

  if (packageInfo) {
    if (selected) {
      packageInfo.textContent = `${selected.name} - ${gtq.format(selected.price)}`;
      appendChatMessage(`Gracias. Envia tu comprobante de ${gtq.format(selected.price)} AQUI.`);
    } else {
      packageInfo.textContent = 'Sin paquete seleccionado';
      appendChatMessage('Gracias. Selecciona un paquete para continuar.');
    }
  }

  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const nombre = String(data.get('nombre') || '').trim();
    const email = String(data.get('email') || '').trim();
    const telefono = String(data.get('telefono') || '').trim();
    const comprobante = data.get('comprobante');

    if (!nombre || !telefono || !comprobante || !(comprobante instanceof File) || !comprobante.name) {
      showMiniToast('Completa nombre, telefono y comprobante.', true);
      return;
    }

    const paqueteTexto = selected ? `${selected.name} ${gtq.format(selected.price)}` : 'No definido';

    try {
      await apiRequest('/api/leads', {
        method: 'POST',
        body: JSON.stringify({
          nombre,
          email,
          telefono,
          canal: 'WhatsApp',
          interes: 'Validacion de pago',
          mensaje: `Comprobante recibido para ${paqueteTexto}. Archivo: ${comprobante.name}`,
        }),
      });

      appendChatMessage('Comprobante recibido. Tu validacion quedo en revision.', 'user');
      appendChatMessage('Listo. El equipo validara tu pago y activara acceso AppSheet.', 'bot');
      form.reset();
      showMiniToast('Comprobante enviado para validacion.');
    } catch (error) {
      showMiniToast(error.message, true);
    }
  });
}

function setupAppSheetScreen() {
  const table = getById('appsheet-table');
  if (!table) return;

  const rows = Array.from(table.querySelectorAll('tbody tr'));
  rows.forEach((row) => {
    const inicial = Number(row.getAttribute('data-inicial') || 0);
    const entrada = row.querySelector('[data-col="entrada"]');
    const salida = row.querySelector('[data-col="salida"]');
    const balance = row.querySelector('[data-col="balance"]');

    const recalc = () => {
      const inValue = Number(entrada.value || 0);
      const outValue = Number(salida.value || 0);
      const current = inicial + inValue - outValue;
      balance.textContent = current.toFixed(2);
      row.classList.toggle('row-low', current <= inicial * 0.3);
    };

    entrada.addEventListener('input', recalc);
    salida.addEventListener('input', recalc);
    recalc();
  });
}

function setupDashboardScreen() {
  const validateButton = getById('dash-validate-carlos');
  if (!validateButton) return;

  validateButton.addEventListener('click', () => {
    validateButton.textContent = 'VALIDADO';
    validateButton.classList.add('validated');
    showMiniToast('Venta de Carlos G. validada.');
  });
}

async function initFlow() {
  const screen = document.body.getAttribute('data-flow-screen');

  if (screen === 'landing') {
    await loadDisenos();
    renderLandingCatalog();
  }
  if (screen === 'calculadora') {
    await setupCalculatorScreen();
  }
  if (screen === 'paquetes') {
    setupPackageScreen();
  }
  if (screen === 'pago') {
    setupPaymentScreen();
  }
  if (screen === 'appsheet') {
    setupAppSheetScreen();
  }
  if (screen === 'dashboard') {
    setupDashboardScreen();
  }
}

initFlow();
