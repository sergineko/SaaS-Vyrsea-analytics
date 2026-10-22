# Verificación entre proveedores: diseño pendiente

## Alcance contratado

La verificación desde **Cloudflare, AWS y Google Cloud** pertenece únicamente a Pro / Agencia y Business. Free y Starter usan la sonda de Cloudflare. La plataforma avanzada también es exclusiva de los dos planes superiores. El catálogo distingue este derecho previsto de la activación real: `multiProbe` describe el alcance y `multiProbeActive` permanece en `false`.

Actualmente solo se ejecuta la sonda Cloudflare. No se han desplegado recursos en AWS o Google Cloud ni se han registrado sus mediciones. Las ubicaciones del runtime de Cloudflare no constituyen sondas independientes de otros proveedores.

## Propuesta de operación

1. El coordinador reserva un ciclo único por monitor y minuto. Solo los planes con verificación entre proveedores generan trabajos para las tres sondas.
2. Cada proveedor realiza su propia resolución DNS y petición HTTP desde su infraestructura. No debe delegar la petición final de nuevo en Cloudflare.
3. Cada resultado incluye monitor, ciclo, proveedor, región real configurada, hora, estado HTTP, latencia y tipo de fallo. Un fallo del agente se distingue del fallo del destino.
4. El coordinador autentica cada sonda, valida plazo y pertenencia al ciclo y deduplica por `(monitor, ciclo, proveedor)`. Las respuestas atrasadas no cambian ciclos posteriores.
5. Política propuesta, pendiente de validar: exigir al menos dos proveedores coincidentes para declarar un resultado confirmado. Mantener dos ciclos fallidos para abrir una incidencia; los resultados incompletos muestran cobertura insuficiente. La caída de una sonda no debe contarse automáticamente como caída del sitio.
6. El panel avanzado muestra datos por proveedor, cobertura y evidencia que confirma cada incidencia. Free y Starter no reciben esa vista mediante una URL manipulada.

Esta política no está implementada y debe probarse con discrepancias regionales, bloqueo de un proveedor, sonda ausente, DNS divergente, entregas repetidas, retrasos y recuperación parcial antes de anunciar una garantía. Varias sondas mejoran la evidencia; no aseguran disponibilidad absoluta.

## Seguridad

Las futuras sondas necesitan validación de destinos públicos, límites de redirección, timeout, resolución y rangos IP en su propio entorno. La validación de Cloudflare no protege las redes de AWS o Google Cloud. Los endpoints receptores necesitarán autenticación de máquina, protección contra replay, rotación de secretos y límites por sonda. No se ha publicado un receptor sin protección para simular esa infraestructura.

## Capacidad y coste

Con 100 monitores, un ciclo por minuto y tres proveedores se generan **432.000 peticiones de sonda al día**, antes de reintentos. El plan Free de infraestructura no debe prometer esa capacidad. Se mantienen diez monitores globales en el prototipo; si todos son Free, son 960 sondas/día con el intervalo de quince minutos.

Antes de activar Pro / Agencia hay que medir CPU, Queues, escrituras y retención de D1, costes de las otras dos nubes y protección frente a abuso. Definir límites por proveedor y por cuenta, presupuesto máximo y comportamiento ante agotamiento. No se han activado servicios de pago ni ampliado cuotas de Cloudflare. Las tarifas y cuotas concretas se comprobarán al elegir y desplegar los servicios.

## Facturación

**Dodo Payments será el único proveedor de pagos.** La contratación sigue deshabilitada por instrucción del propietario. No se crean productos, sesiones de checkout, claves, suscripciones ni cobros hasta que indique habilitarlos. Al integrarlo, los derechos deberán derivarse de webhooks firmados e idempotentes y de reglas de cancelación, impago y reducción de cuota; el navegador nunca podrá concederse un plan.
