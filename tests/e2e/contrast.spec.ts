import { test, expect, Page } from '@playwright/test';
import { loginAs } from './helpers/auth';
import { assertReadable, assertHasVisibleContent } from './helpers/visual';

/**
 * Contrast / readability sweep.
 *
 * Catches the bug class we keep hitting: a parent sets `text-white` (or a
 * theme token flips, or Tailwind purges a className) and a child element
 * becomes invisible against its background. These tests render the screens
 * users actually use, type into the inputs, and assert WCAG-AA contrast
 * against the effective rendered background.
 *
 * The /event/:slug specs mock the edge function so they run without any
 * backend seed. The /login and authenticated specs use the seeded local
 * Supabase that other e2e tests already rely on.
 */

const LANDING_PAYLOAD = {
  session: {
    id: 's1',
    name: 'Contrast Sweep Demo',
    description: 'Used by visual regression tests.',
    start_time: new Date(Date.now() + 86_400_000).toISOString(),
    end_time: new Date(Date.now() + 90_000_000).toISOString(),
    timezone: 'UTC',
    status: 'scheduled',
    slug: 'contrast-sweep',
    hero_image_url: null,
    max_attendees: 100,
    is_full: false,
  },
  startups: [],
  facilitators: [{ email: 'fac@example.com', display_name: 'Fac', image_url: null, bio: null }],
  approved_attendee_count: 0,
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

test.describe('contrast sweep — event landing', () => {
  test('email input text is readable after typing', async ({ page }) => {
    await mockLanding(page);
    await page.goto('/event/contrast-sweep');
    const email = page.locator('#event-email');
    await expect(email).toBeVisible();
    await email.fill('readability@example.com');
    await assertReadable(email, { label: 'event-email input' });
    await assertHasVisibleContent(email);
  });

  test('name input text is readable after typing', async ({ page }) => {
    await mockLanding(page);
    await page.goto('/event/contrast-sweep');
    const name = page.locator('#event-name');
    await expect(name).toBeVisible();
    await name.fill('Visible Person');
    await assertReadable(name, { label: 'event-name input' });
    await assertHasVisibleContent(name);
  });

  test('"Report an issue" mailto link is readable', async ({ page }) => {
    await mockLanding(page);
    await page.goto('/event/contrast-sweep');
    const link = page.locator('a[href^="mailto:"]').first();
    await expect(link).toBeVisible();
    // Mailto links sit on the glassy hero — must stay legible.
    await assertReadable(link, { label: 'report-an-issue mailto link', minRatio: 3 });
  });

  test('submit button label is readable', async ({ page }) => {
    await mockLanding(page);
    await page.goto('/event/contrast-sweep');
    const btn = page.locator('form[data-testid="event-signup-form"] button[type="submit"]');
    await expect(btn).toBeVisible();
    await assertReadable(btn, { label: 'signup submit button', minRatio: 3 });
  });
});

test.describe('contrast sweep — login', () => {
  test('email input text is readable after typing', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('[data-testid="session-name"]')).toBeVisible({ timeout: 10_000 });
    const email = page.locator('#email');
    await email.fill('login-readable@example.com');
    await assertReadable(email, { label: 'login email input' });
    await assertHasVisibleContent(email);
  });

  test('facilitator password input text is readable after typing', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('[data-testid="session-name"]')).toBeVisible({ timeout: 10_000 });
    await page.fill('#email', 'facilitator@test.com');
    await page.click('[data-testid="role-btn-facilitator"]');
    const pwd = page.locator('#password');
    await expect(pwd).toBeVisible();
    await pwd.fill('correcthorsebatterystaple');
    await assertReadable(pwd, { label: 'login password input' });
    await assertHasVisibleContent(pwd);
  });

  test('role button labels are readable', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('[data-testid="session-name"]')).toBeVisible({ timeout: 10_000 });
    for (const role of ['investor', 'startup', 'facilitator'] as const) {
      const btn = page.locator(`[data-testid="role-btn-${role}"]`);
      await expect(btn).toBeVisible();
      await assertReadable(btn, { label: `role button: ${role}`, minRatio: 3 });
    }
  });
});

test.describe('contrast sweep — authenticated session view', () => {
  test('funding meter amount is readable', async ({ page }) => {
    await loginAs(page, { email: 'investor-1@test.com', role: 'investor' });
    const amount = page.locator('[data-testid="funding-amount"]');
    await expect(amount).toBeVisible({ timeout: 10_000 });
    await assertReadable(amount, { label: 'funding amount' });
  });

  test('chat send button is readable', async ({ page }) => {
    await loginAs(page, { email: 'investor-1@test.com', role: 'investor' });
    const sendBtn = page.locator('[data-testid="chat-send-btn"]');
    await expect(sendBtn).toBeVisible({ timeout: 10_000 });
    await assertReadable(sendBtn, { label: 'chat send button', minRatio: 3 });
  });

  test('stage label text is readable', async ({ page }) => {
    await loginAs(page, { email: 'investor-1@test.com', role: 'investor' });
    const stage = page.locator('[data-testid="stage-label"]');
    await expect(stage).toBeVisible({ timeout: 10_000 });
    await assertReadable(stage, { label: 'stage label' });
  });
});
