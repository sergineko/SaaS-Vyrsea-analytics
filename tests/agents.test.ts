import { describe,expect,it,vi } from 'vitest';
import { publicTools,registerAgentTools,workspaceTools } from '../src/agents';
import { demoData } from '../src/demo';
describe('Read-only agent tools',()=>{
  it('labels proposals accurately and publishes only strict read-only schemas',()=>{
    for(const tool of [...publicTools(),...workspaceTools(async()=>demoData(),true)]){
      expect(tool.annotations.readOnlyHint).toBe(true);expect(tool.inputSchema.additionalProperties).toBe(false);expect(tool.inputSchema.type).toBe('object');
    }
    const result=publicTools()[0].execute({}) as {plans:{id:string;available:boolean}[]};
    expect(result.plans.filter(p=>p.available).map(p=>p.id)).toEqual(['free']);
  });
  it('identifies demo data and never returns credentials or session material',async()=>{
    const result=await workspaceTools(async()=>demoData(),true)[0].execute({});
    expect(result).toMatchObject({demo:true,plan:{domains:1,monitors:2}});
    expect(JSON.stringify(result)).not.toMatch(/tokenHash|publicKey|credentials|cookie|username/);
  });
  it('revokes registrations on cleanup using AbortSignal',()=>{
    const registerTool=vi.fn();const cleanup=registerAgentTools(publicTools(),{registerTool});
    const signal=registerTool.mock.calls[0][1].signal as AbortSignal;expect(signal.aborted).toBe(false);cleanup();expect(signal.aborted).toBe(true);
  });
});
