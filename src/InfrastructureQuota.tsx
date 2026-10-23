import {metricQuota,type UsageMetric} from '../shared/infrastructure';
const count=(n:number)=>Math.round(n).toLocaleString('es-ES');
export function InfrastructureQuota({name,metric}:{name:string;metric:UsageMetric}){
 const quota=metricQuota(metric),daily=quota.period==='day',amount=quota.amount;
 return <><span>{quota.period==='unlimited'?'∞ · Sin límite':amount===null?'Sin datos':count(amount)+(daily?' / día':' / mes')}</span><small className="metric-projection">{quota.kind==='included'&&quota.period!=='unlimited'?'Incluido · ':''}Workers {quota.plan}</small>{daily&&amount!==null&&amount>0&&<div className="infrastructure-bar" role="meter" aria-label={`Consumo diario de ${name}`} aria-valuemin={0} aria-valuemax={amount} {...(metric.account!==null?{'aria-valuenow':Math.min(amount,metric.account)}:{'aria-valuetext':'Sin datos'})}><i className={metric.account!==null&&metric.account>=amount*.8?'warning':''} style={{width:`${metric.account===null?0:Math.min(100,metric.account/amount*100)}%`}}/></div>}</>;
}
export const exceedsDailyQuota=(metric:UsageMetric)=>{const quota=metricQuota(metric);return quota.period==='day'&&quota.amount!==null&&metric.projected!==null&&metric.projected>quota.amount;};
