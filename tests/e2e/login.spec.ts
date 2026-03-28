import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';

test.describe('login flows', () => {
  test('investor logs in with known email → reaches /session/:id', async ({ page }) => {
    await loginAs(page, { email: 'investor-1@test.com', role: 'investor' });
    await expect(page).toHaveURL(/\/session\//);
    // Verify session page loaded — funding meter is always visible
    await expect(page.locator('text=Funds Committed')).toBeVisible();
  });

  test('startup logs in with known email → reaches /session/:id', async ({ page }) => {
    await loginAs(page, { email: 'startup-a@test.com', role: 'startup' });
    await expect(page).toHaveURL(/\/session\//);
    await expect(page.locator('text=Funds Committed')).toBeVisible();
  });

  test('facilitator logs in with correct password → reaches /session/:id', async ({ page }) => {
    await loginAs(page, { email: 'facilitator@test.com', role: 'facilitator', password: 'test123' });
    await expect(page).toHaveURL(/\/session\//);
    await expect(page.locator('text=Funds Committed')).toBeVisible();
  });

  test('facilitator login fails with wrong password → stays on login', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('[data-testid="session-name"]')).toBeVisible({ timeout: 10_000 });
    await page.fill('#email', 'facilitator@test.com');
    await page.click('[data-testid="role-btn-facilitator"]');
    await expect(page.locator('#password')).toBeVisible();
    await page.fill('#password', 'wrongpassword');
    await page.click('[data-testid="password-submit-btn"]');

    // Should stay on login page — toast error appears
    await expect(page).toHaveURL(/\/login/);
  });

  test('unregistered email → toast error, stays on login', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('[data-testid="session-name"]')).toBeVisible({ timeout: 10_000 });
    await page.fill('#email', 'nobody@unknown.com');
    await page.click('[data-testid="role-btn-investor"]');

    // Should stay on login page
    await expect(page).toHaveURL(/\/login/);
  });
});
