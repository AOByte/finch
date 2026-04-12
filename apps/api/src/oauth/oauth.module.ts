import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PersistenceModule } from '../persistence/persistence.module';
import { ConnectorModule } from '../connectors/connector.module';
import { OAuthService } from './oauth.service';
import { OAuthController } from './oauth.controller';
import { OAuthProviderRegistry } from './oauth-provider-registry';

/**
 * OAuthModule — LEAF module.
 * Imports only PersistenceModule and ConnectorModule (for CredentialEncryptionService).
 * Does NOT import MCPModule or ConnectorSettingsModule.
 * This breaks the circular dependency: MCPModule → OAuthModule → MCPModule.
 *
 * The OAuth callback endpoint lives in ConnectorSettingsModule as OAuthCallbackController,
 * NOT here. Only the authorize endpoint lives here.
 */
@Module({
  imports: [PersistenceModule, ConnectorModule, ConfigModule],
  controllers: [OAuthController],
  providers: [OAuthService, OAuthProviderRegistry],
  exports: [OAuthService, OAuthProviderRegistry],
})
export class OAuthModule {}
