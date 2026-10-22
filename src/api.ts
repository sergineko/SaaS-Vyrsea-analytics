export async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { method, credentials: 'same-origin',
    ...(method !== 'GET' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) } : {}),
  });
  const result = await response.json() as { error?: string; code?: string };
  if (typeof window !== 'undefined' && (result.code === 'ACCOUNT_PENDING' || result.code === 'ACCOUNT_SUSPENDED' || response.status === 401)) window.dispatchEvent(new Event('vyrsea:account-changed'));
  if (!response.ok) throw new Error(result.error ?? 'No se pudo completar la solicitud.');
  return result as T;
}
