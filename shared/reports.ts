export const REPORT_KINDS=['summary','checks','hourly','incidents','maintenance'] as const;
export type ReportKind=typeof REPORT_KINDS[number];
export const REPORT_NAMES:Record<ReportKind,string>={summary:'Resumen por monitor',checks:'Registro de comprobaciones',hourly:'Estadísticas por hora',incidents:'Incidencias',maintenance:'Mantenimientos'};
export const REPORT_COLUMNS=[
 ['record_type','Tipo de registro'],['exported_at','Exportado UTC'],['period_from','Periodo desde UTC'],['period_to','Periodo hasta UTC'],
 ['domain','Dominio'],['monitor_id','ID del monitor'],['monitor_name','Monitor'],['url','URL'],['current_status','Estado actual'],['paused','En pausa'],['interval_seconds','Intervalo actual (segundos)'],['probe_mask','Sondas seleccionadas actualmente'],['active_probes','Sondas operativas'],
 ['record_id','ID del registro'],['record_at','Fecha del registro UTC'],['ok','Comprobación correcta'],['status_code','Código HTTP'],['response_ms','Respuesta (ms)'],['error','Error'],
 ['total','Comprobaciones'],['successful','Correctas'],['failed','Fallidas'],['uptime','Disponibilidad por comprobaciones (%)'],['average_ms','Respuesta media (ms)'],
 ['started_at','Inicio UTC'],['ended_at','Fin UTC'],['duration_seconds','Duración registrada (segundos)'],['reason','Motivo'],['created_at','Registro creado UTC'],['monitor_created_at','Monitor creado UTC'],['cancelled_at','Cancelado UTC'],['last_checked_at','Última comprobación UTC'],['next_check_at','Próxima comprobación UTC'],['last_status_code','Último HTTP'],['last_response_ms','Última respuesta (ms)'],['last_error','Último error'],['failures','Fallos consecutivos'],['note','Notas'],
] as const;
export type ReportRow=Record<string,string|number|null>;
export interface ReportPage{kind:ReportKind;rows:ReportRow[];nextCursor:string|null;from:number;to:number;generatedAt:number;}
const times=new Set(['exported_at','period_from','period_to','record_at','started_at','ended_at','created_at','monitor_created_at','cancelled_at','last_checked_at','next_check_at']);
export function csvCell(value:unknown){let cell=value==null?'':String(value);if(/^[\s\u0000-\u001f]*[=+\-@]/.test(cell))cell="'"+cell;return '"'+cell.replaceAll('"','""')+'"';}
export const reportCSVHeader=()=> '\uFEFF'+REPORT_COLUMNS.map(([,name])=>csvCell(name)).join(';')+'\r\n';
export function reportCSVRows(page:ReportPage){return page.rows.map(row=>REPORT_COLUMNS.map(([key])=>{
 let value=row[key];if(key==='record_type')value=REPORT_NAMES[page.kind];if(key==='exported_at')value=page.generatedAt;if(key==='period_from')value=page.from;if(key==='period_to')value=page.to;
 if(times.has(key)&&typeof value==='number')value=new Date(value*1000).toISOString();
 if(['ok','paused'].includes(key)&&typeof value==='number')value=value?'Sí':'No';
 if(key==='probe_mask'&&typeof value==='number')value=[[1,'Cloudflare'],[2,'AWS'],[4,'Google Cloud']].filter(([bit])=>Number(row.probe_mask)&Number(bit)).map(([,name])=>name).join(' | ');
 if(key==='uptime'&&row.total!==undefined)value=Number(row.total)?Number((Number(row.successful)/Number(row.total)*100).toFixed(5)):null;
 if(key==='failed'&&row.total!==undefined)value=Number(row.total)-Number(row.successful);
 if(key==='average_ms'&&row.total!==undefined)value=Number(row.total)&&row.total_ms!==undefined?Number((Number(row.total_ms)/Number(row.total)).toFixed(3)):null;
 return csvCell(value);
 }).join(';')).join('\r\n')+(page.rows.length?'\r\n':'');}
