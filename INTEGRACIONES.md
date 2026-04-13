# Integraciones AppSheet, Looker Studio y Persistencia MongoDB

## Variables de entorno

- `INTEGRATION_API_KEY`: llave para consumir endpoints de AppSheet (`x-api-key`)
- `DELIVERY_BASE_URL`: base para enlaces de entrega automáticos
- `DB_PROVIDER`: `json` (default) o `mongo`
- `MONGO_URI`: cadena de conexión de MongoDB Atlas
- `MONGO_DB_NAME`: nombre de base de datos en Mongo (default `app_productos_digitales`)
- `MONGO_SEED_ON_START`: `true|false` para sembrar colecciones desde `data/*.json`
- `ACCESS_TOKEN_TTL_MINUTES`: tiempo de vida del token de descarga segura (default `180`)
- `ACCESS_SINGLE_USE`: `true|false` para invalidar token luego de una descarga (default `true`)
- `MIN_PACKAGE_MARGIN_PCT`: margen minimo objetivo para publicar paquetes (default `25`)
- `DEFAULT_MAX_DISCOUNT_PCT`: descuento maximo por defecto en paquetes (default `15`)

Ejemplo en PowerShell (modo local JSON):

```powershell
$env:INTEGRATION_API_KEY="wmms-integration-key"
npm start
```

Ejemplo en PowerShell (MongoDB Atlas):

```powershell
$env:DB_PROVIDER="mongo"
$env:MONGO_URI="mongodb+srv://usuario:password@cluster.mongodb.net/?retryWrites=true&w=majority"
$env:MONGO_DB_NAME="app_productos_digitales"
$env:INTEGRATION_API_KEY="wmms-integration-key"
npm start
```

## Endpoints para AppSheet

Todos requieren header `x-api-key`.

- `GET /api/integracion/appsheet/schema`
- `GET /api/integracion/appsheet/ventas`
- `GET /api/integracion/appsheet/leads`
- `GET /api/integracion/appsheet/disenos`
- `GET /api/integracion/appsheet/materiales`
- `GET /api/integracion/appsheet/notificaciones`
- `GET /api/integracion/appsheet/consultas`

### Dashboard administrativo (Back-Office)

- `GET /api/integracion/appsheet/inventario`
- `PATCH /api/integracion/appsheet/materiales/:materialId`
- `POST /api/integracion/appsheet/disenos/cargar`
- `PATCH /api/integracion/appsheet/ventas/:ventaId/pago-verificado`
- `POST /api/integracion/appsheet/ventas/:ventaId/regenerar-acceso`
- `POST /api/integracion/appsheet/ventas/:ventaId/reenviar-credenciales`
- `GET /api/integracion/appsheet/historial-credenciales?ventaId=...|destino=...`
- `GET /api/integracion/appsheet/metricas`
- `GET /api/integracion/appsheet/paquetes`
- `POST /api/integracion/appsheet/paquetes`
- `PATCH /api/integracion/appsheet/paquetes/:paqueteId`

Panel interno web:

- `GET /admin.html`

### Paquetes de ventas (API publica)

- `GET /api/paquetes`
- `POST /api/paquetes/cotizar`
- `GET /api/paquetes/politicas`

Body ejemplo de cotizacion:

```json
{
	"paqueteId": "PAQ-PREMIUM"
}
```

Reglas de publicacion automatica:

- Si el descuento excede el limite permitido por estrategia, el paquete se bloquea.
- Si el margen calculado queda por debajo de `MIN_PACKAGE_MARGIN_PCT`, el paquete se bloquea.
- Un paquete bloqueado se guarda con `activo=false`, `bloqueadoPorReglas=true` y `motivosBloqueo`.

### Seguridad de ventas (cerrojo anti-filtracion)

- `GET /api/entrega/validar?token=...`
- `GET /api/entrega/descargar?token=...`

Reglas:

- El token expira segun `ACCESS_TOKEN_TTL_MINUTES`.
- Si `ACCESS_SINGLE_USE=true`, el token queda inutilizable despues de la primera descarga.

### Reenvio de credenciales (Soporte comercial)

Body ejemplo para reenvio:

```json
{
	"regenerarAcceso": true,
	"solicitadoPor": "admin-appsheet"
}
```

Campos de trazabilidad en respuesta e historial:

- `accion`: `pago-verificado` o `reenvio-manual`
- `reenviado`: `true|false`
- `modoEnvio`: `smtp` o `simulado`
- `envioReal`: `true|false`

Contadores nuevos en `GET /api/integracion/appsheet/metricas` (resumen):

- `enviosCredenciales`
- `reenviosCredenciales`
- `enviosCredencialesReales`

### Telemetria de curiosidad

- `POST /api/telemetria/consulta`

Body ejemplo:

```json
{
	"disenoId": "DIS-002",
	"canal": "WhatsApp",
	"origen": "catalogo"
}
```

Filtros disponibles para `ventas`:

- `estadoPago=pagado|pendiente`
- `canal=WhatsApp|Marketplace|...`
- `desde=YYYY-MM-DD`
- `hasta=YYYY-MM-DD`

## Endpoints para Looker Studio (CSV)

- `GET /api/integracion/looker/ventas.csv`
- `GET /api/integracion/looker/leads.csv`
- `GET /api/integracion/looker/notificaciones.csv`
- `GET /api/integracion/looker/dashboard.csv`
- `GET /api/integracion/looker/historial-credenciales.csv` (requiere `x-api-key`)

Los endpoints CSV aceptan filtros de fecha:

- `desde=YYYY-MM-DD`
- `hasta=YYYY-MM-DD`

## Endpoints de persistencia

- `GET /api/persistencia/status`
- `POST /api/persistencia/migrar-json-a-mongo` (requiere `x-api-key`)

La migración copia datos de `data/*.json` a colecciones Mongo:

- `ventas`
- `leads`
- `disenos`
- `materiales`
- `notificaciones`
- `consultas`
- `accesos`
- `paquetes`

## Conexión recomendada

1. Activar MongoDB Atlas con variables `DB_PROVIDER`, `MONGO_URI` y `MONGO_DB_NAME`.
2. Verificar estado con `GET /api/persistencia/status`.
3. Ejecutar `POST /api/persistencia/migrar-json-a-mongo` para llevar históricos.
4. Conectar AppSheet a endpoints `/api/integracion/appsheet/*`.
5. Conectar Looker Studio a `/api/integracion/looker/*.csv`.
6. En producción, publicar en HTTPS y rotar `INTEGRATION_API_KEY`.
