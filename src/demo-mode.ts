export type DemoMode = 'free' | 'pro' | 'business';

export function demoModeFromSearch(search: string): DemoMode | null {
  const params = new URLSearchParams(search);
  if (!params.has('demo')) return null;
  return params.get('demo') === 'business' ? 'business' : params.get('demo') === 'pro' ? 'pro' : 'free';
}

export const demoHref = (mode: DemoMode) => mode === 'free' ? '/?demo' : `/?demo=${mode}`;
