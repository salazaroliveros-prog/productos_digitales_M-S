# Sistema de Password Recovery - Recuperación de Acceso

## Descripción
Sistema para que clientes con compras puedan solicitar y resetear su contraseña mediante un flujo seguro basado en tokens con TTL.

## Características
- ✅ Solicitud de reset vía email
- ✅ Tokens de reset con expiración (15 min por defecto)
- ✅ One-time use tokens (token no puede usarse dos veces)
- ✅ Validación de email registrado (only customers with purchases)
- ✅ Auditoria de intentos de reset
- ✅ Cleanup automático de requests expirados

## Endpoints

### 1. Solicitar Reset de Contraseña
```
POST /api/auth/solicitar-reset
Content-Type: application/json

Body:
{
  "email": "cliente@ejemplo.com"
}

Response (200):
{
  "ok": true,
  "mensaje": "Si el email esta registrado, recibiras instrucciones de reset en tu bandeja de entrada.",
  "email": "cliente@ejemplo.com",
  "smtpSent": true
}

Validaciones:
- Email debe estar en formato válido
- Email debe estar asociado a al menos una compra pagada
- (Seguridad: no revela si email existe o no)
```

### 2. Resetear Contraseña
```
POST /api/auth/resetear-password
Content-Type: application/json

Body:
{
  "token": "base64_encoded_payload.signature",
  "nuevaPassword": "miNuevaPassword123!"
}

Response (200):
{
  "ok": true,
  "mensaje": "Contraseña actualizada exitosamente. Puedes acceder con tu email y nueva contraseña.",
  "token": "eyJhbGc...",  // Nuevo token para login
  "email": "cliente@ejemplo.com"
}

Validaciones:
- Token debe ser válido y no expirado
- Token no puede haber sido usado antes
- Nueva contraseña mínimo 8 caracteres
- Token expira en PASSWORD_RESET_TTL_MINUTES (default: 15 min)
```

## Flujo de Usuario

### Paso 1: Cliente olvida contraseña
Cliente hace click en "Olvidé mi contraseña" en la página de login

### Paso 2: Solicita Reset
```javascript
const response = await fetch('/api/auth/solicitar-reset', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'cliente@ejemplo.com' })
});
```

### Paso 3: Recibe Email
Cliente recibe email con link:
```
https://tu-dominio.com/reset-password.html?token=eyJ...
```

### Paso 4: Ingresa Nueva Contraseña
Cliente sigueel link y ve un formulario para ingresar nueva contraseña

### Paso 5: Envía Reset
```javascript
const response = await fetch('/api/auth/resetear-password', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    token: urlParams.get('token'),
    nuevaPassword: 'miNuevaPassword123!'
  })
});

if (response.ok) {
  // Login automático con token retornado
  localStorage.setItem('token', data.token);
  window.location.href = '/dashboard.html';
}
```

## HTML Form Example

### reset-password.html
```html
<!DOCTYPE html>
<html>
<head>
  <title>Resetear Contraseña - WMMS</title>
  <style>
    body { font-family: Arial; max-width: 400px; margin: 50px auto; }
    .form-group { margin-bottom: 15px; }
    input { width: 100%; padding: 8px; }
    button { width: 100%; padding: 10px; background: #007bff; color: white; border: none; cursor: pointer; }
    .error { color: red; }
    .success { color: green; }
  </style>
</head>
<body>
  <h2>Resetear Contraseña</h2>
  <form id="resetForm">
    <div class="form-group">
      <label>Nueva Contraseña (mínimo 8 caracteres):</label>
      <input type="password" id="password" required minlength="8">
    </div>
    <div class="form-group">
      <label>Confirmar Contraseña:</label>
      <input type="password" id="passwordConfirm" required>
    </div>
    <button type="submit">Actualizar Contraseña</button>
    <div id="message"></div>
  </form>

  <script>
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');

    if (!token) {
      document.getElementById('message').innerHTML = 
        '<p class="error">Token no proporcionado. Verifica el link del email.</p>';
      document.getElementById('resetForm').style.display = 'none';
    }

    document.getElementById('resetForm').addEventListener('submit', async (e) => {
      e.preventDefault();

      const password = document.getElementById('password').value;
      const passwordConfirm = document.getElementById('passwordConfirm').value;

      if (password !== passwordConfirm) {
        document.getElementById('message').innerHTML = 
          '<p class="error">Las contraseñas no coinciden.</p>';
        return;
      }

      try {
        const response = await fetch('/api/auth/resetear-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            nuevaPassword: password
          })
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || 'Error al resetear contraseña');
        }

        // Login automático
        localStorage.setItem('token', data.token);
        document.getElementById('message').innerHTML = 
          '<p class="success">Contraseña actualizada. Redirigiendo...</p>';
        
        setTimeout(() => {
          window.location.href = '/dashboard.html';
        }, 2000);
      } catch (error) {
        document.getElementById('message').innerHTML = 
          `<p class="error">Error: ${error.message}</p>`;
      }
    });
  </script>
</body>
</html>
```

## Variables de Entorno

```
# Auth
ACCESS_TOKEN_TTL_MINUTES=180        # TTL para tokens de acceso (3 horas)
PASSWORD_RESET_TTL_MINUTES=15       # TTL para tokens de reset
DELIVERY_BASE_URL=https://tu-dominio.com  # Base URL para links en email
```

## Base de Datos - Colección password-resets

```javascript
{
  email: "cliente@ejemplo.com",
  token: "hash_del_token",           // Hash SHA256 del token
  solicitadoEn: "2024-04-12T10:00:00Z",
  expiraEn: 1712898900000,           // Timestamp de expiración
  consumido: false,                  // true después de usar
  utilizadoEn: "2024-04-12T10:05:00Z" // Cuando se utilizó
}
```

## Seguridad

✅ **Token Único**: Cada reset genera un token único
✅ **TTL Limitado**: Tokens expiran en 15 minutos (configurable)
✅ **Single-Use**: Token no puede usarse más de una vez
✅ **One-Way Hash**: Token se guarda hasheado en DB
✅ **Email Verification**: Link debe ser abierto desde email
✅ **Signature Validation**: Token tiene firma HMAC-SHA256
✅ **Timing Resistance**: Comparación de strings es segura (`safeCompareString`)
✅ **Info Disclosure Prevention**: No revela si email existe
✅ **Audit Trail**: Todos los resets se registran con timestamp
✅ **Cleanup**: Requests expirados se limpian automáticamente

## Casos de Uso

### Usuario olvida contraseña
1. `POST /api/auth/solicitar-reset` con email
2. Recibe email con token
3. `POST /api/auth/resetear-password` con token y nueva password

### Token expirado
- Usuario intenta usar token después de 15 minutos
- Sistema rechaza con mensaje "Token invalido o expirado"
- Usuario debe solicitar nuevo reset

### Token ya utilizado
- Alguien intenta reutilizar un token que ya se consumió
- Sistema rechaza con mensaje "Token no valido o ya fue utilizado"
- El reset anterior sigue siendo válido (contraseña ya fue cambiada)

## Troubleshooting

### "Token invalido o expirado"
- Token expiró: solicitar nuevo reset
- Link copiado incorrectamente: usar el link completo del email
- Revisar que `PASSWORD_RESET_TTL_MINUTES` es suficiente

### "Token no valido o ya fue utilizado"
- Token ya fue usado: el reset anterior fue exitoso
- Intentar de nuevo: solicitar nuevo reset
- Revisar logs en `password-resets` collection

### Email no llega
- Verificar que `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` están configurados
- Revisar que `DELIVERY_BASE_URL` es correcto
- Revisar spam/carpeta de promociones
- Verificar logs SMTP en servidor

### Contraseña no se actualiza
- Confirmar que email está registrado (tiene al menos una compra)
- Verificar que nueva contraseña tiene mínimo 8 caracteres
- Revisar que token no expiró

## Logs Esperados

```
[password-reset] solicitud para cliente@ejemplo.com
[password-reset] token_hash: abc123def456...
[password-reset] smtp_sent: true
[password-reset] token consumido para cliente@ejemplo.com
[password-reset] cleanup: 5 resets expirados eliminados
```
