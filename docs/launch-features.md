# Preparación comercial sin activar pagos

Las cinco funciones solicitadas están implementadas en el código de aplicación. La configuración de producción conserva `ALERTS_ENABLED=0`, `EMAIL_EVENTS_ENABLED=0` y `CUSTOM_DOMAINS_ENABLED=0`. No cambia la suscripción de Cloudflare, Supabase ni Dodo Payments. Los límites de beta siguen vigentes.

## Correo de Cloudflare y webhooks

El correo usa **Cloudflare Email Service / Email Sending**, con el binding nativo `EMAIL.send()`. No usa Resend, SMTP de IONOS ni un proveedor externo. Se recomienda verificar un subdominio remitente como `notificaciones.vyrsea.com`; su configuración debe obtenerse del alta oficial de Cloudflare, conservando los MX de correo actuales del dominio raíz.

Antes de activar: contratar Workers Paid manualmente; dar de alta el dominio remitente y sus registros de autenticación; añadir el binding `send_email` y `EMAIL_FROM`; y conectar los eventos de Email Sending a la cola existente **vyrsea-checks**, filtrados por zona y dominio. Solo entonces establecer `EMAIL_EVENTS_ENABLED=1` y `ALERTS_ENABLED=1`. La aplicación no contrata el plan ni crea suscripciones de eventos automáticamente.

Cada dirección de alertas requiere confirmar un enlace de 30 minutos. Starter o superior permite email; Pro y Business permiten webhooks. Hay cinco destinos por cuenta en beta. Los secretos de webhooks y los mensajes con enlaces de confirmación se cifran con AES-GCM usando `ALERTS_ENCRYPTION_KEY`, secreto del Worker de 32 bytes en base64. No se devuelve su valor desde la API. El secreto de cada webhook solo se muestra al crearlo.

Los eventos del panel originan entregas únicas por `(destino, evento)`. Cron reutiliza la base de datos y procesa un máximo de cinco por minuto, sin una nueva cola. Cada entrega tiene lease, hasta cinco intentos y espera creciente. Se conservan resultados, intentos y fallos. Un 2xx del webhook confirma aceptación de su servidor. El cliente debe deduplicar el identificador de evento y validar HMAC-SHA256 base64 sobre `timestamp.eventId.cuerpoJSON`, con un margen máximo recomendado de cinco minutos.

La confirmación de webhook hace una petición HTTPS a DNS público, sin seguir redirecciones. El destino devuelve `{"challenge":"valor recibido"}`. Se repite la validación A/AAAA antes de cada entrega. Igual que el sondeo actual, la comprobación DNS previa no fija el socket de `fetch`: antes de permitir destinos arbitrarios en una beta abierta, hay que cerrar el riesgo de DNS rebinding con una salida que fije la IP, o restringir destinos aprobados. No se presenta esta comprobación como protección completa frente a rebinding.

El correo aceptado por Cloudflare queda **aceptado**, no entregado. Los eventos `cf.email.sending.message.*` de la cola actualizan la entrega y deshabilitan destinos con rebotes o quejas. Se almacena un recibo mínimo para soportar que el evento llegue antes de guardar el identificador del envío. «Entregado» significa aceptación del servidor de correo, no lectura ni llegada garantizada a la bandeja principal.

Cloudflare no documenta una clave de idempotencia del envío nativo. La aplicación no promete exactamente una entrega: si se interrumpe un envío y su aceptación es incierta, lo marca **incierto** y no lo reenvía automáticamente. Solo reintenta rechazos temporales conocidos, evitando duplicados por reenvío ciego. El proveedor realiza sus propios reintentos SMTP tras aceptar el mensaje.

## Comunicados y componentes

Las páginas Pro y Business pueden reunir monitores en hasta veinte componentes públicos. Los monitores agrupados deben estar seleccionados para publicación y aparecer como máximo en un componente. El estado técnico del grupo refleja el peor resultado; un servicio sin datos impide dar el grupo por operativo.

Los comunicados son independientes de las incidencias medidas. Tienen gravedad menor/mayor/crítica, componentes afectados, borrador/publicación expresa y cronología de Investigando, Identificado, En observación y Resuelto. Publicar o resolver un comunicado no modifica mediciones ni cierra incidentes técnicos. Solo se expone el texto publicado, sin autores privados, URLs ni errores internos. Se admiten veinte comunicados abiertos y cien actualizaciones por comunicado en beta.

## Marca y dominio

Logo PNG de hasta 32 KB/1024 px y favicon PNG de hasta 8 KB/256 px. Se validan tipo y dimensiones; no se aceptan SVG ejecutables. El HTML exportado conserva la marca, componentes y comunicados, consultando los datos públicos de Vyrsea. La caché pública tiene hasta 60 segundos.

Business puede preparar un subdominio propio y verificar su registro TXT `_vyrsea.<hostname>`. Antes de emitir un certificado se exige una verificación reciente. El aprovisionamiento se conecta a Cloudflare for SaaS con `CUSTOM_DOMAINS_TOKEN` (permiso de zona para custom hostnames), `CUSTOM_DOMAINS_ZONE_ID` y `CUSTOM_DOMAINS_CNAME`. Hace falta configurar allí un origen de respaldo Worker y el CNAME antes de activar `CUSTOM_DOMAINS_ENABLED=1`.

Al activar hostnames propios, `assets.run_worker_first` debe ser `true` para que `/` se resuelva según hostname antes de servir la portada estática. El receptor solo permite GET `/` y `/status.json` para dominios verificados con certificado activo y página publicada; no ofrece autenticación ni API privada en hostnames ajenos. La configuración Free actual mantiene el comportamiento anterior de Static Assets y no activa ese tráfico. Cloudflare gestiona la renovación del certificado; su emisión inicial no se considera completada solo por verificar el TXT.

Un dominio activo debe desvincularse y retirar su certificado antes de eliminar la página. La operación no borra sus monitores. Las configuraciones preparadas sin proveedor se eliminan con la página.

## Equipo Pro / Agencia y Business; auditoría

Cada persona utiliza su cuenta y passkeys existentes. Un administrador invita a una cuenta activa registrada; el enlace está vinculado a ese usuario, caduca en siete días y se consume una vez. No se envía automáticamente a terceros. Los roles:

- Administrador: monitores, páginas, destinos y miembros de la organización.
- Operador: consultas, pausa/comprobación de monitores, mantenimientos y comunicados de incidencias. No borra monitores ni administra equipo o canales.
- Lector: solo consulta. No escribe ni publica.

El selector lateral elige entre el espacio personal y los compartidos. `X-Vyrsea-Workspace` es una preferencia: el servidor vuelve a verificar membresía, plan Pro/Business y rol en cada solicitud. Las rutas de autenticación, seguridad personal y administración global siguen usando la identidad de la sesión. Revocar acceso bloquea las nuevas solicitudes. El equipo reutiliza cuentas registradas; no crea otras ni amplía el máximo global de cien cuentas de la beta. Los cambios de rol invalidan invitaciones pendientes del mismo miembro.

Pro / Agencia incluye un usuario por 29,99 €/mes; dos usuarios cuestan 39,99 € y tres, 49,99 €. El límite de tres incluye al titular. Las invitaciones válidas reservan plaza y pueden cancelarse. Los triggers de PostgreSQL y SQLite impiden superar el límite mediante peticiones simultáneas y bloquean una reducción de plan incompatible con el equipo existente.

Business incluye un usuario en la base personalizada. `business_contracts.seat_price_cents` define el precio mensual de cada usuario adicional por contrato: 1.500 céntimos por defecto, editable en Admin Propietario, incluido cero para acuerdos específicos. La base corresponde al ciclo acordado; los adicionales de un contrato anual incluyen doce mensualidades. Los miembros aceptados ocupan plaza hasta retirar su acceso; las invitaciones pendientes no forman parte del importe. Los importes son referencias, sin cobros, prorrateos ni sincronización con Dodo mientras la contratación siga desactivada.

## Reducción de consultas de Hyperdrive

La función privada `record_monitor_result`, con privilegios del llamante, guarda cada resultado mediante una única consulta de red. Mantiene los bloqueos cuenta → monitor, la comprobación de cuenta/slot/mantenimiento, el histórico, agregados, incidencias, notificaciones y eliminación de la tarea en la misma transacción implícita. No concede permisos de administración ni expone el esquema mediante la API de Supabase. Las escrituras simples ya no envían BEGIN/COMMIT redundantes; los lotes con cuotas conservan transacciones SERIALIZABLE y reintentos.

El ensayo PostgreSQL verifica una consulta de red por resultado frente a diez en el camino saludable anterior. Esta reducción no elimina el límite de 100.000 consultas/día de Hyperdrive Free, ni el trabajo interno de PostgreSQL. La métrica de Cloudflare sigue siendo la referencia para la instalación completa, que incluye lecturas de panel, autenticación y planificación. La caché de Hyperdrive permanece desactivada para evitar estados antiguos en permisos y monitorización.

Los cambios en monitores, mantenimientos, páginas, comunicados, dominios y destinos guardan autor y recurso en la misma transacción que la modificación. No se genera auditoría por sonda o lectura. La administración de miembros tiene sus propios eventos. La limpieza aplica el histórico contratado a auditoría, entregas y comunicados resueltos; conserva comunicados abiertos y elimina invitaciones vencidas y recibos de correo de más de siete días en lotes acotados.

## Consumo de Supabase

Admin Propietario muestra espacio real de PostgreSQL, tablas/índices de Vyrsea, conexiones y caché de bloques. Consulta catálogos y estadísticas, sin contar todas las muestras, y reutiliza el diagnóstico cinco minutos. No escribe una nueva tabla de telemetría. Las filas vivas/muertas son estimaciones de PostgreSQL, no facturación ni conteos exactos.

La previsión del histórico usa monitores activos, frecuencia y retención por plan, un día adicional para borrado por días UTC y 30 % de reserva. Calibra bytes por muestra/agregado cuando hay estadísticas suficientes; antes muestra supuestos de 400/240 bytes. La simulación multiplica la carga actual, no representa automáticamente 15.000 clientes. Conservar datos caducados no reduce inmediatamente el tamaño físico: PostgreSQL reutiliza páginas y autovacuum mantiene su salud.

La analítica de Hyperdrive incorpora consultas reales por proyecto/cuenta y bytes de resultados del mes natural UTC. Estos bytes son una aproximación al volumen SQL, no el egress facturado de Supabase ni el consumo de otros proyectos. CPU, RAM y tráfico facturable se identifican como pendientes de consultar en Supabase, sin inventar ceros ni usar las credenciales administrativas en el Worker.

El simulador Pro muestra USD: base 25 + cómputo que exceda 10 de crédito + disco provisionado sobre 8 GB a 0,125/GB + egress sobre 250 GB a 0,09/GB. No activa planes ni incluye impuestos, cambio de moneda, réplicas o PITR. Las cuotas Free de referencia son 500 MB y 5 GB de tráfico de organización. Vyrsea no usa Supabase Auth, Storage, Realtime ni Edge Functions.

Fuentes oficiales revisadas el 23-10-2026: [Cloudflare Email Sending](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/), [eventos de entrega](https://developers.cloudflare.com/email-service/reference/event-subscriptions/), [Cloudflare for SaaS](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/domain-support/create-custom-hostnames/), [Supabase precios](https://supabase.com/pricing), [almacenamiento](https://supabase.com/docs/guides/platform/database-size), [tráfico](https://supabase.com/docs/guides/platform/manage-your-usage/egress), [Hyperdrive métricas](https://developers.cloudflare.com/hyperdrive/observability/metrics/).
