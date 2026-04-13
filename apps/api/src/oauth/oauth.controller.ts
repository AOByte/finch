import { Controller, Get, Param, Query, Res, HttpStatus, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { Response } from 'express';
import { OAuthService } from './oauth.service';
import { OAuthProviderRegistry } from './oauth-provider-registry';

/**
 * OAuthController — lives in OAuthModule.
 * Only handles the authorize endpoint (redirect to provider's consent screen).
 * The callback endpoint lives in ConnectorSettingsModule as OAuthCallbackController.
 */
@Controller('api/oauth')
@UseGuards(JwtAuthGuard)
export class OAuthController {
  constructor(
    private readonly oauthService: OAuthService,
    private readonly providerRegistry: OAuthProviderRegistry,
  ) {}

  /**
   * List available OAuth providers.
   */
  @Get('providers')
  listProviders() {
    const providers = this.providerRegistry.listProviders().map(p => ({
      providerId: p.providerId,
      displayName: p.displayName,
      supportsPKCE: p.supportsPKCE,
    }));
    return { data: providers };
  }

  /**
   * Initiate OAuth flow — generates state + PKCE, stores in oauth_states,
   * returns redirect URL to provider's consent screen.
   */
  @Get('authorize/:providerId')
  async authorize(
    @Param('providerId') providerId: string,
    @Query('harnessId') harnessId: string,
    @Res() res: Response,
  ) {
    if (!harnessId) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        error: 'harnessId query parameter is required',
      });
    }

    const { url } = await this.oauthService.generateAuthUrl(providerId, harnessId);
    return res.redirect(url);
  }
}
