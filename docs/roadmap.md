# Alcance y evolución

**No están implementadas todas las funciones del Word.** Está construido el núcleo del MVP gratuito y su ejecución local; faltan el despliegue remoto, la etapa comercial y las funciones avanzadas. Los siguientes cambios pedidos después del documento ya están incorporados: marca Vyrsea, Free de un dominio y dos monitores, agrupación por dominio, rediseño visual, prerenderizado, SEO técnico y herramientas de lectura para agentes.

| Requisito del MVP del documento | Estado |
| --- | --- |
| Registro de usuarios | Passkeys reales y sesión segura |
| Alta de monitores | Funcional con límites en servidor y SQLite |
| Disponibilidad HTTP y errores | GET acotado, timeout, redirecciones y DNS |
| Rendimiento básico | Tiempo de la comprobación HTTP, sin navegador |
| Estadísticas e histórico | Agregados horarios, muestras recientes y gráficos |
| Incidencias | Dos fallos para confirmar, recuperación y deduplicación |
| Panel de clientes | Datos privados por usuario, búsqueda y filtros |
| Planes por dominio y monitores | Free 1/2 aplicado en servidor; cuatro planes definidos; Free 15 min/7 días, Starter 5 min/30 días, Pro / Agencia 1 min/90 días y Business a medida |
| Alertas gratuitas | Dentro del panel; sin envío externo |
| Mantenimiento programado | Funcional: horario por monitor, cancelación, protección de trabajos en cola y en curso, reanudación y conservación de incidencias previas |
| Investigación de errores | Filtros de incidencias y muestras correctas/fallidas con paginación en servidor |
| Cron Triggers y Queues | Programador, outbox, reintentos y DLQ |
| Workers Static Assets | SPA y API en un único despliegue Wrangler |
| Seguridad de formularios | Turnstile remoto y validación de origen |
| D1 y Drizzle | Esquema, migración, índices y CRUD |
| Cuenta y recursos Cloudflare remotos | Pendientes de autenticar y configurar la cuenta |

La última auditoría local de la portada obtiene rendimiento 99 en móvil y 100 en escritorio; accesibilidad, buenas prácticas y SEO alcanzan 100 en ambos. El detalle y sus límites están en [calidad](quality.md). Los tests cubren el plan Free, dominios complejos, concurrencia y aislamiento, además de los flujos de autenticación, cola e incidencias.

## Siguiente validación antes de abrir el registro

Desplegar en la cuenta Free, registrar una passkey desde un dispositivo real y observar durante un día las métricas de CPU, filas y operaciones con diez monitores. Probar un destino de éxito y otro controlado de fallo/recuperación y comprobar incidentes y retrasos. Revisar la salida DNS con destinos no confiables antes de una beta abierta. Estas validaciones necesitan recursos remotos y no se consideran realizadas por pasar tests locales.

## Etapa comercial

Añadir recuperación y gestión de credenciales, correo transaccional, página pública de estado, webhooks, soporte de cuenta y eliminación/exportación de datos. Las cuotas por plan ya existen; falta conectar la asignación de planes a facturación real. Solo después integrar Dodo Payments con webhooks verificados, idempotencia y cambios de suscripción en servidor. Los precios definidos posteriormente por el propietario sustituyen al Word: Starter 7,99 €, Pro / Agencia 29,99 € y Business por consulta. Dodo Payments será el único proveedor; no se habilitará hasta una instrucción expresa del propietario. No hay productos ni cobros activos.

Validar Workers Paid y sus costes antes de activar correo u otras capacidades. No se incluye una migración automática a pago.

## Históricos y funciones avanzadas

Con mayor volumen, exportar muestras a R2 en bloques comprimidos por cliente y fecha con retención explícita; conservar agregados diarios además de los horarios. Evaluar división de D1 por grupos de cuentas cuando su tamaño y la concurrencia lo justifiquen.

La caducidad SSL requiere una prueba técnica independiente de qué metadatos expone el entorno TLS; no inferirla a partir de que HTTPS responda. La caducidad de dominios depende del acceso y calidad de RDAP. Las capturas y cambios visuales requieren Browser Run y su presupuesto. Las sondas independientes requieren una red de medición distinta y no deben anunciarse como existentes por usar Cron Workers.

| Función adicional del documento | Estado y dependencia |
| --- | --- |
| Dodo Payments y suscripciones | Pendiente; eventos verificados antes de conceder cuotas |
| Correo a destinatarios de clientes | Pendiente; proveedor y presupuesto a validar |
| Páginas públicas de estado | Pendiente; publicación explícita y datos filtrados |
| Cambios DNS y caducidad RDAP | Pendiente; frecuencia y cobertura de proveedores |
| Certificados SSL | Pendiente de prototipo TLS y fiabilidad de la fecha |
| Contenido y palabras clave | Pendiente; lectura de cuerpo acotada y reglas configurables |
| Informes PDF | Pendiente; generación bajo demanda y acceso privado |
| Histórico en R2 | Pendiente; volumen, retención y archivo por lotes |
| Capturas y cambios visuales | Pendiente; Browser Run y coste |
| Sondas independientes por países | Pendiente; infraestructura externa a la medición actual. Se reservan AWS, Google Cloud y Cloudflare para Pro / Agencia y Business; el diseño y las dependencias están en [verificación entre proveedores](multi-probe.md) |

Las mejoras se ordenan por utilidad y coste en [el plan de producto](product-plan.md). Ninguna función pendiente se presenta como incluida en una suscripción contratable.
