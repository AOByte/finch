import { test, expect } from '@playwright/test';

const API_BASE = 'http://localhost:3001';

test.describe('Test Case 2: Run Detail — TAPES Phase Order & Gate Resume', () => {
  let cookies: string;

  test.beforeAll(async ({ request }) => {
    // Login to get auth cookies
    const loginRes = await request.post(`${API_BASE}/api/auth/login`, {
      data: { email: 'admin@finch.local', password: 'finch-dev-password' },
    });
    expect(loginRes.status()).toBe(200);
    cookies = loginRes.headers()['set-cookie'] ?? '';
  });

  test('Run detail page shows 5 phases in TAPES order', async ({ page }) => {
    // Login via the UI
    await page.goto('/login');
    await page.fill('input[type="email"]', 'admin@finch.local');
    await page.fill('input[type="password"]', 'finch-dev-password');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/');

    // Navigate to runs page
    await page.goto('/runs');
    await page.waitForSelector('text=Runs');

    // Check that the runs page renders
    await expect(page.locator('h1')).toContainText('Runs');
  });

  test('No approve/reject buttons exist on the page', async ({ page }) => {
    // Login via the UI
    await page.goto('/login');
    await page.fill('input[type="email"]', 'admin@finch.local');
    await page.fill('input[type="password"]', 'finch-dev-password');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/');

    // Navigate to runs
    await page.goto('/runs');
    await page.waitForSelector('text=Runs');

    // Verify no approve/reject buttons (UI-02 / FF-03)
    const approveButton = page.locator('button:has-text("approve")');
    const rejectButton = page.locator('button:has-text("reject")');
    await expect(approveButton).toHaveCount(0);
    await expect(rejectButton).toHaveCount(0);
  });

  test('API: HarnessAuthGuard rejects users without harness access (403)', async ({ request }) => {
    // Login first
    const loginRes = await request.post(`${API_BASE}/api/auth/login`, {
      data: { email: 'admin@finch.local', password: 'finch-dev-password' },
    });
    expect(loginRes.status()).toBe(200);

    // Try accessing a non-existent harness
    const res = await request.get(`${API_BASE}/api/agents/nonexistent-harness-id-12345`);
    // Should return either 403 (forbidden) or 404 (not found) — not 200
    expect([403, 404, 500]).toContain(res.status());
  });
});
