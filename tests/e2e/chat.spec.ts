import { test, expect, BrowserContext } from '@playwright/test';
import { loginAs } from './helpers/auth';

test.describe('live chat', () => {
  let facilitatorContext: BrowserContext;
  let startupContext: BrowserContext;
  let investorContext: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    facilitatorContext = await browser.newContext();
    startupContext = await browser.newContext();
    investorContext = await browser.newContext();

    // Login all three users
    const facilitatorPage = await facilitatorContext.newPage();
    await loginAs(facilitatorPage, { email: 'facilitator@test.com', role: 'facilitator', password: 'test123' });

    const startupPage = await startupContext.newPage();
    await loginAs(startupPage, { email: 'startup-a@test.com', role: 'startup' });

    const investorPage = await investorContext.newPage();
    await loginAs(investorPage, { email: 'investor-1@test.com', role: 'investor' });
  });

  test.afterAll(async () => {
    await facilitatorContext?.close();
    await startupContext?.close();
    await investorContext?.close();
  });

  test('facilitator sends message → appears in all three contexts', async () => {
    const facilitatorPage = facilitatorContext.pages()[0];
    const startupPage = startupContext.pages()[0];
    const investorPage = investorContext.pages()[0];

    const message = `Hello from facilitator ${Date.now()}`;

    await facilitatorPage.fill('[data-testid="chat-input"]', message);
    await facilitatorPage.click('[data-testid="chat-send-btn"]');

    // Verify message appears in all three contexts
    for (const page of [facilitatorPage, startupPage, investorPage]) {
      await expect(
        page.locator('[data-testid="chat-message-list"]').locator(`text=${message}`)
      ).toBeVisible({ timeout: 10_000 });
    }
  });

  test('startup sends message → appears in all three contexts', async () => {
    const facilitatorPage = facilitatorContext.pages()[0];
    const startupPage = startupContext.pages()[0];
    const investorPage = investorContext.pages()[0];

    const message = `Hello from startup ${Date.now()}`;

    await startupPage.fill('[data-testid="chat-input"]', message);
    await startupPage.click('[data-testid="chat-send-btn"]');

    for (const page of [facilitatorPage, startupPage, investorPage]) {
      await expect(
        page.locator('[data-testid="chat-message-list"]').locator(`text=${message}`)
      ).toBeVisible({ timeout: 10_000 });
    }
  });

  test('investor sends message → appears in all three contexts', async () => {
    const facilitatorPage = facilitatorContext.pages()[0];
    const startupPage = startupContext.pages()[0];
    const investorPage = investorContext.pages()[0];

    const message = `Hello from investor ${Date.now()}`;

    await investorPage.fill('[data-testid="chat-input"]', message);
    await investorPage.click('[data-testid="chat-send-btn"]');

    for (const page of [facilitatorPage, startupPage, investorPage]) {
      await expect(
        page.locator('[data-testid="chat-message-list"]').locator(`text=${message}`)
      ).toBeVisible({ timeout: 10_000 });
    }
  });
});
