import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Smoke test: the transactional-email registry must register both commitment
 * templates so Admin.tsx can route equity vs gift pledges to distinct copy.
 * We read the registry source as text rather than importing it because the
 * template files use Deno-style `npm:` specifiers that vitest can't resolve.
 */
describe('transactional email registry', () => {
  const registrySrc = readFileSync(
    resolve(process.cwd(), 'supabase/functions/_shared/transactional-email-templates/registry.ts'),
    'utf8',
  );
  const giftSrc = readFileSync(
    resolve(process.cwd(), 'supabase/functions/_shared/transactional-email-templates/commitment-gift-pledge.tsx'),
    'utf8',
  );

  it('registers both equity and gift commitment templates', () => {
    expect(registrySrc).toMatch(/'investment-commitment'\s*:\s*investmentCommitment/);
    expect(registrySrc).toMatch(/'commitment-gift-pledge'\s*:\s*commitmentGiftPledge/);
  });

  it('gift-pledge template uses non-binding gift language and avoids SAFE wording', () => {
    expect(giftSrc).toMatch(/non-binding/i);
    expect(giftSrc).toMatch(/gift/i);
    // The gift template must NOT instruct startups to send a SAFE.
    expect(giftSrc).not.toMatch(/send.*SAFE/i);
  });
});
