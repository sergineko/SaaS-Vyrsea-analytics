# Crecimiento de los datos de Vyrsea

Decisión del 23 de octubre de 2026: mantener **0 € de infraestructura durante la beta**. El propietario valorará aumentar el presupuesto cuando existan suscripciones. No se ha creado ningún servidor, base externa o servicio de pago.

## Qué se ha optimizado ahora

Se mantiene D1 con retención por cuenta, outbox fiable y el histórico individual. El programador reserva un lote mediante tres sentencias, los resultados evitan ramas imposibles y el dashboard reutiliza resúmenes de horas cerradas durante cinco minutos. El estado y la hora en curso se consultan en cada actualización. El detalle personalizado busca solo los dos rangos que necesita. Las mediciones y sus límites están en [capacity.md](capacity.md).

La base sigue consumiendo diez escrituras por comprobación sana en el benchmark local, más los borrados al caducar y otras operaciones. D1 Free incluye 100.000 escrituras y cinco millones de lecturas por día compartidos por cuenta. Cachear lecturas no aumenta esa cuota de escritura. Se conserva la aprobación manual y el límite compartido de diez monitores de clientes, además de la carga del propietario. No aumentar la beta solo porque la cola esté vacía.

## Una base sin cuotas por fila

PostgreSQL autohospedado permite dimensionar CPU, RAM, disco y conexiones en lugar de contratar una cuota de filas leídas/escritas. Es compatible con la aplicación React, la API Hono y Workers mediante un cliente PostgreSQL y conexiones TLS agrupadas. Esto es una opción técnica, no una migración ya implementada.

No significa capacidad ilimitada: el disco se llena y las consultas compiten por CPU, memoria e I/O. Un VPS necesita mantenimiento, actualizaciones, supervisión, copias fuera del servidor y pruebas de restauración. Normalmente ampliar un volumen requiere pedir capacidad al proveedor y ampliar el sistema de archivos. Para crecimiento automático de almacenamiento debe elegirse un servicio que lo implemente y fijar un máximo y alertas de coste. Por ejemplo, RDS permite autoscaling con un máximo configurado, pero no reduce luego el almacenamiento asignado. No es un servicio de coste cero.

## Alternativas para el lanzamiento abierto

Recomendación técnica: PostgreSQL para cuentas, cuotas, passkeys, suscripciones, estado e incidencias. Para el histórico, empezar con particiones temporales nativas o TimescaleDB si la carga y el proveedor lo justifican; añadir ClickHouse como almacén analítico separado si las consultas agregadas dominan el coste. Es una recomendación de arquitectura, no una afirmación de capacidad ya probada.

| Motor / servicio | Encaje en Vyrsea | Coste y crecimiento | Trabajo necesario |
| --- | --- | --- | --- |
| PostgreSQL autohospedado | Control transaccional y registros en un solo motor; particiones por tiempo e índices por cuenta/monitor | VPS y copias externas; sin factura por cada fila. CPU, IOPS, disco, conexiones y mantenimiento siguen limitados. El crecimiento del volumen depende del cloud. | Migrar SQL/triggers, pool de conexiones, backups con restauración y supervisión. Un servidor no equivale a alta disponibilidad. |
| PostgreSQL gestionado: Supabase, Neon, Crunchy Bridge o RDS | Mismo modelo relacional con operación delegada | Supabase Pro desde 25 USD/mes; Neon por CU-h y GB; Crunchy anuncia planes desde unos 10 USD/mes con configuración/almacenamiento aparte; RDS puede ampliar disco automáticamente hasta el máximo configurado. No son presupuestos para la carga futura. | Verificar región, capacidad, extensiones, copias, conexiones, tráfico y coste sostenido. Supabase completo aporta servicios que Vyrsea quizá no necesite. |
| PostgreSQL + TimescaleDB / Tiger Cloud | Especialmente adecuado para muestras temporales, agregados de disponibilidad y políticas de histórico | Autohospedado según servidor/licencia y funciones; Tiger Cloud anuncia cómputo desde 30 USD/mes más almacenamiento. Permite crecer el servicio y separar almacenamiento histórico según modalidad. | Diseñar hypertables, agregados y retención por grupos de política. No borrar un chunk mixto que todavía contenga datos válidos de otro plan. |
| PostgreSQL + ClickHouse | PostgreSQL conserva operaciones y cuentas; ClickHouse sirve histórico y analítica de grandes volúmenes | Self-host o Cloud por cómputo, almacenamiento y transferencia. La prueba gratuita de Cloud dura 30 días; no es infraestructura gratuita permanente. | Ingestión agrupada, confirmación duradera, reintentos/deduplicación y lectura con retraso controlado. Es otro sistema que operar. |
| ScyllaDB | Opción especializada para ingestión distribuida y consultas conocidas por clave/tiempo | Nodos, replicación, copias, tráfico y licencia según versión/tamaño. La oferta source-available gratuita tiene condiciones y topes; no es crecimiento gratuito ilimitado. | Rediseño a CQL y particiones, consistencia, reparación de réplicas y una capa transaccional aparte para la aplicación. |

No asumir que Supabase gestionado incluye TimescaleDB: desde PostgreSQL 17 su plataforma ya no ofrece esa extensión. Las imágenes autohospedadas predeterminadas de PG17 tampoco la incluyen. Para TimescaleDB elegir una distribución/proveedor que lo soporte expresamente; para Supabase moderno, valorar particiones PostgreSQL nativas.

ClickHouse tiene un cliente web oficial compatible con Cloudflare Workers. PostgreSQL/TimescaleDB pueden permanecer detrás de Workers mediante un pool TLS o Hyperdrive; Neon también ofrece un controlador serverless por HTTP/WebSocket, sujeto a su consumo de cómputo. Se conservan React y Hono en todas estas opciones. Las credenciales de base de datos siguen exclusivamente en el servidor.

### Escenarios de ingestión y retención

Dos monitores por cuenta, sin pausas ni reintentos y **una sonda**. Las cifras son aritméticas y no una prueba de carga. La columna de espacio usa **200 bytes por muestra como hipótesis**, sin índices, agregados, copias, replicación o compresión; hay que sustituirla por mediciones del motor elegido.

| Escenario | Muestras diarias | Muestras conservadas | Datos a 200 bytes/muestra |
| --- | ---: | ---: | ---: |
| 1.000 Free, 15 min y 7 días | 192.000 | 1.344.000 | 0,27 GB |
| 1.000 Starter, 5 min y 30 días | 576.000 | 17.280.000 | 3,46 GB |
| 1.000 Pro, 1 min y 90 días | 2.880.000 | 259.200.000 | 51,84 GB |
| 100 Pro usando sus 100 monitores, 1 min y 90 días | 14.400.000 | 1.296.000.000 | 259,20 GB |

Si se guarda una muestra por proveedor, tres sondas multiplican esa ingestión y detalle por tres; un registro de consenso tendría otro modelo. Ninguna de esas arquitecturas multisonda está medida o desplegada. La frecuencia genera ráfagas si todos los monitores comparten minuto: el diseño debe repartir fases y particiones de planificación manteniendo el intervalo contratado.

En D1 Paid el límite de 10 GB **por base** sí es un límite de arquitectura; el volumen mensual de filas incluido en el precio se puede exceder pagando. No confundir ambos. D1 también ofrece varias bases por cuenta, pero repartir clientes añade enrutamiento y migraciones y no amplía la capacidad de escritura de una base individual. Para los escenarios de históricos extensos anteriores, PostgreSQL/TimescaleDB o PostgreSQL + ClickHouse permiten una ruta de crecimiento más clara que acumular todo en una D1.

## ¿Supabase completo o PostgreSQL?

Vyrsea ya tiene API y autenticación por passkeys. Si solo se necesita cambiar la base de registros, PostgreSQL con un pool de conexiones evita operar servicios adicionales de Auth, Realtime, Storage y Functions. No hace falta sustituir el inicio de sesión para cambiar el motor de datos.

Supabase autohospedado sigue siendo viable si más adelante necesitamos su plataforma. Su instalación completa requiere como mínimo 4 GB de RAM, dos núcleos y 40 GB SSD; recomienda 8 GB, cuatro núcleos y 80 GB o más. Se pueden retirar componentes no usados. El software libre no incluye gratis el servidor, las copias, la operación o el almacenamiento creciente. El crecimiento del disco y la alta disponibilidad deben diseñarse aparte.

## Conectar PostgreSQL con Workers

Hyperdrive aporta agrupación de conexiones cerca de la aplicación. **En Workers Free tiene 100.000 sentencias SQL diarias** y también cuenta las consultas servidas desde su caché. Usarlo con PostgreSQL sin cambiar de plan puede sustituir la cuota de D1 por otra cuota diaria. En Workers Paid Hyperdrive no limita el número de consultas facturadas por ese servicio; siguen existiendo capacidad de la base y límites técnicos de Workers y Queues.

Una conexión directa TLS a un pool PostgreSQL o una API HTTP evita la cuota de Hyperdrive, pero requiere medir latencia, conexiones, autenticación y coste del servicio. No elimina los límites de ejecución del Worker. No se elegirá esa vía solo para afirmar que hay consultas ilimitadas.

## Alternativas por etapa

| Etapa | Decisión | Motivo |
| --- | --- | --- |
| Beta sin ingresos | D1 Free optimizado, alta supervisada y admisión acotada | Mantiene 0 € sin añadir operación de servidores. Las métricas reales y el margen diario deciden cuándo detener altas. |
| Primeras suscripciones | Comparar Workers Paid + D1 con PostgreSQL | D1 de pago elimina el bloqueo por cuota gratuita diaria y cobra el exceso mensual; desde 5 USD/mes de Workers, antes de otros consumos. Es la ampliación con menos cambios de código. |
| Demanda sostenida de históricos | Prueba de PostgreSQL gestionado o VPS con backups externos | Evita el modelo de facturación por filas de D1 si el coste total y la carga medida lo justifican. Dimensionar ingestión, retención y lecturas antes de mover producción. |

Los límites de espacio por base y de escritura concurrente de D1 siguen existiendo en Paid. PostgreSQL tampoco hace que cientos de cuentas sean compatibles con el programador actual de diez reservas por minuto: planificación y consumidores necesitan su propia ampliación y prueba de carga.

## Ruta de migración que preserva el producto

1. Medir días completos: filas leídas/escritas, tamaño e índices, comprobaciones por minuto, latencias y retraso de cola. Reproducir el patrón en una base de prueba con datos sintéticos y presupuesto aprobado.
2. Adaptar consultas y esquema SQLite a PostgreSQL: JSON, tipos, triggers de cuotas, claves, índices y borrados de retención. Los contadores y límites deben seguir siendo atómicos. La interfaz D1 y su batch transaccional no se sustituyen cambiando solo una URL.
3. Guardar cada resultado en una transacción que compruebe cuenta, mantenimiento y slot, escriba muestra y agregados, actualice estado/incidencias y cierre el outbox. Verificar duplicados, mensajes fuera de orden, reintentos y fallos de red con pruebas de concurrencia.
4. Elegir qué tablas mover. Trasladar solo `checks` deja en D1 reservas, estado, agregados y autenticación; ahorra una parte de las escrituras, pero no elimina su cuota. Evitar doble escritura como estado final sin reconciliación y presupuesto.
5. Preparar copia consistente, importación y validación por cuenta/periodo: recuentos, sumas de disponibilidad y claves. Mantener el dominio y RP ID de WebAuthn y las passkeys de los titulares. No registrar credenciales nuevas desde la migración.
6. Ensayar corte, drenaje de cola y vuelta atrás sin perder resultados. Diseñar particiones temporales, archivado y eliminación por plan antes de ampliar históricos; no borrar detalle antes de que su sustituto pueda consultarse.

## ScyllaDB como alternativa de telemetría

ScyllaDB puede evaluarse para una ingestión sostenida mucho mayor. Para esta beta sería una complejidad operativa adicional sin una prueba que demuestre su necesidad. No sustituye directamente el SQL, las relaciones y las transacciones del control de cuentas. Su documentación distingue mínimo de producción de memoria (4 GB o 0,5 GB por núcleo lógico, el mayor) y recomendación (16 GB o 2 GB por núcleo). No se puede convertir una cifra genérica de operaciones por núcleo en capacidad garantizada de Vyrsea.

Tres nodos con RF=3 son una configuración habitual para tolerar la caída de una réplica conservando quorum. Lo relevante es cuántas réplicas confirman cada operación y la distribución por datacenter; tener un número impar de máquinas no garantiza por sí solo ausencia de pérdida o lectura reciente. ONE y LOCAL_ONE priorizan disponibilidad y no deben aplicarse sin estudiar los requisitos de consistencia del control de cuentas.

TTL y TWCS pueden reducir el trabajo de expiración de series temporales, pero no eliminan compaction ni consumo de disco y CPU. Mezclar retenciones Free/Starter/Pro/Business en una misma tabla TWCS requiere un diseño específico: ScyllaDB recomienda un TTL uniforme por tabla para purgar SSTables eficientemente. Particionar por monitor y fecha completa puede acotar datos; si una partición concentra demasiada carga, habrá que dividirla más. No se presupone que cambiar la fecha distribuya perfectamente las escrituras actuales.

Se estudiaría como almacén especializado de telemetría con carga medida y financiación suficiente, manteniendo separado el control transaccional. No es la siguiente ampliación recomendada para el MVP de coste cero.

La FAQ oficial de licencias sitúa el nivel gratuito de las versiones Enterprise source-available desde 2025.1 en un máximo agregado de 10 TB de disco y 50 vCPU por organización; hay que validar los términos de la versión concreta antes de contratar. Los servidores y su operación se pagan igualmente. No basar la decisión en una antigua licencia AGPL de la rama 6.2.

## Fuentes oficiales consultadas

- [D1: precios, índices y aplicación de límites](https://developers.cloudflare.com/d1/platform/pricing/)
- [D1: límites técnicos](https://developers.cloudflare.com/d1/platform/limits/)
- [Workers: precios](https://developers.cloudflare.com/workers/platform/pricing/)
- [Hyperdrive: precios y cuotas de consultas](https://developers.cloudflare.com/hyperdrive/platform/pricing/)
- [Hyperdrive: funcionamiento y conexiones](https://developers.cloudflare.com/hyperdrive/concepts/how-hyperdrive-works/)
- [Supabase autohospedado: requisitos de Docker](https://supabase.com/docs/guides/self-hosting/docker)
- [RDS: crecimiento automático del almacenamiento y sus límites](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PIOPS.Autoscaling.html)
- [ScyllaDB: requisitos de sistema](https://docs.scylladb.com/manual/stable/getting-started/system-requirements.html)
- [ScyllaDB: niveles de consistencia](https://docs.scylladb.com/manual/stable/cql/consistency.html)
- [ScyllaDB: TTL y compaction](https://docs.scylladb.com/manual/stable/kb/ttl-facts.html)
- [ScyllaDB: estrategias de compaction y advertencias de TWCS](https://docs.scylladb.com/manual/stable/architecture/compaction/compaction-strategies.html)
- [PostgreSQL: particiones y eliminación por bloques](https://www.postgresql.org/docs/current/ddl-partitioning.html)
- [Supabase: precios](https://supabase.com/pricing)
- [Supabase: migración de TimescaleDB a particiones nativas](https://supabase.com/docs/guides/database/migrating-to-pg-partman)
- [Supabase autohospedado: cambio de imagen PostgreSQL 17](https://supabase.com/changelog/46080-self-hosted-supabase-upgrading-from-pg-15-to-17-breaking-change)
- [Neon: precios](https://neon.com/pricing)
- [Neon: controlador serverless](https://neon.com/docs/serverless/serverless-driver)
- [Crunchy Bridge: precios](https://www.crunchydata.com/pricing)
- [Tiger Cloud: precios](https://www.tigerdata.com/pricing)
- [TimescaleDB: agregados continuos](https://www.tigerdata.com/docs/build/continuous-aggregates/refresh-policies)
- [TimescaleDB: automatización y retención](https://www.tigerdata.com/docs/build/data-management/about-automation)
- [ClickHouse: cliente JavaScript para Workers](https://clickhouse.com/docs/integrations/language-clients/js/index)
- [ClickHouse: inserciones asíncronas y confirmación](https://clickhouse.com/blog/asynchronous-data-inserts-in-clickhouse)
- [ClickHouse Cloud: precios](https://clickhouse.com/pricing)
- [ScyllaDB: licencia source-available y condiciones del nivel gratuito](https://www.scylladb.com/source-available-faq/)
