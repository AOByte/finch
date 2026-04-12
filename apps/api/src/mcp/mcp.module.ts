import { Module, forwardRef } from '@nestjs/common';
import { ConnectorModule } from '../connectors/connector.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { OAuthModule } from '../oauth/oauth.module';
import { OAuthService } from '../oauth/oauth.service';
import { MCPRegistryService } from './mcp-registry.service';
import { MCPServerFactory } from './mcp-server.factory';
import { ProcessManager } from './transports/process-manager';

/**
 * MCPModule imports OAuthModule so that OAuthService can be injected
 * into MCPServerFactory as the tokenRefresher callback.
 * OAuthModule is a leaf (imports only PersistenceModule) — no circular dependency.
 */
@Module({
  imports: [forwardRef(() => ConnectorModule), PersistenceModule, OAuthModule],
  providers: [
    MCPRegistryService,
    MCPServerFactory,
    ProcessManager,
    {
      provide: 'OAUTH_TOKEN_REFRESHER',
      useFactory: (oauthService: OAuthService) => {
        return (mcpServerId: string) => oauthService.refreshTokens(mcpServerId);
      },
      inject: [OAuthService],
    },
  ],
  exports: [MCPRegistryService, MCPServerFactory, ProcessManager],
})
export class MCPModule {}
