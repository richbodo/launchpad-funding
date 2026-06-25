import { test, expect } from '@playwright/test';

/**
 * Regression guard for the white-on-white email-input bug on /event/:slug
 * (the public landing page). The dark-glass signup Card sets `text-white`,
 * which would cascade into <Input> and render typed text invisible on the
 * input's white background. This test mocks the event-landing endpoint
 * (no DB seed required) and asserts that:
 *
 *   1. After typing, the input's value matches what we typed
 *   2. The computed color of the input text differs from its background,
 *      i.e. typed characters are actually visible
 */
test.describe('event landing page — signup form', () => {
  test('typed email is visible (text color contrasts with input background)', async ({ page }) => {
    await page.route('**/functions/v1/event-landing**', async (route) => {
      const payload = {
        session: {
          id: 's1',
          name: 'Visible Text Demo',
          description: 'Regression test for input contrast.',
          start_time: new Date(Date.now() + 86_400_000).toISOString(),
          end_time: new Date(Date.now() + 90_000_000).toISOString(),
          timezone: 'UTC',
          status: 'scheduled',
          slug: 'visible-text-demo',
          hero_image_url: null,
          max_attendees: 100,
          is_full: false,
        },
        startups: [],
        facilitators: [],
        approved_attendee_count: 0,
        accepting_signups: true,
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(payload),
      });
    });

    await page.goto('/event/visible-text-demo');

    const email = page.locator('#event-email');
    await expect(email).toBeVisible();

    await email.fill('visible@example.com');
    await expect(email).toHaveValue('visible@example.com');

    // Compute the actual rendered text color vs the input background and
    // assert they aren't identical. If text-foreground gets stripped, both
    // resolve to white and this fails — exactly the regression we hit.
    const { color, bg } = await email.evaluate((el) => {
      const cs = window.getComputedStyle(el);
      return { color: cs.color, bg: cs.backgroundColor };
    });

    expect(color).not.toBe(bg);
    expect(color).not.toBe('rgb(255, 255, 255)');
    expect(color).not.toBe('rgba(0, 0, 0, 0)');
  });
});
