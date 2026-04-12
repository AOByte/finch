import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WebhookConnectorService } from './webhook-connector.service';
import { ConnectorRegistryService } from './connector-registry.service';
import { CredentialEncryptionService } from './credential-encryption.service';
import { JiraConnectorService } from './jira-connector.service';
import { GitHubAcquireConnectorService } from './github-acquire-connector.service';
import { GitHubExecuteConnectorService } from './github-execute-connector.service';
import { GitHubShipConnectorService } from './github-ship-connector.service';
import { SlackConnectorService } from './slack-connector.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [ConfigModule, forwardRef(() => AuditModule)],
  providers: [
    WebhookConnectorService,
    ConnectorRegistryService,
    CredentialEncryptionService,
    JiraConnectorService,
    GitHubAcquireConnectorService,
    GitHubExecuteConnectorService,
    GitHubShipConnectorService,
    SlackConnectorService,
  ],
  exports: [
    WebhookConnectorService,
    ConnectorRegistryService,
    CredentialEncryptionService,
    JiraConnectorService,
    GitHubAcquireConnectorService,
    GitHubExecuteConnectorService,
    GitHubShipConnectorService,
    SlackConnectorService,
  ],
})
export class ConnectorModule {}
