import { describe, expect, it } from 'vitest';
import { demoData } from '../src/demo';
import { domainSummaries, workspaceReportCSV } from '../src/advanced-data';
describe('Account report from measured data',()=>{
  it('aggregates each domain without inventing measurements',()=>{
    const data=demoData();data.stats=[];
    expect(domainSummaries(data).every(group=>group.total===0&&group.successful===0)).toBe(true);
    expect(workspaceReportCSV(data)).toContain('Sin datos');
  });
  it('exports the selected window, escapes CSV and neutralizes spreadsheet formula cells',()=>{
    const data=demoData();data.user.username='  =HYPERLINK("https://invalid.example")';data.windowDays=7;
    const csv=workspaceReportCSV(data);
    expect(csv).toContain('"Periodo (días)";"7"');
    expect(csv).toContain('"\'  =HYPERLINK(""https://invalid.example"")"');
    expect(csv).not.toContain('INFORME SIMULADO');
    const groups=domainSummaries(data);expect(groups.reduce((sum,group)=>sum+group.total,0)).toBe(data.stats.reduce((sum,stat)=>sum+stat.total,0));
  });
});
