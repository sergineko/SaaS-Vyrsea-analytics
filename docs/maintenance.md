# Mantenimientos e investigación de incidencias

## Operación del cliente

La vista Mantenimiento permite programar una ventana para un servicio o comenzar inmediatamente. Está disponible en el panel básico y no cambia las cuotas, frecuencias o precios acordados. Cada monitor admite hasta cinco ventanas activas o futuras, sin solapamientos. La duración puede ser de cinco minutos a veinticuatro horas y se puede programar con treinta días de antelación.

El formulario usa la zona local del navegador y envía timestamps UTC. La interfaz muestra su zona horaria. Para cambiar un horario, cancela la ventana y crea otra. La cancelación conserva el registro; no elimina su historial. Las ventanas finalizadas o canceladas siguen la retención de la cuenta.

Durante la ventana no se realizan nuevas sondas ni se generan alertas de cambios de estado. No se insertan éxitos, fallos o agregados artificiales para rellenar ese periodo. Las estadísticas anteriores se conservan; disponibilidad sigue significando porcentaje de comprobaciones correctas, no disponibilidad temporal exacta.

El monitor vuelve a ser comprobable al terminar la ventana, respetando el intervalo del plan y el reloj Cron de un minuto. Cancelar no permite aumentar la frecuencia del plan. Un monitor pausado manualmente sigue pausado. Una incidencia abierta antes de la ventana se conserva; su recuperación se confirma con una respuesta real posterior. Su duración confirmada puede incluir el mantenimiento.

## Flujo técnico

`maintenance_windows` pertenece a un monitor mediante clave foránea con borrado en cascada. Los horarios y motivos se validan en el servidor. Un trigger comprueba solapamientos y capacidad de forma atómica. Toda consulta, alta y cancelación verifica la sesión y el propietario.

Al reservar una comprobación que cae en una ventana activa, se avanza la próxima ejecución hasta su fin y no se crea trabajo. El consumidor comprueba el horario antes de sondear, incluido el slot original de un trabajo atrasado. La transacción de resultados vuelve a comprobar tanto el slot como la hora del resultado: una petición iniciada antes del mantenimiento no puede generar un falso aviso al completarse dentro de él.

El mantenimiento interrumpe la secuencia de fallos que todavía no había abierto una incidencia. Dos fallos separados por una ventana prevista no constituyen dos fallos consecutivos. Una incidencia que ya estaba abierta no se cierra por programar mantenimiento.

Cancelar una ventana activa se registra con `cancelled_at`. El límite efectivo de su periodo es el menor entre fin y cancelación. Un trabajo de un periodo que estuvo en mantenimiento sigue descartándose aunque se entregue después de cancelar. Cancelar una ventana futura, antes de comenzar, no afecta a las mediciones posteriores.

## API privada

| Operación | Ruta | Comportamiento |
| --- | --- | --- |
| Programar | `POST /api/monitors/:id/maintenance` | `startsAt`, `endsAt`, `reason`; 201 o error de validación/cuota/solapamiento |
| Cancelar | `POST /api/monitors/:id/maintenance/:windowId/cancel` | Cancelación idempotente; 404 si no pertenece a la sesión |
| Consultar | `GET /api/dashboard` | Incluye ventanas activas, futuras e históricas dentro de la retención |
| Filtrar muestras | `GET /api/monitors/:id/history?result=failed` | `all`, `failed` u `ok`, con cursor `before` y bloques de cien |

El botón manual devuelve 409 si el monitor está en mantenimiento. Las escrituras mantienen las protecciones de origen, JSON, tamaño y frecuencia. Ninguna de estas acciones se publica como herramienta de escritura para agentes. La herramienta de lectura del espacio sí incluye los mantenimientos y trata sus motivos como contenido no confiable.

## Investigación de errores

La vista de incidencias filtra por dominio, estado y búsqueda en servicio, URL o causa. Describe el límite actual de cincuenta incidencias devueltas por el panel. El selector de periodo mantiene el límite de histórico del plan y las incidencias abiertas se conservan.

El detalle de un monitor consulta todos los resultados, solo fallos o solo respuestas correctas. El filtrado se realiza en el servidor antes de paginar. Cambiar de filtro invalida las respuestas anteriores para evitar mezclar bloques de consultas distintas. Los resultados vencidos se excluyen antes de la limpieza física.

## Validación

Las pruebas usan el Worker y D1 reales en workerd, con destinos de red controlados. Cubren autorización, validación, solapamientos concurrentes, capacidad, cancelación, pausas, retención, sondas atrasadas y peticiones en curso, reanudación, incidencias previas y filtrado del histórico. La demo es de solo lectura y sus ventanas son ejemplos; no programa cambios en una cuenta real.
