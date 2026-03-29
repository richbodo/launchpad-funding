import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';

test.describe('Take Stage — facilitator controls', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, { email: 'facilitator@test.com', role: 'facilitator', password: 'test123' });
    // Wait for stage label AND startups to load (stages rebuild when participant data arrives).
    // The stage label shows "Introduction" immediately, but we need startups loaded so
    // that clicking Next advances to a presentation stage rather than Outro.
    await expect(page.locator('[data-testid="stage-label"]')).toHaveText(/Introduction/, { timeout: 10_000 });
    // Wait for the facilitator pane to confirm participants have loaded
    await expect(page.locator('[data-testid^="facilitator-pane-"]')).toHaveCount(1, { timeout: 10_000 });
  });

  test('Take Stage button is NOT visible before call is started', async ({ page }) => {
    // During intro but call not started — no Take Stage buttons
    await expect(page.locator('[data-testid^="take-stage-btn-"]')).toHaveCount(0);
  });

  test('Take Stage button hidden during presentation stage', async ({ page }) => {
    // Advance to presentation stage
    await page.click('[data-testid="stage-next-btn"]');
    await expect(page.locator('[data-testid="stage-label"]')).toHaveText(/AlphaTech Presentation/);

    // Take Stage buttons should not be present
    await expect(page.locator('[data-testid^="take-stage-btn-"]')).toHaveCount(0);
  });

  test('center pane shows placeholder during intro, not startup video', async ({ page }) => {
    const mainPane = page.locator('[data-testid="main-video-pane"]');
    // Should show the stage label, not a startup name
    await expect(mainPane.locator('text=Introduction')).toBeVisible();
    await expect(mainPane.locator('text=Startup Presentation')).toHaveCount(0);
  });

  test('center pane shows placeholder during outro', async ({ page }) => {
    // Jump to outro via dropdown
    await page.click('[data-testid="stage-dropdown"]');
    await page.locator('[role="dialog"] button:has-text("Outro")').click();
    await expect(page.locator('[data-testid="stage-label"]')).toHaveText(/Outro/);

    const mainPane = page.locator('[data-testid="main-video-pane"]');
    await expect(mainPane.locator('text=Outro')).toBeVisible();
    await expect(mainPane.locator('text=Startup Presentation')).toHaveCount(0);
  });

  test('advancing from intro to presentation shows startup in center pane', async ({ page }) => {
    await page.click('[data-testid="stage-next-btn"]');
    await expect(page.locator('[data-testid="stage-label"]')).toHaveText(/AlphaTech Presentation/);

    const mainPane = page.locator('[data-testid="main-video-pane"]');
    await expect(mainPane.locator('text=AlphaTech')).toBeVisible();
    await expect(mainPane.locator('text=Startup Presentation')).toBeVisible();
  });
});
