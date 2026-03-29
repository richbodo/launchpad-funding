import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';

test.describe('stage flow — facilitator perspective', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, { email: 'facilitator@test.com', role: 'facilitator', password: 'test123' });
    // Wait for startups to load — stages rebuild when participant data arrives.
    // Without this, clicking Next before load can advance to "Outro" instead of
    // the first presentation stage, then reset back to "Introduction" when data loads.
    // We check the stage label includes "Introduction" (always present) AND that the
    // facilitator pane has loaded (confirms participant data has arrived).
    await expect(page.locator('[data-testid="stage-label"]')).toHaveText(/Introduction/, { timeout: 10_000 });
    await expect(page.locator('[data-testid^="facilitator-pane-"]')).toHaveCount(1, { timeout: 10_000 });
  });

  test('initial state: stage label shows "Stage 1 — Introduction"', async ({ page }) => {
    await expect(page.locator('[data-testid="stage-label"]')).toHaveText(/Stage 1 — Introduction/);
  });

  test('Previous button is disabled at first stage', async ({ page }) => {
    await expect(page.locator('[data-testid="stage-prev-btn"]')).toBeDisabled();
  });

  test('click Next → label changes to "Stage 2 — AlphaTech Presentation"', async ({ page }) => {
    await page.click('[data-testid="stage-next-btn"]');
    await expect(page.locator('[data-testid="stage-label"]')).toHaveText(/Stage 2 — AlphaTech Presentation/);
  });

  test('click Next through stages and Previous returns correctly', async ({ page }) => {
    // Next → Stage 2 (AlphaTech Presentation)
    await page.click('[data-testid="stage-next-btn"]');
    await expect(page.locator('[data-testid="stage-label"]')).toHaveText(/AlphaTech Presentation/);

    // Next → Stage 3 (AlphaTech Q&A)
    await page.click('[data-testid="stage-next-btn"]');
    await expect(page.locator('[data-testid="stage-label"]')).toHaveText(/AlphaTech Q&A/);

    // Next → Stage 4 (BetaCorp Presentation)
    await page.click('[data-testid="stage-next-btn"]');
    await expect(page.locator('[data-testid="stage-label"]')).toHaveText(/BetaCorp Presentation/);

    // Previous → back to Stage 3
    await page.click('[data-testid="stage-prev-btn"]');
    await expect(page.locator('[data-testid="stage-label"]')).toHaveText(/AlphaTech Q&A/);
  });

  test('Next button is disabled at last stage', async ({ page }) => {
    // Navigate to last stage via stage dropdown
    await page.click('[data-testid="stage-dropdown"]');
    // Click the last stage in the dialog (Outro)
    const stageButtons = page.locator('[role="dialog"] button:has-text("Outro")');
    await stageButtons.click();

    await expect(page.locator('[data-testid="stage-next-btn"]')).toBeDisabled();
  });

  test('Pause/Play toggle works', async ({ page }) => {
    // Initially paused — button shows "Play"
    await expect(page.locator('[data-testid="stage-playpause-btn"]')).toHaveText(/Play/);

    // Click to play
    await page.click('[data-testid="stage-playpause-btn"]');
    await expect(page.locator('[data-testid="stage-playpause-btn"]')).toHaveText(/Pause/);

    // Click to pause again
    await page.click('[data-testid="stage-playpause-btn"]');
    await expect(page.locator('[data-testid="stage-playpause-btn"]')).toHaveText(/Play/);
  });

  test('stage dropdown lists all stages; selecting one jumps directly', async ({ page }) => {
    await page.click('[data-testid="stage-dropdown"]');

    // Verify all stages appear in the dialog
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog.locator('text=Introduction')).toBeVisible();
    await expect(dialog.locator('text=AlphaTech Presentation')).toBeVisible();
    await expect(dialog.locator('text=AlphaTech Q&A')).toBeVisible();
    await expect(dialog.locator('text=BetaCorp Presentation')).toBeVisible();
    await expect(dialog.locator('text=BetaCorp Q&A')).toBeVisible();
    await expect(dialog.locator('text=Outro')).toBeVisible();

    // Select BetaCorp Presentation directly
    await dialog.locator('button:has-text("BetaCorp Presentation")').click();
    await expect(page.locator('[data-testid="stage-label"]')).toHaveText(/BetaCorp Presentation/);
  });
});
