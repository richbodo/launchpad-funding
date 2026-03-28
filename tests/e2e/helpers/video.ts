import { Page, expect } from '@playwright/test';

/**
 * Wait for a real <video> element to appear within a DOM region and be playing.
 * LiveKit renders <video> tags via its VideoTrack component.
 */
export async function expectVideoPlaying(page: Page, selector: string, timeout = 15_000) {
  const videoLocator = page.locator(`${selector} video`);
  await expect(videoLocator).toBeVisible({ timeout });

  // Verify the video is actually receiving frames (not just a black box)
  const isPlaying = await videoLocator.evaluate((el: HTMLVideoElement) => {
    return el.readyState >= 2 && !el.paused && el.videoWidth > 0;
  });
  expect(isPlaying).toBe(true);
}

export async function expectNoVideo(page: Page, selector: string) {
  const count = await page.locator(`${selector} video`).count();
  expect(count).toBe(0);
}
