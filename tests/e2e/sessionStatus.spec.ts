import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';

const SESSION_ID = '00000000-0000-0000-0000-000000000001';
const SUPABASE_URL = 'http://127.0.0.1:54321';
const API_KEY = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';

/** Read the session status directly from the database via REST API. */
async function getSessionStatus(page: any): Promise<string> {
  return page.evaluate(async ({ url, key, sid }: any) => {
    const res = await fetch(
      `${url}/rest/v1/sessions?id=eq.${sid}&select=status`,
      {
        headers: {
          'apikey': key,
          'Authorization': `Bearer ${key}`,
        },
      },
    );
    if (!res.ok) throw new Error(`Session query failed: ${res.status}`);
    const rows = await res.json();
    return rows[0]?.status;
  }, { url: SUPABASE_URL, key: API_KEY, sid: SESSION_ID });
}

/** Reset session status back to 'scheduled' via REST API. */
async function resetSessionStatus(page: any) {
  await page.evaluate(async ({ url, key, sid }: any) => {
    const res = await fetch(
      `${url}/rest/v1/sessions?id=eq.${sid}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': key,
          'Authorization': `Bearer ${key}`,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ status: 'scheduled' }),
      },
    );
    if (!res.ok) throw new Error(`Session reset failed: ${res.status}`);
  }, { url: SUPABASE_URL, key: API_KEY, sid: SESSION_ID });
}

test.describe('session status persistence (issue #9)', () => {
  test('"Start Call" sets session status to live in the database', async ({ page }) => {
    await loginAs(page, { email: 'facilitator@test.com', role: 'facilitator', password: 'test123' });

    // Ensure session starts as 'scheduled'
    await resetSessionStatus(page);
    const before = await getSessionStatus(page);
    expect(before).toBe('scheduled');

    // Click Start Call
    await page.click('text=Start Call');
    await expect(page.locator('[data-testid="end-call-btn"]')).toBeVisible({ timeout: 15_000 });

    // Verify the database was actually updated (not just React state)
    await expect(async () => {
      const status = await getSessionStatus(page);
      expect(status).toBe('live');
    }).toPass({ timeout: 5_000 });
  });

  test('"End Call" sets session status to completed in the database', async ({ page }) => {
    await loginAs(page, { email: 'facilitator@test.com', role: 'facilitator', password: 'test123' });

    // Ensure session is 'scheduled', then start it
    await resetSessionStatus(page);
    await page.click('text=Start Call');
    await expect(page.locator('[data-testid="end-call-btn"]')).toBeVisible({ timeout: 15_000 });

    // End the call
    await page.click('[data-testid="end-call-btn"]');

    // Verify the database shows 'completed'
    await expect(async () => {
      const status = await getSessionStatus(page);
      expect(status).toBe('completed');
    }).toPass({ timeout: 5_000 });

    // Reset for other tests
    await resetSessionStatus(page);
  });

  test('investor auto-joins when session goes live via database', async ({ browser }) => {
    const facilitatorCtx = await browser.newContext();
    const investorCtx = await browser.newContext();

    try {
      const facilitatorPage = await facilitatorCtx.newPage();
      const investorPage = await investorCtx.newPage();

      await loginAs(facilitatorPage, { email: 'facilitator@test.com', role: 'facilitator', password: 'test123' });
      await loginAs(investorPage, { email: 'investor-1@test.com', role: 'investor' });

      // Reset to scheduled
      await resetSessionStatus(facilitatorPage);
      await facilitatorPage.reload();
      await investorPage.reload();
      await expect(facilitatorPage.locator('text=Start Call')).toBeVisible({ timeout: 10_000 });

      // Facilitator starts the call — this should update the DB
      await facilitatorPage.click('text=Start Call');
      await expect(facilitatorPage.locator('[data-testid="end-call-btn"]')).toBeVisible({ timeout: 15_000 });

      // Investor should see session is live (their page reacts to Realtime status change)
      // The invest button becomes visible when they've joined
      await expect(investorPage.locator('[data-testid="invest-btn"]')).toBeVisible({ timeout: 15_000 });

      // Reset
      await resetSessionStatus(facilitatorPage);
    } finally {
      await facilitatorCtx.close();
      await investorCtx.close();
    }
  });
});
