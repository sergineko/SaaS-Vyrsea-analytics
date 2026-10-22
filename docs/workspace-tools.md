# Resumen, disponibilidad, Business y páginas públicas

- Resumen usa siempre 24 intervalos horarios. El selector general se conserva en las vistas de histórico; el detalle de monitor consulta su propio periodo sin cambiar el resumen.
- El detalle mantiene las últimas 24 h junto a 7, 30 días o un rango horario personalizado. Solo consulta la retención del plan; ausencia de muestras no equivale a éxito. Un contrato Business con un solo día muestra también comparación de 12 h. Los agregados incluyen extremos parciales y no representan tiempo exacto de caída.
- El dashboard agrupa en servidor a un máximo de 24 intervalos por monitor incluso al consultar 90 días. Conserva totales y evita transferir toda la tabla horaria al navegador. El detalle individual utiliza hasta 365 días de agregados de ese monitor.
- Pro / Agencia y Business pueden guardar la selección Cloudflare/AWS/GCP por monitor. El valor inicial es 7 (bits 1, 2, 4). Solo Cloudflare está desplegada; no se permite desactivarla mientras sea la única conectada. Las preferencias de AWS/GCP se guardan para su futura conexión; no generan mediciones.

## Páginas de estado

El editor de la plataforma avanzada guarda título, descripción, color, tema claro/oscuro y servicios seleccionados. Cinco páginas por cuenta y cien servicios por página durante la beta. Se crean como borrador salvo publicación explícita. No se publica ninguna página automáticamente al desplegar.

API autenticada `/api/status-pages`: GET lista, POST crea y PUT `/:id` guarda. Requiere cuenta activa y plataforma avanzada; cada monitor se comprueba contra el titular. La página pertenece a su cuenta y no se puede editar desde otra.

`/api/public/status/:id` devuelve únicamente nombres elegidos, estado, disponibilidad y bloques de 24 h. Excluye URL, errores internos, ID del usuario/monitor y contratos. La página debe estar publicada y su titular activo con Pro/Business (o propietario). La caché pública de 60 segundos reduce lecturas y no escribe en D1. Una despublicación o suspensión puede tardar hasta 60 segundos entre ubicaciones edge. No se garantiza indexación; se sirve `noindex`.

`/api/public/status/:id/view` sirve HTML accesible y permite iframe expresamente en esa ruta; las otras rutas API mantienen protección de marcos. El HTML descargable y el iframe consultan el endpoint público cada minuto cuando son visibles. La descarga necesita conexión a Vyrsea, no lleva sesiones ni tokens privados y no copia una BBDD. Las cadenas de texto se escapan y el script utiliza textContent; el color solo admite hexadecimal. Si se pierde la conexión se retiran resultados anteriores de pantalla y se indica que no hay estado disponible.

## Admin Propietario y Business

La administración separa directorio completo, solicitudes, Business e infraestructura. Permite buscar cuentas, aprobar/suspender/reactivar y editar plan y cuotas, con protección del propietario. Todos los endpoints siguen validando rol en servidor.

El propietario puede crear una cuenta Business sin passkey, con dominios, monitores, histórico y condiciones comerciales. Se entrega un enlace de activación de un uso, válido siete días, que debe compartir personalmente por un canal de confianza. El token va en fragmento y la aplicación lo retira de la barra al cargar; solo se guarda su hash en D1. El titular verifica Turnstile y crea su propia passkey mediante WebAuthn. El consumo se protege transaccionalmente frente a carreras, caducidad y sustitución. El alta no concede rol de propietario y conserva el estado y plan elegidos. Puede renovarse una invitación solo si todavía no existen passkeys; no sustituye el sistema de recuperación.

El contrato guarda empresa, email de contacto, importe EUR en céntimos, periodicidad y notas. Es un borrador privado para contratar **Vyrsea**, sin factura ni aceptación de condiciones. No crea productos o suscripciones Dodo, no envía correos y no cobra. Dodo permanece deshabilitado. Las invitaciones Business son distintas de las invitaciones de equipo, que siguen pendientes de implementar.

Email de alertas y webhooks notifican incidencias de monitores; no gestionan cobros de los negocios de los clientes. Dodo es exclusivamente la futura facturación de suscripciones a Vyrsea. El panel explica los ejemplos y el estado operativo de cada integración.
