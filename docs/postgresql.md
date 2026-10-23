# PostgreSQL en Supabase y Hyperdrive

Producción usa PostgreSQL 17 en el proyecto **vyrsea**, organización **SergioTech**, región Frankfurt. Workers, Queues, Turnstile, las passkeys y el dominio `https://vyrsea.com` conservan su función. No se utiliza Supabase Auth: migrar la base de datos no cambia las identidades ni las claves de acceso.

## Conexión y seguridad

- El Worker accede al esquema privado `vyrsea` mediante `vyrsea-hyperdrive`. El binding se configura en `wrangler.production.jsonc`; no contiene contraseñas.
- Hyperdrive conecta directamente a PostgreSQL, con verificación `verify-full` de su certificado y nombre de servidor. La CA pública de Supabase está registrada en Cloudflare. No se encadenan Hyperdrive y Supavisor en producción.
- Caché de consultas desactivada. El estado, las sesiones, los permisos y las reservas de comprobaciones necesitan datos recientes. Los agregados de horas cerradas conservan su caché privada en Workers.
- Máximo de cinco conexiones al origen para esta beta. El rol `vyrsea_app` permite leer y modificar las tablas de la aplicación; no es superusuario, no crea esquemas, bases de datos ni roles, y no modifica las migraciones. Tiene límites de tiempo de consulta y de transacción inactiva.
- Ni `anon` ni `authenticated` tienen acceso al esquema de la aplicación. La autorización por cuenta se realiza en el backend, con consultas por propietario. No hay conexión directa desde React a PostgreSQL.
- Los lotes de seguridad y cuotas conservan transacciones serializables con reintento completo. Las comprobaciones, reservas y cambios de mantenimiento usan bloqueos de cuenta y monitor en orden fijo, con aislamiento READ COMMITTED: dos monitores distintos pueden completarse en paralelo sin los conflictos de predicados de SERIALIZABLE. Las escrituras individuales son atómicas. Los disparadores nativos conservan las cuotas, el acceso del propietario, los límites de passkeys y las exclusiones de mantenimiento.

La Data API está desactivada. Supabase documenta un error repetitivo al usar esa opción: `pg_pgrst_no_exposed_schemas` no existe. Se ha aplicado su [solución oficial](https://supabase.com/kb/troubleshooting/schema-pg_pgrst_no_exposed_schemas-does-not-exist): el rol `authenticator` apunta únicamente al esquema **vacío** `pgrst_no_exposed_schemas`, sin objetos ni datos de Vyrsea. `scripts/supabase-private-api.mjs` reproduce el ajuste. No cambies ese valor por `vyrsea` para eliminar avisos.

## Migraciones y despliegues

Las migraciones PostgreSQL están en `migrations/postgres/`. `scripts/postgres-migrate.mjs` guarda nombre y SHA-256 de cada archivo en `vyrsea._migrations`, y aplica las pendientes en una transacción. No edites un archivo ya aplicado.

Antes de publicar código que necesite un cambio de esquema:

1. Guarda una copia de la base de datos y comprueba la recuperación.
2. Usa una conexión administrativa en `DATABASE_URL`, fuera del repositorio. Para una CA privada, configura `DATABASE_CA_FILE` con la ruta al certificado público verificado.
3. Ejecuta `pnpm run db:postgres:migrate` y verifica el resultado. Usa primero una base de desarrollo independiente.
4. Comprueba tipos, pruebas y compilación; publica código compatible con la migración.

Cloudflare Builds publica `main` y recibe únicamente la referencia de Hyperdrive. **No recibe la contraseña administrativa ni ejecuta migraciones PostgreSQL**. `scripts/deploy.mjs` conserva el camino D1 para entornos de desarrollo antiguos, pero producción no ejecuta migraciones D1.

## Pruebas y desarrollo

`pnpm run dev` conserva D1 local como modo de compatibilidad rápido; no accede a Supabase de producción. Las pruebas de regresión verifican ese camino. Las pruebas PostgreSQL usan un esquema único temporal, datos sintéticos y limpieza al terminar:

```powershell
# Una base PostgreSQL 17 de desarrollo, nunca la base de producción.
$env:VYRSEA_POSTGRES_TEST_URL='postgresql://postgres:local_test_only@127.0.0.1:5432/vyrsea_test'
pnpm run test:postgres
```

GitHub Actions levanta un PostgreSQL 17 desechable y ejecuta también estas pruebas. Cubren registro y acceso WebAuthn, aislamiento entre cuentas, cuotas concurrentes, rollback, reentregas de Queues, incidencias, estadísticas, páginas de estado, mantenimiento, retención y el programador. Sin la variable explícita, esta suite se omite: las pruebas normales no buscan contraseñas de producción en el ordenador.

La prueba con un Supabase de desarrollo puede usar un puente TLS limitado a loopback: Node verifica CA y nombre del servidor antes de reenviar la conexión. Así se prueba el Worker local sin desactivar la validación del certificado de Supabase. Producción usa Hyperdrive.

## Copia desde D1 y recuperación

El 23-10-2026 se detuvieron temporalmente API, Cron y consumo de Queues con `DATABASE_MIGRATION_LOCK=1`. Se exportó D1, se copiaron las 19 tablas y se verificaron **2.536 registros** mediante recuentos y huellas de contenido, dentro de una importación atómica. El esquema de destino estaba vacío. El informe privado conserva las huellas por tabla; no se publica junto al código.

Se conservaron usuarios, claves públicas de passkeys, sesiones, códigos de recuperación en forma de hash, cuotas, pausas manuales, comprobaciones, agregados, incidencias, alertas, mantenimientos, páginas de estado, condiciones Business y trabajos pendientes. El backend conserva el mismo origen y RP ID de WebAuthn.

La base remota `vyrsea-db` de D1 se conserva como copia del momento del cambio; ya no está enlazada al Worker de producción. El volcado final y el informe están en `.wrangler/supabase-migration/`, ignorado por Git. Esos archivos contienen datos privados.

**Una reversión de código no sincroniza bases de datos.** Desde la reapertura, los datos nuevos se escriben en PostgreSQL. Para volver a D1 hay que volver a detener API/Cron/consumidores, exportar PostgreSQL y reconciliar los cambios posteriores al corte; no basta con restaurar el binding antiguo. Conservar la copia D1 no equivale a disponer de recuperación automática continua de PostgreSQL.

La contraseña administrativa de PostgreSQL y la de `vyrsea_app` no deben publicarse en Git, `.dev.vars.example`, capturas, respuestas HTTP ni variables `VITE_*`. Las copias locales de operación deben permanecer cifradas o en un gestor de contraseñas.

## Presupuesto de la beta

No se ha activado ningún plan de pago. Supabase Free incluye 500 MB de base de datos y Hyperdrive Free 100.000 consultas al día. La migración elimina las cuotas de filas de D1 para Vyrsea; no elimina los límites de cómputo, almacenamiento, conexiones, tráfico o consultas de Hyperdrive.

El panel del propietario muestra el tamaño real de PostgreSQL, deja de extrapolar escrituras D1 y conserva las métricas de Workers y Queues. Las cuotas y operaciones de Cloudflare continúan compartidas con otros proyectos. La aprobación manual, la suspensión por inactividad y el límite compartido de diez monitores de clientes siguen activos hasta medir y ampliar la capacidad de forma consciente.

Referencias: [Supabase con Hyperdrive](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/), [Postgres.js en Workers](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/postgres-js/), [límites Hyperdrive](https://developers.cloudflare.com/hyperdrive/platform/limits/), [precios Supabase](https://supabase.com/pricing).
