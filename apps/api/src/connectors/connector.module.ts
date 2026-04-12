import { Module } from '@nestjs/common';
import { WebhookConnectorService } from './webhook-connector.service';
import { ConnectorRegistryService } from './connector-registry.service';

@Module({
  providers: [WebhookConnectorService, ConnectorRegistryService],
  exports: [WebhookConnectorService, ConnectorRegistryService],
})
export class ConnectorModule {}
