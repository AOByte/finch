import { describe, it, expect, vi } from 'vitest';
import { OAuthCallbackController } from '../../src/connector-settings/oauth-callback.controller';
import { HttpException } from '@nestjs/common';

describe('OAuthCallbackController', () => {
  function makeMocks() {
    return {
      mockOAuthService: {
        handleCallback: vi.fn().mockResolvedValue('mcp-new-id'),
      },
      mockConnectorSettings: {
        loadAndRegisterServer: vi.fn().mockResolvedValue(undefined),
      },
    };
  }

  it('callback returns mcpServerId on success', async () => {
    const mocks = makeMocks();
    const controller = new OAuthCallbackController(
      mocks.mockOAuthService as never,
      mocks.mockConnectorSettings as never,
    );
    const result = await controller.callback('test-state', 'test-code');
    expect(result).toEqual({ data: { mcpServerId: 'mcp-new-id' } });
    expect(mocks.mockOAuthService.handleCallback).toHaveBeenCalledWith('test-state', 'test-code');
    expect(mocks.mockConnectorSettings.loadAndRegisterServer).toHaveBeenCalledWith('mcp-new-id');
  });

  it('callback throws 400 when state is missing', async () => {
    const mocks = makeMocks();
    const controller = new OAuthCallbackController(
      mocks.mockOAuthService as never,
      mocks.mockConnectorSettings as never,
    );
    await expect(controller.callback('', 'code')).rejects.toThrow(HttpException);
  });

  it('callback throws 400 when code is missing', async () => {
    const mocks = makeMocks();
    const controller = new OAuthCallbackController(
      mocks.mockOAuthService as never,
      mocks.mockConnectorSettings as never,
    );
    await expect(controller.callback('state', '')).rejects.toThrow(HttpException);
  });

  it('callback wraps OAuthService errors as 400', async () => {
    const mocks = makeMocks();
    mocks.mockOAuthService.handleCallback.mockRejectedValue(new Error('Invalid OAuth state'));
    const controller = new OAuthCallbackController(
      mocks.mockOAuthService as never,
      mocks.mockConnectorSettings as never,
    );
    await expect(controller.callback('bad-state', 'code')).rejects.toThrow(HttpException);
  });

  it('callback wraps loadAndRegisterServer errors as 400', async () => {
    const mocks = makeMocks();
    mocks.mockConnectorSettings.loadAndRegisterServer.mockRejectedValue(new Error('Connection failed'));
    const controller = new OAuthCallbackController(
      mocks.mockOAuthService as never,
      mocks.mockConnectorSettings as never,
    );
    await expect(controller.callback('state', 'code')).rejects.toThrow(HttpException);
  });
});
