import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {serviceQuota,type UsageMetric} from '../shared/infrastructure';
import {InfrastructureQuota,exceedsDailyQuota} from '../src/InfrastructureQuota';
const metric=(service:Parameters<typeof serviceQuota>[0],plan:'free'|'paid'):UsageMetric=>({project:500,account:90000,projected:110000,dailyLimit:plan==='free'?100000:null,quota:serviceQuota(service,plan)});
describe('Quotas reflect the configured service plan and period',()=>{
 it('shows a daily Free cap and compares the daily forecast against it',()=>{
  const data=metric('hyperdrive','free'),html=renderToStaticMarkup(<InfrastructureQuota name="Hyperdrive" metric={data}/>);
  expect(html).toContain('/ día');expect(html).toContain('Workers Free');expect(html).toContain('role="meter"');expect(exceedsDailyQuota(data)).toBe(true);
 });
 it('shows Paid monthly allowances without a daily usage meter or a false daily overage',()=>{
  expect(serviceQuota('workers','paid').amount).toBe(10000000);expect(serviceQuota('queues','paid').amount).toBe(1000000);
  const data=metric('queues','paid'),html=renderToStaticMarkup(<InfrastructureQuota name="Queues" metric={data}/>);
  expect(html).toContain('/ mes');expect(html).toContain('Incluido');expect(html).not.toContain('role="meter"');expect(exceedsDailyQuota(data)).toBe(false);
 });
 it('represents Hyperdrive Paid as unlimited and preserves unknown usage',()=>{
  const data=metric('hyperdrive','paid'),html=renderToStaticMarkup(<InfrastructureQuota name="Hyperdrive" metric={data}/>);
  expect(html).toContain('Sin límite');expect(html).toContain('Workers Paid');expect(html).not.toContain('role="meter"');expect(exceedsDailyQuota(data)).toBe(false);
 });
});
