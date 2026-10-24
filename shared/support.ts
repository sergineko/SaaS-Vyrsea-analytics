export const TICKET_STATES={open:'Abierto',waiting:'En espera',resolved:'Resuelto'} as const;
export const TICKET_PRIORITIES={low:'Baja',normal:'Normal',high:'Alta',urgent:'Urgente'} as const;
export const TICKET_CATEGORIES={access:'Acceso y recuperación',plan:'Plan y facturación',monitoring:'Monitorización',other:'Otro'} as const;
export const TICKET_CHANNELS={internal:'Soporte',portal:'Panel del cliente',contact:'Formulario de contacto',email:'Correo recibido'} as const;
export interface SupportTicket {id:string;publicRef:string;userId:string|null;username:string|null;isOwner:number|null;requesterEmail:string;requesterName:string;subject:string;category:keyof typeof TICKET_CATEGORIES;state:keyof typeof TICKET_STATES;priority:keyof typeof TICKET_PRIORITIES;channel:keyof typeof TICKET_CHANNELS;assigneeId:string|null;createdAt:number;updatedAt:number;recoveryState:string;expiresAt:number|null;usedAt:number|null}
export interface SupportEvent {id:string;actor:string;kind:string;visibility:'internal'|'public';message:string;createdAt:number;deliveryState:string;attempts:number;lastError:string|null}
export interface SupportDetail {ticket:SupportTicket;events:SupportEvent[];security?:{passkeys:number;recoveryCodes:number;isStaff:number};canApproveRecovery?:boolean}
export interface SupportMeta {owner:boolean;staff:{id:string;username:string}[];counts:{open:number;waiting:number;resolved:number};channels:{address:string;inboundReady:boolean;outboundReady:boolean;forwarding:boolean}}
