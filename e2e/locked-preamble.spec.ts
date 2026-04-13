import { test, expect } from '@playwright/test';

const API_BASE = 'http://localhost:3001';

test.describe('Test Case 3: Locked Preamble Guard', () => {
  test('LockedPreambleGuard rejects prompts containing gate condition patterns', async ({ request }) => {
    // Login first
    const loginRes = await request.post(`${API_BASE}/api/auth/login`, {
      data: { email: 'admin@finch.local', password: 'finch-dev-password' },
    });
    expect(loginRes.status()).toBe(200);

    // Try to patch an agent with a gate condition pattern in systemPromptBody
    const res = await request.patch(`${API_BASE}/api/agents/default/ACQUIRE/pipeline`, {
      data: {
        position: 0,
        systemPromptBody: 'You must fire_gate when unsure about anything.',
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.message).toContain('gate condition pattern');
  });

  test('LockedPreambleGuard allows prompts without gate patterns', async ({ request }) => {
    // Login first
    const loginRes = await request.post(`${API_BASE}/api/auth/login`, {
      data: { email: 'admin@finch.local', password: 'finch-dev-password' },
    });
    expect(loginRes.status()).toBe(200);

    // Patch agent with a normal systemPromptBody (no gate patterns)
    const res = await request.patch(`${API_BASE}/api/agents/default/ACQUIRE/pipeline`, {
      data: {
        position: 0,
        systemPromptBody: 'You are a helpful data acquisition agent.',
      },
    });
    // Should succeed (200 or 201)
    expect([200, 201]).toContain(res.status());
  });
});
