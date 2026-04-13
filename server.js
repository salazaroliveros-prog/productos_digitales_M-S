const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');
const nodemailer = require('nodemailer');

require('dotenv').config();

const PORT = process.env.PORT || 3007;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const AUTH_SECRET = process.env.AUTH_SECRET || 'wmms-local-secret';
const DELIVERY_BASE_URL = process.env.DELIVERY_BASE_URL || 'https://entregas.wmms.local';
const INTEGRATION_API_KEY = process.env.INTEGRATION_API_KEY || 'wmms-integration-key';
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_SECURE = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || 'no-reply@wmms.local';
const ACCESS_TOKEN_TTL_MINUTES = parseInt(process.env.ACCESS_TOKEN_TTL_MINUTES || '180', 10);
const ACCESS_SINGLE_USE = String(process.env.ACCESS_SINGLE_USE || 'true').toLowerCase() === 'true';
const MIN_PACKAGE_MARGIN_PCT = parseNumber(process.env.MIN_PACKAGE_MARGIN_PCT, 25);
const DEFAULT_MAX_DISCOUNT_PCT = parseNumber(process.env.DEFAULT_MAX_DISCOUNT_PCT, 15);
const STRATEGY_MAX_DISCOUNT = {
  'cross-sell': 12,
  upsell: 18,
  bundle: 15,
  'bundle-max': 10,
  'bundle-max-optimizado': 8,
};
const DB_PROVIDER = String(process.env.DB_PROVIDER || (process.env.MONGO_URI ? 'mongo' : 'json')).toLowerCase();
const MONGO_URI = process.env.MONGO_URI || '';
const MONGO_DB_NAME = process.env.MONGO_DB_NAME || 'app_productos_digitales';
const MONGO_SEED_ON_START = String(process.env.MONGO_SEED_ON_START || 'true').toLowerCase() === 'true';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const COLLECTIONS = ['ventas', 'leads', 'disenos', 'materiales', 'notificaciones', 'consultas', 'accesos', 'paquetes'];

let runtimeProvider = DB_PROVIDER === 'mongo' ? 'mongo' : 'json';
let mongoClient = null;
let mongoDb = null;
let smtpTransporter = null;

class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': MIME_TYPES['.json'] });
  res.end(JSON.stringify(payload));
}

function sendCsv(res, statusCode, rows) {
  res.writeHead(statusCode, { 'Content-Type': MIME_TYPES['.csv'] });
  res.end(rows);
}

function getSmtpTransporter() {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return null;
  }

  if (!smtpTransporter) {
    smtpTransporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
    });
  }

  return smtpTransporter;
}

async function sendTransactionalEmail({ to, subject, text }) {
  const transporter = getSmtpTransporter();
  if (!transporter || !to) {
    return { sent: false, mode: 'simulado', reason: 'smtp-no-configurado' };
  }

  await transporter.sendMail({
    from: SMTP_FROM,
    to,
    subject,
    text,
  });

  return { sent: true, mode: 'smtp' };
}

function getSmtpStatus() {
  return {
    configured: Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS),
    host: SMTP_HOST || null,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    from: SMTP_FROM || null,
    userConfigured: Boolean(SMTP_USER),
    passConfigured: Boolean(SMTP_PASS),
  };
}

function filePathForCollection(collectionName) {
  return path.join(DATA_DIR, `${collectionName}.json`);
}

function readJsonFile(filePath, fallback = []) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function sanitizeMongoDoc(doc) {
  const copy = { ...doc };
  delete copy._id;
  return copy;
}

async function ensureMongoConnection() {
  if (runtimeProvider !== 'mongo') {
    return;
  }

  if (!MONGO_URI) {
    throw new Error('MONGO_URI no configurado');
  }

  if (mongoDb) {
    return;
  }

  mongoClient = new MongoClient(MONGO_URI);
  await mongoClient.connect();
  mongoDb = mongoClient.db(MONGO_DB_NAME);
}

async function recoverMongoRuntime() {
  if (runtimeProvider === 'mongo' || !MONGO_URI) {
    return false;
  }

  try {
    if (!mongoDb) {
      mongoClient = new MongoClient(MONGO_URI);
      await mongoClient.connect();
      mongoDb = mongoClient.db(MONGO_DB_NAME);
    }
    runtimeProvider = 'mongo';
    return true;
  } catch (_error) {
    return false;
  }
}

async function readCollection(collectionName, fallback = []) {
  if (runtimeProvider === 'mongo') {
    await ensureMongoConnection();
    const docs = await mongoDb.collection(collectionName).find({}).toArray();
    return docs.map(sanitizeMongoDoc);
  }

  if (process.env.VERCEL) {
    const recovered = await recoverMongoRuntime();
    if (recovered) {
      const docs = await mongoDb.collection(collectionName).find({}).toArray();
      return docs.map(sanitizeMongoDoc);
    }
  }

  return readJsonFile(filePathForCollection(collectionName), fallback);
}

async function writeCollection(collectionName, data) {
  if (runtimeProvider === 'mongo') {
    await ensureMongoConnection();
    const payload = Array.isArray(data) ? data.map(sanitizeMongoDoc) : [];
    const collection = mongoDb.collection(collectionName);
    await collection.deleteMany({});
    if (payload.length > 0) {
      await collection.insertMany(payload);
    }
    return;
  }

  if (process.env.VERCEL) {
    const recovered = await recoverMongoRuntime();
    if (recovered) {
      const payload = Array.isArray(data) ? data.map(sanitizeMongoDoc) : [];
      const collection = mongoDb.collection(collectionName);
      await collection.deleteMany({});
      if (payload.length > 0) {
        await collection.insertMany(payload);
      }
      return;
    }

    throw new ApiError(503, 'Persistencia no disponible temporalmente. Intenta de nuevo.');
  }

  writeJsonFile(filePathForCollection(collectionName), data);
}

async function seedMongoFromJsonIfNeeded() {
  if (runtimeProvider !== 'mongo' || !MONGO_SEED_ON_START) {
    return;
  }

  await ensureMongoConnection();

  for (const name of COLLECTIONS) {
    const collection = mongoDb.collection(name);
    const count = await collection.countDocuments();
    if (count > 0) {
      continue;
    }

    const fromJson = readJsonFile(filePathForCollection(name), []);
    if (Array.isArray(fromJson) && fromJson.length > 0) {
      await collection.insertMany(fromJson.map(sanitizeMongoDoc));
    }
  }
}

async function migrateJsonToMongo() {
  if (runtimeProvider !== 'mongo') {
    throw new ApiError(400, 'La app no esta en modo mongo. Configura DB_PROVIDER=mongo y MONGO_URI.');
  }

  await ensureMongoConnection();

  const result = {};
  for (const name of COLLECTIONS) {
    const items = readJsonFile(filePathForCollection(name), []);
    await writeCollection(name, items);
    result[name] = Array.isArray(items) ? items.length : 0;
  }

  return result;
}

function toBase64Url(input) {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function fromBase64Url(input) {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function signPayload(payload) {
  return crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
}

function buildToken(email) {
  const payload = JSON.stringify({
    email,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 7,
  });
  const encoded = toBase64Url(payload);
  const signature = signPayload(encoded);
  return `${encoded}.${signature}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) {
    return null;
  }

  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) {
    return null;
  }

  const expected = signPayload(encoded);
  if (signature !== expected) {
    return null;
  }

  try {
    const payload = JSON.parse(fromBase64Url(encoded));
    if (!payload.email || !payload.exp || payload.exp < Date.now()) {
      return null;
    }
    return payload;
  } catch (_error) {
    return null;
  }
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePagoStatus(value) {
  return String(value || 'pendiente').trim().toLowerCase();
}

function parseNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'si', 'yes'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no'].includes(normalized)) {
      return false;
    }
  }
  return fallback;
}

function normalizeDateOnly(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function tokenHash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

async function getClientProfile(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return {
      email: '',
      comprasPagadas: [],
      comprasPendientes: [],
      nivelAcceso: 'publico',
      isAutenticado: false,
    };
  }

  const ventas = (await readCollection('ventas', [])).filter(
    (venta) => normalizeEmail(venta.clienteEmail) === normalizedEmail
  );

  const comprasPagadas = ventas.filter(
    (venta) => String(venta.estadoPago || '').toLowerCase() === 'pagado'
  );

  const comprasPendientes = ventas.filter(
    (venta) => String(venta.estadoPago || '').toLowerCase() !== 'pagado'
  );

  return {
    email: normalizedEmail,
    comprasPagadas,
    comprasPendientes,
    nivelAcceso: comprasPagadas.length > 0 ? 'premium' : 'publico',
    isAutenticado: ventas.length > 0,
  };
}

async function getAuthContext(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const payload = verifyToken(token);

  if (!payload) {
    return {
      email: '',
      tokenValido: false,
      perfil: await getClientProfile(''),
      purchasedIds: new Set(),
    };
  }

  const perfil = await getClientProfile(payload.email);
  return {
    email: payload.email,
    tokenValido: true,
    perfil,
    purchasedIds: new Set(perfil.comprasPagadas.map((venta) => venta.disenoId).filter(Boolean)),
  };
}

function canAccessDiseno(diseno, authContext) {
  const nivel = String(diseno.nivelAcceso || 'publico').toLowerCase();
  if (nivel !== 'premium') {
    return true;
  }
  return authContext.purchasedIds.has(diseno.id);
}

function shapeDisenoForClient(diseno, authContext) {
  const isPremium = String(diseno.nivelAcceso || 'publico').toLowerCase() === 'premium';
  const hasAccess = canAccessDiseno(diseno, authContext);

  if (!isPremium || hasAccess) {
    return {
      ...diseno,
      bloqueado: false,
      nivelAcceso: isPremium ? 'premium' : 'publico',
    };
  }

  return {
    id: diseno.id,
    nombre: diseno.nombre,
    categoria: diseno.categoria,
    dimensiones: diseno.dimensiones,
    areaBaseM2: diseno.areaBaseM2,
    estilo: diseno.estilo,
    descripcion: 'Contenido premium. Inicia sesion con el cliente que compro este producto.',
    incluye: ['Vista previa disponible', 'Contenido completo con compra pagada'],
    precioKit: diseno.precioKit,
    canales: diseno.canales || [],
    nivelAcceso: 'premium',
    bloqueado: true,
  };
}

async function buildVentasLookup() {
  return (await readCollection('ventas', [])).reduce((acc, venta) => {
    acc[venta.id] = venta;
    return acc;
  }, {});
}

async function getIntegrationDataset(tableName) {
  if (!COLLECTIONS.includes(tableName)) {
    throw new ApiError(404, 'Tabla no soportada');
  }
  return readCollection(tableName, []);
}

function filterVentasByQuery(ventas, query) {
  const estado = String(query.get('estadoPago') || '').trim().toLowerCase();
  const canal = String(query.get('canal') || '').trim().toLowerCase();
  const desde = normalizeDateOnly(query.get('desde'));
  const hasta = normalizeDateOnly(query.get('hasta'));

  return ventas.filter((venta) => {
    const ventaEstado = String(venta.estadoPago || '').toLowerCase();
    const ventaCanal = String(venta.canal || '').toLowerCase();
    const fecha = normalizeDateOnly(venta.fecha) || '';

    if (estado && ventaEstado !== estado) {
      return false;
    }
    if (canal && ventaCanal !== canal) {
      return false;
    }
    if (desde && fecha < desde) {
      return false;
    }
    if (hasta && fecha > hasta) {
      return false;
    }

    return true;
  });
}

function escapeCsvCell(value) {
  const raw = String(value ?? '');
  const escaped = raw.replace(/"/g, '""');
  if (/[",\n]/.test(escaped)) {
    return `"${escaped}"`;
  }
  return escaped;
}

function toCsv(items, preferredHeaders = []) {
  const hasPreferredHeaders = Array.isArray(preferredHeaders) && preferredHeaders.length > 0;
  if (!Array.isArray(items) || items.length === 0) {
    const headers = hasPreferredHeaders ? preferredHeaders : ['id'];
    return `${headers.join(',')}\n`;
  }

  const discoveredHeaders = Array.from(
    items.reduce((acc, item) => {
      Object.keys(item || {}).forEach((key) => acc.add(key));
      return acc;
    }, new Set())
  );

  const extraHeaders = hasPreferredHeaders
    ? discoveredHeaders.filter((header) => !preferredHeaders.includes(header))
    : [];
  const headers = hasPreferredHeaders ? [...preferredHeaders, ...extraHeaders] : discoveredHeaders;

  const lines = [headers.join(',')];
  items.forEach((item) => {
    const row = headers.map((key) => {
      const value = item?.[key];
      if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
        return escapeCsvCell(JSON.stringify(value));
      }
      return escapeCsvCell(value);
    });
    lines.push(row.join(','));
  });

  return `${lines.join('\n')}\n`;
}

function checkIntegrationKey(req) {
  const key = (req.headers['x-api-key'] || '').trim();
  if (!key || key !== INTEGRATION_API_KEY) {
    throw new ApiError(401, 'API key invalida para integracion');
  }
}

async function getLookerVentasRows(query) {
  const ventas = filterVentasByQuery(await readCollection('ventas', []), query);
  const disenosMap = (await readCollection('disenos', [])).reduce((acc, diseno) => {
    acc[diseno.id] = diseno;
    return acc;
  }, {});

  return ventas.map((venta) => {
    const diseno = disenosMap[venta.disenoId] || {};
    const fechaIso = new Date(venta.fecha || Date.now()).toISOString();
    const fecha = fechaIso.slice(0, 10);
    return {
      id: venta.id,
      fecha,
      fechaHora: fechaIso,
      clienteNombre: venta.clienteNombre || '',
      clienteEmail: venta.clienteEmail || '',
      disenoId: venta.disenoId || '',
      disenoNombre: diseno.nombre || '',
      categoria: diseno.categoria || '',
      canal: venta.canal || '',
      monto: parseNumber(venta.monto),
      estadoPago: venta.estadoPago || 'pendiente',
      entregaActiva: venta.enlaceEntrega ? 'si' : 'no',
      enlaceEntrega: venta.enlaceEntrega || '',
    };
  });
}

async function getLookerLeadsRows(query) {
  const desde = normalizeDateOnly(query.get('desde'));
  const hasta = normalizeDateOnly(query.get('hasta'));

  const leads = (await readCollection('leads', [])).filter((lead) => {
    const fecha = normalizeDateOnly(lead.fecha) || '';
    if (desde && fecha < desde) {
      return false;
    }
    if (hasta && fecha > hasta) {
      return false;
    }
    return true;
  });

  return leads.map((lead) => ({
    id: lead.id,
    fecha: (lead.fecha || '').slice(0, 10),
    fechaHora: lead.fecha || '',
    nombre: lead.nombre || '',
    telefono: lead.telefono || '',
    canal: lead.canal || '',
    interes: lead.interes || '',
    estado: lead.estado || 'nuevo',
  }));
}

async function getLookerNotificacionesRows(query) {
  const desde = normalizeDateOnly(query.get('desde'));
  const hasta = normalizeDateOnly(query.get('hasta'));

  const notificaciones = (await readCollection('notificaciones', [])).filter((item) => {
    const fecha = normalizeDateOnly(item.fecha) || '';
    if (desde && fecha < desde) {
      return false;
    }
    if (hasta && fecha > hasta) {
      return false;
    }
    return true;
  });

  const ventasMap = await buildVentasLookup();

  return notificaciones.map((item) => ({
    id: item.id,
    fecha: (item.fecha || '').slice(0, 10),
    fechaHora: item.fecha || '',
    ventaId: item.ventaId || '',
    clienteEmail: ventasMap[item.ventaId]?.clienteEmail || '',
    disenoId: ventasMap[item.ventaId]?.disenoId || '',
    canal: item.canal || '',
    tipo: item.tipo || '',
    estado: item.estado || '',
    destino: item.destino || '',
  }));
}

async function getCredencialesHistorialRows(query) {
  const ventaId = String(query.get('ventaId') || '').trim();
  const destino = normalizeEmail(query.get('destino') || '');
  const desde = normalizeDateOnly(query.get('desde'));
  const hasta = normalizeDateOnly(query.get('hasta'));

  let notificaciones = (await readCollection('notificaciones', [])).filter(
    (item) => item.tipo === 'credenciales-acceso'
  );

  if (ventaId) {
    notificaciones = notificaciones.filter((item) => item.ventaId === ventaId);
  }

  if (destino) {
    notificaciones = notificaciones.filter((item) => normalizeEmail(item.destino) === destino);
  }

  notificaciones = notificaciones.filter((item) => {
    const fecha = normalizeDateOnly(item.fecha) || '';
    if (desde && fecha < desde) {
      return false;
    }
    if (hasta && fecha > hasta) {
      return false;
    }
    return true;
  });

  return notificaciones
    .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
    .map((item) => ({
      id: item.id,
      fecha: item.fecha,
      ventaId: item.ventaId,
      destino: item.destino,
      estado: item.estado,
      modoEnvio: item.envio?.mode || 'simulado',
      envioReal: Boolean(item.envio?.sent),
      accion: item.accion || 'pago-verificado',
      reenviado: Boolean(item.reenviado),
      solicitadoPor: item.solicitadoPor || 'sistema',
    }));
}

async function createDeliveryAccessToken(venta, scope = 'descarga-premium') {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_MINUTES * 60 * 1000).toISOString();
  const accesos = await readCollection('accesos', []);
  const registro = {
    id: `ACC-${Date.now()}`,
    tokenHash: tokenHash(token),
    ventaId: venta.id,
    disenoId: venta.disenoId || '',
    clienteEmail: normalizeEmail(venta.clienteEmail || ''),
    scope,
    usado: false,
    createdAt: new Date().toISOString(),
    expiresAt,
  };
  accesos.push(registro);
  await writeCollection('accesos', accesos);
  return { token, expiresAt };
}

async function buildEntregaLink(venta) {
  const generated = await createDeliveryAccessToken(venta, 'descarga-premium');
  const base = DELIVERY_BASE_URL.replace(/\/$/, '');
  return `${base}/api/entrega/descargar?token=${generated.token}`;
}

async function resolveAccessToken(rawToken) {
  const clean = String(rawToken || '').trim();
  if (!clean) {
    throw new ApiError(400, 'Token requerido');
  }

  const accesos = await readCollection('accesos', []);
  const hash = tokenHash(clean);
  const registro = accesos.find((item) => item.tokenHash === hash);
  if (!registro) {
    throw new ApiError(401, 'Token de acceso invalido');
  }

  const exp = new Date(registro.expiresAt).getTime();
  if (!Number.isFinite(exp) || exp < Date.now()) {
    throw new ApiError(401, 'Token expirado');
  }

  if (registro.usado && ACCESS_SINGLE_USE) {
    throw new ApiError(401, 'Token ya utilizado');
  }

  return { registro, accesos };
}

async function consumeAccessToken(registro, accesos) {
  if (!ACCESS_SINGLE_USE) {
    return;
  }

  const target = accesos.find((item) => item.id === registro.id);
  if (!target) {
    return;
  }

  target.usado = true;
  target.usedAt = new Date().toISOString();
  await writeCollection('accesos', accesos);
}

async function registrarNotificacionEntrega(venta) {
  const notificaciones = await readCollection('notificaciones', []);
  const notificacion = {
    id: `NTF-${Date.now()}`,
    fecha: new Date().toISOString(),
    ventaId: venta.id,
    canal: venta.canal || 'WhatsApp',
    destino: venta.clienteEmail || venta.clienteNombre || 'cliente',
    tipo: 'entrega-pagado',
    mensaje: `Tu compra ${venta.disenoId} ya esta pagada. Accede aqui: ${venta.enlaceEntrega}`,
    estado: 'simulado-enviado',
  };
  notificaciones.push(notificacion);
  await writeCollection('notificaciones', notificaciones);
  return notificacion;
}

async function activarEntregaSiPagado(venta) {
  const estadoPago = normalizePagoStatus(venta.estadoPago);
  if (estadoPago !== 'pagado') {
    return null;
  }

  if (!venta.enlaceEntrega) {
    venta.enlaceEntrega = await buildEntregaLink(venta);
  }

  return registrarNotificacionEntrega(venta);
}

async function registrarNotificacionCredenciales(venta, options = {}) {
  const notificaciones = await readCollection('notificaciones', []);
  const credencialBase = Buffer.from(`${venta.id}:${venta.clienteEmail || 'cliente'}`, 'utf8').toString('base64url');
  const usuario = normalizeEmail(venta.clienteEmail || `${venta.id}@wmms.local`);
  const passwordTemporal = `WMMS-${credencialBase.slice(0, 10)}`;
  const accion = options.accion || 'pago-verificado';
  const reenviado = Boolean(options.reenviado);
  const solicitadoPor = options.solicitadoPor || 'sistema';

  venta.accesoApp = true;
  venta.credenciales = {
    usuario,
    passwordTemporal,
    emitidasEn: new Date().toISOString(),
  };

  const emailText = `Hola,\n\nTu acceso para ${venta.disenoId} ya esta activo.\nUsuario: ${usuario}\nPassword temporal: ${passwordTemporal}\nLink de entrega: ${venta.enlaceEntrega || 'pendiente'}\n\nCONSTRUCTORA WM/M&S`;
  const envioEmail = await sendTransactionalEmail({
    to: venta.clienteEmail || '',
    subject: `Acceso activado ${venta.disenoId}`,
    text: emailText,
  });

  const notificacion = {
    id: `NTF-${Date.now()}`,
    fecha: new Date().toISOString(),
    ventaId: venta.id,
    canal: 'Email',
    destino: venta.clienteEmail || venta.clienteNombre || 'cliente',
    tipo: 'credenciales-acceso',
    mensaje: `Acceso activado para ${venta.disenoId}. Usuario: ${usuario}. Password temporal: ${passwordTemporal}. Link: ${venta.enlaceEntrega || 'pendiente'}`,
    estado: envioEmail.sent ? 'enviado' : 'simulado-enviado',
    envio: envioEmail,
    accion,
    reenviado,
    solicitadoPor,
  };

  notificaciones.push(notificacion);
  await writeCollection('notificaciones', notificaciones);
  return notificacion;
}

async function registrarConsulta(payload = {}) {
  const consultas = await readCollection('consultas', []);
  const consulta = {
    id: `QRY-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    fecha: new Date().toISOString(),
    disenoId: payload.disenoId || '',
    canal: payload.canal || 'Web',
    origen: payload.origen || 'web',
    clienteEmail: normalizeEmail(payload.clienteEmail || ''),
    tokenValido: Boolean(payload.tokenValido),
  };
  consultas.push(consulta);
  await writeCollection('consultas', consultas);
  return consulta;
}

function calcularCostoBaseDiseno(diseno, materiales) {
  const area = Math.max(1, parseNumber(diseno.areaBaseM2, 1));
  const factor = 1.05;

  return (diseno.insumos || []).reduce(
    (acc, insumo) => {
      const material = materiales.find((item) => item.id === insumo.materialId);
      if (!material) {
        return acc;
      }

      const cantidad = area * parseNumber(insumo.rendimiento, 0) * factor;
      const costoMaterial = cantidad * parseNumber(material.costoMaterial, 0);
      const costoManoObra = cantidad * parseNumber(material.costoManoObra, 0);

      acc.costoMaterial += costoMaterial;
      acc.costoManoObra += costoManoObra;
      return acc;
    },
    { costoMaterial: 0, costoManoObra: 0 }
  );
}

async function getMetricasNegocio(query = null) {
  const ventas = await readCollection('ventas', []);
  const disenos = await readCollection('disenos', []);
  const materiales = await readCollection('materiales', []);
  const consultas = await readCollection('consultas', []);
  const notificaciones = await readCollection('notificaciones', []);
  const desde = query ? normalizeDateOnly(query.get('desde')) : null;
  const hasta = query ? normalizeDateOnly(query.get('hasta')) : null;

  const disenosMap = disenos.reduce((acc, diseno) => {
    acc[diseno.id] = diseno;
    return acc;
  }, {});

  const ventasPagadas = ventas.filter((venta) => {
    if (normalizePagoStatus(venta.estadoPago) !== 'pagado') {
      return false;
    }
    const fecha = normalizeDateOnly(venta.fecha) || '';
    if (desde && fecha < desde) {
      return false;
    }
    if (hasta && fecha > hasta) {
      return false;
    }
    return true;
  });
  const margenPorVenta = ventasPagadas.map((venta) => {
    const diseno = disenosMap[venta.disenoId] || null;
    const costos = diseno ? calcularCostoBaseDiseno(diseno, materiales) : { costoMaterial: 0, costoManoObra: 0 };
    const costoTotal = costos.costoMaterial + costos.costoManoObra;
    const ingreso = parseNumber(venta.monto, 0);
    const utilidadNeta = ingreso - costoTotal;

    return {
      ventaId: venta.id,
      fecha: venta.fecha,
      clienteNombre: venta.clienteNombre || '',
      clienteEmail: venta.clienteEmail || '',
      disenoId: venta.disenoId || '',
      disenoNombre: diseno?.nombre || '',
      ingreso: Number(ingreso.toFixed(2)),
      costoMaterial: Number(costos.costoMaterial.toFixed(2)),
      costoManoObra: Number(costos.costoManoObra.toFixed(2)),
      costoTotal: Number(costoTotal.toFixed(2)),
      utilidadNeta: Number(utilidadNeta.toFixed(2)),
      margenPorcentaje: ingreso > 0 ? Number(((utilidadNeta / ingreso) * 100).toFixed(2)) : 0,
    };
  });

  const utilidadNetaTotal = margenPorVenta.reduce((acc, row) => acc + row.utilidadNeta, 0);
  const ingresosPagados = margenPorVenta.reduce((acc, row) => acc + row.ingreso, 0);

  const consultasFiltradas = consultas.filter((item) => {
    const fecha = normalizeDateOnly(item.fecha) || '';
    if (desde && fecha < desde) {
      return false;
    }
    if (hasta && fecha > hasta) {
      return false;
    }
    return true;
  });

  const consultasOrdenadas = [...consultasFiltradas]
    .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
    .slice(0, 30);

  const rankingInteres = consultasFiltradas.reduce((acc, item) => {
    const key = item.disenoId || 'sin-diseno';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const disenosMasConsultados = Object.entries(rankingInteres)
    .map(([disenoId, consultasTotal]) => ({
      disenoId,
      disenoNombre: disenosMap[disenoId]?.nombre || '',
      consultas: consultasTotal,
    }))
    .sort((a, b) => b.consultas - a.consultas)
    .slice(0, 10);

  const notificacionesCredenciales = notificaciones.filter((item) => item.tipo === 'credenciales-acceso');
  const reenviosCredenciales = notificacionesCredenciales.filter((item) => Boolean(item.reenviado));
  const enviosCredencialesReales = notificacionesCredenciales.filter(
    (item) => item.envio?.mode === 'smtp' && item.envio?.sent
  );

  return {
    resumen: {
      ventasPagadas: ventasPagadas.length,
      ingresosPagados: Number(ingresosPagados.toFixed(2)),
      utilidadNetaTotal: Number(utilidadNetaTotal.toFixed(2)),
      margenPromedioPorcentaje:
        ingresosPagados > 0 ? Number(((utilidadNetaTotal / ingresosPagados) * 100).toFixed(2)) : 0,
      consultasRegistradas: consultasFiltradas.length,
      enviosCredenciales: notificacionesCredenciales.length,
      reenviosCredenciales: reenviosCredenciales.length,
      enviosCredencialesReales: enviosCredencialesReales.length,
      rango: {
        desde: desde || null,
        hasta: hasta || null,
      },
    },
    margenPorVenta,
    disenosMasConsultados,
    ultimasConsultas: consultasOrdenadas,
  };
}

async function enrichPaquetes(paquetes = []) {
  const disenos = await readCollection('disenos', []);
  const disenosMap = disenos.reduce((acc, item) => {
    acc[item.id] = item;
    return acc;
  }, {});

  return paquetes.map((paquete) => {
    const items = Array.isArray(paquete.items) ? paquete.items : [];
    const detalle = items.map((item) => {
      const diseno = disenosMap[item.disenoId] || {};
      const precioUnitario = parseNumber(
        item.precioUnitario,
        parseNumber(diseno.precioKit, 0)
      );
      const cantidad = Math.max(1, parseNumber(item.cantidad, 1));
      return {
        disenoId: item.disenoId || '',
        nombre: diseno.nombre || item.nombre || '',
        categoria: diseno.categoria || '',
        cantidad,
        precioUnitario,
        subtotal: Number((precioUnitario * cantidad).toFixed(2)),
      };
    });

    const precioLista = detalle.reduce((acc, row) => acc + row.subtotal, 0);
    const descuentoPct = Math.max(0, parseNumber(paquete.descuentoPct, 0));
    const descuentoMonto = Number((precioLista * (descuentoPct / 100)).toFixed(2));
    const precioFinal = Number((precioLista - descuentoMonto).toFixed(2));

    return {
      ...paquete,
      detalle,
      precioLista: Number(precioLista.toFixed(2)),
      descuentoMonto,
      precioFinal,
      ahorroCliente: descuentoMonto,
    };
  });
}

async function cotizarPaquete(paqueteId) {
  const paquetes = await readCollection('paquetes', []);
  const paquete = paquetes.find((item) => item.id === paqueteId);
  if (!paquete) {
    throw new ApiError(404, 'Paquete no encontrado');
  }

  return cotizarPaqueteFromObject(paquete);
}

function getMaxDiscountForStrategy(estrategia) {
  const key = String(estrategia || 'bundle').trim().toLowerCase();
  return parseNumber(STRATEGY_MAX_DISCOUNT[key], DEFAULT_MAX_DISCOUNT_PCT);
}

function evaluatePaquetePolicies(cotizacion, paquete) {
  const discount = parseNumber(paquete.descuentoPct, 0);
  const maxDiscount = getMaxDiscountForStrategy(paquete.estrategia);
  const margen = parseNumber(cotizacion.margenPorcentaje, 0);
  const motivos = [];

  if (discount > maxDiscount) {
    motivos.push(`Descuento ${discount}% excede limite ${maxDiscount}% para estrategia ${paquete.estrategia || 'bundle'}`);
  }

  if (margen < MIN_PACKAGE_MARGIN_PCT) {
    motivos.push(`Margen ${margen}% por debajo del minimo objetivo ${MIN_PACKAGE_MARGIN_PCT}%`);
  }

  return {
    cumple: motivos.length === 0,
    bloqueado: motivos.length > 0,
    motivos,
    limites: {
      margenMinimoObjetivoPct: MIN_PACKAGE_MARGIN_PCT,
      descuentoMaximoPct: maxDiscount,
    },
  };
}

async function cotizarPaqueteFromObject(paquete) {
  const [paqueteEnriquecido] = await enrichPaquetes([paquete]);
  const materiales = await readCollection('materiales', []);
  const disenos = await readCollection('disenos', []);
  const disenosMap = disenos.reduce((acc, item) => {
    acc[item.id] = item;
    return acc;
  }, {});

  const costoEstimado = (paqueteEnriquecido.detalle || []).reduce((acc, item) => {
    const diseno = disenosMap[item.disenoId];
    if (!diseno) {
      return acc;
    }
    const costoBase = calcularCostoBaseDiseno(diseno, materiales);
    return acc + (costoBase.costoMaterial + costoBase.costoManoObra) * item.cantidad;
  }, 0);

  const utilidadNeta = Number((paqueteEnriquecido.precioFinal - costoEstimado).toFixed(2));
  const margenPorcentaje =
    paqueteEnriquecido.precioFinal > 0
      ? Number(((utilidadNeta / paqueteEnriquecido.precioFinal) * 100).toFixed(2))
      : 0;

  const cotizacion = {
    id: paqueteEnriquecido.id,
    nombre: paqueteEnriquecido.nombre,
    estrategia: paqueteEnriquecido.estrategia || 'bundle',
    precioLista: paqueteEnriquecido.precioLista,
    descuentoPct: parseNumber(paqueteEnriquecido.descuentoPct, 0),
    descuentoMonto: paqueteEnriquecido.descuentoMonto,
    precioFinal: paqueteEnriquecido.precioFinal,
    costoEstimado: Number(costoEstimado.toFixed(2)),
    utilidadNeta,
    margenPorcentaje,
    detalle: paqueteEnriquecido.detalle,
  };

  const politicas = evaluatePaquetePolicies(cotizacion, paqueteEnriquecido);
  return {
    ...cotizacion,
    politicas,
  };
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) {
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });
  });
}

async function getDashboard() {
  const ventas = await readCollection('ventas', []);
  const leads = await readCollection('leads', []);

  const totalVentas = ventas.length;
  const totalLeads = leads.length;
  const ingresos = ventas
    .filter((venta) => String(venta.estadoPago || '').toLowerCase() === 'pagado')
    .reduce((acc, venta) => acc + Number(venta.monto || 0), 0);

  const porCanal = ventas.reduce((acc, venta) => {
    const canal = venta.canal || 'Sin canal';
    acc[canal] = (acc[canal] || 0) + 1;
    return acc;
  }, {});

  return {
    totalVentas,
    totalLeads,
    ingresos,
    conversionAprox: totalLeads > 0 ? Number(((totalVentas / totalLeads) * 100).toFixed(2)) : 0,
    porCanal,
  };
}

async function cotizar(disenoId, areaM2, wasteFactor = 0.05) {
  const materiales = await readCollection('materiales', []);
  const disenos = await readCollection('disenos', []);
  const diseno = disenos.find((item) => item.id === disenoId);

  if (!diseno) {
    throw new ApiError(404, 'Diseno no encontrado');
  }

  const area = Number(areaM2);
  if (!Number.isFinite(area) || area <= 0) {
    throw new ApiError(400, 'Area invalida');
  }

  const factor = 1 + Math.max(0, Number(wasteFactor) || 0);
  const detalle = diseno.insumos.map((insumo) => {
    const mat = materiales.find((item) => item.id === insumo.materialId);
    if (!mat) {
      throw new ApiError(404, `Material no encontrado: ${insumo.materialId}`);
    }

    const cantidad = area * Number(insumo.rendimiento) * factor;
    const costoMaterial = cantidad * Number(mat.costoMaterial);
    const costoManoObra = cantidad * Number(mat.costoManoObra);

    return {
      materialId: mat.id,
      nombre: mat.nombre,
      unidad: mat.unidad,
      rendimiento: Number(insumo.rendimiento),
      cantidad: Number(cantidad.toFixed(3)),
      costoMaterial: Number(costoMaterial.toFixed(2)),
      costoManoObra: Number(costoManoObra.toFixed(2)),
      subtotal: Number((costoMaterial + costoManoObra).toFixed(2)),
    };
  });

  const totalMateriales = detalle.reduce((acc, item) => acc + item.costoMaterial, 0);
  const totalManoObra = detalle.reduce((acc, item) => acc + item.costoManoObra, 0);

  return {
    disenoId: diseno.id,
    disenoNombre: diseno.nombre,
    areaM2: area,
    wasteFactor: Number((factor - 1).toFixed(2)),
    totalMateriales: Number(totalMateriales.toFixed(2)),
    totalManoObra: Number(totalManoObra.toFixed(2)),
    total: Number((totalMateriales + totalManoObra).toFixed(2)),
    detalle,
  };
}

async function routeApi(req, res, url) {
  const pathname = url.pathname;
  const query = url.searchParams;
  const authContext = await getAuthContext(req);

  if (req.method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      service: 'constructora-wm-ms-api',
      persistence: runtimeProvider,
      mongoConnected: Boolean(mongoDb),
    });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/persistencia/status') {
    sendJson(res, 200, {
      provider: runtimeProvider,
      mongoConfigured: Boolean(MONGO_URI),
      mongoConnected: Boolean(mongoDb),
      dbName: runtimeProvider === 'mongo' ? MONGO_DB_NAME : null,
    });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/persistencia/migrar-json-a-mongo') {
    checkIntegrationKey(req);
    const result = await migrateJsonToMongo();
    sendJson(res, 200, {
      ok: true,
      provider: runtimeProvider,
      migrated: result,
    });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/entrega/validar') {
    const token = query.get('token') || '';
    const { registro } = await resolveAccessToken(token);

    sendJson(res, 200, {
      ok: true,
      ventaId: registro.ventaId,
      disenoId: registro.disenoId,
      scope: registro.scope,
      expiresAt: registro.expiresAt,
      singleUse: ACCESS_SINGLE_USE,
      usado: Boolean(registro.usado),
    });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/entrega/descargar') {
    const token = query.get('token') || '';
    const { registro, accesos } = await resolveAccessToken(token);

    const ventas = await readCollection('ventas', []);
    const venta = ventas.find((item) => item.id === registro.ventaId);
    if (!venta) {
      throw new ApiError(404, 'Venta asociada no encontrada');
    }

    if (normalizePagoStatus(venta.estadoPago) !== 'pagado') {
      throw new ApiError(403, 'La venta no esta pagada');
    }

    await consumeAccessToken(registro, accesos);

    sendJson(res, 200, {
      ok: true,
      secureDownload: {
        ventaId: venta.id,
        disenoId: venta.disenoId,
        clienteEmail: venta.clienteEmail || '',
        archivo: `${venta.disenoId || 'diseno'}-premium.zip`,
        watermark: venta.clienteEmail || venta.clienteNombre || 'cliente',
        tokenConsumido: ACCESS_SINGLE_USE,
      },
    });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/auth/login') {
    const body = await parseBody(req);
    const email = normalizeEmail(body.email);
    if (!email) {
      throw new ApiError(400, 'Email requerido');
    }

    const perfil = await getClientProfile(email);
    if (!perfil.isAutenticado) {
      throw new ApiError(404, 'Cliente no encontrado. Registra una venta primero.');
    }

    const token = buildToken(email);
    sendJson(res, 200, {
      token,
      cliente: {
        email: perfil.email,
        nivelAcceso: perfil.nivelAcceso,
        comprasPagadas: perfil.comprasPagadas.map((venta) => venta.disenoId),
        comprasPendientes: perfil.comprasPendientes.map((venta) => venta.disenoId),
      },
    });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/auth/registro') {
    const body = await parseBody(req);
    const email = normalizeEmail(body.email);
    if (!email) {
      throw new ApiError(400, 'Email requerido');
    }

    const perfil = await getClientProfile(email);
    if (perfil.isAutenticado) {
      const token = buildToken(email);
      sendJson(res, 200, {
        ok: true,
        registro: 'cliente-existente',
        mensaje: 'Este correo ya tiene una cuenta activa. Se inicio sesion automaticamente.',
        token,
        cliente: {
          email: perfil.email,
          nivelAcceso: perfil.nivelAcceso,
          comprasPagadas: perfil.comprasPagadas.map((venta) => venta.disenoId),
          comprasPendientes: perfil.comprasPendientes.map((venta) => venta.disenoId),
        },
      });
      return true;
    }

    const leads = await readCollection('leads', []);
    const existeLead = leads.find((item) => normalizeEmail(item.email) === email);
    if (existeLead) {
      existeLead.nombre = body.nombre || existeLead.nombre || 'Cliente';
      existeLead.telefono = body.telefono || existeLead.telefono || '';
      existeLead.canal = body.canal || existeLead.canal || 'Web Registro';
      existeLead.interes = body.interes || existeLead.interes || 'Catalogo digital';
      existeLead.mensaje = body.mensaje || existeLead.mensaje || 'Registro cliente publico';
      existeLead.estado = 'pre-registro';
      existeLead.actualizadoEn = new Date().toISOString();
    } else {
      leads.push({
        id: `LEAD-${Date.now()}`,
        fecha: new Date().toISOString(),
        nombre: body.nombre || 'Cliente',
        email,
        telefono: body.telefono || '',
        canal: body.canal || 'Web Registro',
        interes: body.interes || 'Catalogo digital',
        mensaje: body.mensaje || 'Registro cliente publico',
        estado: 'pre-registro',
      });
    }

    await writeCollection('leads', leads);
    sendJson(res, 201, {
      ok: true,
      registro: 'lead-creado',
      email,
      mensaje:
        'Registro recibido. Ya puedes ver productos publicos. El acceso premium se activa cuando tu compra quede pagada.',
    });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/auth/me') {
    if (!authContext.tokenValido) {
      sendJson(res, 401, { error: 'Token invalido o expirado' });
      return true;
    }

    sendJson(res, 200, {
      email: authContext.perfil.email,
      nivelAcceso: authContext.perfil.nivelAcceso,
      comprasPagadas: authContext.perfil.comprasPagadas.map((venta) => ({
        id: venta.id,
        disenoId: venta.disenoId,
        fecha: venta.fecha,
      })),
      comprasPendientes: authContext.perfil.comprasPendientes.map((venta) => ({
        id: venta.id,
        disenoId: venta.disenoId,
        fecha: venta.fecha,
      })),
    });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/materiales') {
    sendJson(res, 200, await readCollection('materiales', []));
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/disenos') {
    const disenos = (await readCollection('disenos', [])).map((diseno) =>
      shapeDisenoForClient(diseno, authContext)
    );
    sendJson(res, 200, disenos);
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/paquetes') {
    const paquetes = await readCollection('paquetes', []);
    const activos = paquetes.filter((item) => parseBoolean(item.activo, true));
    sendJson(res, 200, await enrichPaquetes(activos));
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/paquetes/cotizar') {
    const body = await parseBody(req);
    if (!body.paqueteId) {
      throw new ApiError(400, 'paqueteId requerido');
    }
    sendJson(res, 200, await cotizarPaquete(body.paqueteId));
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/paquetes/politicas') {
    sendJson(res, 200, {
      margenMinimoObjetivoPct: MIN_PACKAGE_MARGIN_PCT,
      descuentoMaximoPorDefectoPct: DEFAULT_MAX_DISCOUNT_PCT,
      descuentoMaximoPorEstrategiaPct: STRATEGY_MAX_DISCOUNT,
    });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/dashboard') {
    sendJson(res, 200, await getDashboard());
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/cotizar') {
    const body = await parseBody(req);
    const disenos = await readCollection('disenos', []);
    const diseno = disenos.find((item) => item.id === body.disenoId);
    if (!diseno) {
      throw new ApiError(404, 'Diseno no encontrado');
    }

    if (!canAccessDiseno(diseno, authContext)) {
      throw new ApiError(403, 'Este contenido es premium y requiere compra pagada del cliente.');
    }

    await registrarConsulta({
      disenoId: body.disenoId,
      canal: body.canal || 'Web',
      origen: 'cotizador',
      clienteEmail: authContext.email || body.clienteEmail || '',
      tokenValido: authContext.tokenValido,
    });

    sendJson(res, 200, await cotizar(body.disenoId, body.areaM2, body.wasteFactor));
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/telemetria/consulta') {
    const body = await parseBody(req);
    if (!body.disenoId) {
      throw new ApiError(400, 'disenoId requerido');
    }

    const consulta = await registrarConsulta({
      disenoId: body.disenoId,
      canal: body.canal || 'Web',
      origen: body.origen || 'catalogo',
      clienteEmail: authContext.email || body.clienteEmail || '',
      tokenValido: authContext.tokenValido,
    });

    sendJson(res, 201, consulta);
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/leads') {
    const body = await parseBody(req);
    const leads = await readCollection('leads', []);
    const lead = {
      id: `LEAD-${Date.now()}`,
      fecha: new Date().toISOString(),
      nombre: body.nombre || 'Sin nombre',
      email: normalizeEmail(body.email || ''),
      telefono: body.telefono || '',
      canal: body.canal || 'WhatsApp',
      interes: body.interes || 'General',
      mensaje: body.mensaje || '',
      estado: body.estado || 'nuevo',
    };
    leads.push(lead);
    await writeCollection('leads', leads);
    sendJson(res, 201, lead);
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/ventas') {
    const body = await parseBody(req);
    const ventas = await readCollection('ventas', []);

    const venta = {
      id: `VTA-${Date.now()}`,
      fecha: new Date().toISOString(),
      clienteNombre: body.clienteNombre || 'Cliente',
      clienteEmail: body.clienteEmail || '',
      disenoId: body.disenoId || '',
      canal: body.canal || 'WhatsApp',
      monto: Number(body.monto || 0),
      estadoPago: normalizePagoStatus(body.estadoPago),
      enlaceEntrega: body.enlaceEntrega || '',
    };

    const notificacion = await activarEntregaSiPagado(venta);
    ventas.push(venta);
    await writeCollection('ventas', ventas);

    sendJson(res, 201, {
      venta,
      entregaAutomatica: Boolean(notificacion),
      notificacion,
    });
    return true;
  }

  if (req.method === 'PATCH' && pathname.startsWith('/api/ventas/') && pathname.endsWith('/estado-pago')) {
    const body = await parseBody(req);
    const parts = pathname.split('/').filter(Boolean);
    const ventaId = parts[2];
    if (!ventaId) {
      throw new ApiError(400, 'ventaId requerido');
    }

    const nuevoEstado = normalizePagoStatus(body.estadoPago);
    if (!['pendiente', 'pagado'].includes(nuevoEstado)) {
      throw new ApiError(400, 'estadoPago invalido');
    }

    const ventas = await readCollection('ventas', []);
    const venta = ventas.find((item) => item.id === ventaId);
    if (!venta) {
      throw new ApiError(404, 'Venta no encontrada');
    }

    venta.estadoPago = nuevoEstado;
    venta.accesoApp = nuevoEstado === 'pagado';
    const notificacion = await activarEntregaSiPagado(venta);
    let notificacionCredenciales = null;
    if (nuevoEstado === 'pagado') {
      notificacionCredenciales = await registrarNotificacionCredenciales(venta);
    }
    await writeCollection('ventas', ventas);

    sendJson(res, 200, {
      venta,
      entregaAutomatica: Boolean(notificacion),
      notificacion,
      notificacionCredenciales,
    });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/notificaciones') {
    sendJson(res, 200, await readCollection('notificaciones', []));
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/integracion/appsheet/schema') {
    checkIntegrationKey(req);
    sendJson(res, 200, {
      source: 'constructora-wm-ms-api',
      tables: {
        ventas: ['id', 'fecha', 'clienteNombre', 'clienteEmail', 'disenoId', 'canal', 'monto', 'estadoPago', 'enlaceEntrega'],
        leads: ['id', 'fecha', 'nombre', 'telefono', 'canal', 'interes', 'mensaje', 'estado'],
        disenos: ['id', 'nombre', 'categoria', 'dimensiones', 'areaBaseM2', 'estilo', 'descripcion', 'nivelAcceso', 'precioKit', 'imagenBase64'],
        materiales: ['id', 'nombre', 'unidad', 'costoMaterial', 'costoManoObra'],
        notificaciones: ['id', 'fecha', 'ventaId', 'canal', 'destino', 'tipo', 'mensaje', 'estado'],
        consultas: ['id', 'fecha', 'disenoId', 'canal', 'origen', 'clienteEmail', 'tokenValido'],
        paquetes: ['id', 'nombre', 'descripcion', 'items', 'descuentoPct', 'activo', 'estrategia', 'actualizadoEn'],
      },
    });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/integracion/appsheet/inventario') {
    checkIntegrationKey(req);
    const materiales = await readCollection('materiales', []);
    sendJson(
      res,
      200,
      materiales.map((item) => ({
        ...item,
        costoTotalUnitario: Number((parseNumber(item.costoMaterial) + parseNumber(item.costoManoObra)).toFixed(2)),
      }))
    );
    return true;
  }

  if (req.method === 'PATCH' && pathname.startsWith('/api/integracion/appsheet/materiales/')) {
    checkIntegrationKey(req);
    const materialId = pathname.replace('/api/integracion/appsheet/materiales/', '').trim();
    if (!materialId) {
      throw new ApiError(400, 'materialId requerido');
    }

    const body = await parseBody(req);
    const materiales = await readCollection('materiales', []);
    const material = materiales.find((item) => item.id === materialId);
    if (!material) {
      throw new ApiError(404, 'Material no encontrado');
    }

    if (body.costoMaterial !== undefined) {
      material.costoMaterial = parseNumber(body.costoMaterial, material.costoMaterial);
    }
    if (body.costoManoObra !== undefined) {
      material.costoManoObra = parseNumber(body.costoManoObra, material.costoManoObra);
    }
    material.region = body.region || material.region || 'Jutiapa';
    material.ultimaActualizacion = new Date().toISOString().slice(0, 10);

    await writeCollection('materiales', materiales);
    sendJson(res, 200, material);
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/integracion/appsheet/disenos/cargar') {
    checkIntegrationKey(req);
    const body = await parseBody(req);
    if (!body.nombre) {
      throw new ApiError(400, 'nombre requerido');
    }

    const disenos = await readCollection('disenos', []);
    const disenoId = body.id || `DIS-${String(Date.now()).slice(-6)}`;
    const existing = disenos.find((item) => item.id === disenoId);
    const payload = {
      id: disenoId,
      nombre: body.nombre,
      categoria: body.categoria || 'Diseno Arq',
      dimensiones: body.dimensiones || '',
      areaBaseM2: parseNumber(body.areaBaseM2, 1),
      estilo: body.estilo || 'Moderno',
      descripcion: body.descripcion || '',
      nivelAcceso: String(body.nivelAcceso || 'publico').toLowerCase(),
      incluye: Array.isArray(body.incluye) ? body.incluye : [],
      insumos: Array.isArray(body.insumos) ? body.insumos : [],
      precioKit: parseNumber(body.precioKit, 0),
      canales: Array.isArray(body.canales) ? body.canales : ['AppSheet'],
      imagenBase64: String(body.imagenBase64 || ''),
      actualizadoEn: new Date().toISOString(),
    };

    if (existing) {
      Object.assign(existing, payload);
    } else {
      disenos.push(payload);
    }

    await writeCollection('disenos', disenos);
    sendJson(res, existing ? 200 : 201, payload);
    return true;
  }

  if (
    req.method === 'PATCH' &&
    pathname.startsWith('/api/integracion/appsheet/ventas/') &&
    pathname.endsWith('/pago-verificado')
  ) {
    checkIntegrationKey(req);
    const parts = pathname.split('/').filter(Boolean);
    const ventaId = parts[4];
    if (!ventaId) {
      throw new ApiError(400, 'ventaId requerido');
    }

    const body = await parseBody(req);
    const ventas = await readCollection('ventas', []);
    const venta = ventas.find((item) => item.id === ventaId);
    if (!venta) {
      throw new ApiError(404, 'Venta no encontrada');
    }

    venta.estadoPago = 'pagado';
    venta.accesoApp = true;
    venta.fechaPagoVerificado = new Date().toISOString();

    const notificacionEntrega = await activarEntregaSiPagado(venta);
    const enviarCredenciales = parseBoolean(body.enviarCredenciales, true);
    const notificacionCredenciales = enviarCredenciales
      ? await registrarNotificacionCredenciales(venta, {
          accion: 'pago-verificado',
          reenviado: false,
          solicitadoPor: 'dashboard-admin',
        })
      : null;

    await writeCollection('ventas', ventas);
    sendJson(res, 200, {
      venta,
      accesoApp: venta.accesoApp,
      notificacionEntrega,
      notificacionCredenciales,
    });
    return true;
  }

  if (
    req.method === 'POST' &&
    pathname.startsWith('/api/integracion/appsheet/ventas/') &&
    pathname.endsWith('/regenerar-acceso')
  ) {
    checkIntegrationKey(req);
    const parts = pathname.split('/').filter(Boolean);
    const ventaId = parts[4];
    if (!ventaId) {
      throw new ApiError(400, 'ventaId requerido');
    }

    const ventas = await readCollection('ventas', []);
    const venta = ventas.find((item) => item.id === ventaId);
    if (!venta) {
      throw new ApiError(404, 'Venta no encontrada');
    }

    if (normalizePagoStatus(venta.estadoPago) !== 'pagado') {
      throw new ApiError(403, 'Solo se puede regenerar acceso para ventas pagadas');
    }

    venta.enlaceEntrega = await buildEntregaLink(venta);
    await writeCollection('ventas', ventas);

    sendJson(res, 200, {
      ok: true,
      ventaId: venta.id,
      enlaceEntrega: venta.enlaceEntrega,
      ttlMinutos: ACCESS_TOKEN_TTL_MINUTES,
      singleUse: ACCESS_SINGLE_USE,
    });
    return true;
  }

  if (
    req.method === 'POST' &&
    pathname.startsWith('/api/integracion/appsheet/ventas/') &&
    pathname.endsWith('/reenviar-credenciales')
  ) {
    checkIntegrationKey(req);
    const parts = pathname.split('/').filter(Boolean);
    const ventaId = parts[4];
    if (!ventaId) {
      throw new ApiError(400, 'ventaId requerido');
    }

    const body = await parseBody(req);
    const ventas = await readCollection('ventas', []);
    const venta = ventas.find((item) => item.id === ventaId);
    if (!venta) {
      throw new ApiError(404, 'Venta no encontrada');
    }

    if (normalizePagoStatus(venta.estadoPago) !== 'pagado') {
      throw new ApiError(403, 'Solo se pueden reenviar credenciales para ventas pagadas');
    }

    const regenerarAcceso = parseBoolean(body.regenerarAcceso, false);
    if (regenerarAcceso) {
      venta.enlaceEntrega = await buildEntregaLink(venta);
    }

    const notificacionCredenciales = await registrarNotificacionCredenciales(venta, {
      accion: 'reenvio-manual',
      reenviado: true,
      solicitadoPor: body.solicitadoPor || 'dashboard-admin',
    });

    await writeCollection('ventas', ventas);
    sendJson(res, 200, {
      ok: true,
      ventaId: venta.id,
      regenerarAcceso,
      enlaceEntrega: venta.enlaceEntrega || '',
      notificacionCredenciales,
    });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/integracion/appsheet/historial-credenciales') {
    checkIntegrationKey(req);
    sendJson(res, 200, await getCredencialesHistorialRows(query));
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/integracion/appsheet/metricas') {
    checkIntegrationKey(req);
    sendJson(res, 200, await getMetricasNegocio(query));
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/integracion/appsheet/smtp-status') {
    checkIntegrationKey(req);
    sendJson(res, 200, getSmtpStatus());
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/integracion/appsheet/smtp-test') {
    checkIntegrationKey(req);
    const body = await parseBody(req);
    const to = normalizeEmail(body.to || '');
    if (!to) {
      throw new ApiError(400, 'to requerido');
    }

    const result = await sendTransactionalEmail({
      to,
      subject: 'WM/M&S SMTP Test',
      text: 'Prueba de envio SMTP desde CONSTRUCTORA WM/M&S.',
    });

    sendJson(res, 200, {
      smtp: getSmtpStatus(),
      test: result,
      to,
    });
    return true;
  }

  if (req.method === 'GET' && pathname.startsWith('/api/integracion/appsheet/')) {
    checkIntegrationKey(req);
    const tableName = pathname.replace('/api/integracion/appsheet/', '').trim();
    const dataset = await getIntegrationDataset(tableName);
    if (tableName === 'ventas') {
      sendJson(res, 200, filterVentasByQuery(dataset, query));
      return true;
    }
    if (tableName === 'paquetes') {
      sendJson(res, 200, await enrichPaquetes(dataset));
      return true;
    }
    sendJson(res, 200, dataset);
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/integracion/appsheet/paquetes') {
    checkIntegrationKey(req);
    const body = await parseBody(req);
    if (!body.nombre) {
      throw new ApiError(400, 'nombre requerido');
    }

    const paquetes = await readCollection('paquetes', []);
    const nuevo = {
      id: body.id || `PAQ-${String(Date.now()).slice(-6)}`,
      nombre: body.nombre,
      descripcion: body.descripcion || '',
      items: Array.isArray(body.items) ? body.items : [],
      descuentoPct: Math.max(0, parseNumber(body.descuentoPct, 0)),
      activo: parseBoolean(body.activo, true),
      estrategia: body.estrategia || 'bundle',
      actualizadoEn: new Date().toISOString(),
    };

    const validacion = await cotizarPaqueteFromObject(nuevo);
    nuevo.bloqueadoPorReglas = validacion.politicas.bloqueado;
    nuevo.motivosBloqueo = validacion.politicas.motivos;
    if (nuevo.bloqueadoPorReglas) {
      nuevo.activo = false;
    }

    paquetes.push(nuevo);
    await writeCollection('paquetes', paquetes);

    const [enriquecido] = await enrichPaquetes([nuevo]);
    sendJson(res, 201, {
      ...enriquecido,
      politicas: validacion.politicas,
    });
    return true;
  }

  if (req.method === 'PATCH' && pathname.startsWith('/api/integracion/appsheet/paquetes/')) {
    checkIntegrationKey(req);
    const paqueteId = pathname.replace('/api/integracion/appsheet/paquetes/', '').trim();
    if (!paqueteId) {
      throw new ApiError(400, 'paqueteId requerido');
    }

    const body = await parseBody(req);
    const paquetes = await readCollection('paquetes', []);
    const paquete = paquetes.find((item) => item.id === paqueteId);
    if (!paquete) {
      throw new ApiError(404, 'Paquete no encontrado');
    }

    if (body.nombre !== undefined) paquete.nombre = body.nombre;
    if (body.descripcion !== undefined) paquete.descripcion = body.descripcion;
    if (body.items !== undefined) paquete.items = Array.isArray(body.items) ? body.items : [];
    if (body.descuentoPct !== undefined) paquete.descuentoPct = Math.max(0, parseNumber(body.descuentoPct, paquete.descuentoPct));
    if (body.activo !== undefined) paquete.activo = parseBoolean(body.activo, paquete.activo);
    if (body.estrategia !== undefined) paquete.estrategia = body.estrategia;
    paquete.actualizadoEn = new Date().toISOString();

    const validacion = await cotizarPaqueteFromObject(paquete);
    paquete.bloqueadoPorReglas = validacion.politicas.bloqueado;
    paquete.motivosBloqueo = validacion.politicas.motivos;
    if (paquete.bloqueadoPorReglas) {
      paquete.activo = false;
    }

    await writeCollection('paquetes', paquetes);
    const [enriquecido] = await enrichPaquetes([paquete]);
    sendJson(res, 200, {
      ...enriquecido,
      politicas: validacion.politicas,
    });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/integracion/looker/ventas.csv') {
    const csv = toCsv(await getLookerVentasRows(query), [
      'id',
      'fecha',
      'fechaHora',
      'clienteNombre',
      'clienteEmail',
      'disenoId',
      'disenoNombre',
      'categoria',
      'canal',
      'monto',
      'estadoPago',
      'entregaActiva',
      'enlaceEntrega',
    ]);
    sendCsv(res, 200, csv);
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/integracion/looker/leads.csv') {
    const csv = toCsv(await getLookerLeadsRows(query), [
      'id',
      'fecha',
      'fechaHora',
      'nombre',
      'telefono',
      'canal',
      'interes',
      'estado',
    ]);
    sendCsv(res, 200, csv);
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/integracion/looker/notificaciones.csv') {
    const csv = toCsv(await getLookerNotificacionesRows(query), [
      'id',
      'fecha',
      'fechaHora',
      'ventaId',
      'clienteEmail',
      'disenoId',
      'canal',
      'tipo',
      'estado',
      'destino',
    ]);
    sendCsv(res, 200, csv);
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/integracion/looker/historial-credenciales.csv') {
    checkIntegrationKey(req);
    const csv = toCsv(await getCredencialesHistorialRows(query), [
      'id',
      'fecha',
      'ventaId',
      'destino',
      'estado',
      'modoEnvio',
      'envioReal',
      'accion',
      'reenviado',
      'solicitadoPor',
    ]);
    sendCsv(res, 200, csv);
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/integracion/looker/dashboard.csv') {
    const dash = await getDashboard();
    const row = {
      fecha: new Date().toISOString().slice(0, 10),
      totalVentas: dash.totalVentas,
      totalLeads: dash.totalLeads,
      ingresos: dash.ingresos,
      conversionAprox: dash.conversionAprox,
      porCanal: JSON.stringify(dash.porCanal),
    };

    sendCsv(
      res,
      200,
      toCsv([row], ['fecha', 'totalVentas', 'totalLeads', 'ingresos', 'conversionAprox', 'porCanal'])
    );
    return true;
  }

  return false;
}

function serveStatic(req, res, pathname) {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(ROOT, safePath);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

const requestHandler = (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  if (pathname.startsWith('/api/')) {
    routeApi(req, res, url)
      .then((handled) => {
        if (!handled) {
          sendJson(res, 404, { error: 'Endpoint no encontrado' });
        }
      })
      .catch((error) => {
        sendJson(res, error.statusCode || 500, { error: error.message || 'Error interno' });
      });
    return;
  }

  serveStatic(req, res, pathname);
};

const server = http.createServer(requestHandler);

async function bootstrapPersistence() {
  if (runtimeProvider !== 'mongo') {
    return;
  }

  try {
    await ensureMongoConnection();
    await seedMongoFromJsonIfNeeded();
  } catch (error) {
    console.warn(`Mongo no disponible, se usara JSON local. Motivo: ${error.message}`);
    runtimeProvider = 'json';
    mongoDb = null;
    if (mongoClient) {
      await mongoClient.close().catch(() => {});
      mongoClient = null;
    }
  }
}

const bootstrapPromise = bootstrapPersistence().catch(() => {
  runtimeProvider = 'json';
});

if (require.main === module) {
  bootstrapPromise.finally(() => {
    server.listen(PORT, () => {
      console.log(
        `CONSTRUCTORA WM/M&S app running on http://localhost:${PORT} (persistence=${runtimeProvider})`
      );
    });
  });

  process.on('SIGINT', async () => {
    if (mongoClient) {
      await mongoClient.close().catch(() => {});
    }
    process.exit(0);
  });
}

module.exports = async (req, res) => {
  await bootstrapPromise;
  return requestHandler(req, res);
};
