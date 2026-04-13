# Sistema de Entregas Protegidas - Deliverables

## Descripción
Sistema para almacenar y entregar archivos (PDFs, ZIPs, documentos) asociados a ventas, con protección mediante tokens de acceso de un solo uso y control de permisos.

## Características
- ✅ Subida de archivos protegida por API key
- ✅ Descarga con token de un solo uso (ONE-TIME tokens)
- ✅ Validación de venta pagada  
- ✅ Registro automático de accesos (auditoría)
- ✅ Soporte para múltiples formatos (PDF, ZIP, DOCX, XLSX, etc.)
- ✅ TTL en tokens (expiración configurable)

## Directorio de Almacenamiento
Los archivos se guardan en: `./deliverables/`
Estructura de nombres: `{ventaId}_{nombreArchivo}.{ext}`

Ejemplo: `VTA-1234567890_diseno-premium.zip`

## Endpoints

### 1. Subir Archivo (Admin Integration)
```
POST /api/archivos/subir
Header: Authorization: integration-key-required
Content-Type: multipart/form-data

Body:
- ventaId: "VTA-1234567890" (requerido)
- archivo: <file> (requerido)

Response (201):
{
  "archivo": "VTA-1234567890_diseno.pdf",
  "ventaId": "VTA-1234567890",
  "tamanio": 1048576,
  "generadoEn": "2024-04-12T10:00:00Z",
  "acceso": {
    "token": "base64_encoded_payload.signature",
    "expiresIn": "3 horas",
    "enlaceDescarga": "/api/archivos/descargar/VTA-1234567890/diseno.pdf?token=..."
  }
}
```

### 2. Descargar Archivo (Cliente)
```
GET /api/archivos/descargar/:ventaId/:archivo?token=TOKEN

Response (200):
- Descarga el archivo binario
- Headers: Content-Disposition: attachment; filename="..."

Validaciones:
- ✓ Token válido y no expirado
- ✓ Venta existe
- ✓ Venta tiene estado "pagado"
- ✓ Archivo existe
- ✓ El archivo pertenece a la venta (nombre inicia con ventaId)
```

## Estructura de Token

### Generación
```javascript
const payload = {
  ventaId: "VTA-1234567890",
  archivo: "diseno.pdf",
  timestamp: 1712898000000,
  ttl: 10800000  // 3 horas en ms
};

const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
const signature = sha256(encoded);
token = `${encoded}.${signature}`;
```

### Validación
- Verificar firma (HMAC-SHA256)
- Validar que no expiró: `now <= timestamp + ttl`
- Validar que ventaId coincide (si se especifica)
- Validar que archivo coincide en payload

## Integración con Ventas

### Flujo Automático (Webhook de Stripe)
1. Client paga via Stripe
2. Webhook `payment_intent.succeeded` recibido
3. Venta se marca como `pagado`
4. Se envía email con link de descarga (credenciales + token)
5. Cliente puede descargar usando token en email

### Flujo Manual (Admin)
1. Admin verifica pago manualmente
2. Admin sube archivo: `POST /api/archivos/subir`
3. Sistema genera token de descarga
4. Admin envía token al cliente
5. Cliente descarga con: `/api/archivos/descargar/:ventaId/:archivo?token=...`

## Variables de Entorno
```
ACCESS_TOKEN_TTL_MINUTES=180    # TTL del token en minutos (3 horas default)
ACCESS_SINGLE_USE=true           # Consumir token después de descargar
```

## Registro de Accesos

Cada descarga se registra en colección `accesos`:
```javascript
{
  ventaId: "VTA-1234567890",
  archivo: "diseno.pdf",
  fecha: "2024-04-12T10:00:00Z",
  tipo: "descarga",
  email: "cliente@ejemplo.com"
}
```

## Seguridad

✅ **Autenticación Server-Side**: Tokens validados en servidor
✅ **Single-Use**: Tokens se pueden consumir (marcar como usado)
✅ **TTL**: Expiración temporal de tokens
✅ **Venta Verification**: Solo descargar si venta está pagada
✅ **Audit Trail**: Registro de todos los accesos
✅ **API Key Protection**: Subidas requieren integration key
✅ **Extensión Whitelist**: Solo formatos permitidos (.pdf, .zip, .doc, etc)
✅ **Path Traversal Protection**: Nombres de archivo sanitizados

## Ejemplo Completo de Implementación (Cliente)

### HTML Form
```html
<form id="download-form">
  <input type="hidden" id="token" value="<TOKEN_DEL_EMAIL>">
  <button type="submit">Descargar Diseno</button>
</form>

<script>
document.getElementById('download-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const token = document.getElementById('token').value;
  
  // Link para descargar
  window.location.href = 
    `/api/archivos/descargar/${ventaId}/${archivo}?token=${token}`;
});
</script>
```

### Backend (Node.js)
```javascript
// Al crear venta con delierable:
const token = generateDeliverableToken(ventaId, 'diseno.pdf');
const downloadLink = `${DOMAIN}/api/archivos/descargar/${ventaId}/diseno.pdf?token=${token}`;

// Enviar en email
await sendTransactionalEmail({
  to: cliente.email,
  subject: 'Tu Diseño está Listo',
  text: `
    Tu diseño premium está listo para descargar:
    ${downloadLink}
    
    El link expira en 3 horas.
  `
});
```

## Troubleshooting

### "Token inválido o expirado"
- Token expiró: regenerar nuevo
- Firma inválida: revisar que encoding sea base64
- Venta mismatch: revisar ventaId en URL vs token

### "Acceso denegado. Venta no pagada"
- Asegurar que venta tiene estadoPago = "pagado"
- Verificar que venta existe en DB
- Validar ventaId en URL

### "Archivo no encontrado"
- Confirmar que archivo foi subido: `./deliverables/{ventaId}_{archivo}`
- Revisar name exacto del archivo
- Validar que el nombre del archivo no contiene caracteres especiales

### Logs en el servidor
```
[accesos collection updated] ventaId=..., archivo=..., fecha=...
```
