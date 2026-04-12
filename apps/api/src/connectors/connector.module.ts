import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WebhookConnectorService } from './webhook-connector.service';
import { ConnectorRegistryService } from './connector-registry.service';
import { CredentialEncryptionService } from './credential-encryption.service';

@Module({
  imports: [ConfigModule],
  providers: [WebhookConnectorService, ConnectorRegistryService, CredentialEncryptionService],
  exports: [WebhookConnectorService, ConnectorRegistryService, CredentialEncryptionService],
})
export class ConnectorModule {}
