import { Page, expect } from '@playwright/test';

export async function loginAs(page: Page, opts: {
  email: string;
  role: 'investor' | 'startup' | 'facilitator';
  password?: string;
}) {
  await page.goto('/login');

  // Wait for session to load (the login page fetches active sessions on mount)
  await expect(page.locator('[data-testid="session-name"]')).toBeVisible({ timeout: 10_000 });

  // Enter email
  await page.fill('#email', opts.email);

  // Click role button to submit
  await page.click(`[data-testid="role-btn-${opts.role}"]`);

  // Facilitator has a password step (skipped in demo mode).
  // Race: either the password field appears or we navigate straight through.
  if (opts.role === 'facilitator') {
    const passwordVisible = page.locator('#password');
    const navigated = page.waitForURL(/\/session\//, { timeout: 10_000 });

    const result = await Promise.race([
      passwordVisible.waitFor({ state: 'visible', timeout: 5_000 }).then(() => 'password' as const),
      navigated.then(() => 'navigated' as const),
    ]);

    if (result === 'password') {
      await page.fill('#password', opts.password!);
      await page.click('[data-testid="password-submit-btn"]');
    }
  }

  // Wait for navigation to session page
  await page.waitForURL(/\/session\//, { timeout: 10_000 });
}
