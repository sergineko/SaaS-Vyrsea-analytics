# Vyrsea: planes y evolución

## Catálogo acordado

| Plan | Precio mensual | Dominios | Monitores totales | Comprobación | Histórico | Plataforma y funciones previstas |
| --- | --- | ---: | ---: | --- | --- | --- |
| Free | 0 € | 1 | 2 | 15 minutos | 7 días | Panel básico, alertas dentro del panel |
| Starter | 7,99 € | 5 | 15 | 5 minutos | 30 días | Panel básico y alertas por email |
| Pro / Agencia | 29,99 € | 20 | 100 | 1 minuto | 90 días | Plataforma avanzada, email, página de estado y webhooks |
| Business | Consultar precios | A medida | A medida | 1 minuto | Por contrato | Plataforma avanzada, informes, equipo y permisos, páginas personalizadas |

Las frecuencias de Free y Starter son la última decisión del propietario: 15 y 5 minutos. Sustituyen a la propuesta inicial de 30 y 10 minutos. Business no tiene una retención numérica acordada; se configura junto con sus cuotas. No se presenta como ilimitado.

Una URL es un monitor, aunque comparta hostname con otro. Un dominio agrupa su raíz y sus subdominios mediante Public Suffix List. Los monitores pausados cuentan. Eliminar el último monitor libera el grupo de dominio. El dominio de la URL no acredita por sí solo su propiedad.

**Dominios y monitores son máximos independientes por cuenta.** Starter permite, por ejemplo, 2 dominios con 15 monitores repartidos entre ellos (12 + 3, 8 + 7 u otro reparto). No requiere registrar 5 dominios, ni asigna 3 monitores por dominio. Se rechaza el sexto dominio aunque queden monitores disponibles, y el monitor número 16 aunque solo se use un dominio.

## Demos del producto

- `/?demo`: conserva el panel básico Free, 1 dominio y 2 monitores.
- `/?demo=pro`: cartera ficticia con 6 dominios y 24 monitores, distribución desigual y cuotas máximas de 20 / 100. Incluye filtros, servicios por cliente, matriz de sondas, páginas de estado y vista previa de email/webhook.
- `/?demo=business`: 9 dominios y 42 monitores; añade equipo, simulación local de roles, personalización visual y descarga de CSV expresamente marcado como simulado. El ejemplo de contrato utiliza 50 dominios, 300 monitores y 90 días; no establece nuevas condiciones comerciales.

Son vistas interactivas de ejemplo, sin escritura en la cuenta del visitante ni consultas a servicios vigilados. Pueden abrirse aunque exista una sesión real; la demo tiene prioridad y salir de ella conserva esa sesión. El selector cambia de ejemplo, nunca de plan contratado. Las vistas de AWS, Google Cloud, email, webhooks, páginas de estado y equipo no activan esas funciones. La API y las herramientas de agentes siguen indicando que solo Cloudflare está operativo y etiquetan los datos de demo como simulados.

## Estado de implementación

Free está operativo en producción. Las cuotas, frecuencia y retención de cada plan se resuelven en servidor; las consultas fuera del histórico permitido se rechazan. El histórico se consulta por periodos y los resultados detallados se filtran en servidor (todos, errores o correctos) antes de paginar. El panel incluye búsqueda y filtros de incidencias y mantenimiento inmediato/programado con reanudación automática, disponible también en el panel básico. La comparativa avanzada de dominios se reserva a Pro / Agencia y Business, con comprobación de acceso en servidor.

Starter, Pro / Agencia y Business tienen su alcance definido pero su contratación sigue deshabilitada. El email nativo de Cloudflare y los webhooks tienen destinos, confirmación, entregas y reintentos implementados, con su activación externa pendiente. El equipo Business ya tiene invitaciones, roles y auditoría. Los informes programados siguen pendientes. Las páginas públicas personalizables y exportables y los informes CSV bajo demanda están implementados. Ninguna cuota superior de cliente elimina el límite compartido de diez monitores de clientes de la beta; el propietario está exento de ese límite de registro, pero consume infraestructura.

## Verificación entre proveedores

AWS, Google Cloud y Cloudflare se usarán exclusivamente en Pro / Agencia y Business para contrastar disponibilidad. Actualmente solo se ejecuta Cloudflare. No hay datos de otras sondas ni confirmación entre proveedores. La comparativa avanzada identifica esta limitación. El [diseño técnico](multi-probe.md) define las tareas necesarias antes de activarlo.

## Pagos

Dodo Payments será el único proveedor. Por instrucción expresa del propietario, todos los pagos permanecerán deshabilitados hasta que indique habilitarlos. No se han creado productos, checkout ni suscripciones. No hay rutas públicas para cambiar el plan o introducir cuotas Business.

## Prioridades siguientes

1. Validar el MVP Free desplegado: CPU, filas D1, Queues y caída/recuperación controlada con quince minutos de intervalo.
2. Añadir recuperación de cuenta, varias passkeys y verificación DNS de propiedad.
3. Implementar email de Starter. El mantenimiento programado ya está disponible; su comportamiento está en [la guía de mantenimiento](maintenance.md).
4. Construir y probar la verificación entre proveedores, las páginas de estado y los webhooks para Pro / Agencia.
5. Añadir informes, espacios, equipo, permisos y personalización para Business.
6. Integrar Dodo Payments solo cuando el propietario lo solicite, con webhooks firmados e idempotentes antes de conceder derechos.

El plan Free de producto no implica infraestructura gratuita para toda la oferta comercial. Cien monitores cada minuto desde tres proveedores generan 432.000 peticiones al día antes de reintentos. Es necesario validar costes antes de activar esa capacidad. No se han ampliado cuotas ni contratado servicios.

## Posicionamiento y publicación

La portada, el panel, los metadatos, llms y las herramientas de agentes comparten el catálogo. Antes de publicar en vyrsea.com, preparar la migración del sitio existente y comprobar canónicas, HTTPS e indexación. El contenido actual está en español; una versión global en inglés requiere traducciones completas y URLs propias. El SEO técnico no garantiza una posición concreta.

La preparación comercial actual y sus activaciones están en [launch-features.md](launch-features.md). La creación y administración de cuentas Business con invitación de un uso y borrador comercial está documentada en [herramientas del panel](workspace-tools.md). Dodo continúa deshabilitado.
