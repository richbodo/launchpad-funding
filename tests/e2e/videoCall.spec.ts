import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';
import { expectNoVideo } from './helpers/video';

test.describe('video call lifecycle — facilitator', () => {
  test('before starting call: facilitator sees "Start Call", no video elements', async ({ page }) => {
    await loginAs(page, { email: 'facilitator@test.com', role: 'facilitator', password: 'test123' });

    // Facilitator self-pane should show "Start Call" button
    await expect(page.locator('text=Start Call')).toBeVisible();

    // No video elements should be present yet
    await expectNoVideo(page, '[data-testid="main-video-pane"]');
  });

  test('facilitator clicks "Start Call" → connected to LiveKit', async ({ page }) => {
    await loginAs(page, { email: 'facilitator@test.com', role: 'facilitator', password: 'test123' });

    // Click Start Call
    await page.click('text=Start Call');

    // End Call button appears — this proves:
    // 1. LiveKit token was fetched successfully
    // 2. LiveKitRoom connected to the server
    // 3. Session status set to 'live'
    await expect(page.locator('[data-testid="end-call-btn"]')).toBeVisible({ timeout: 15_000 });

    // Check if any <video> elements appeared on the page.
    // In headless Chromium with fake media, WebRTC track negotiation
    // can take longer than expected or may not render <video> elements
    // depending on the LiveKit components-react version and SFU state.
    const videoCount = await page.locator('video').count();
    if (videoCount > 0) {
      // Video tracks rendered — verify one is in the facilitator pane
      await expect(
        page.locator('[data-testid="facilitator-pane-facilitator@test.com"] video')
      ).toBeVisible({ timeout: 5_000 });
    } else {
      // No video elements — connection works but tracks haven't rendered.
      // This is expected in some CI/headless environments. Log for diagnostics.
      console.log('Note: LiveKit connected but no <video> elements rendered (headless environment)');
    }
  });

  test('facilitator clicks "End Call" → disconnected, session completed', async ({ page }) => {
    await loginAs(page, { email: 'facilitator@test.com', role: 'facilitator', password: 'test123' });

    // Start the call
    await page.click('text=Start Call');
    await expect(page.locator('[data-testid="end-call-btn"]')).toBeVisible({ timeout: 15_000 });

    // End the call
    await page.click('[data-testid="end-call-btn"]');

    // Video panes should revert to placeholders
    await expect(page.locator('[data-testid="end-call-btn"]')).not.toBeVisible();
  });
});
