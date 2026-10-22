# Vyrsea

MVP de monitorización HTTP basado en el alcance gratuito de `Idea C.docx`. Frontend React + TypeScript + Vite + Tailwind, API Hono sobre Workers, D1 con Drizzle, passkeys y Cloudflare Queues. No necesita VPS, Supabase ni un servicio de correo. El documento de producto original y los datos locales no se publican en el repositorio.

Repositorio: [sergineko/SaaS-Vyrsea-analytics](https://github.com/sergineko/SaaS-Vyrsea-analytics). La rama `main` ejecuta validación de tipos, pruebas y compilación mediante GitHub Actions. Este flujo no publica ni necesita secretos de Cloudflare; la conexión de despliegue se configura por separado.

## Qué funciona

- Beta con aprobación manual de nuevas cuentas y reactivaciones desde un panel exclusivo del propietario. Free se suspende tras más de 14 días sin uso real (una hora de margen por agrupación de actividad); el refresco automático, sondas y agentes no mantienen activa la cuenta. [Acceso y política de inactividad](docs/account-access.md).

- Registro y acceso con passkeys verificadas en el servidor. Sesiones de siete días, tokens aleatorios almacenados como SHA-256, cookies HttpOnly y SameSite Strict; en HTTPS usan Secure y prefijo `__Host-`.
- Plan **Free: 1 dominio registrable y 2 monitores en total por cuenta**, con límites atómicos en SQLite. Los monitores pausados también ocupan capacidad. El prototipo conserva además un tope técnico de **10 monitores entre todas las cuentas**.
- Agrupación automática del dominio principal y sus subdominios, vista por dominios, filtros y cuotas visibles. La identificación usa Public Suffix List, incluidos sufijos como `co.uk` y proveedores como `github.io`.
- Cuotas independientes: Starter permite repartir los 15 monitores entre 2 dominios sin registrar el máximo de 5. Demos separadas: `/?demo` (Free), `/?demo=pro` (cartera avanzada) y `/?demo=business` (equipo, personalización e informe CSV de ejemplo). Son datos simulados y no cambian el plan real; las integraciones externas y Dodo Payments siguen deshabilitados.
- Alta, renombrado, pausa, reanudación y eliminación. Para cambiar la URL se crea un monitor nuevo, evitando mezclar históricos.
- Comprobaciones HTTP Free cada **15 minutos** (Starter: 5 minutos; Pro / Agencia y Business: 1 minuto), timeout global de 10 segundos, hasta tres redirecciones validadas y sin descargar el contenido completo.
- Una primera respuesta incorrecta muestra «Confirmando». Dos fallos consecutivos abren una incidencia y una alerta. La primera respuesta correcta cierra la incidencia y genera otra alerta.
- Panel con disponibilidad por comprobaciones, tiempos de respuesta, gráficas, incidencias, notificaciones e historial. Incidencias filtrables por dominio, estado o búsqueda y muestras filtrables por resultado antes de paginar.
- Mantenimiento inmediato o programado por servicio, sin solapamientos y con reanudación automática. Las ventanas suspenden sondas/alertas y no fabrican disponibilidad. Las incidencias previas se conservan.
- Outbox persistente para entregar trabajos a Queues, reintentos, cola de mensajes fallidos y procesamiento idempotente.
- Retención por cuenta: Free 7 días, Starter 30 días, Pro / Agencia 90 días y Business según contrato. Se aplica a resultados, agregados, alertas e incidencias resueltas. Las incidencias abiertas se conservan.
- Demo de solo lectura con datos de ejemplo separada del backend real: `/?demo`.
- Portada prerenderizada, diseño adaptable, acceso por teclado, metadatos para `https://vyrsea.com`, sitemap, robots, datos estructurados y página 404 real.
- Documentación pública en `/llms.txt` y `/openapi.json`; herramientas WebMCP experimentales de solo lectura cuando el navegador las admite.

Hay cuatro planes definidos: Free (0 €, 1 dominio / 2 monitores, 15 min, 7 días), Starter (7,99 €, 5 / 15, 5 min, 30 días), Pro / Agencia (29,99 €, 20 / 100, 1 min, 90 días) y Business (precio, cuotas e histórico a medida, 1 min). Los límites son totales por cuenta. La contratación sigue deshabilitada; Dodo Payments será el único proveedor cuando el propietario indique habilitarla. Consulta [planes y evolución](docs/product-plan.md).

## Probar en tu ordenador

Necesitas Node.js **22.19 o superior** y pnpm. Las dependencias ya están instaladas en esta carpeta.

```powershell
pnpm install
pnpm run dev
```

Abre **http://localhost:5173**. `pnpm run dev` aplica las migraciones locales, arranca Vite y Wrangler y dispara el Cron local cada minuto. D1 y Queues se ejecutan en el runtime local de Cloudflare; no es una base de datos simulada en memoria del frontend. Los datos locales quedan en `.wrangler/state`. Ejecuta `pnpm run build` para regenerar los documentos públicos que Vite sirve desde `dist` durante el desarrollo.

El registro local permite prescindir de Turnstile únicamente cuando `APP_ORIGIN` es `http://localhost` con un puerto opcional. El navegador debe admitir passkeys y el sistema debe tener un gestor de credenciales o una llave de seguridad. Elige **Crear cuenta**, guarda la passkey y espera la aprobación. Configura tu cuenta de propietario con el [procedimiento de acceso](docs/account-access.md); después añade un monitor público como `https://www.cloudflare.com/`. El programador lo comprueba en el siguiente minuto. El panel se actualiza cada minuto; el botón de actualizar consulta el resultado sin provocar otra sonda.

No uses `127.0.0.1:5173` para registrar passkeys: el RP configurado es `localhost`. El puerto 5173 debe estar libre; Vite falla si está ocupado para evitar un cambio de origen silencioso. Para usar otro puerto configura ese mismo puerto en Vite y en `APP_ORIGIN`, en una copia `.dev.vars` de `.dev.vars.example`.

Con la configuración de origen local, `pnpm run preview` solo sirve para revisar la compilación en `http://127.0.0.1:8787`; utiliza `pnpm run dev` para el flujo de autenticación completo.

## Desplegar en tu Cloudflare Free

El MVP está publicado en [vyrsea.com](https://vyrsea.com), con D1, Queues, Turnstile y aprobación obligatoria. Algunos resolutores pueden conservar la antigua dirección durante la propagación DNS. No registres cuentas reales en `workers.dev`: las passkeys y escrituras están vinculadas al origen final `https://vyrsea.com`.

Los recursos remotos están separados con nombres `vyrsea-*`: `vyrsea-db`, `vyrsea-checks` y `vyrsea-dead-letters`. Se ha verificado Workers Free en la cuenta. Las seis migraciones están aplicadas en D1 remoto. La configuración pública de producción está en `wrangler.production.jsonc`; `wrangler.jsonc` conserva el entorno local. El secreto de Turnstile se guarda como Worker Secret, nunca en Git.

La zona DNS usa Cloudflare y la ruta `vyrsea.com/*` entrega el Worker y sus Static Assets. El registro A raíz está proxied y apunta a `192.0.2.1`: es un destino de documentación sin servidor de origen, por lo que no debe desactivarse el proxy. Las reglas de zona redirigen `www` al dominio raíz y HTTP a HTTPS, conservando ruta y consulta. La antigua entrada `/es` redirige a `/`; las demás rutas inexistentes devuelven 404. Los registros de correo de IONOS se conservan. Consulta la [operación del dominio](docs/operations.md#dominio-publicado).

Para publicar cambios desde un terminal ya autenticado:

```powershell
pnpm install --frozen-lockfile
pnpm run check
pnpm run deploy:production
```

El despliegue compila, comprueba el HTML público, aplica migraciones pendientes y publica Worker + Static Assets. La configuración exige HTTPS, un UUID D1 real y una clave pública de Turnstile. Si falta su secreto, el servidor mantiene el registro desactivado. En esta estación Wrangler utiliza `XDG_CONFIG_HOME=.wrangler/config`; ese directorio está ignorado por Git.

La rama `main` pasa la validación de GitHub Actions. La conexión de despliegue continuo se configura por separado. Crear tu cuenta Business de propietario requiere registrar personalmente la passkey en el dominio definitivo y conceder el rol por UUID desde el [procedimiento de acceso](docs/account-access.md). No se habilita ningún pago.

### Capacidad y coste

La configuración reduce consumo; **no promete capacidad ilimitada ni sustituye las métricas reales**. Los límites de Cloudflare se comparten con el resto de aplicaciones de la misma cuenta. Al agotar el cupo Free, el servicio puede dejar de comprobar webs hasta el reinicio de cuota.

| Recurso | Diseño del prototipo |
| --- | --- |
| Sondas | 10 monitores Free × 96/día = 960/día como carga base |
| Queues | Mensajes con hasta 3 monitores; aprox. 1.152–2.880 operaciones/día para diez monitores Free sin reintentos, según agrupación |
| Manuales | Respetan el intervalo del plan (Free: 15 minutos); no se suman a una comprobación ya reservada |
| D1 | Consultas indexadas, ventanas de histórico autorizadas por cuenta, paginación, agregados por hora y limpieza diaria acotada |
| CPU | Sin SSR ni hash de contraseñas; trabajo de red acotado. Validar los 10 ms de CPU en el entorno remoto |
| Servicios activos | Workers, Static Assets, D1, Queues y Turnstile |

No se activa R2 para el MVP: con este volumen basta la retención de D1. Su archivo histórico queda previsto para una siguiente etapa, evitando añadir requisitos de cuenta innecesarios. Los correos a clientes, Dodo Payments, PDF, certificados SSL, RDAP, capturas, páginas públicas y sondas independientes quedan fuera de esta entrega.

## Verificación

```powershell
pnpm run typecheck
pnpm run test
pnpm run build
pnpm exec wrangler deploy --dry-run
```

Para comprobar además una web real desde `workerd`, con conexión a Internet y sin respuestas simuladas:

```powershell
pnpm run smoke:probe
# También admite una URL pública como argumento:
pnpm run smoke:probe https://tuweb.es
```

Las pruebas de integración compilan el Worker y ejecutan el runtime real `workerd` con D1 y Queues locales. El autenticador de pruebas genera claves ES256 y firma registros y accesos WebAuthn reales. Solo las respuestas HTTP de las webs se controlan para reproducir los fallos. El harness está dentro de `tests/` y nunca se publica.

La compilación local y las pruebas no miden CPU de producción ni verifican un despliegue remoto. La revisión de navegador cubre la interfaz, la demo y su navegación; los diálogos nativos de passkeys necesitan un dispositivo compatible.

Para repetir las auditorías Lighthouse, compila y arranca otro Wrangler con persistencia independiente:

```powershell
pnpm run build
pnpm exec wrangler d1 migrations apply DB --local --persist-to .wrangler/audit-state
pnpm exec wrangler dev --port 8788 --persist-to .wrangler/audit-state
# En otra terminal:
pnpm run audit http://127.0.0.1:8788/
```

No ejecutes dos procesos Wrangler sobre el mismo directorio de persistencia. El auditor necesita Chrome instalado y crea su propio perfil temporal. Los informes HTML/JSON se guardan en `artifacts/`. La medición local del 22/10/2026 obtuvo **100/100/100/100 en móvil y 100/100/100/100 en escritorio**. Es un ensayo de laboratorio, no PageSpeed Insights del dominio público ni datos de usuarios reales. [Resultados y límites de la medición](docs/quality.md).

## Documentación técnica

- [Arquitectura, modelo de datos y decisiones](docs/architecture.md)
- [Seguridad y operación](docs/operations.md)
- [Alcance del documento y siguientes etapas](docs/roadmap.md)
- [Modelo de planes y mejoras de producto](docs/product-plan.md)
- [Mantenimiento e investigación de incidencias](docs/maintenance.md)
- [Diseño de verificación entre proveedores y activación de pagos](docs/multi-probe.md)
- [SEO, rendimiento, accesibilidad y agentes](docs/quality.md)

Las rutas del código son `src/` (frontend), `worker/` (backend), `migrations/` (SQLite), `scripts/` (desarrollo y despliegue) y `tests/`.

## Referencias verificadas

Documentación oficial consultada el 22 de octubre de 2026:

- [Workers: límites y CPU](https://developers.cloudflare.com/workers/platform/limits/)
- [Queues: operaciones y plan gratuito](https://developers.cloudflare.com/queues/platform/pricing/)
- [D1: precios, índices y límites diarios](https://developers.cloudflare.com/d1/platform/pricing/)
- [Static Assets y rutas de la SPA](https://developers.cloudflare.com/workers/static-assets/binding/)
- [Turnstile: validación en servidor](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- [SimpleWebAuthn: registro y acceso](https://simplewebauthn.dev/docs/packages/server)
