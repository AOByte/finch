/**
 * Transport interface for communicating with external MCP servers.
 * Supports both stdio (child process) and SSE (HTTP streaming) transports.
 */
export interface MCPTransport {
  /** Initialize the transport connection and perform MCP protocol handshake. */
  initialize(): Promise<void>;
  /** Send a JSON-RPC 2.0 request and return the result. */
  sendRequest(method: string, params?: unknown): Promise<unknown>;
  /** Close the transport connection and clean up resources. */
  close(): Promise<void>;
  /** Check if the transport connection is active. */
  isConnected(): boolean;
  /** Update credentials (e.g., after OAuth token refresh). */
  updateCredentials?(token: string): void;
}

/** Configuration for spawning a stdio MCP server process. */
export interface StdioTransportConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** Configuration for connecting to an SSE MCP server endpoint. */
export interface SSETransportConfig {
  url: string;
  headers: Record<string, string>;
}
