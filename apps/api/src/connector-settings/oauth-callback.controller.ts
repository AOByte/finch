import { Controller, Get, Query, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { OAuthService } from '../oauth/oauth.service';
import { ConnectorSettingsService } from './connector-settings.service';

/**
 * OAuthCallbackController — lives in ConnectorSettingsModule (NOT OAuthModule).
 *
 * Why here and not in OAuthModule?
 * OAuthModule is a leaf module (imports only PersistenceModule + ConnectorModule).
 * The callback needs to call ConnectorSettingsService.loadAndRegisterServer()
 * which requires MCPRegistryService + MCPServerFactory. Putting this controller
 * in OAuthModule would create a circular dependency:
 *   OAuthModule → MCPModule → OAuthModule
 *
 * Instead, ConnectorSettingsModule already imports both OAuthModule and MCPModule,
 * so it can wire the callback without any new dependency edges.
 */
@Controller('api/connectors/oauth')
export class OAuthCallbackController {
  private readonly logger = new Logger(OAuthCallbackController.name);

  constructor(
    private readonly oauthService: OAuthService,
    private readonly connectorSettings: ConnectorSettingsService,
  ) {}

  /**
   * GET /api/connectors/oauth/callback?state=...&code=...
   *
   * 1. OAuthService.handleCallback() validates state, exchanges code for tokens,
   *    persists tokens in mcp_servers row, returns mcpServerId.
   * 2. ConnectorSettingsService.loadAndRegisterServer() creates the adapter
   *    via MCPServerFactory and registers it in MCPRegistryService.
   */
  @Get('callback')
  async callback(
    @Query('state') state: string,
    @Query('code') code: string,
  ) {
    if (!state || !code) {
      throw new HttpException(
        'Missing state or code query parameters',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      // Step 1: OAuthService handles token exchange → returns mcpServerId only
      const mcpServerId = await this.oauthService.handleCallback(state, code);

      // Step 2: ConnectorSettingsService creates adapter + registers in MCPRegistry
      await this.connectorSettings.loadAndRegisterServer(mcpServerId);

      this.logger.log(`OAuth callback completed, server registered: ${mcpServerId}`);
      return { data: { mcpServerId } };
    } catch (err) {
      this.logger.error(`OAuth callback failed: ${(err as Error).message}`);
      throw new HttpException(
        (err as Error).message,
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
