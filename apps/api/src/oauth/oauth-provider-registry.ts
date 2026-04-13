import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';

export interface OAuthProviderConfig {
  providerId: string;
  displayName: string;
  authorizationUrl: string;
  tokenUrl: string;
  revocationUrl: string | null;
  scopes: string[];
  clientIdEnvVar: string;
  clientSecretEnvVar: string;
  supportsPKCE: boolean;
  tokenPassingStrategy: 'env' | 'header';
  tokenEnvVar?: string;
}

/**
 * Registry of OAuth provider configurations loaded from providers.json.
 * Adding a new OAuth provider requires only a new entry in providers.json
 * — zero TypeScript changes.
 *
 * Note: providers.json is bundled into the Docker image, so adding a new
 * entry requires a new image build and deployment. Operators should not
 * expect to hot-add a provider via a mounted config file.
 */
@Injectable()
export class OAuthProviderRegistry {
  private readonly logger = new Logger(OAuthProviderRegistry.name);
  private readonly providers = new Map<string, OAuthProviderConfig>();

  constructor() {
    this.loadProviders();
  }

  private loadProviders(): void {
    try {
      const filePath = join(__dirname, 'providers.json');
      const raw = readFileSync(filePath, 'utf-8');
      const configs = JSON.parse(raw) as OAuthProviderConfig[];
      for (const config of configs) {
        this.providers.set(config.providerId, config);
      }
      this.logger.log(`Loaded ${this.providers.size} OAuth provider(s): ${Array.from(this.providers.keys()).join(', ')}`);
    } catch (err) {
      this.logger.warn(`Failed to load providers.json: ${(err as Error).message}. OAuth providers unavailable.`);
    }
  }

  getProvider(providerId: string): OAuthProviderConfig | undefined {
    return this.providers.get(providerId);
  }

  listProviders(): OAuthProviderConfig[] {
    return Array.from(this.providers.values());
  }

  hasProvider(providerId: string): boolean {
    return this.providers.has(providerId);
  }
}
