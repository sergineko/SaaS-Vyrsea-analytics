import { Activity, ArrowRight, Check, Clock3, Globe2 } from 'lucide-react';
import { intervalLabel, PLAN_CATALOG } from '../shared/plans';

export function Pricing({ onAuth }: { onAuth: (mode: 'register' | 'login') => void }) {
  return <section id="planes" className="pricing-section">
    <div className="pricing-intro"><div><p className="small-label">PLANES POR DOMINIO Y MONITORES</p><h2>Desde tu primera web<br />hasta toda tu cartera.</h2></div><p>Empieza gratis. Starter, Pro / Agencia y Business ya tienen su alcance definido; su contratación y sus funciones comerciales siguen en preparación.</p></div>
    <div className="pricing-grid">{PLAN_CATALOG.map(plan => <article key={plan.id} className={`pricing-card ${plan.available ? 'available' : ''}`}>
      <div className="pricing-top"><h3>{plan.name}</h3><span className={plan.available ? 'plan-available' : 'plan-upcoming'}>{plan.available ? 'Disponible' : 'Próximamente'}</span></div>
      <p>{plan.description}</p>
      <div className={`plan-price ${plan.priceMonthly === null ? 'custom-price' : ''}`}>{plan.priceMonthly === null ? 'Consultar precios' : <>{plan.priceMonthly.toLocaleString('es-ES', { minimumFractionDigits: plan.priceMonthly ? 2 : 0 })}<span>€ / mes</span></>}</div>
      <div className="plan-capacity"><span><Globe2 size={16} />{plan.maxDomains === null ? <strong>Dominios a medida</strong> : <>Hasta <strong>{plan.maxDomains}</strong> {plan.maxDomains === 1 ? 'dominio' : 'dominios'}</>}</span><span><Activity size={16} />{plan.maxMonitors === null ? <strong>Monitores a medida</strong> : <>Hasta <strong>{plan.maxMonitors}</strong> monitores en total</>}</span><span><Clock3 size={16} />Cada <strong>{intervalLabel(plan.intervalSeconds)}</strong></span><span><Check size={16} />Histórico <strong>{plan.historyDays === null ? 'a medida' : `${plan.historyDays} días`}</strong></span></div>
      <ul className="plan-features">{plan.features.map(feature => <li key={feature}><Check size={14} aria-hidden="true" /><span>{feature}</span></li>)}</ul>
      {plan.available ? <button className="button primary full" onClick={() => onAuth('register')}>Crear cuenta gratuita <ArrowRight size={15} /></button> : <span className="planned-label">Contratación no habilitada</span>}
      {plan.advancedDashboard && <a className="plan-demo-link" href={`/?demo=${plan.id}`}>Ver demo {plan.id === 'business' ? 'Business' : 'Pro / Agencia'} <ArrowRight size={14}/></a>}
    </article>)}</div>
    <div className="quota-explanation"><div><strong>Dos máximos. Tú decides el reparto.</strong><p>Los dominios y los monitores son límites independientes para toda la cuenta. Cada URL ocupa un monitor y los subdominios se agrupan bajo su dominio principal.</p></div><div className="quota-example"><span>EJEMPLO CON STARTER</span><p><strong>2 dominios + 15 monitores</strong></p><p>Puedes usar los 15 monitores entre esos 2 dominios. El máximo de 5 dominios no obliga a registrar los cinco.</p></div></div>
    <p className="pricing-note">Los monitores en pausa también cuentan. Business define sus cuotas y retención por contrato. Las demos son vistas previas con datos simulados.</p>
    <div className="probe-roadmap"><div><p className="small-label">PRO / AGENCIA Y BUSINESS</p><h3>Una comprobación, contrastada entre proveedores.</h3></div><p>La verificación desde AWS, Google Cloud y Cloudflare estará reservada a estos planes, junto con la plataforma avanzada. Actualmente las sondas operativas parten de Cloudflare; la verificación entre proveedores está en preparación.</p></div>
  </section>;
}
