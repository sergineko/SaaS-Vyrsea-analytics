# Seguridad y operación de Vyrsea

## Acceso supervisado

El registro está sujeto a aprobación manual. Las cuentas Free se suspenden tras más de 14 días sin uso, con una hora de margen por la agrupación de escrituras de actividad. La suspensión detiene las sondas y requiere revisión para reactivar. El propietario y los planes de pago están exentos. Consulta [estados, controles y cuenta Business del propietario](account-access.md).

## Controles incluidos

El servidor valida sesión y propietario en cada operación. El acceso a un monitor ajeno devuelve 404. Las cuotas de dominios y monitores están en triggers SQLite para resistir peticiones concurrentes. La API limita cuerpos a 16 KiB y valida campos con Zod; todas las consultas usan parámetros. El plan se obtiene de la cuenta en D1; no existe una ruta de autoasignación de planes ni se aceptan campos de cuota enviados por el cliente.

Las passkeys requieren presencia y verificación del usuario. El servidor verifica desafío, origen, RP ID y firma. Los desafíos caducan a los cinco minutos y se consumen con `DELETE ... RETURNING` antes de verificar, de modo que un intento no puede reutilizarse. La cookie del desafío es HttpOnly y SameSite Strict. Los tokens de sesión tienen 256 bits aleatorios y solo se conserva su hash; cerrar sesión revoca el token actual.

El alta remota exige Turnstile. Hay límites persistentes por IP para registro y acceso y por usuario para escrituras. El hash de IP no incorpora una sal secreta: minimiza el almacenamiento directo de direcciones, pero no se debe considerar anonimización. Las ventanas vencidas se limpian diariamente. La protección no evita el agotamiento de cuotas de Cloudflare ante un ataque grande; para un lanzamiento abierto será necesario evaluar reglas de red y protección adicional.

Las URLs solo admiten dominios públicos con HTTP/HTTPS, puertos estándar y sin credenciales. No se admiten IP literales, hostnames de una sola etiqueta, sufijos locales ni servicios comunes de DNS wildcard. Se validan direcciones A y AAAA con Cloudflare DNS over HTTPS en cada salto y se rechazan rangos privados, loopback, documentación, multicast y otros reservados. Se aplican timeout global y límite de tres redirecciones. La respuesta se cancela tras los encabezados; no se ejecuta HTML ni JavaScript de los destinos.

**Límite de la validación DNS:** Workers `fetch` vuelve a resolver el hostname; esta implementación no fija el socket a la dirección consultada por DoH. La comprobación previa reduce el riesgo pero no demuestra resistencia completa a DNS rebinding ni a todas las resoluciones divergentes. Antes de abrir un servicio comercial a destinos arbitrarios, valida este límite con el proveedor o añade verificación de propiedad/allowlist o un proxy de salida que fije y verifique el destino. El prototipo debe probarse con destinos conocidos.

Los recursos estáticos incluyen CSP, protección de framing, política de referencias y `nosniff`. La aplicación no emplea fuentes externas ni analítica de terceros; Turnstile es la única integración de navegador externa. Los datos reales se consultan por el mismo origen. La demo estática indica que sus valores son ejemplos y no permite escribir en cuentas reales.

## Secretos y dominios

- `APP_ORIGIN` y `TURNSTILE_SITE_KEY` son configuración pública del Worker.
- `TURNSTILE_SECRET_KEY` se establece con Wrangler Secrets, nunca con un `VITE_` ni en `wrangler.jsonc`.
- `.dev.vars`, `.env`, `.wrangler`, dependencias y artefactos de pruebas están ignorados por Git.
- El `database_id` no es una credencial, pero debe corresponder al recurso de tu cuenta.
- Las passkeys están vinculadas al hostname. No registrar usuarios reales en un dominio que se vaya a sustituir sin preparar una migración de credenciales.
- `PUBLIC_SITE_URL` fija el origen canónico `https://vyrsea.com`; no configura DNS ni publica por sí mismo. La ruta de producción se declara por separado en `wrangler.production.jsonc`.

La recuperación de cuentas, gestión de passkeys adicionales, revocación de todas las sesiones y eliminación de cuenta completa quedan pendientes. Guarda la credencial en un gestor sincronizado y no emplees cuentas importantes hasta tener recuperación operativa. Un fallo de WebAuthn no debe resolverse desactivando la verificación de origen o de usuario.

## Dominio publicado

La zona `vyrsea.com` está activa en Cloudflare Free con nameservers `jay.ns.cloudflare.com` y `ziggy.ns.cloudflare.com`. El registro A raíz está **proxied**, con destino `192.0.2.1`, y la ruta `vyrsea.com/*` sirve `vyrsea-monitor` y sus Static Assets sin un servidor de origen. No cambies el registro raíz a DNS only: ese destino no aloja una web. La configuración usa una ruta de zona, no un Custom Domain de Workers.

Las reglas `vyrsea-www-to-apex` y `vyrsea-http-to-https` hacen redirecciones 301 y conservan ruta y parámetros. `public/_redirects` lleva `/es` y `/es/` a la portada. No se redirigen todos los errores a la portada. Se han verificado TLS, `/api/health` y estas redirecciones en el extremo de Cloudflare; durante la propagación un resolutor con caché antigua puede seguir llegando a Vercel.

El correo continúa en IONOS con sus MX, SPF y DKIM. La configuración de reenvíos se administra allí y no requiere activar Email Routing de Cloudflare. Domain Guard se ha reactivado tras cambiar los nameservers. La web anterior de Vercel debe conservarse hasta comprobar la propagación; su retirada es una acción separada de publicar el Worker.

El repositorio solo contiene configuración pública. Las exportaciones DNS previas, datos operativos y credenciales permanecen fuera de Git. No copies la credencial OAuth local de Wrangler a un sistema de CI. Una integración de despliegue continuo necesita su propio token con los permisos imprescindibles para publicar, administrar la ruta y aplicar migraciones D1.

## Operación diaria

1. En Workers revisa errores 1102 y CPU real, especialmente en registro WebAuthn y Cron. Las pruebas locales no reproducen el presupuesto de CPU Free.
2. En D1 consulta filas leídas/escritas y tamaño. Los índices también generan escrituras. La cuota corresponde a toda la cuenta, no solo a Vyrsea.
3. En Queues revisa reintentos, edad de mensajes y mensajes en `vyrsea-dead-letters`. El outbox vuelve a entregar trabajos sin finalizar después de quince minutos; una DLQ creciente indica un problema operativo aunque los reenvíos continúen.
4. Verifica que `last_checked_at` avance. Un endpoint de salud HTTP correcto no garantiza que Cron esté funcionando. El panel marca datos antiguos cuando superan tres intervalos de su plan; Free no se marca como antiguo antes de su siguiente comprobación.
5. Comprueba la ejecución de la limpieza a las 03:17 UTC. La retención depende de la cuenta (7/30/90 días o contrato Business). La API excluye registros vencidos aunque sigan físicamente en D1. Las eliminaciones son acotadas: tras una interrupción larga pueden tardar varios ciclos en vaciar el atraso. Las incidencias abiertas se conservan. También se limpian los mantenimientos vencidos y cancelados según la retención de la cuenta.

Para ver eventos del Worker:

```powershell
pnpm exec wrangler tail
```

Los mensajes de error de la aplicación no incluyen cookies, tokens, datos de passkeys ni URLs completas. Wrangler y las métricas del proveedor tienen sus propias políticas de logging. El muestreo de observabilidad está al 10 % para reducir volumen; no constituye un registro de auditoría completo.

## Diagnóstico local

- **Registro 403:** abre exactamente `http://localhost:5173` o ajusta `APP_ORIGIN` al origen usado. Las escrituras sin `Origin` están bloqueadas por diseño.
- **Registro remoto desactivado:** configura la clave pública y el secreto de Turnstile y vuelve a desplegar.
- **El navegador no guarda passkeys:** utiliza un navegador compatible, HTTPS en producción o `localhost` en desarrollo, y un gestor de credenciales del sistema o una llave FIDO2.
- **El monitor queda pendiente:** ejecuta `pnpm run dev`, que incluye el reloj local. `wrangler dev` por sí solo no dispara automáticamente Cron. El primer ciclo debe arrancar en aproximadamente un minuto.
- **Respuesta 409 al comprobar:** el monitor está en mantenimiento. Consulta su fin o cancela la ventana; la reanudación sigue respetando el intervalo del plan.
- **Respuesta 429 al comprobar:** una solicitud ya ha reservado la siguiente sonda o todavía no ha transcurrido el intervalo del plan (Free 15 min, Starter 5 min, Pro / Agencia y Business 1 min). Actualizar el panel no gasta una sonda.
- **Error HTTP 403 en un destino:** el sitio puede bloquear agentes o tráfico de Cloudflare. Se registra como error; el monitor no intenta saltarse esa protección.
- **Límite de dominios o monitores:** Free permite un dominio y dos monitores totales. Pausar no libera capacidad. Eliminar el último monitor de un dominio libera ese grupo. Hay además un máximo global de diez monitores de prueba.
- **Documentos públicos en Vite:** ejecuta `pnpm run build` para generar `llms.txt`, OpenAPI, robots y sitemap; Vite los sirve desde `dist`. El Worker de producción entrega esos archivos como Static Assets.
- **Errores SQLite con dos previews:** cada Wrangler debe usar un directorio `--persist-to` distinto. No borres archivos SQLite para resolverlo; detén el preview secundario y reinicia el principal con su persistencia original.
- **D1 Free agotado:** las consultas fallan hasta que se restablezca la cuota del proveedor. No se cambia automáticamente a un plan de pago.

## Limitaciones de medición

La disponibilidad se observa desde la red de Cloudflare. No se garantizan países concretos ni independencia del proveedor. Una incidencia de Cloudflare puede afectar simultáneamente a sondeo, datos y alertas. Los errores de DNS y del propio monitor se muestran como fallos de la comprobación; el MVP no distingue todos los posibles orígenes de un fallo. Dos fallos reducen avisos aislados, pero no eliminan falsos positivos.

El panel solo recibe nuevas alertas mientras se consulta. No hay correo, push, SMS ni webhook de salida activo. La demo no representa ninguna web real vigilada. El prototipo no calcula la fecha de vencimiento de certificados ni de dominios. Solo Cloudflare está operativo. La verificación AWS/Google Cloud/Cloudflare y la plataforma avanzada están reservadas a Pro / Agencia y Business. El acceso avanzado se comprueba en el servidor; las sondas de otros proveedores siguen pendientes.

## Agentes y contenido público

`llms.txt` y OpenAPI describen capacidades; no otorgan permisos. Las herramientas WebMCP son experimentales y de solo lectura. La consulta del panel exige la sesión existente y limita los datos al usuario actual. Los nombres, URLs y causas de incidencias deben tratarse como contenido no confiable; no deben convertirse en instrucciones para otros agentes. No se publican herramientas para crear, borrar, pagar o cambiar planes. El navegador sigue sujeto a sus propias confirmaciones y política de acceso.

Lighthouse 13 no incluye la categoría experimental de navegación agéntica en este entorno. La compatibilidad se ha comprobado con pruebas de registro/cancelación y con la herramienta pública detectada e invocada en el navegador; no se anuncia una puntuación de agentes.

## Copias y cambios

Antes de modificar migraciones o desplegar cambios de esquema en una instalación con datos, exporta D1 con las herramientas oficiales. No edites una migración ya aplicada; crea otra numerada. Mantén por separado los secretos y la exportación de datos. El borrado de un monitor elimina su historial sin papelera y la interfaz pide confirmación concreta.
