import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';
import { measureFillRatio } from './helpers/visual';

/**
 * Pixel-level Fund-ometer visual regressions.
 *
 * The text in `[data-testid="funding-amount"]` is already asserted by
 * funding.spec.ts. These tests guard the *visual* fill of the meter — the
 * width of the animated bar element relative to its track. A CSS or
 * Framer Motion regression that silently zeros the fill width would not be
 * caught by reading the percentage label, only by measuring pixels.
 */

const SESSION_ID = '00000000-0000-0000-0000-000000000001';
const SUPABASE_URL = 'http://127.0.0.1:54321';
const API_KEY = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';

async function clearInvestments(page: any) {
  await page.evaluate(
    async ({ url, key, sid }: any) => {
      const res = await fetch(`${url}/rest/v1/investments?session_id=eq.${sid}`, {
        method: 'DELETE',
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
      if (!res.ok) throw new Error(`Investment delete failed: ${res.status}`);
    },
    { url: SUPABASE_URL, key: API_KEY, sid: SESSION_ID },
  );
}

async function insertInvestment(
  page: any,
  opts: {
    investorEmail: string;
    investorName: string;
    startupEmail: string;
    startupName: string;
    amount: number;
  },
) {
  await page.evaluate(
    async ({ sid, url, key, inv }: any) => {
      const res = await fetch(`${url}/rest/v1/investments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: key,
          Authorization: `Bearer ${key}`,
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          session_id: sid,
          investor_email: inv.investorEmail,
          investor_name: inv.investorName,
          startup_email: inv.startupEmail,
          startup_name: inv.startupName,
          amount: inv.amount,
        }),
      });
      if (!res.ok) throw new Error(`Investment insert failed: ${res.status}`);
    },
    { sid: SESSION_ID, url: SUPABASE_URL, key: API_KEY, inv: opts },
  );
}

test.describe('funding meter — visual fill ratio', () => {
  test('empty meter renders ~0% pixel width', async ({ page }) => {
    await loginAs(page, { email: 'facilitator@test.com', role: 'facilitator', password: 'test123' });
    await clearInvestments(page);
    await page.reload();
    await page.click('[data-testid="stage-next-btn"]');
    await expect(page.locator('[data-testid="funding-amount"]')).toContainText('$0');

    const ratio = await measureFillRatio(
      page,
      '[data-testid="funding-meter-fill"]',
      '[data-testid="funding-meter-bar"]',
    );
    expect(ratio).toBeLessThan(0.02);
  });

  test('half-funded meter renders ~50% pixel width', async ({ page }) => {
    await loginAs(page, { email: 'facilitator@test.com', role: 'facilitator', password: 'test123' });
    await clearInvestments(page);
    await page.reload();
    await page.click('[data-testid="stage-next-btn"]');
    await expect(page.locator('[data-testid="funding-goal"]')).toContainText('Goal: $125K');

    // Seed half the goal ($62.5K of $125K).
    await insertInvestment(page, {
      investorEmail: 'investor-1@test.com',
      investorName: 'Investor One',
      startupEmail: 'startup-a@test.com',
      startupName: 'AlphaTech',
      amount: 62_500,
    });

    await expect(async () => {
      const text = await page.locator('[data-testid="funding-amount"]').textContent();
      expect(text).toContain('$62');
    }).toPass({ timeout: 10_000 });

    // Give Framer Motion's animation a beat to settle.
    await page.waitForTimeout(900);

    const ratio = await measureFillRatio(
      page,
      '[data-testid="funding-meter-fill"]',
      '[data-testid="funding-meter-bar"]',
    );
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(0.6);
  });

  test('fully-funded meter renders ~100% pixel width', async ({ page }) => {
    await loginAs(page, { email: 'facilitator@test.com', role: 'facilitator', password: 'test123' });
    await clearInvestments(page);
    await page.reload();
    await page.click('[data-testid="stage-next-btn"]');
    await expect(page.locator('[data-testid="funding-goal"]')).toContainText('Goal: $125K');

    await insertInvestment(page, {
      investorEmail: 'investor-1@test.com',
      investorName: 'Investor One',
      startupEmail: 'startup-a@test.com',
      startupName: 'AlphaTech',
      amount: 125_000,
    });

    await expect(async () => {
      const text = await page.locator('[data-testid="funding-amount"]').textContent();
      expect(text).toBe('$125K');
    }).toPass({ timeout: 10_000 });

    await page.waitForTimeout(900);

    const ratio = await measureFillRatio(
      page,
      '[data-testid="funding-meter-fill"]',
      '[data-testid="funding-meter-bar"]',
    );
    // Meter caps at 100% width even when oversubscribed; >= 0.95 lets us
    // tolerate minor border/transform jitter.
    expect(ratio).toBeGreaterThanOrEqual(0.95);
  });

  test('oversubscribed meter still caps at 100% width (no overflow)', async ({ page }) => {
    await loginAs(page, { email: 'facilitator@test.com', role: 'facilitator', password: 'test123' });
    await clearInvestments(page);
    await page.reload();
    await page.click('[data-testid="stage-next-btn"]');
    await expect(page.locator('[data-testid="funding-goal"]')).toContainText('Goal: $125K');

    await insertInvestment(page, {
      investorEmail: 'investor-1@test.com',
      investorName: 'Investor One',
      startupEmail: 'startup-a@test.com',
      startupName: 'AlphaTech',
      amount: 250_000,
    });

    await expect(page.locator('[data-testid="oversubscribed-banner"]')).toBeVisible({
      timeout: 10_000,
    });
    await page.waitForTimeout(900);

    const ratio = await measureFillRatio(
      page,
      '[data-testid="funding-meter-fill"]',
      '[data-testid="funding-meter-bar"]',
    );
    // Width is clamped to <= 100% even when amount is 2x the goal.
    expect(ratio).toBeLessThanOrEqual(1.02);
    expect(ratio).toBeGreaterThanOrEqual(0.95);
  });
});
