import {readFileSync,writeFileSync} from 'node:fs';
// Generates a reviewable configuration only. Never deploys, subscribes to a
// paid plan, edits DNS or creates provider event subscriptions.
const args=process.argv.slice(2),allowed=new Set(['--email-from','--email-events-ready','--custom-domains-cname']);
const options={};
for(let i=0;i<args.length;i++){
 if(!allowed.has(args[i]))throw new Error('Opciones: --email-from dirección [--email-events-ready] [--custom-domains-cname host]');
 const key=args[i];options[key]=key==='--email-events-ready'?true:args[++i];
 if(!options[key])throw new Error('Falta el valor de '+key);
}
const source=JSON.parse(readFileSync('wrangler.production.jsonc','utf8'));
if(options['--email-from']){
 const from=options['--email-from'];if(!/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(from))throw new Error('Remitente no válido.');
 source.send_email=[{name:'EMAIL',allowed_sender_addresses:[from]}];
 source.vars.EMAIL_FROM=from;source.vars.CLOUDFLARE_EMAIL_ZONE_ID=source.routes[0].zone_id;
 source.vars.EMAIL_EVENTS_ENABLED=options['--email-events-ready']?'1':'0';
}
source.vars.ALERTS_ENABLED='1';
source.vars.INFRA_CLOUDFLARE_PLAN='paid';
if(options['--custom-domains-cname']){
 const hostname=options['--custom-domains-cname'];if(!/^[a-z0-9.-]+\.vyrsea\.com$/.test(hostname))throw new Error('Usa el CNAME de Vyrsea configurado en Cloudflare for SaaS.');
 source.vars.CUSTOM_DOMAINS_CNAME=hostname;source.vars.CUSTOM_DOMAINS_ZONE_ID=source.routes[0].zone_id;source.vars.CUSTOM_DOMAINS_ENABLED='1';source.assets.run_worker_first=true;
}
const output='wrangler.activation.generated.jsonc';writeFileSync(output,JSON.stringify(source,null,2)+'\n');
console.log(`Configuración preparada en ${output}. No se ha desplegado ni contratado nada.`);
console.log('Antes de desplegar: Workers Paid, dominio remitente, eventos de entrega, clave de cifrado y, si procede, Cloudflare for SaaS y su token.');
