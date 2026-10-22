export interface AccountUser {
  id: string; username: string; createdAt: number;
  accountStatus: 'pending' | 'active' | 'suspended'; isOwner: boolean;
  planId: string; lastActiveAt: number;
  suspensionReason: 'inactivity' | 'owner' | null; reviewRequestedAt: number | null;
}
export interface OwnerAccount extends Omit<AccountUser, 'isOwner'> { isOwner: number; statusChangedAt: number; domains: number; monitors: number; domainLimit:number|null; monitorLimit:number|null; historyDaysLimit:number|null;passkeys?:number;invitationExpiresAt?:number|null }
export interface OwnerAccountsData {
  accounts: OwnerAccount[];
  usage: { monitors: number; monitorLimit: number; queuedChecks: number; activeAccounts: number; accountLimit: number };
  capacity?: ReturnType<typeof import('./capacity').estimateCapacity>;
  inactivityDays: number;
}
