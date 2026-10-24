# Aprobación de cuentas e inactividad

La política de acceso también se conserva en [PostgreSQL](postgresql.md). `grant-owner.mjs --remote` utiliza la conexión administrativa PostgreSQL de `DATABASE_URL`; `--local` mantiene D1 local. No cambies roles o planes en la copia D1 esperando que cambien en producción. Las cuentas migradas conservan su UUID, passkeys y derechos.

El MVP utiliza una beta con aprobación manual obligatoria. No existe un modo público para saltarse la revisión ni una asignación automática de propietario a la primera cuenta.

## Registro y revisión

El usuario guarda su passkey y obtiene una sesión, pero la nueva cuenta siempre se crea como `pending`, tanto en desarrollo como en producción. Puede consultar su estado y cerrar sesión. El servidor bloquea el panel, el histórico y cualquier operación de monitores mientras no esté aprobada. Un trigger D1 también impide insertar monitores para una cuenta no habilitada. Turnstile sigue siendo obligatorio en producción.

El propietario tiene la sección **Admin Propietario**. Muestra solicitudes, cuentas activas y suspendidas, fecha de uso, número de dominios y monitores, trabajos pendientes y consumo del máximo técnico de 10 monitores de clientes/100 cuentas. Puede aprobar, suspender y reactivar. Estas rutas verifican sesión, rol, estado activo, origen y entradas en cada solicitud. La ruta PATCH de plan permite asignar Free, Starter, Pro o Business y las cuotas personalizadas de Business; solo el propietario puede usarla. Nunca permite conceder el rol de propietario. Ningún propietario se puede suspender desde esas rutas.

La aprobación no reserva monitores ni eleva los topes: Free conserva 1 dominio y 2 monitores; el máximo técnico compartido de clientes continúa en 10. La cuenta de propietario está exenta de cuotas de dominios y monitores, pero comparte recursos de infraestructura con la beta. Las cuentas suspendidas mantienen los monitores registrados, incluidos los pausados, y sus plazas. El propietario debe supervisar además las métricas de Cloudflare: las cuotas gratuitas se comparten con sus otras aplicaciones y un monitor Business por minuto consume más que uno Free cada 15 minutos.

## Actividad y suspensión

- Cuenta como actividad iniciar sesión correctamente con la passkey o interactuar con el panel visible mediante teclado o puntero.
- No cuentan las sondas, Cron, refresco automático, lecturas de API, consultas de asistentes ni mantener abierta una pestaña sin interactuar.
- El navegador comunica interacción como máximo una vez por hora. El servidor limita también las escrituras de actividad a una por hora; el reloj y los límites del servidor son autoritativos.
- Para evitar suspender antes de 14 días completos desde una interacción agrupada, se añade **una hora de margen**. El corte técnico es `last_active_at < ahora - 14 días - 1 hora`.
- El planificador y el consumidor excluyen la cuenta al cruzar el corte, aunque la limpieza diaria todavía no la haya marcado como suspendida. Consultar la sesión también aplica la suspensión vencida. La limpieza a las 03:17 UTC consolida el estado.
- Solo se suspenden automáticamente cuentas `active`, plan `free`, sin rol de propietario. Starter, Pro y Business quedan exentos de esta política.

La suspensión detiene las comprobaciones; no fabrica muestras ni disponibilidad. Conserva monitores, pausas manuales e incidencias abiertas. El histórico sigue su retención habitual de 7 días, por lo que suspender no lo conserva indefinidamente. Iniciar sesión en una cuenta ya caducada no la reactiva. El usuario puede solicitar revisión una vez y el propietario puede reactivarla; la aprobación concede un nuevo periodo de actividad.

Al aprobar/reactivar se eliminan trabajos anteriores y se establece una barrera de slots en el siguiente minuto. La transacción de resultados vuelve a verificar estado, antigüedad de actividad y barrera: una sonda en curso de antes de la suspensión no escribe resultados, incluso si termina después de la reactivación. Se respeta la próxima fecha de comprobación del plan y no se recuperan de golpe todos los ciclos perdidos.

La migración `0006` conserva activas las cuentas anteriores y les concede un periodo inicial desde la migración. Los nuevos registros siempre quedan pendientes. No elimina credenciales, sesiones ni históricos.

## Cuenta Business del propietario

El directorio permite editar también la cuenta propietaria: datos, plan, cuotas de referencia y condiciones Business. Por defecto conserva dominios/monitores ilimitados y exención de pago. Puede activar **Aplicar a mi cuenta los límites y funciones del plan para probarlo**; ese modo aplica cuotas y funciones reales sin retirar la administración ni generar cargos. Desactivarlo vuelve a Business ilimitado. Los clientes siempre respetan su plan. Cambiar a un plan con menos plazas exige retirar antes los miembros/invitaciones que excedan su capacidad; no se eliminan monitores automáticamente.

Registra personalmente tu passkey en el dominio definitivo. Desde un terminal autenticado en la cuenta Cloudflare correcta, identifica el UUID de esa cuenta y concede el rol con:

```powershell
node scripts/grant-owner.mjs --remote --user-id UUID-DE-TU-CUENTA
```

Para una cuenta local usa `--local`. El script exige un UUID y una configuración de producción existente; nunca selecciona una cuenta por orden o por ser la primera. Otorga Business sin facturación, dominios y monitores sin límite de producto y 90 días de histórico. La API representa los dos máximos como null y D1 exime únicamente a is_owner=1, incluido el tope compartido de clientes. No se promete capacidad física infinita en Free. No contacta con Dodo Payments ni añade tarjetas o suscripciones. El rol habilita las seis secciones de la plataforma avanzada y el CSV de datos reales. Las sondas AWS/GCP, correo de alertas, webhooks, invitaciones de equipo y publicación de páginas de estado siguen pendientes; la vista previa de estado es privada.

## Verificación

`tests/accounts.test.ts` ejecuta el Worker real con D1 y firmas WebAuthn: registro pendiente, controles de rol y origen, aprobación, cuotas, exclusión de lecturas como actividad, agrupación horaria, frontera de caducidad, exenciones, suspensión antes de la limpieza, colas antiguas, sondas en curso, reactivación y protección del propietario.

Consulta también [Seguridad de acceso y recuperación](access-recovery.md) para preparar passkeys de respaldo y el kit antes de perder el acceso.
