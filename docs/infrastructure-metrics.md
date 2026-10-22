# Métricas reales y capacidad

**Accesos y cuentas** consulta Cloudflare desde el servidor, exclusivamente para el propietario activo. El token `vyrsea-analytics` tiene únicamente `Account Analytics: Read` sobre la cuenta autorizada. Se guarda como `CLOUDFLARE_ANALYTICS_TOKEN`, nunca como variable VITE ni en el repositorio. La instalación temporal autorizada se elimina después de guardarlo. El token puede leer analítica de toda la cuenta; las consultas de aplicación muestran recursos de Vyrsea y totales agregados de la cuenta para interpretar las cuotas compartidas. No permiten elegir recursos, fechas ni consultas desde el navegador.

La API utiliza `queueMessageOperationsAdaptiveGroups`, `d1AnalyticsAdaptiveGroups`, `d1StorageAdaptiveGroups` y `workersInvocationsAdaptive`. Consulta la cola, D1 y el script fijados en `wrangler.production.jsonc`. Los totales de cuenta no exponen nombres, consultas SQL ni datos de otras aplicaciones.

- Queues: operaciones facturables, retraso medio de escritura a lectura y reintentos medios.
- D1: filas leídas/escritas y tamaño de la base de Vyrsea.
- Workers: invocaciones, errores y CPU mediana de Vyrsea. `cpuTimeP50` de GraphQL se expresa en microsegundos y se convierte a milisegundos.
- Backlog: `CHECK_QUEUE.metrics()` da un valor puntual; se consulta directamente, sin consumir mensajes.

El panel se actualiza cada minuto cuando está visible. Una caché privada de aplicación en el edge y una instantánea en el isolate reutilizan la analítica durante 60 segundos; no hay tabla de telemetría por comprobación ni nuevas colas. La API enviada al navegador mantiene `Cache-Control: no-store` y comprueba la sesión antes de acceder a esa caché.

Los totales diarios comienzan a las 00:00 UTC. La consulta deja dos minutos para que lleguen los datos del proveedor; esa espera no garantiza que Cloudflare haya publicado todos los eventos. Los datasets adaptativos pueden aplicar muestreo. No se presenta esta analítica como factura ni como contabilidad instantánea exacta. Los campos no disponibles se muestran como ausencia de datos, nunca como ceros inventados.

La proyección al cierre usa `consumido + ritmo de los últimos 15 minutos × segundos restantes del día UTC`. Los despliegues, limpiezas y picos pueden distorsionarla. Se conserva una previsión teórica según las frecuencias en un bloque desplegable para comparar ambos modelos.

## Colas y ampliación de beta

Cada mensaje contiene hasta cuatro comprobaciones. Una escritura, lectura y eliminación de un mensaje de menos de 64 KB son tres operaciones normales; tres o cuatro monitores que coincidan pueden compartirlas. Cinco comprobaciones requieren al menos dos mensajes. `sendBatch` agrupa transporte, pero no elimina las operaciones de cada mensaje.

El consumidor recibe un mensaje por invocación y ejecuta dos sondas simultáneas, esperando ambas antes de cualquier reintento. Una sonda tiene como máximo dos solicitudes DNS simultáneas y cancela el cuerpo HTTP; dos sondas mantienen acotadas las conexiones. El peor caso conserva 48 solicitudes externas y 40 consultas D1 por mensaje de cuatro trabajos. `max_batch_timeout=0` elimina la espera de agrupación configurable; Cloudflare puede añadir su propio retraso de entrega. El timeout anterior tampoco debía esperar cinco segundos si ya se completaba el lote de un mensaje.

La lectura previa al cambio del 22-10-2026 encontró backlog cero y cero reintentos, con unos 6,16 s de retraso medio de lectura y un máximo de minuto de 26,03 s en la ventana observada. Son una muestra inicial, no un SLA ni una prueba de carga. Las cifras deben compararse con la nueva ventana de métricas después del despliegue.

Agrupar permite ampliar la beta, pero no justifica eliminar los límites técnicos. Deben comprobarse a la vez operaciones de colas, filas leídas/escritas, CPU, cadencia, backlog y reintentos durante un periodo representativo. El tope actual de diez monitores de clientes se mantiene. Los monitores del propietario no ocupan esas plazas, pero sí consumen cuotas.

Referencias: [métricas de Queues](https://developers.cloudflare.com/queues/observability/metrics/), [precios de Queues](https://developers.cloudflare.com/queues/platform/pricing/), [D1](https://developers.cloudflare.com/d1/observability/metrics-analytics/) y [Workers](https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/).
