# Publicación desde GitHub

La integración de Cloudflare Workers and Pages está conectada a `sergineko/SaaS-Vyrsea-analytics`, rama `main`, Worker `vyrsea-monitor`. No afecta a los otros repositorios o Workers de la cuenta.

## Flujo

1. GitHub Actions ejecuta `pnpm run check` para validar tipos, pruebas y compilación. No contiene una credencial de Cloudflare ni publica.
2. Cloudflare Builds escucha los cambios de `main` e instala las dependencias del proyecto. Usa `NODE_VERSION=24`, `PNPM_VERSION=11.25.0` y caché de compilación.
3. El comando de compilación `pnpm run check` vuelve a ejecutar las comprobaciones en el propio entorno de publicación. Un fallo impide continuar al despliegue.
4. `pnpm run deploy:production` compila los assets, comprueba el sitio prerenderizado y publica con `wrangler.production.jsonc`. Usa PostgreSQL mediante el binding Hyperdrive. Las migraciones de `migrations/postgres/` se aplican explícitamente antes de publicar cambios que las necesiten; Builds no recibe la contraseña administrativa. Cualquier error de compilación o publicación detiene el proceso.
5. Comprueba que la compilación y el despliegue finalicen correctamente en Cloudflare y que `/api/health` devuelva el servicio `vyrsea` en el dominio final.

Las vistas previas están deshabilitadas. No actives publicaciones de ramas o pull requests contra los recursos actuales: PostgreSQL, Hyperdrive y Queues son de producción. Antes de añadir vistas previas, crea recursos y configuración independientes. GitHub Actions utiliza un PostgreSQL 17 desechable para sus pruebas.

## Credenciales

El token `vyrsea-builds` se guarda en Cloudflare Builds. Sus permisos permanentes son Workers Scripts, D1 y Queues en edición para la cuenta elegida, Account Settings en lectura y Workers Routes en edición solo para `vyrsea.com`. La interfaz utilizada agrupa los permisos de los tres servicios a nivel de cuenta; el flujo solo debe administrar recursos `vyrsea-*`. No se conceden los permisos adicionales de KV, R2, IA, contenedores o correo que propone la configuración automática.

El permiso Workers Builds Configuration usado para registrar el token se retiró al terminar. La copia local temporal se eliminó. El secreto no figura en el repositorio, en GitHub Secrets ni en variables públicas de Vite. Turnstile mantiene un secreto de ejecución diferente en el Worker.

No reutilices la sesión OAuth del terminal como credencial de CI. Para rotar el token, crea una credencial nueva con los mismos permisos, regístrala en Builds y selecciónala en la configuración del Worker. Verifica un despliegue antes de revocar la anterior. Conservar una conexión Git en la interfaz no prueba que la aplicación GitHub siga autorizada: confirma el acceso al repositorio y una compilación real.

## Cambios de datos y recuperación

Las migraciones ya aplicadas no se editan: se añade otra numerada. Un fallo de publicación después de aplicar una migración puede dejar el esquema nuevo con el Worker anterior. Utiliza cambios aditivos compatibles, exporta PostgreSQL antes de cambios de esquema o datos y prepara una transición en varias publicaciones si fuese necesario. Volver a una versión anterior del Worker no revierte la base de datos. Consulta [la migración desde D1 y el procedimiento de recuperación](postgresql.md).

Un despliegue manual sigue disponible desde un terminal autenticado:

```powershell
pnpm install --frozen-lockfile
pnpm run check
pnpm run deploy:production
```

La configuración remota y la local son distintas. No sustituyas `wrangler.production.jsonc` por la configuración de desarrollo ni cambies el origen de las passkeys.
