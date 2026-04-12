import { describe, it, expect, vi } from 'vitest';
import { OAuthController } from '../../src/oauth/oauth.controller';

describe('OAuthController', () => {
  function makeMocks() {
    const mockOAuthService = {
      generateAuthUrl: vi.fn().mockResolvedValue({ url: 'https://figma.com/oauth?state=abc', state: 'abc' }),
    };
    const mockProviderRegistry = {
      listProviders: vi.fn().mockReturnValue([
        { providerId: 'figma', displayName: 'Figma', supportsPKCE: true, scopes: ['files:read'] },
        { providerId: 'github', displayName: 'GitHub', supportsPKCE: false, scopes: ['repo'] },
      ]),
    };
    return { mockOAuthService, mockProviderRegistry };
  }

  it('listProviders returns provider summaries', () => {
    const mocks = makeMocks();
    const controller = new OAuthController(mocks.mockOAuthService as never, mocks.mockProviderRegistry as never);
    const result = controller.listProviders();
    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toEqual({ providerId: 'figma', displayName: 'Figma', supportsPKCE: true });
    expect(result.data[1]).toEqual({ providerId: 'github', displayName: 'GitHub', supportsPKCE: false });
  });

  it('authorize redirects to provider URL', async () => {
    const mocks = makeMocks();
    const controller = new OAuthController(mocks.mockOAuthService as never, mocks.mockProviderRegistry as never);
    const mockRes = { status: vi.fn().mockReturnThis(), json: vi.fn(), redirect: vi.fn() };
    await controller.authorize('figma', 'harness-1', mockRes as never);
    expect(mocks.mockOAuthService.generateAuthUrl).toHaveBeenCalledWith('figma', 'harness-1');
    expect(mockRes.redirect).toHaveBeenCalledWith('https://figma.com/oauth?state=abc');
  });

  it('authorize returns 400 when harnessId is missing', async () => {
    const mocks = makeMocks();
    const controller = new OAuthController(mocks.mockOAuthService as never, mocks.mockProviderRegistry as never);
    const mockRes = { status: vi.fn().mockReturnThis(), json: vi.fn(), redirect: vi.fn() };
    await controller.authorize('figma', '', mockRes as never);
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });
});
