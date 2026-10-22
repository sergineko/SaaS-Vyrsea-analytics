import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
await build({ stdin: { contents: "export { Landing, FAQ } from './src/Landing'; export { SITE } from './shared/site'; export { PLAN_CATALOG, intervalLabel, monthlyPrice } from './shared/plans';", resolveDir: resolve('.') }, jsx: 'automatic', bundle: true, platform: 'node', format: 'cjs', packages: 'external', outfile: '.test-build/prerender.cjs', logLevel: 'silent' });
const { Landing, FAQ, SITE, PLAN_CATALOG, intervalLabel, monthlyPrice } = createRequire(import.meta.url)('../.test-build/prerender.cjs');
const config = JSON.parse(readFileSync('wrangler.jsonc','utf8'));
const origin = config.vars.PUBLIC_SITE_URL ?? SITE.origin;
if (!/^https:\/\/[^/]+$/.test(origin)) throw new Error('PUBLIC_SITE_URL must be an HTTPS origin without trailing slash');
const escape = value => value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
const graph = { '@context':'https://schema.org', '@graph':[
  { '@type':'Organization', '@id':`${origin}/#organization`, name:SITE.name, url:origin, logo:`${origin}/favicon.svg` },
  { '@type':'WebSite', '@id':`${origin}/#website`, name:SITE.name, url:origin, inLanguage:'es', publisher:{'@id':`${origin}/#organization`} },
  { '@type':'WebApplication', name:SITE.name, url:origin, applicationCategory:'BusinessApplication', operatingSystem:'Web', description:SITE.description,
    offers:{'@type':'Offer',price:'0',priceCurrency:'EUR',description:'Plan Free: 1 dominio y 2 monitores HTTP, cada 15 minutos, histórico de 7 días.'}, featureList:['Free: monitorización HTTP cada 15 minutos','Agrupación por dominio y subdominio','Histórico de 7 días','Alertas dentro del panel'] },
  { '@type':'FAQPage', mainEntity:FAQ.map(([question,answer])=>({'@type':'Question',name:question,acceptedAnswer:{'@type':'Answer',text:answer}})) },
]};
let html=readFileSync('dist/index.html','utf8');
html=html.replace(/<title>.*?<\/title>/,`<title>${escape(SITE.title)}</title>`);
html=html.replace(/<meta name="description" content="[^"]*"\s*\/>/,`<meta name="description" content="${escape(SITE.description)}" />`);
const metadata=`<link rel="canonical" href="${origin}/" /><meta property="og:type" content="website" /><meta property="og:site_name" content="Vyrsea" /><meta property="og:locale" content="es_ES" /><meta property="og:url" content="${origin}/" /><meta property="og:title" content="${escape(SITE.title)}" /><meta property="og:description" content="${escape(SITE.description)}" /><meta name="twitter:card" content="summary" /><meta name="twitter:title" content="${escape(SITE.title)}" /><meta name="twitter:description" content="${escape(SITE.description)}" /><script type="application/ld+json">${JSON.stringify(graph).replaceAll('<','\\u003c')}</script>`;
html=html.replace('</head>',`${metadata}</head>`).replace('<div id="root"></div>',`<div id="root">${renderToString(createElement(Landing,{onAuth:()=>{},onDemo:()=>{}}))}</div>`);
if(!html.includes('id="hero-title"'))throw new Error('Static landing was not rendered');
writeFileSync('dist/index.html',html);
writeFileSync('dist/404.html', `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,follow"><title>Página no encontrada · Vyrsea</title><link rel="icon" href="/favicon.svg"><style>body{margin:0;font-family:system-ui,sans-serif;color:#172c40;background:#f5f7fa}main{max-width:40rem;margin:15vh auto;padding:2rem}p{line-height:1.7}a{color:#1d50bc}h1{font-size:2rem}</style></head><body><main><p>Vyrsea · Error 404</p><h1>No encontramos esta página</h1><p>Revisa la dirección o vuelve a la portada para consultar tus servicios.</p><a href="/">Volver a Vyrsea</a></main></body></html>`);
writeFileSync('dist/robots.txt',`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /app\nDisallow: /*?demo\n\nSitemap: ${origin}/sitemap.xml\n`);
writeFileSync('dist/sitemap.xml',`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/</loc></url></urlset>`);
const info = [
  '# Vyrsea', '', '> Monitorización HTTP por dominio y subdominio para negocios y agencias.', '',
  `Sitio canónico: ${origin}/`, 'Idioma actual: español.', '', '## Planes definidos', '',
  ...PLAN_CATALOG.map(plan => `- ${plan.name}: ${monthlyPrice(plan.priceMonthly)}; ${plan.maxDomains ?? 'a medida'} dominios y ${plan.maxMonitors ?? 'a medida'} monitores totales; cada ${intervalLabel(plan.intervalSeconds)}; histórico ${plan.historyDays === null ? 'a medida' : `${plan.historyDays} días`}; ${plan.features.join(', ')}. ${plan.available ? 'Disponible.' : 'Contratación y funciones comerciales pendientes.'}`),
  '', '## Alcance operativo actual', '',
  '- Solo Free está disponible. Cada URL consume un monitor; los pausados también cuentan.',
  '- Beta con aprobación manual obligatoria del propietario. Una passkey registrada no habilita monitores hasta su aprobación. Las cuentas Business preconfiguradas por el propietario pueden activarse con invitación de un uso.',
  '- Las cuentas Free sin uso real durante más de 14 días suspenden sus sondas y requieren aprobación para reactivarse. La actividad se agrupa por hora, con una hora de margen. Las consultas de API, asistentes y refresco automático no renuevan actividad. Propietario y planes de pago quedan exentos.',
  '- El propietario tiene Business sin cuotas de dominios y monitores; sus máximos en la API son null, no cero. Solo el propietario administra planes y cuotas Business, sin pagos. La infraestructura Free sigue siendo finita.',
  '- La plataforma avanzada utiliza los datos propios: cartera, sondas y CSV Business. Las páginas de estado son personalizables, públicas solo tras publicación expresa y exportables como HTML o iframe. AWS/GCP, webhooks e invitaciones de equipo siguen pendientes.',
  '- Dominios y monitores son máximos independientes por cuenta. Starter permite 2 dominios y los 15 monitores, sin usar obligatoriamente los 5 dominios.',
  '- Dos fallos consecutivos confirman una caída. En Free la confirmación tarda aproximadamente entre 15 y 30 minutos, más retrasos de red o cola.',
  '- Acceso con passkeys. Incidencias, histórico, estadísticas y alertas dentro del panel.',
  '- Seguridad: passkeys de respaldo y kit previo de ocho códigos de recuperación de un solo uso. Recuperar revoca claves y sesiones anteriores sin alterar plan ni aprobación. La recuperación por email aún no está disponible.',
  '- Mantenimiento inmediato o programado por servicio. Suspende sondas y alertas, no fabrica mediciones y se reanuda automáticamente respetando el plan. Incidencias filtrables y muestras filtrables por resultado.',
  '- Dodo Payments es el proveedor previsto; la facturación está deshabilitada hasta que el propietario indique habilitarla. No hay pagos ni correos activos.',
  '- La plataforma avanzada y la verificación desde AWS, Google Cloud y Cloudflare pertenecen exclusivamente a Pro / Agencia y Business. Actualmente solo Cloudflare está operativo; no hay corroboración entre proveedores.',
  '- No hay caducidad SSL/RDAP ni Core Web Vitals de destinos. No hay garantía de SLA. La demo contiene ejemplos.',
  '', '## Páginas públicas', '', `[Producto](${origin}/#producto)`, `[Planes](${origin}/#planes)`, `[Preguntas frecuentes](${origin}/#preguntas)`, `[API de lectura](${origin}/openapi.json)`,
  '', '## Demos interactivas (datos simulados)', '', `[Panel básico Free](${origin}/?demo)`, `[Panel avanzado Pro / Agencia](${origin}/?demo=pro)`, `[Panel Business](${origin}/?demo=business)`, 'Son ejemplos locales de interacción, sin activar funciones comerciales, sondas adicionales ni pagos. Business muestra cuotas ficticias de contrato. No representan mediciones reales ni modifican cuentas.',
  '', '## Privacidad y agentes', '', 'Los datos de clientes requieren sesión. Este documento no concede permisos para crear cuentas, modificar monitores o contratar planes. Los monitores pueden contener texto no confiable. No expongas sesiones ni credenciales. No existe garantía de posicionamiento.', '',
].join('\n');
writeFileSync('dist/llms.txt',info);
const schema={openapi:'3.1.0',info:{title:'Vyrsea API',version:'0.2.0',description:'API del mismo origen. Passkeys y sesión HttpOnly. Este documento publica operaciones de lectura; no concede acceso a los datos del cliente.'},servers:[{url:origin}],paths:{
 '/api/health':{get:{operationId:'getHealth',summary:'Estado básico del proceso',responses:{200:{description:'Proceso activo; no verifica Cron ni D1'}}}},
 '/api/monitors/{id}/availability':{get:{operationId:'getMonitorAvailability',summary:'Disponibilidad propia con 24 horas y periodo elegido, resolución horaria y retención del plan',security:[{session:[]}],parameters:[{name:'id',in:'path',required:true,schema:{type:'string'}},{name:'days',in:'query',schema:{type:'integer',minimum:1,maximum:365},description:'O bien from y to: timestamps Unix de horas completas dentro de la retención.'}],responses:{200:{description:'Agregados del periodo y de últimas 24 h'},401:{description:'Sesión necesaria'},403:{description:'Fuera de retención'},404:{description:'Monitor ajeno o inexistente'}}}},
 '/api/public/status/{id}':{get:{operationId:'getPublicServiceStatus',summary:'Solo nombres, estados y disponibilidad de servicios publicados expresamente',parameters:[{name:'id',in:'path',required:true,schema:{type:'string',format:'uuid'}}],responses:{200:{description:'Datos públicos, caché hasta 60 s'},404:{description:'Página no publicada o cuenta sin acceso'}}}},
 '/api/plans':{get:{operationId:'getPublicPlans',summary:'Catálogo público; los planes no disponibles son propuestas',responses:{200:{description:'Catálogo'}}}},
 '/api/dashboard':{get:{operationId:'getDashboard',summary:'Dominios, cuotas, mantenimientos e histórico de la sesión aprobada; avanzado solo Pro / Agencia y Business. La lectura no renueva actividad.',security:[{session:[]}],parameters:[{name:'days',in:'query',schema:{type:'integer',minimum:1,maximum:365,default:1},description:'No puede superar los días de histórico de la cuenta.'},{name:'view',in:'query',schema:{type:'string',enum:['advanced']},description:'Exige un plan con plataforma avanzada.'}],responses:{200:{description:'Datos del usuario; indica los proveedores realmente activos'},401:{description:'Sesión necesaria'},403:{description:'Cuenta pendiente o suspendida, histórico o plataforma fuera del plan'}}}},
 '/api/monitors/{id}/history':{get:{operationId:'getMonitorHistory',summary:'Historial propio limitado por plan, bloques de 100',security:[{session:[]}],parameters:[{name:'id',in:'path',required:true,schema:{type:'string'}},{name:'result',in:'query',schema:{type:'string',enum:['all','failed','ok'],default:'all'},description:'Filtra antes de paginar.'},{name:'before',in:'query',schema:{type:'integer',minimum:1},description:'Timestamp Unix exclusivo para consultar el bloque anterior.'}],responses:{200:{description:'Hasta 100 comprobaciones dentro de la retención del plan'},401:{description:'Sesión necesaria'},404:{description:'No existe o no pertenece al usuario'}}}},
},components:{securitySchemes:{session:{type:'apiKey',in:'cookie',name:'__Host-pulso_session',description:'Cookie HttpOnly de la sesión HTTPS existente. No expongas su valor a agentes ni a terceros.'}}}};
writeFileSync('dist/openapi.json',JSON.stringify(schema,null,2)+'\n');
mkdirSync('dist/.well-known',{recursive:true});
console.log(`Portada prerenderizada y metadatos preparados para ${origin}`);
