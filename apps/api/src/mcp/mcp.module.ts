import { Module, forwardRef } from '@nestjs/common';
import { ConnectorModule } from '../connectors/connector.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { MCPRegistryService } from './mcp-registry.service';
import { MCPServerFactory } from './mcp-server.factory';

@Module({
  imports: [forwardRef(() => ConnectorModule), PersistenceModule],
  providers: [MCPRegistryService, MCPServerFactory],
  exports: [MCPRegistryService, MCPServerFactory],
})
export class MCPModule {}
