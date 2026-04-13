# Analytics Hardening - Validaciones Robustas 

## Descripción
Sistema de validaciones mejoradas para endpoints de métricas y analytics, previniendo errores, inyecciones, y consultas malformadas.

## Validaciones Implementadas

### 1. Validación de Fechas

#### Formato de Fecha
- Formato requerido: `YYYY-MM-DD`
- Error si: fecha no sigue formato
- Código: 400 "Formato de fecha invalido. Use YYYY-MM-DD"

```
❌ Inválido: "2024/04/12", "12-04-2024", "2024", ""
✅ Válido: "2024-04-12", null, undefined
```

#### Rango de Fechas Válido
- Condición: `desde <= hasta`
- Error si: desde > hasta
- Código: 400 "Fecha desde no puede ser mayor a hasta"

```
❌ desde: "2024-04-12", hasta: "2024-04-01"
✅ desde: "2024-04-01", hasta: "2024-04-12"
```

#### Rango Máximo Permitido
- Máximo: 90 días consecutivos
- Error si: rango > 90 días
- Código: 400 "Rango máximo permitido: 90 días"

```
❌ desde: "2024-01-01", hasta: "2024-04-15" (104 días)
✅ desde: "2024-02-15", hasta: "2024-05-15" (89 días)
```

#### No Fechas Futuras
- Validación: `hasta <= hoy`
- Error si: hasta está en el futuro
- Código: 400 "No se pueden consultar fechas futuras"

```
❌ hasta: "2025-04-12" (futuro)
✅ hasta: "2024-04-11" (pasado), null
```

### 2. Validación de Estados de Pago

#### Valores Permitidos
- Válidos: `"pagado"`, `"pendiente"`, (vacío=sin filtro)
- Error si: valor no está en lista
- Código: 400 "Estado inválido. Valores permitidos: pagado, pendiente"

```
❌ estadoPago: "cancelado", "PAGADO", "pag"
✅ estadoPago: "pagado", "pendiente", "" (sin filtro)
```

### 3. Validación de Canal

#### Longitud Máxima
- Máximo: 100 caracteres
- Error si: canal.length > 100
- Código: 400 "Canal no puede exceder 100 caracteres"

#### Sanitización
- Se convierte a lowercase
- Se trimea (quita espacios)
- Búsqueda case-insensitive

```
❌ canal: "WhatsApp muy largo y con caracteres especiales ñ @#$%..."
✅ canal: "WhatsApp", "web", "instagram"
```

## Endpoints Afectados

### GET /api/integracion/appsheet/metricas
```
Query Parameters:
- desde: YYYY-MM-DD (opcional)
- hasta: YYYY-MM-DD (opcional)

Validaciones:
✓ Formato de fecha (si se proporciona)
✓ desde <= hasta
✓ Rango máximo 90 días
✓ No fechas futuras
```

### GET /api/integracion/appsheet/ventas
```
Query Parameters:
- estadoPago: pagado | pendiente (opcional)
- canal: string (opcional, max 100 chars)
- desde: YYYY-MM-DD (opcional)
- hasta: YYYY-MM-DD (opcional)

Validaciones:
✓ Estado válido
✓ Canal length ≤ 100
✓ Todas las validaciones de fecha
```

### GET /api/integracion/appsheet/leads
```
Similar a ventas, soporta los mismos filtros
```

## Ejemplos Correctos

### Consulta válida - Últimos 7 días
```
GET /api/integracion/appsheet/metricas?desde=2024-04-05&hasta=2024-04-12
```

### Consulta válida - Mes completo
```
GET /api/integracion/appsheet/ventas?estadoPago=pagado&desde=2024-04-01&hasta=2024-04-30
```

### Consulta válida - Sin rango de fechas
```
GET /api/integracion/appsheet/metricas
```

### Consulta válida - Solo hasta hoy
```
GET /api/integracion/appsheet/leads?hasta=2024-04-12
```

## Ejemplos Inválidos y Errores

### Formato de fecha inválido
```
❌ GET /api/integracion/appsheet/metricas?desde=04-12-2024

Response (400):
{
  "error": "Formato de fecha invalido. Use YYYY-MM-DD"
}
```

### Rango invertido
```
❌ GET /api/integracion/appsheet/ventas?desde=2024-04-12&hasta=2024-04-01

Response (400):
{
  "error": "Fecha desde no puede ser mayor a hasta"
}
```

### Rango > 90 días
```
❌ GET /api/integracion/appsheet/metricas?desde=2024-01-01&hasta=2024-05-01

Response (400):
{
  "error": "Rango máximo permitido: 90 días. Rango solicitado: 120 días"
}
```

### Fecha futura
```
❌ GET /api/integracion/appsheet/metricas?hasta=2025-04-12

Response (400):
{
  "error": "No se pueden consultar fechas futuras"
}
```

### Estado inválido
```
❌ GET /api/integracion/appsheet/ventas?estadoPago=cancelado

Response (400):
{
  "error": "Estado inválido. Valores permitidos: pagado, pendiente"
}
```

### Canal demasiado largo
```
❌ GET /api/integracion/appsheet/ventas?canal=...{más de 100 caracteres}...

Response (400):
{
  "error": "Canal no puede exceder 100 caracteres"
}
```

## Mejoras Implementadas

### Antes
- Sin validación de formato de fecha
- Sin límite de rango (podía consultar años completos)
- Sin rechazo de fechas futuras
- Sin validación de valores enum
- Sin límites de longitud en strings

### Después
✅ Validación estricta de fechas (YYYY-MM-DD)
✅ Rango máximo 90 días
✅ Rechazo de fechas futuras
✅ Whitelist de valores permitidos (estado, etc.)
✅ Límites de longitud en parámetros string
✅ Mensajes de error informativos
✅ Protección contra inyección de parámetros
✅ Trim y normalization de inputs

## Testing

### Script de Testing
```bash
# Prueba formato inválido
curl -X GET "http://localhost:3007/api/integracion/appsheet/metricas?desde=invalid"

# Prueba rango invertido
curl -X GET "http://localhost:3007/api/integracion/appsheet/metricas?desde=2024-04-12&hasta=2024-04-01"

# Prueba rango > 90 días
curl -X GET "http://localhost:3007/api/integracion/appsheet/metricas?desde=2024-01-01&hasta=2024-06-01"

# Prueba fecha futura
curl -X GET "http://localhost:3007/api/integracion/appsheet/metricas?hasta=2025-04-12"

# Prueba estado inválido
curl -X GET "http://localhost:3007/api/integracion/appsheet/ventas?estadoPago=CANCELADO"

# Prueba correcta
curl -X GET "http://localhost:3007/api/integracion/appsheet/metricas?desde=2024-04-01&hasta=2024-04-12"
```

## Logs de Validación

Cuando una validación falla, el servidor retorna:

```json
{
  "statusCode": 400,
  "message": "Descripción del error",
  "hint": "Información adicional si aplica"
}
```

Ejemplos en logs del servidor pueden incluir:
```
[metrics query] validation error: invalid date format
[metrics query] validation error: date range exceeds 90 days
[metrics query] validation error: future date not allowed
[ventas filter] validation error: invalid status
[ventas filter] validation error: parameter too long
```

## Performance

Las validaciones se ejecutan:
1. **Antes** de la lectura de datos (fail-fast)
2. **Una sola vez** por request
3. **Sin recursión** (protección contra DoS)
4. **Con límites de memoria** (strings, arrays)

## Seguridad

✅ **Injection Prevention**: Parámetros validados antes de uso
✅ **Overflow Prevention**: Límites de longitud en strings
✅ **Range Validation**: Fechas dentro de rango permitido
✅ **Type Checking**: Conversión y validación de tipos
✅ **Whitelist Approach**: Solo valores permitidos aceptados
✅ **Error Messages**: No revelan información sensible
✅ **Input Normalization**: Trim, lowercase, sanitization
