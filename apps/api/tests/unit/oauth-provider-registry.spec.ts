import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OAuthProviderRegistry } from '../../src/oauth/oauth-provider-registry';

// Mock fs.readFileSync to return test providers
vi.mock('fs', () => ({
  readFileSync: vi.fn().mockReturnValue(JSON.stringify([
    {
      providerId: 'figma',
      displayName: 'Figma',
      authorizationUrl: 'https://www.figma.com/oauth',
      tokenUrl: 'https://api.figma.com/v1/oauth/token',
      revocationUrl: null,
      scopes: ['files:read'],
      clientIdEnvVar: 'FIGMA_CLIENT_ID',
      clientSecretEnvVar: 'FIGMA_CLIENT_SECRET',
      supportsPKCE: true,
      tokenPassingStrategy: 'env',
      tokenEnvVar: 'FIGMA_ACCESS_TOKEN',
    },
    {
      providerId: 'github',
      displayName: 'GitHub',
      authorizationUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      revocationUrl: null,
      scopes: ['repo'],
      clientIdEnvVar: 'GITHUB_CLIENT_ID',
      clientSecretEnvVar: 'GITHUB_CLIENT_SECRET',
      supportsPKCE: false,
      tokenPassingStrategy: 'header',
    },
  ])),
}));

describe('OAuthProviderRegistry', () => {
  let registry: OAuthProviderRegistry;

  beforeEach(() => {
    registry = new OAuthProviderRegistry();
  });

  it('loads providers from JSON', () => {
    const providers = registry.listProviders();
    expect(providers).toHaveLength(2);
  });

  it('getProvider returns provider by ID', () => {
    const figma = registry.getProvider('figma');
    expect(figma).toBeDefined();
    expect(figma!.displayName).toBe('Figma');
    expect(figma!.supportsPKCE).toBe(true);
    expect(figma!.tokenPassingStrategy).toBe('env');
  });

  it('getProvider returns undefined for unknown provider', () => {
    expect(registry.getProvider('notion')).toBeUndefined();
  });

  it('hasProvider returns true for known provider', () => {
    expect(registry.hasProvider('figma')).toBe(true);
    expect(registry.hasProvider('github')).toBe(true);
  });

  it('hasProvider returns false for unknown provider', () => {
    expect(registry.hasProvider('notion')).toBe(false);
  });

  it('listProviders returns all providers', () => {
    const providers = registry.listProviders();
    const ids = providers.map(p => p.providerId);
    expect(ids).toContain('figma');
    expect(ids).toContain('github');
  });
});
