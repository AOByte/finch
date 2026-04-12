import { Module } from '@nestjs/common';
import { ConnectorModule } from '../connectors/connector.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { MCPModule } from '../mcp/mcp.module';
import { ConnectorSettingsController } from './connector-settings.controller';
import { ConnectorSettingsService } from './connector-settings.service';

@Module({
  imports: [PersistenceModule, ConnectorModule, MCPModule],
  controllers: [ConnectorSettingsController],
  providers: [ConnectorSettingsService],
  exports: [ConnectorSettingsService],
})
export class ConnectorSettingsModule {}
