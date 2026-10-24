# CRM de soporte

El propietario abre **CRM de soporte** desde el menú. Puede dar o retirar el permiso global de soporte en **Admin Propietario → Administrar cuenta → Acceso y estado**, confirmando su passkey. El agente necesita una cuenta activa con una passkey registrada. El permiso se comprueba en cada solicitud y es independiente de los roles de las organizaciones cliente. No permite modificar planes, precios o infraestructura ni autorizar recuperaciones.

## Entradas y conversación

- **Ayuda y soporte → Reportar un problema** crea un ticket vinculado a la cuenta autenticada. También está disponible para cuentas pendientes/suspendidas, sin desbloquear sus monitores.
- **Contacto**, en el pie de la portada, crea un contacto sin cuenta vinculada. Requiere Turnstile, origen válido y límites de frecuencia; incorpora un campo señuelo antispam.
- **Correo recibido**: la regla exacta `soporte@vyrsea.com` se dirige al Worker `vyrsea-monitor`. `SUPPORT_INBOUND_ENABLED=1` activa la conversión en tickets. El Worker reenvía primero el original a `SUPPORT_FORWARD_TO`. El resto del dominio mantiene el reenvío general al destino verificado.
- Soporte puede registrar tickets manualmente. El propietario puede vincular contactos externos a una cuenta; esa operación queda registrada y no acredita por sí sola su titularidad.

La bandeja permite buscar por referencia, asunto, correo o usuario y filtrar estado, canal y responsable. Cada ticket tiene prioridad, categoría, asignación, conversación pública, notas internas y estados Abierto/En espera/Resuelto. El cliente solo ve sus tickets y mensajes públicos. Una respuesta suya reabre el ticket.

Los correos con referencia `VYR-…` se incorporan al hilo solo si coincide el remitente declarado. Se deduplican las entregas repetidas. No se muestra HTML ejecutable ni se almacenan adjuntos. Los mensajes grandes se conservan únicamente en el reenvío. El remitente de un correo nunca es prueba suficiente de titularidad.

## Recuperación asistida

1. Soporte documenta la solicitud y las comprobaciones en un ticket de Acceso y recuperación.
2. El propietario verifica la identidad por un canal de confianza, documenta la comprobación y confirma su propia passkey.
3. Genera un enlace de un solo uso válido una hora. Solo se guarda su hash. Generar otro lo sustituye; revocarlo o resolver el ticket lo invalida.
4. El titular supera Turnstile y registra personalmente una nueva passkey. Una transacción sustituye las claves, sesiones y códigos anteriores, conserva UUID/plan/datos/estado de aprobación y registra la finalización.

No se recuperan cuentas propietarias ni con permiso global de soporte por esta vía. El propietario utiliza passkeys de respaldo o su kit. Para un agente se retira primero su permiso global y se verifica su identidad. Las restricciones también se aplican en PostgreSQL para serializar recuperaciones y altas de agentes simultáneas. No se muestran claves, códigos ni enlaces de recuperación en los listados.

## Activación y consumo

No se añade otra cola ni otro Cron. El envío de soporte retorna sin consultar la base mientras `SUPPORT_EMAIL_ENABLED=0`. Solo refresca la vista de soporte abierta, siguiendo la frecuencia del plan, y se pausa el refresco del histórico de monitores. La beta admite 200 solicitudes nuevas al día en total, además de límites por usuario/IP. Las consultas se acotan a 100 tickets y 200 mensajes por vista. El correo procesado tiene un máximo de 256 KiB y el texto almacenado de 12.000 caracteres. Los adjuntos permanecen en el original reenviado.

Las respuestas públicas se guardan en el portal. El correo saliente permanece deshabilitado hasta configurar Cloudflare Email Service, `EMAIL`, `EMAIL_FROM` y `SUPPORT_EMAIL_ENABLED=1`. No se utiliza Resend. «Aceptado por Cloudflare» no significa entrega confirmada al buzón; los envíos inciertos requieren revisión para evitar duplicados. Las confirmaciones automáticas por email aún no están activas.

La producción utiliza tablas PostgreSQL privadas `platform_staff`, `support_cases` y `support_events`, sin exponer el schema en la Data API. La migración se aplica explícitamente antes del despliegue y solo concede DML al rol existente. `tests/support.test.ts` cubre aislamiento, permisos, email y firmas WebAuthn reales; `tests/postgres.test.ts` verifica la recuperación en una transacción PostgreSQL nativa dentro de un schema de prueba aislado.
