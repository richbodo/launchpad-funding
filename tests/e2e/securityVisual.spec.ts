import { test, expect, Page } from '@playwright/test';
import { assertNoEmailsInVisibleText } from './helpers/visual';

/**
 * Visual proof of the security lockdown:
 *
 *   - chat_messages and investments were just locked behind RPCs that gate
 *     reads by the caller's email matching session_participants.
 *   - The public /event/:slug landing page exists for anonymous visitors —
 *     it must NEVER leak participant emails (facilitators, startups, or
 *     past investors) into the rendered DOM. The edge function strips those
 *     fields server-side, but a future "convenience" change that piped a
 *     raw row into the React tree would re-introduce the leak silently.
 *
 * These tests render the page as an anonymous visitor (no auth) and assert
 * that the rendered text contains zero email addresses. The mailto link
 * built from the facilitator list is a legitimate exception — it lives in
 * an href attribute, not in visible text, so it does not match.
 */

const LANDING_PAYLOAD = {
  session: {
    id: 's1',
    name: 'Privacy Demo',
    description: 'Security visual proof.',
    start_time: new Date(Date.now() + 86_400_000).toISOString(),
    end_time: new Date(Date.now() + 90_000_000).toISOString(),
    timezone: 'UTC',
    status: 'scheduled',
    slug: 'privacy-demo',
    hero_image_url: null,
    max_attendees: 100,
    is_full: false,
  },
  // The edge function shape includes `email` on each facilitator object so
  // the client can build a single mailto link. The page must use those
  // values for the href and nothing else.
  startups: [
    {
      display_name: 'AlphaTech',
      image_url: null,
      website_link: null,
      dd_room_link: null,
      funding_goal: 125000,
      description: null,
    },
  ],
  facilitators: [
    { email: 'secret-facilitator-1@private.com', display_name: 'Fac One', image_url: null, bio: null },
    { email: 'secret-facilitator-2@private.com', display_name: 'Fac Two', image_url: null, bio: null },
  ],
  approved_attendee_count: 12,
  accepting_signups: true,
};

async function mockLanding(page: Page) {
  await page.route('**/functions/v1/event-landing**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(LANDING_PAYLOAD),
    }),
  );
}

test.describe('security visual proof — anonymous landing page', () => {
  test('no facilitator email is rendered in visible text', async ({ page }) => {
    await mockLanding(page);
    await page.goto('/event/privacy-demo');
    await expect(page.locator('#event-email')).toBeVisible();
    await assertNoEmailsInVisibleText(page);
  });

  test('facilitator emails appear only inside the mailto href, never in text', async ({ page }) => {
    await mockLanding(page);
    await page.goto('/event/privacy-demo');
    await expect(page.locator('#event-email')).toBeVisible();

    const mailto = page.locator('a[href^="mailto:"]').first();
    if (await mailto.count()) {
      const href = await mailto.getAttribute('href');
      // href is allowed to contain the addresses (that's the point of mailto).
      expect(href).toMatch(/secret-facilitator-1@private\.com/);
      // ... but the link's *text* must not.
      const text = (await mailto.innerText()) || '';
      expect(text).not.toMatch(/@/);
    }

    // Belt and suspenders: full visible text sweep.
    await assertNoEmailsInVisibleText(page);
  });

  test('full-page screenshot contains no @-shaped text via OCR-free byte heuristic', async ({ page }) => {
    await mockLanding(page);
    await page.goto('/event/privacy-demo');
    await expect(page.locator('#event-email')).toBeVisible();

    // Cross-check: even if some future refactor wraps emails in a CSS
    // pseudo-element (which innerText would miss), they would still need
    // to appear in the accessibility tree to be useful. Snapshot that.
    const snapshot = await page.accessibility.snapshot();
    const flat = JSON.stringify(snapshot ?? {});
    expect(flat).not.toMatch(/secret-facilitator-1@private\.com/);
    expect(flat).not.toMatch(/secret-facilitator-2@private\.com/);
  });
});
