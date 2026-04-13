import { test, expect } from '@playwright/test';

const API_BASE = 'http://localhost:3001';

test.describe('Test Case 4: Prometheus Metrics & Observability', () => {
  test('GET /metrics returns Prometheus metrics with custom Finch metrics', async ({ request }) => {
    const res = await request.get('http://localhost:9464/metrics');
    expect(res.status()).toBe(200);
    const body = await res.text();

    // Verify all 5 custom Finch metrics are registered
    expect(body).toContain('finch_gate_fires_total');
    expect(body).toContain('finch_llm_tokens_total');
    expect(body).toContain('finch_phase_duration_seconds');
    expect(body).toContain('finch_rule_violations_total');
    expect(body).toContain('finch_memory_query_ms');
  });

  test('API health endpoint is accessible without auth', async ({ request }) => {
    const res = await request.get(`${API_BASE}/health`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  test('POST /api/auth/refresh returns new tokens', async ({ request }) => {
    // Login first
    const loginRes = await request.post(`${API_BASE}/api/auth/login`, {
      data: { email: 'admin@finch.local', password: 'finch-dev-password' },
    });
    expect(loginRes.status()).toBe(200);

    // Refresh tokens
    const refreshRes = await request.post(`${API_BASE}/api/auth/refresh`);
    expect(refreshRes.status()).toBe(200);
    const refreshCookies = refreshRes.headers()['set-cookie'];
    expect(refreshCookies).toBeDefined();
    expect(refreshCookies).toContain('access_token');
  });
});
