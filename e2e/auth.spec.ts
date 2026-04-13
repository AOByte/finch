import { test, expect } from '@playwright/test';

const API_BASE = 'http://localhost:3001';

test.describe('Test Case 1: Authentication Flow', () => {
  test('POST /api/auth/login with valid credentials returns 200 + Set-Cookie', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/auth/login`, {
      data: { email: 'admin@finch.local', password: 'finch-dev-password' },
    });
    expect(res.status()).toBe(200);
    const cookies = res.headers()['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies).toContain('access_token');
  });

  test('POST /api/auth/login with invalid credentials returns 401', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/auth/login`, {
      data: { email: 'admin@finch.local', password: 'wrong-password' },
    });
    expect(res.status()).toBe(401);
  });

  test('Unauthenticated request to /api/runs returns 401', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/runs?harnessId=default`);
    expect(res.status()).toBe(401);
  });

  test('Login page renders at /login', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('text=Finch Login')).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('Unauthenticated user is redirected to /login', async ({ page }) => {
    await page.goto('/runs');
    await page.waitForURL('**/login');
    await expect(page.locator('text=Finch Login')).toBeVisible();
  });
});
