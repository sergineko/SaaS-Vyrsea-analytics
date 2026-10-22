# Limpieza automática del histórico

Una tarea interna usa el Cron de un minuto que ya tiene Vyrsea. Comienza la limpieza diaria a las **03:17 UTC**, sin otra cola ni otro binding Cron. El horario UTC no cambia con el horario de verano. La pantalla del propietario muestra el estado y el recuento de los lotes terminados.

La retención se obtiene de cada cuenta: Free 7 días, Starter 30, Pro / Agencia 90 y Business el número de días personalizado por el propietario. Cambiar Business en **Accesos y cuentas → Configurar plan** modifica la retención; no crea una suscripción ni realiza cobros. La cuenta del propietario conserva inicialmente 90 días.

El panel y las APIs filtran inmediatamente la ventana móvil del plan. El borrado físico utiliza el inicio del día UTC menos los días de retención: elimina jornadas completas que ya han vencido, sin partir la jornada límite. Esto puede conservar físicamente hasta una jornada adicional respecto a la ventana visible, más el tiempo de drenaje de lotes pendientes. Por ejemplo, Free deja de mostrar un resultado al superar siete días y lo elimina con el resto de su día UTC en la siguiente limpieza aplicable.

Se eliminan comprobaciones, agregados horarios, incidencias resueltas, notificaciones y mantenimientos terminados/cancelados fuera de la retención. Las incidencias todavía abiertas se conservan. Los tokens de sesión, desafíos, autorizaciones recientes y contadores de frecuencia caducados siguen su propia fecha, independientemente del plan. No se borran cuentas, monitores, passkeys ni códigos de recuperación por esta tarea.

Cada ejecución limita los borrados: 3.500 checks, 1.000 agregados horarios, 500 incidencias, 500 notificaciones, 500 mantenimientos y lotes acotados de datos temporales de seguridad. Si cualquiera alcanza el máximo, la tarea queda pendiente y continúa a los minutos 02, 17, 32 y 47 hasta terminar. Un error conserva la marca pendiente para reintentar. Una concesión de exclusión de dos minutos evita limpiezas simultáneas y permite recuperarse de una interrupción.

`maintenance_jobs` conserva una sola fila de estado, no un registro por comprobación. La limpieza y el programador completo de diez monitores emplean como máximo 48 consultas D1 en esa invocación, comprobadas con el Worker real en las pruebas. La continuación no añade operaciones de Queues. El borrado sí consume escrituras D1, por lo que debe considerarse al ampliar el volumen de la beta.

La selección del histórico usa los índices de monitor/fecha. El trabajo está acotado para Free y puede requerir varias rondas después de una incidencia prolongada o una reducción importante de histórico. No garantiza drenaje ilimitado bajo cuotas agotadas; la pantalla mantiene el estado pendiente.

Pruebas: jornadas límite de todos los planes y Business a medida, conservación de incidencias abiertas, drenaje de más de 3.500 registros, recuperación tras error, exclusión entre intentos y presupuesto conjunto de consultas.
