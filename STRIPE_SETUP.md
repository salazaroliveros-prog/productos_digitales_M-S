# Integración de Stripe - Pagos Automáticos

## Descripción
Este documento describe cómo configurar Stripe para procesar pagos automáticos y webhooks en la aplicación CONSTRUCTORA WM/M&S.

## Requisitos
1. Cuenta de Stripe (https://stripe.com)
2. API keys de Stripe (Secret Key y Webhook Secret)
3. Instalación de la dependencia Stripe en Node.js

## Instalación

### 1. Instalar paquete Stripe
```bash
npm install stripe
```

### 2. Obtener API Keys en Stripe Dashboard
- Ir a: https://dashboard.stripe.com/apikeys
- Copiar **Secret Key** (comienza con `sk_...`)
- Guardar en `.env` como `STRIPE_SECRET_KEY`

### 3. Configurar Webhook Secret
- Ir a: https://dashboard.stripe.com/webhooks
- Crear nuevo webhook endpoint: `https://tu-dominio.com/api/webhooks/stripe`
- Seleccionar eventos: `payment_intent.succeeded`, `payment_intent.payment_failed`
- Copiar **Signing Secret** (comienza con `whsec_...`)
- Guardar en `.env` como `STRIPE_WEBHOOK_SECRET`

## Variables de Entorno

Agregar a `.env`:
```
STRIPE_SECRET_KEY=sk_live_xxxxx  # Tu secret key
STRIPE_WEBHOOK_SECRET=whsec_xxxxx # Tu webhook secret
```

## Endpoints

### 1. Crear Payment Intent
```
POST /api/stripe/create-payment-intent
Content-Type: application/json

{
  "ventaId": "VTA-1234567890",
  "monto": 99.99,
  "clienteEmail": "cliente@example.com",
  "clienteNombre": "Juan Pérez",
  "descripcion": "Diseño de producto"
}

Response:
{
  "paymentIntent": {
    "id": "pi_...",
    "client_secret": "pi_..._secret_...",
    "amount": 9999,      // En centavos
    "currency": "usd",
    "status": "requires_payment_method",
    "metadata": {
      "ventaId": "VTA-1234567890",
      "clienteEmail": "cliente@example.com",
      "clienteNombre": "Juan Pérez"
    }
  }
}
```

### 2. Webhook de Stripe
```
POST /api/webhooks/stripe
Header: stripe-signature: t=...,v1=...
Body: Stripe Event JSON

Eventos procesados:
- payment_intent.succeeded → Marca venta como pagada, envía credenciales
- payment_intent.payment_failed → Registra intento fallido
```

## Flujo de Pago E2E

1. **Cliente inicia compra**
   - Selecciona producto y confirma en el sitio público
   - Sistema crea `venta` inicial en estado `pendiente`

2. **Cliente realiza pago**
   - Solicita payment intent (POST `/api/stripe/create-payment-intent`)
   - Recibe `client_secret`
   - Usa Stripe Payment Element en frontend para completar pago

3. **Stripe procesa pago** (automático)
   - Envía `payment_intent.succeeded` al webhook
   - Sistema recibe webhook, valida firma
   - Actualiza venta a estado `pagado`
   - Genera credenciales de acceso
   - Envía credenciales por SMTP

4. **Cliente recibe acceso**
   - Accede a su descarga con token de acceso
   - Descarga protegida y de un solo uso

## Implementación Real en el Código

Para activar pagos reales de Stripe, actualiza `/api/stripe/create-payment-intent`:

```javascript
const stripe = require('stripe')(STRIPE_SECRET_KEY);

const paymentIntent = await stripe.paymentIntents.create({
  amount: monto,           // en centavos
  currency: 'usd',
  payment_method_types: ['card'],
  metadata: {
    ventaId,
    clienteEmail,
    clienteNombre,
  },
  receipt_email: clienteEmail,
  description: descripcion,
});

return paymentIntent;
```

## Testing

### Tarjetas de prueba (Stripe Test Mode)
- **Éxito**: `4242 4242 4242 4242`
- **Decline**: `4000 0000 0000 0002`
- Mes/Año: cualquiera en el futuro
- CVC: cualquier 3 dígitos

### Verificar webhooks en desarrollo
Usar Stripe CLI:
```bash
npm install -g @stripe/cli
stripe listen --api-key sk_test_...
stripe login
stripe forward-to-url http://localhost:3007/api/webhooks/stripe
```

## Seguridad

✅ Firma de webhooks validada (`verifyStripeWebhookSignature`)
✅ API Key guardada en variables de entorno
✅ Webhook Secret solo en servidor (no expuesto)
✅ ventaId requerido en metadata para asociar pago a venta
✅ Email verification antes de enviar credenciales

## Troubleshooting

### Webhook no recibido
- Verificar que STRIPE_WEBHOOK_SECRET es correcto
- Validar que el endpoint es accesible desde Stripe
- Revisar logs en Stripe Dashboard → Webhooks → Event details

### Pago no aparece en venta
- Verificar que ventaId en payment intent metadata es exacto
- Revisar que venta existe en DB antes de procesar webhook
- Confirmar que MONGO_URI/DB está accesible

### Signature inválida
- Verificar que STRIPE_WEBHOOK_SECRET no tiene espacios extra
- Confirmar que al actualizar .env se reinició el servidor
- Stripe CLI debe estar en mismo contexto si se testea localmente
