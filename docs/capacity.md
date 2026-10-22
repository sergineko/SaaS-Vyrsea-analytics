# Coste y capacidad

## Qué significan las tres operaciones

Queues contabiliza cada mensaje por bloques de 64 KB. Una entrega habitual consume una escritura, una lectura y un borrado; los reintentos añaden lecturas. `sendBatch` agrupa la llamada, pero no reduce las operaciones de sus mensajes. El ahorro procede de incluir varios trabajos dentro de **un mismo mensaje**.

El MVP agrupa hasta cuatro comprobaciones por mensaje, mantiene un lote entregado de un mensaje y permite tres consumidores concurrentes. Diez trabajos coincidentes pasan de cuatro mensajes con la agrupación anterior de tres a tres mensajes: **12 → 9 operaciones, un 25 % menos**, sin reintentos. Con dos monitores Business coincidentes sigue siendo un mensaje por minuto: 4.320 operaciones diarias. No se retrasa su frecuencia para llenar lotes ni se renuncia a confirmar las entregas.

Cada consumidor hace como máximo cuatro sondas secuenciales: hasta 48 solicitudes externas en el peor caso de tres redirecciones por destino y dos consultas DNS por salto. Las llamadas internas a D1 tienen un límite separado; las cuatro comprobaciones ejecutan hasta 40 sentencias D1, dentro de las 50 del plan Free. El límite de CPU de producción se sigue supervisando: estas cuentas de operaciones no miden CPU ni garantizan latencia.

Tres consumidores permiten procesar los tres mensajes del lote actual de diez trabajos sin serializar sus esperas de red. Cada transacción de resultados mantiene la barrera de slots y la comprobación de estado, cuenta y mantenimiento. Se prueba la entrega duplicada simultánea para no duplicar muestras, agregados o alertas.

## D1 con mucho histórico

La migración `0007` elimina los índices globales `checks_time` y `hourly_time`. Las consultas se sirven por monitor y tiempo con `checks_monitor_time` y la clave de `hourly_stats`. Se añade `(monitor_id, resolved_at)` para localizar incidencias cerradas sin recorrer todo su histórico.

La limpieza comienza por el catálogo de monitores y busca rangos vencidos en los índices de cada monitor. Evita empezar con un recorrido del histórico completo cuando todavía no hay registros vencidos. Los borrados conservan el límite por tabla y la retención individual; no se pierde detalle para ahorrar. Eliminar un índice ahorra su mantenimiento al insertar y borrar muestras, pero no elimina las escrituras de la tabla, outbox ni agregados.

`pnpm run benchmark:storage` genera 100.000 muestras sintéticas en SQLite en memoria, compara el plan y el tiempo de consulta y guarda `artifacts/storage-cost-benchmark.json`. La primera medición local obtuvo 15,242 ms antes y 0,004 ms después para buscar expirados inexistentes en diez monitores. El plan pasó de recorrer el índice de 100.000 muestras a buscar diez rangos. Es una microprueba local, no una prueba de 1.000 usuarios, ni una medición de facturación D1 o latencia remota.

El panel del propietario muestra una proyección por frecuencia y excluye monitores pausados y cuentas suspendidas. El mínimo es una cota matemática; no asegura que los horarios permitan llenar cada mensaje. El máximo supone una comprobación por mensaje. No incluye reintentos ni otros proyectos. Las métricas de Cloudflare son la autoridad del consumo real.

## Proyecciones de crecimiento

Ejemplos con **dos monitores activos por cuenta**, una sonda Cloudflare y sin reintentos. El mínimo de Queues supone agrupación óptima de cuatro y puede no alcanzarse con otros horarios.

| Cuentas | Plan / frecuencia | Sondas al día | Operaciones Queues mínimas al día |
| --- | --- | ---: | ---: |
| 100 | Free / 15 min | 19.200 | 14.400 |
| 1.000 | Free / 15 min | 192.000 | 144.000 |
| 100 | Starter / 5 min | 57.600 | 43.200 |
| 1.000 | Starter / 5 min | 576.000 | 432.000 |
| 100 | Pro o Business / 1 min | 288.000 | 216.000 |
| 1.000 | Pro o Business / 1 min | 2.880.000 | 2.160.000 |

Workers Free incluye 10.000 operaciones diarias de Queues y 100.000 filas escritas diarias en D1, compartidas por la cuenta. Mil cuentas Free del ejemplo excederían D1 incluso con una sola fila por sonda, antes de contar índices, estado, reservas y agregados. **Optimizar no convierte estas cargas en gratuitas.** No se ha activado ningún plan de infraestructura de pago.

El programador actual reserva como máximo diez trabajos por minuto: su límite teórico es 14.400 reservas al día, antes de errores, CPU y cuotas. Es independiente de la capacidad de las colas. El máximo compartido de diez monitores de clientes y el alta supervisada siguen activos. El propietario está exento de cuotas de registro, pero no de la capacidad finita de ejecución: su carga también entra en la proyección de consumo. Esta instalación no admite 100 o 1.000 cuentas con sus monitores, aunque pudiera guardar sus registros.

## Cambios necesarios antes de ampliar la beta

1. Medir tráfico real por tipo de plan, CPU p95/p99, errores, filas D1, antigüedad del trabajo más antiguo, reintentos y DLQ. Comparar capacidad de entrada con la de salida y mantener margen. Una cola vacía en la prueba actual no demuestra capacidad futura.
2. Sustituir la única reserva de diez trabajos por un programador particionado con índice `(partición, próxima_comprobación)`. Páginas acotadas y reservas atómicas; ampliar particiones y consumidores según carga. No crear una Queue o D1 por cliente.
3. Separar colas por clase de servicio cuando la carga lo justifique, para que un atraso masivo de Free no bloquee comprobaciones de un minuto. Mantener pocas colas compartidas y límites de concurrencia de acuerdo con D1 y los destinos.
4. Añadir admisión basada en sondas por minuto y presupuesto, no solo en número de cuentas. No aprobar más capacidad de la que el sistema puede atender con la frecuencia contratada. Reducir la frecuencia silenciosamente no resuelve el problema.
5. Separar estado reciente, históricos y analítica. Estudiar compactación de muestras antiguas, agregados por día y archivo en R2 por bloques antes de aumentar retenciones. Diseñar la consulta y la retención del archivo antes de mover o borrar detalle.
6. Particionar D1 por grupos estables de cuentas cuando lo indiquen escritura concurrente, almacenamiento y latencia. Mantener un catálogo de ubicación y migraciones verificables. Añadir AWS/GCP multiplica trabajo y coste, por lo que requiere otro presupuesto y prueba.
7. Hacer pruebas de carga progresivas con destinos controlados, primero 100 cuentas sintéticas y después 1.000. Verificar retraso de comprobación, aislamiento, reintentos, duplicados y recuperación tras una interrupción. Solicitar el cambio de infraestructura solo cuando exista una estimación y un límite de gasto aprobado.

## Referencias

- [Queues: operaciones y precios](https://developers.cloudflare.com/queues/platform/pricing/)
- [Workers: subsolicitudes, CPU y servicios internos](https://developers.cloudflare.com/workers/platform/limits/)
- [D1: filas, índices y precios](https://developers.cloudflare.com/d1/platform/pricing/)
- [D1: límites por ejecución y almacenamiento](https://developers.cloudflare.com/d1/platform/limits/)
