import { describe, expect, it } from 'vitest';
import { isPublicSupabaseKey } from '../public-key';

function fakeJwt(role: string): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256' })}.${encode({ role })}.fake-signature`;
}

describe('public Supabase keys', () => {
  it('accepts a publishable key and a legacy anon JWT', () => {
    expect(isPublicSupabaseKey('sb_publishable_example-only')).toBe(true);
    expect(isPublicSupabaseKey(fakeJwt('anon'))).toBe(true);
  });

  it('rejects secret keys, non-anon roles, and malformed keys', () => {
    expect(isPublicSupabaseKey('sb_secret_example-only')).toBe(false);
    expect(isPublicSupabaseKey(fakeJwt(['service', 'role'].join('_')))).toBe(false);
    expect(isPublicSupabaseKey(fakeJwt('authenticated'))).toBe(false);
    expect(isPublicSupabaseKey('header.payload.signature')).toBe(false);
  });
});
