# Administración del propietario

La cuenta con `is_owner=1` tiene Business y máximos de dominios/monitores `null`, que significan **sin límite de producto**. La API, los triggers D1 y las vistas aplican esta excepción únicamente al propietario. El histórico inicial es de 90 días y se mantiene la frecuencia de un minuto. Las cuotas físicas de Workers, D1 y Queues permanecen intactas; registrar más destinos no amplía la infraestructura gratuita.

Los monitores del propietario no ocupan el máximo compartido de diez monitores de clientes. El cálculo de consumo sí los incluye. El programador reserva diez trabajos por ciclo, por lo que una carga excesiva también puede retrasar las sondas del propietario. No se debe interpretar la etiqueta sin límite como garantía de ejecución ilimitada.

## Cuentas

En **Accesos y cuentas**, el propietario puede aprobar, suspender, reactivar y configurar el plan de cualquier cuenta de cliente. Selecciona **Configurar plan** para asignar Free, Starter, Pro / Agencia o Business. Business exige máximos positivos de dominios y monitores y una retención de 1 a 365 días. Los máximos son independientes: no hay que agotar dominios para utilizar los monitores.

Cambiar el plan no aprueba una solicitud pendiente, no restaura una cuenta suspendida y no crea pagos o suscripciones. No modifica el rol de propietario. Free, Starter y Pro utilizan sus límites de catálogo; no aceptan cuotas personalizadas. El servidor comprueba rol, sesión, origen y campos; estas restricciones no dependen de la interfaz.

Reducir una cuota no elimina los monitores existentes. Una cuenta que quede por encima de su máximo puede consultarlos y gestionarlos, pero no añadir otros hasta liberar capacidad. La nueva retención sí se aplica al histórico y la limpieza puede eliminar muestras antiguas. El formulario indica este efecto antes de guardar.

Al cambiar plan se cancelan trabajos anteriores, se establece una barrera desde el próximo minuto y se recalcula la próxima comprobación con el nuevo intervalo. Una sonda en curso del plan anterior no escribe después de esa barrera. Las funciones de pago se asignan manualmente durante la beta, con Dodo Payments deshabilitado.

## Plataforma avanzada real

Las secciones coinciden con la demo sin mezclar sus datos ficticios: Cartera, Sondas, Páginas de estado, Integraciones, y para Business, Equipo y permisos e Informes. La cartera permite buscar, expandir dominios y abrir el detalle real. El CSV usa el periodo seleccionado, conserva ausencia de datos y neutraliza fórmulas de hoja de cálculo en campos de texto.

La sonda activa es Cloudflare. AWS/GCP no se presentan como mediciones reales. Estado permite una vista previa privada; no publica una URL. Integraciones informa de alertas internas operativas y envíos externos pendientes. Equipo muestra al titular actual; todavía no invita personas ni asigna roles compartidos. No se han creado cuentas, miembros, confirmaciones multiproveedor ni páginas públicas ficticias.

El módulo avanzado se carga bajo demanda, separado del panel básico y la portada.
