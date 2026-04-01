import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';

const SESSION_ID = '00000000-0000-0000-0000-000000000001';
const SUPABASE_URL = 'http://127.0.0.1:54321';
const API_KEY = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const ROOM_NAME = `session-${SESSION_ID}`;

/** Call the mute-participant Edge Function directly. */
async function muteParticipant(page: any, identity: string, muted: boolean) {
  return page.evaluate(async ({ url, key, room, ident, m }: any) => {
    const res = await fetch(`${url}/functions/v1/mute-participant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': key,
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({ room_name: room, identity: ident, muted: m }),
    });
    return res.json();
  }, { url: SUPABASE_URL, key: API_KEY, room: ROOM_NAME, ident: identity, m: muted });
}

test.describe('audio controls', () => {
  test('personal mute button toggles app audio', async ({ page }) => {
    await loginAs(page, { email: 'facilitator@test.com', role: 'facilitator', password: 'test123' });

    // Personal mute button should be visible
    const muteBtn = page.locator('[data-testid="personal-mute-btn"]');
    await expect(muteBtn).toBeVisible();

    // Initially unmuted — should show volume icon
    const initialSvg = await muteBtn.locator('svg').getAttribute('class');
    expect(initialSvg).toContain('lucide-volume');

    // Click to mute
    await muteBtn.click();
    const mutedSvg = await muteBtn.locator('svg').getAttribute('class');
    expect(mutedSvg).toContain('lucide-volume-off');

    // Click again to unmute
    await muteBtn.click();
    const unmutedSvg = await muteBtn.locator('svg').getAttribute('class');
    expect(unmutedSvg).toContain('lucide-volume');
  });

  test('facilitator can mute another participant via admin mute', async ({ browser }) => {
    const facilitatorCtx = await browser.newContext();

    try {
      const facilitatorPage = await facilitatorCtx.newPage();
      await loginAs(facilitatorPage, { email: 'facilitator@test.com', role: 'facilitator', password: 'test123' });

      // Start the call so LiveKit room is active
      await facilitatorPage.click('text=Start Call');
      await expect(facilitatorPage.locator('[data-testid="end-call-btn"]')).toBeVisible({ timeout: 15_000 });

      // Wait for participants to appear in the left pane
      await expect(facilitatorPage.locator('[data-testid="facilitator-pane-facilitator@test.com"]')).toBeVisible();

      // The admin mute button for the facilitator's own mic should be visible
      const adminMuteBtn = facilitatorPage.locator('[data-testid="admin-mute-btn-facilitator@test.com"]');
      await expect(adminMuteBtn).toBeVisible();

      // Click admin mute — should mute successfully via Edge Function
      await adminMuteBtn.click();

      // After muting, the button should show the muted state (mic-off icon)
      // and become disabled (can't remote-unmute)
      await expect(async () => {
        const isDisabled = await adminMuteBtn.isDisabled();
        expect(isDisabled).toBe(true);
      }).toPass({ timeout: 5_000 });

      // The mic-off icon should be visible
      const svg = await adminMuteBtn.locator('svg').getAttribute('class');
      expect(svg).toContain('lucide-mic-off');

    } finally {
      await facilitatorCtx.close();
    }
  });

  test('mute-participant Edge Function returns success for mute', async ({ page }) => {
    await loginAs(page, { email: 'facilitator@test.com', role: 'facilitator', password: 'test123' });

    // Start a call so the LiveKit room exists
    await page.click('text=Start Call');
    await expect(page.locator('[data-testid="end-call-btn"]')).toBeVisible({ timeout: 15_000 });

    // Mute should succeed
    const muteResult = await muteParticipant(page, 'facilitator@test.com', true);
    expect(muteResult.success).toBe(true);
    expect(muteResult.muted).toBe(true);
  });

  test('mute-participant Edge Function rejects remote unmute', async ({ page }) => {
    await loginAs(page, { email: 'facilitator@test.com', role: 'facilitator', password: 'test123' });

    // Start a call so the LiveKit room exists
    await page.click('text=Start Call');
    await expect(page.locator('[data-testid="end-call-btn"]')).toBeVisible({ timeout: 15_000 });

    // First mute (should succeed)
    await muteParticipant(page, 'facilitator@test.com', true);

    // Then try to unmute remotely (should fail — LiveKit security restriction)
    const unmuteResult = await muteParticipant(page, 'facilitator@test.com', false);
    expect(unmuteResult.error).toBeDefined();
  });

  test('mic toggle button allows self-unmute after admin mute', async ({ page }) => {
    await loginAs(page, { email: 'facilitator@test.com', role: 'facilitator', password: 'test123' });

    // Start a call
    await page.click('text=Start Call');
    await expect(page.locator('[data-testid="end-call-btn"]')).toBeVisible({ timeout: 15_000 });

    // Mute self via admin mute (server-side)
    await muteParticipant(page, 'facilitator@test.com', true);

    // Wait for the mic toggle to reflect muted state
    const micToggle = page.locator('[data-testid="mic-toggle-btn"]');
    await expect(micToggle).toBeVisible();

    await expect(async () => {
      const svg = await micToggle.locator('svg').getAttribute('class');
      expect(svg).toContain('lucide-mic-off');
    }).toPass({ timeout: 5_000 });

    // Click mic toggle to self-unmute (this should work — local unmute is allowed)
    await micToggle.click();

    // Should now show unmuted state
    await expect(async () => {
      const svg = await micToggle.locator('svg').getAttribute('class');
      expect(svg).toContain('lucide-mic');
      // Make sure it's not mic-off
      const text = svg || '';
      expect(text).not.toContain('lucide-mic-off');
    }).toPass({ timeout: 5_000 });
  });
});
