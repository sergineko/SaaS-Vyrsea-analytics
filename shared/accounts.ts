export interface AccountUser {
  id: string; username: string; createdAt: number;
  accountStatus: 'pending' | 'active' | 'suspended'; isOwner: boolean;
  planId: string; lastActiveAt: number;
  suspensionReason: 'inactivity' | 'owner' | null; reviewRequestedAt: number | null;
}
export interface OwnerAccount extends Omit<AccountUser, 'isOwner'> { isOwner: number; statusChangedAt: number; domains: number; monitors: number }
export interface OwnerAccountsData {
  accounts: OwnerAccount[];
  usage: { monitors: number; monitorLimit: number; queuedChecks: number; activeAccounts: number; accountLimit: number };
  inactivityDays: number;
}
