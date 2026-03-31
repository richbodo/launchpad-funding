import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';

const SESSION_ID = '00000000-0000-0000-0000-000000000001';
const SUPABASE_URL = 'http://127.0.0.1:54321';
const API_KEY = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';

/** Insert an investment directly via the Supabase REST API. */
async function insertInvestment(page: any, opts: {
  investorEmail: string;
  investorName: string;
  startupEmail: string;
  startupName: string;
  amount: number;
}) {
  await page.evaluate(async ({ sid, url, key, inv }: any) => {
    const res = await fetch(`${url}/rest/v1/investments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Prefer': 'return=minimal',
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
  }, { sid: SESSION_ID, url: SUPABASE_URL, key: API_KEY, inv: opts });
}

/** Delete all investments for the test session via REST API. */
async function clearInvestments(page: any) {
  await page.evaluate(async ({ url, key, sid }: any) => {
    const res = await fetch(`${url}/rest/v1/investments?session_id=eq.${sid}`, {
      method: 'DELETE',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
      },
    });
    if (!res.ok) throw new Error(`Investment delete failed: ${res.status}`);
  }, { url: SUPABASE_URL, key: API_KEY, sid: SESSION_ID });
}

test.describe('funding meter', () => {
  test('shows goal and per-startup funding during presentation stage', async ({ page }) => {
    await loginAs(page, { email: 'facilitator@test.com', role: 'facilitator', password: 'test123' });

    // Clear previous investments
    await clearInvestments(page);
    await page.reload();

    // Advance to startup-a's presentation (stage 1)
    await page.click('[data-testid="stage-next-btn"]');
    await expect(page.locator('[data-testid="funding-goal"]')).toContainText('Goal: $125K');

    // Funding amount should show $0 (no investments)
    await expect(page.locator('[data-testid="funding-amount"]')).toContainText('$0');
  });

  test('full-amount pledge fills meter to 100%', async ({ page }) => {
    await loginAs(page, { email: 'facilitator@test.com', role: 'facilitator', password: 'test123' });
    await clearInvestments(page);
    await page.reload();

    // Advance to startup-a's presentation
    await page.click('[data-testid="stage-next-btn"]');
    await expect(page.locator('[data-testid="funding-goal"]')).toBeVisible();

    // Insert investment equal to the full goal ($125K)
    await insertInvestment(page, {
      investorEmail: 'investor-1@test.com',
      investorName: 'Investor One',
      startupEmail: 'startup-a@test.com',
      startupName: 'AlphaTech',
      amount: 125000,
    });

    // Meter should show $125K and 100%
    await expect(async () => {
      const text = await page.locator('[data-testid="funding-amount"]').textContent();
      expect(text).toBe('$125K');
    }).toPass({ timeout: 10_000 });

    // Should NOT show oversubscription
    await expect(page.locator('[data-testid="oversubscribed-banner"]')).not.toBeVisible();
  });

  test('oversubscription banner appears when pledges exceed goal', async ({ page }) => {
    await loginAs(page, { email: 'facilitator@test.com', role: 'facilitator', password: 'test123' });
    await clearInvestments(page);
    await page.reload();

    // Advance to startup-a's presentation
    await page.click('[data-testid="stage-next-btn"]');
    await expect(page.locator('[data-testid="funding-goal"]')).toBeVisible();

    // Insert investment exceeding the goal
    await insertInvestment(page, {
      investorEmail: 'investor-1@test.com',
      investorName: 'Investor One',
      startupEmail: 'startup-a@test.com',
      startupName: 'AlphaTech',
      amount: 150000,
    });

    // Oversubscription banner should appear
    await expect(page.locator('[data-testid="oversubscribed-banner"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="oversubscribed-banner"]')).toContainText('Oversubscribed: $25K');
  });

  test('per-startup isolation — advancing to next startup resets meter', async ({ page }) => {
    await loginAs(page, { email: 'facilitator@test.com', role: 'facilitator', password: 'test123' });
    await clearInvestments(page);
    await page.reload();

    // Insert investment for startup-a only
    await insertInvestment(page, {
      investorEmail: 'investor-1@test.com',
      investorName: 'Investor One',
      startupEmail: 'startup-a@test.com',
      startupName: 'AlphaTech',
      amount: 50000,
    });

    // Advance to startup-a's presentation
    await page.click('[data-testid="stage-next-btn"]');
    await expect(async () => {
      const text = await page.locator('[data-testid="funding-amount"]').textContent();
      expect(text).toBe('$50K');
    }).toPass({ timeout: 10_000 });

    // Advance to startup-a's Q&A (stage 2), then to startup-b's presentation (stage 3)
    await page.click('[data-testid="stage-next-btn"]');
    await page.click('[data-testid="stage-next-btn"]');

    // Startup-b should show $0 (no investments for BetaCorp)
    await expect(page.locator('[data-testid="funding-amount"]')).toContainText('$0');
    // Goal should be BetaCorp's $200K
    await expect(page.locator('[data-testid="funding-goal"]')).toContainText('Goal: $200K');
  });

  test('funding goal update by startup propagates to facilitator in real time', async ({ browser }) => {
    const startupCtx = await browser.newContext();
    const facilitatorCtx = await browser.newContext();

    try {
      const startupPage = await startupCtx.newPage();
      const facilitatorPage = await facilitatorCtx.newPage();

      // Login both roles
      await loginAs(facilitatorPage, { email: 'facilitator@test.com', role: 'facilitator', password: 'test123' });
      await loginAs(startupPage, { email: 'startup-a@test.com', role: 'startup' });

      // Facilitator advances to AlphaTech's presentation stage
      await facilitatorPage.click('[data-testid="stage-next-btn"]');
      await expect(facilitatorPage.locator('[data-testid="funding-goal"]')).toContainText('Goal: $125K');

      // Startup edits their funding goal to $300K
      await startupPage.click('[data-testid="edit-startup-btn"]');
      await startupPage.fill('[data-testid="edit-funding-goal"]', '300000');
      await startupPage.click('[data-testid="save-startup-info-btn"]');

      // Facilitator should see the updated goal via Realtime
      await expect(facilitatorPage.locator('[data-testid="funding-goal"]')).toContainText('Goal: $300K', { timeout: 10_000 });

      // Reset funding goal back to original for other tests
      await startupPage.click('[data-testid="edit-startup-btn"]');
      await startupPage.fill('[data-testid="edit-funding-goal"]', '125000');
      await startupPage.click('[data-testid="save-startup-info-btn"]');
    } finally {
      await startupCtx.close();
      await facilitatorCtx.close();
    }
  });

  test('two near-simultaneous pledges update meter correctly', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();

    try {
      const page1 = await ctx1.newPage();
      const page2 = await ctx2.newPage();

      await loginAs(page1, { email: 'facilitator@test.com', role: 'facilitator', password: 'test123' });
      await clearInvestments(page1);
      await page1.reload();

      // Advance to startup-a's presentation
      await page1.click('[data-testid="stage-next-btn"]');
      await expect(page1.locator('[data-testid="funding-goal"]')).toBeVisible();

      // Login investor on page2 so we can make concurrent inserts
      await loginAs(page2, { email: 'investor-1@test.com', role: 'investor' });

      // Insert two investments concurrently from different pages
      await Promise.all([
        insertInvestment(page1, {
          investorEmail: 'investor-1@test.com',
          investorName: 'Investor One',
          startupEmail: 'startup-a@test.com',
          startupName: 'AlphaTech',
          amount: 30000,
        }),
        insertInvestment(page2, {
          investorEmail: 'investor-2@test.com',
          investorName: 'Investor Two',
          startupEmail: 'startup-a@test.com',
          startupName: 'AlphaTech',
          amount: 40000,
        }),
      ]);

      // Both pages should eventually show $70K (30K + 40K)
      for (const page of [page1, page2]) {
        await expect(async () => {
          const text = await page.locator('[data-testid="funding-amount"]').textContent();
          expect(text).toBe('$70K');
        }).toPass({ timeout: 10_000 });
      }
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });
});
