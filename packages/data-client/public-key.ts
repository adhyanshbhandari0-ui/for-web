/** Check key format and legacy JWT role before using a key in public code. */
export function isPublicSupabaseKey(key: string): boolean {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) return false;

  try {
    const payload = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims: { role?: unknown } | null = JSON.parse(atob(payload));
    return claims?.role === 'anon';
  } catch {
    return false;
  }
}
