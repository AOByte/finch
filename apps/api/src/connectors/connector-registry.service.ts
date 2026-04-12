import { Injectable, Logger } from '@nestjs/common';
import type { TriggerConnector, ConnectorCategory } from '@finch/types';

interface ConnectorEntry {
  category: ConnectorCategory;
  connector: TriggerConnector;
}

@Injectable()
export class ConnectorRegistryService {
  private readonly logger = new Logger(ConnectorRegistryService.name);
  private readonly connectors = new Map<string, ConnectorEntry>();

  register(id: string, category: ConnectorCategory, connector: TriggerConnector): void {
    this.connectors.set(id, { category, connector });
    this.logger.log(`Registered connector: ${id} (${category})`);
  }

  getTriggerConnector(id: string): TriggerConnector | undefined {
    const entry = this.connectors.get(id);
    if (entry && entry.category === 'trigger') {
      return entry.connector;
    }
    return undefined;
  }

  getDefaultTriggerConnector(): TriggerConnector | undefined {
    for (const [, entry] of this.connectors) {
      if (entry.category === 'trigger') {
        return entry.connector;
      }
    }
    return undefined;
  }

  has(id: string): boolean {
    return this.connectors.has(id);
  }

  listByCategory(category: ConnectorCategory): string[] {
    const ids: string[] = [];
    for (const [id, entry] of this.connectors) {
      if (entry.category === category) {
        ids.push(id);
      }
    }
    return ids;
  }
}
