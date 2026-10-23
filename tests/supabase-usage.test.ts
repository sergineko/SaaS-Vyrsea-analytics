import {describe,it,expect} from 'vitest';
import {storageProjection,supabaseProBudget,type SupabaseUsage} from '../shared/supabase-usage';
import {componentState,validPNG} from '../shared/status-components';
import {dispatchAlerts} from '../worker/alerts';
const fixture:SupabaseUsage={fetchedAt:1,databaseBytes:60e6,applicationBytes:2e6,indexBytes:1e6,databaseConnections:10,applicationConnections:2,maxConnections:60,cacheHitPercent:99,tables:[{name:'checks',bytes:400000,indexBytes:150000,estimatedRows:1000,deadRows:5},{name:'hourly_stats',bytes:24000,indexBytes:10000,estimatedRows:100,deadRows:0}],plans:[{plan:'free',activeMonitors:2,checksPerDay:192,retainedChecks:1536,retainedHours:384},{plan:'business',activeMonitors:3,checksPerDay:4320,retainedChecks:393120,retainedHours:6552}]};
describe('Supabase planning models',()=>{
 it('does no SQL work and sends nothing while external alerts are disabled',async()=>{let calls=0;await dispatchAlerts({ALERTS_ENABLED:'0',DB:{prepare:()=>{calls++;throw new Error('Must not run');}}} as never);expect(calls).toBe(0);});
 it('uses measured row sizes and retention rather than assuming endless linear growth',()=>{const value=storageProjection(fixture);expect(value.calibrated).toBe(true);expect(value.checksPerDay).toBe(4512);expect(value.checkBytes).toBe(400);expect(value.retainedChecks).toBe(394656);expect(value.fullHistoryBytes).toBeGreaterThan(200e6);expect(storageProjection(fixture,100).freePercent).toBeGreaterThan(100);expect(()=>storageProjection(fixture,NaN)).toThrow();});
 it('uses explicit planning assumptions for uncalibrated tables and never predicts shrinking physical files',()=>{const value=storageProjection({...fixture,tables:[],plans:[]});expect(value.calibrated).toBe(false);expect(value.fullHistoryBytes).toBe(fixture.databaseBytes);expect(value.checkBytes).toBe(400);});
 it('applies Pro compute credit once and bills provisioned disk and egress extras separately',()=>{expect(supabaseProBudget(8,250)).toBe(25);expect(supabaseProBudget(1000,810,410)).toBeCloseTo(599.4);expect(()=>supabaseProBudget(-1,1)).toThrow();});
 it('keeps unknown group coverage separate from healthy measurements and rejects active images',()=>{expect(componentState(['up','pending'])).toBe('pending');expect(componentState(['up','down'])).toBe('down');expect(validPNG('data:image/svg+xml;base64,PHN2Zy8+')).toBe(false);});
});
