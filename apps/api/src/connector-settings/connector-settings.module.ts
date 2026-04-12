import { Module } from '@nestjs/common';
import { ConnectorModule } from '../connectors/connector.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { MCPModule } from '../mcp/mcp.module';
import { OAuthModule } from '../oauth/oauth.module';
import { ConnectorSettingsController } from './connector-settings.controller';
import { OAuthCallbackController } from './oauth-callback.controller';
import { ConnectorSettingsService } from './connector-settings.service';

/**
 * ConnectorSettingsModule imports both MCPModule and OAuthModule.
 * OAuthCallbackController lives here (NOT in OAuthModule) to avoid circular dependency.
 * Dependency graph: ConnectorSettingsModule → MCPModule → OAuthModule (leaf).
 */
@Module({
  imports: [PersistenceModule, ConnectorModule, MCPModule, OAuthModule],
  controllers: [ConnectorSettingsController, OAuthCallbackController],
  providers: [ConnectorSettingsService],
  exports: [ConnectorSettingsService],
})
export class ConnectorSettingsModule {}
