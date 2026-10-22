# Rendimiento, SEO y acceso de agentes

## Resultado medido

Lighthouse 13.0.0 ejecutado el **22 de octubre de 2026, 17:02 CEST**, sobre la compilación de producción servida localmente en `http://127.0.0.1:8788/`. Perfiles móvil y escritorio, Chrome aislado. Se midió la portada pública; no el dominio actualmente publicado ni todas las pantallas del panel.

| Categoría o métrica | Móvil | Escritorio |
| --- | ---: | ---: |
| Rendimiento | 100 | 100 |
| Accesibilidad automatizada | 100 | 100 |
| Buenas prácticas | 100 | 100 |
| SEO técnico automatizado | 100 | 100 |
| FCP | 1,4 s | 0,3 s |
| LCP | 1,5 s | 0,3 s |
| TBT | 0 ms | 0 ms |
| CLS | 0 | 0 |

Los informes completos quedan en `artifacts/lighthouse-mobile.html`, `artifacts/lighthouse-desktop.html` y sus JSON. `artifacts/audit-summary.json` conserva fechas y valores sin redondear. El árbol de dependencias señala la consulta de sesión después de cargar el JavaScript; es una oportunidad de ajuste aunque no reduzca las cuatro puntuaciones.

Estas cifras son una medición de laboratorio local. No equivalen a PageSpeed Insights de `vyrsea.com`, no incluyen condiciones de la red pública ni garantizan resultados idénticos. Lighthouse no sustituye pruebas manuales de accesibilidad. INP necesita interacciones representativas y datos de campo; no se declara un INP medido. Tras desplegar, repetir PageSpeed Insights móvil/escritorio y seguir LCP, INP y CLS en el percentil 75 cuando exista volumen suficiente.

## Cambios que sustentan el resultado

La portada se entrega como HTML completo generado al compilar; el panel y las passkeys se cargan al necesitarlos. Se usan fuentes del sistema, iconos vectoriales y ninguna imagen pesada o vídeo. Los archivos con hash tienen caché de un año. El Worker no hace SSR por cada visita. La interfaz incluye etiquetas, foco visible, enlace para saltar al contenido, encabezados, tablas semánticas y modales con foco controlado. Se corrigieron contrastes de textos secundarios durante la auditoría.

## SEO técnico implementado

- Título y descripción coherentes, un H1, idioma español y contenido público accesible sin JavaScript.
- URL canónica `https://vyrsea.com/`, Open Graph y metadatos de Twitter.
- JSON-LD de organización, sitio, aplicación y preguntas visibles; el único precio activo declarado es Free. No hay reseñas o valoraciones inventadas.
- Sitemap con la portada real y robots con exclusión de rutas privadas/demostración.
- `noindex` en demo y panel al cargarse; `X-Robots-Tag` en respuestas API.
- Respuesta 404 para URLs inexistentes, sin devolver una portada 200 para cualquier ruta.

La configuración canónica no publica el sitio. Hay que ajustar dominio, HTTPS, indexación de pruebas y migración del sitio existente al desplegar. La portada actual está en español; todavía no se generan páginas inglesas ni etiquetas `hreflang` que anuncien traducciones inexistentes. Google indica que no existe una garantía de primera posición: [guía oficial de SEO](https://developers.google.com/search/docs/fundamentals/seo-starter-guide).

## Agentes

`/llms.txt` ofrece un resumen honesto del alcance y `/openapi.json` documenta lecturas y autenticación. Estos archivos ayudan a describir el servicio; no son un permiso para operar ni un requisito especial para aparecer en respuestas de IA. Google mantiene los principios habituales de SEO para sus funciones de IA: [documentación oficial](https://developers.google.com/search/docs/appearance/ai-features).

Cuando el navegador soporta `document.modelContext`, se registran dos herramientas WebMCP:

| Herramienta | Acceso y comportamiento |
| --- | --- |
| `vyrsea_get_plans` | Catálogo y capacidades actuales; identifica planes de pago como propuestas |
| `vyrsea_read_workspace` | Solo el espacio de la sesión actual o datos de demo etiquetados; consulta sin cambios |

No hay herramientas de escritura. Las entradas son objetos vacíos estrictos y las salidas no contienen cookies o secretos. Las herramientas se cancelan al desmontar sus vistas. La lectura del panel se marca como contenido no confiable porque incluye nombres y URLs de usuarios.

Se verificó en el navegador la detección e invocación de la herramienta pública y de la lectura del espacio de demo, además de pruebas de registro, limpieza y consulta del espacio. La revisión manual cubrió también navegación móvil a 390 píxeles, apertura y cierre del menú, agrupación, plegado y búsqueda. Lighthouse 13 de este entorno **no proporciona una categoría agéntica**; no se ha inventado una puntuación. La API sigue siendo experimental y la web funciona en navegadores que no la exponen.

## Reproducir

La revisión del panel del 22/10/2026 añadió mantenimiento programado y filtros de investigación. Pasan 92 pruebas, incluidas ventanas solapadas concurrentes, sondas en curso, cancelación, retención e aislamiento. Se revisaron el formulario local, filtros, vacíos y la vista móvil a 390 píxeles, y se invocó la herramienta WebMCP de lectura con mantenimientos de ejemplo. Los estilos nuevos se cargan con el módulo del panel; no se añaden a la hoja CSS inicial de la portada. Las puntuaciones Lighthouse de arriba conservan su fecha de medición y corresponden a la portada pública.

La ampliación de demos añade 10 pruebas: pasan **102 pruebas**. Se verifican el reparto de los 15 monitores Starter entre 2 dominios, el rechazo del sexto dominio y del monitor 16, y la conservación del límite técnico global de 10 del prototipo. Para probar la capacidad superior se usa únicamente una base de pruebas en memoria con capacidad global ampliada; no se cambia el tope de producción.

Se revisaron en navegador los filtros de cartera, el despliegue de servicios y el detalle de un monitor, el bloqueo de escritura en demo, la matriz de sondas simuladas, el cambio Pro/Business, la simulación local de roles y la selección de cliente/apariencia en páginas de estado. Business se revisó en un marco móvil de 390 píxeles, con 375 útiles por la barra de desplazamiento: documento y cuerpo no superan ese ancho. La herramienta WebMCP devuelve `measurementKind: simulated` y `customQuotaExample: true` para Business. La demo avanzada y sus estilos tienen un módulo diferido propio; no se cargan en la portada ni en el panel Free.

```powershell
pnpm run check
pnpm exec wrangler deploy --dry-run
pnpm exec wrangler d1 migrations apply DB --local --persist-to .wrangler/audit-state
pnpm exec wrangler dev --port 8788 --persist-to .wrangler/audit-state
# Desde otra terminal, con Chrome instalado:
pnpm run audit http://127.0.0.1:8788/
```

El auditor genera perfiles independientes y guarda ambos informes. Usa persistencia diferente a `.wrangler/state` si el desarrollo principal está activo. Las pruebas de integración utilizan D1 y Queues locales en workerd: comprueban autenticación, aislamiento, cuotas por dominio/monitor, concurrencia, incidencias, orden de mensajes y reintentos. La validación de CPU y capacidad de la cuenta Free sigue pendiente del despliegue remoto.
