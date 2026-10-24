import {describe,it,expect} from 'vitest';
import {REPORT_COLUMNS,reportCSVHeader,reportCSVRows} from '../shared/reports';
describe('Detailed report CSV',()=>{
 it('exports all columns and UTC dates while neutralizing formulas in names, URLs and errors',()=>{
  const csv=reportCSVRows({kind:'checks',from:3600,to:7200,generatedAt:7200,nextCursor:null,rows:[{monitor_name:'  =HYPERLINK("bad")',record_at:4000,error:'@SUM(1)',ok:0,status_code:503,response_ms:42,url:'https://example.org/a;b'}]});
  expect(reportCSVHeader().split(';')).toHaveLength(REPORT_COLUMNS.length);expect(csv).toContain('1970-01-01T01:06:40.000Z');expect(csv).toContain('"\'  =HYPERLINK(""bad"")"');expect(csv).toContain('"\'@SUM(1)"');expect(csv).toContain('https://example.org/a;b');expect(csv).toContain('503');
 });
 it('keeps an unavailable percentage empty and computes averages and failures from measured totals',()=>{
  const measured=reportCSVRows({kind:'summary',from:0,to:1,generatedAt:1,nextCursor:null,rows:[{monitor_name:'API',total:10,successful:9,total_ms:1234}]});expect(measured).toContain('"90"');expect(measured).toContain('"123.4"');
  const missing=reportCSVRows({kind:'summary',from:0,to:1,generatedAt:1,nextCursor:null,rows:[{total:0,successful:0,total_ms:0}]});expect(missing).not.toContain('NaN');expect(missing).not.toContain('Infinity');
 });
});
