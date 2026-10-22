# D1, consumo por comprobación y opciones de crecimiento

Evaluación del 23 de octubre de 2026. Recomendación: conservar D1 para la beta controlada, aplicar la compactación y revisar Workers Paid antes de ampliar capacidad. No se ha contratado ningún plan ni migrado a otro proveedor.

## Medición reproducible

`node scripts/benchmark-writes.mjs 0010` y `node scripts/benchmark-writes.mjs 0012` ejecutan el programador, outbox y transacción de resultado sobre D1 de Miniflare/workerd con tres monitores sanos. Solo usan datos sintéticos aislados. Se suman los `meta.rows_written` de cada sentencia; no son mediciones de producción ni una garantía de coste.

| Ciclo de tres monitores | Antes | Después |
| --- | ---: | ---: |
| Primer ciclo / creación de agregados | 42 | 30 |
| Ciclo posterior, agregado existente | 39 | 30 |
| Por comprobación en régimen estable | 13 | 10 |

Se utilizan tablas `WITHOUT ROWID` en checks, hourly_stats y check_jobs para evitar duplicar la clave primaria en un índice adicional. El índice de entrega ordena por `created_at`, sin reescribir un índice de `dispatched_at` en cada envío. Se conservan historial individual, estadísticas, última respuesta, outbox y barrera transaccional de idempotencia. La migración copia todos los datos en una transacción, conserva claves e índices de consulta y requiere una instantánea previa. La limpieza usa claves explícitas en lugar de rowid.

Agrupar mensajes ahorra operaciones de Queues; `DB.batch()` reduce viajes y ofrece atomicidad, pero no deja de contar cada fila escrita. D1 contabiliza INSERT, UPDATE, DELETE y mantenimiento de índices. Borrar historial también consume escrituras.

## Carga orientativa con una sola sonda operativa

| Escenario | Comprobaciones / día | Escrituras base / día | Base + borrado de checks al vencer |
| --- | ---: | ---: | ---: |
| 3 monitores de propietario, cada minuto | 4.320 | 43.200 | 47.520 |
| 1 Free con 2 monitores, cada 15 min | 192 | 1.920 | 2.112 |
| 1 Starter con 15, cada 5 min | 4.320 | 43.200 | 47.520 |
| 1 Pro con 100, cada minuto | 144.000 | 1.440.000 | 1.584.000 |
| 100 Free con 2 cada uno | 19.200 | 192.000 | 211.200 |
| 1.000 Free con 2 cada uno | 192.000 | 1.920.000 | 2.112.000 |

No incluye borrado de agregados horarios, fallos, alertas, autenticación, panel, migraciones ni otros proyectos. Tampoco supone que el programador actual pueda servir esas cargas: sigue limitado a diez reservas por minuto (14.400 / día), al presupuesto de CPU, consultas y Queues. La beta mantiene diez monitores de clientes; las cuotas del propietario son de producto, no de infraestructura. No aumentar este tope con una regla basada únicamente en cuentas.

Con el propietario actual, una Free completa añade unas 2.112 escrituras diarias sostenidas. Diez Free completas sumarían unas 68.640 incluyendo propietario y borrado de checks, antes de extras. Es un cálculo de capacidad, no una autorización para duplicar el tope actual ni un benchmark de diez cuentas. Tres sondas futuras tendrán otro coste: no multiplicar ni prometer capacidad hasta medir el diseño real.

## Opciones verificadas

| Opción | Límites / coste relevantes | Evaluación para Vyrsea |
| --- | --- | --- |
| D1 Free | 100.000 escrituras y 5 millones de lecturas al día por cuenta; 500 MB por base | Adecuado para beta pequeña. Al superar cuota diaria las consultas fallan hasta medianoche UTC. |
| Workers Paid + D1 | Base de Workers desde 5 USD / mes; D1 incluye 50 millones de escrituras / mes y 25.000 millones de lecturas; exceso de escritura 1 USD / millón; máximo 10 GB por base | Menor trabajo y coste inicial para este MVP. Siguen existiendo límites técnicos, de tamaño y rendimiento por base. No es ilimitado. |
| Neon PostgreSQL | Free: 1 GB / proyecto, 100 CU-h / mes y tamaños de hasta 2 CU; pago por cómputo y almacenamiento | Permite otra arquitectura de históricos, pero el acceso continuo del monitor reduce el beneficio de scale-to-zero. Requiere prueba de carga y adaptación SQLite → PostgreSQL, transacciones, migraciones y conexiones. |
| Supabase PostgreSQL | Free: 500 MB, CPU compartida y 5 GB de transferencia; Pro desde 25 USD / mes | Útil si se aprovecha su ecosistema. Sustituir solo la BBDD no elimina capacidad, conexiones, transferencia o tamaño, y hoy añade trabajo sin resolver Queues/Cron. |

Los precios se expresan en USD del proveedor, sin conversión ni impuestos. No son el coste total de Vyrsea. Como ejemplo aritmético, 1.000 Free completas generarían unos 63,36 millones de escrituras en 30 días incluyendo borrado de checks: unos 13,36 USD de exceso de D1 sobre lo incluido, además de Workers, Queues, almacenamiento y extras. El programador actual no soporta ese escenario: habría que rediseñarlo y medirlo antes.

## Decisión y siguientes umbrales

1. Mantener aprobación y diez monitores de clientes durante la validación. Comparar varios días completos de analítica con carga representativa después de la migración; un pico de 15 minutos no basta.
2. Mostrar por separado acumulado UTC, previsión al cierre de cuenta y ritmo de Vyrsea extrapolado a 24 horas. Reservar margen cuando la previsión supere 70.000 escrituras diarias; no ampliar en ese caso.
3. Si la demanda supera Free, decidir con el propietario la ampliación de Workers antes de aceptar más carga. No hace falta migrar solo por el límite gratuito diario.
4. Antes de cientos de cuentas: repartir planificación, controlar backpressure, medir cola y latencias, compactar histórico frío sin cambiar la retención ofrecida y separar datos operativos de analítica. Evaluar PostgreSQL con un benchmark de carga y coste total si D1 de pago deja de encajar.

Fuentes: [D1 precios y cómo se cuentan las escrituras](https://developers.cloudflare.com/d1/platform/pricing/), [límites D1](https://developers.cloudflare.com/d1/platform/limits/), [aplicación de límites diarios Free](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/), [Workers precios](https://developers.cloudflare.com/workers/platform/pricing/), [Neon](https://neon.com/pricing), [Supabase](https://supabase.com/pricing).
