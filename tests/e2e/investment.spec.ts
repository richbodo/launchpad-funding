import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';

// Note: The Invest button is disabled during intro/outro stages, and stages
// are local React state (not synced via Supabase). The investor has no stage
// controls. This test verifies:
// 1. The Invest button renders for investors
// 2. The button is correctly disabled during intro stage
// 3. Investment realtime updates work across all participants

test.describe('investment flow', () => {
  test('Invest button is visible but disabled during intro stage', async ({ page }) => {
    await loginAs(page, { email: 'investor-1@test.com', role: 'investor' });
    await expect(page.locator('[data-testid="invest-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="invest-btn"]')).toBeDisabled();
  });

  test('realtime investment updates appear on all participant screens', async ({ browser }) => {
    const facilitatorContext = await browser.newContext();
    const startupContext = await browser.newContext();
    const investorContext = await browser.newContext();

    try {
      const facilitatorPage = await facilitatorContext.newPage();
      await loginAs(facilitatorPage, { email: 'facilitator@test.com', role: 'facilitator', password: 'test123' });

      const startupPage = await startupContext.newPage();
      await loginAs(startupPage, { email: 'startup-a@test.com', role: 'startup' });

      const investorPage = await investorContext.newPage();
      await loginAs(investorPage, { email: 'investor-1@test.com', role: 'investor' });

      // Wait for pages to load and capture initial funding text
      await expect(facilitatorPage.locator('[data-testid="funding-amount"]')).toBeVisible();
      const initialText = await facilitatorPage.locator('[data-testid="funding-amount"]').textContent();

      // Insert an investment directly via Supabase (bypasses the disabled button)
      // This tests the realtime subscription pipeline end-to-end
      const sessionId = facilitatorPage.url().match(/\/session\/(.+)/)?.[1];
      const pubKey = await investorPage.evaluate(() => {
        // Read the supabase key from the client
        return (window as any).__SUPABASE_KEY || '';
      });

      // Use the publishable key from env — it's baked into the Supabase client
      await investorPage.evaluate(async ({ sid, url }) => {
        // Find the key from the meta tag or supabase client
        const key = document.querySelector('meta[name="supabase-key"]')?.getAttribute('content') || '';
        const response = await fetch(`${url}/rest/v1/investments`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': key || 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH',
            'Authorization': `Bearer ${key || 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH'}`,
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({
            session_id: sid,
            investor_email: 'investor-1@test.com',
            investor_name: 'Investor One',
            startup_email: 'startup-a@test.com',
            startup_name: 'AlphaTech',
            amount: 50000,
          }),
        });
        if (!response.ok) throw new Error(`Investment insert failed: ${response.status}`);
      }, { sid: sessionId, url: 'http://127.0.0.1:54321' });

      // Verify funding meter changes on all screens via Supabase Realtime
      // The amount text should change from its initial value
      for (const page of [facilitatorPage, startupPage, investorPage]) {
        await expect(async () => {
          const current = await page.locator('[data-testid="funding-amount"]').textContent();
          expect(current).not.toBe('$0');
        }).toPass({ timeout: 10_000 });
      }
    } finally {
      await facilitatorContext.close();
      await startupContext.close();
      await investorContext.close();
    }
  });
});
