import { Controller, Get, Post, Delete, Param, Body, HttpCode } from '@nestjs/common';
import { ConnectorSettingsService } from './connector-settings.service';

@Controller('api/harness/:harnessId/mcp-servers')
export class ConnectorSettingsController {
  constructor(private readonly service: ConnectorSettingsService) {}

  @Get()
  async list(@Param('harnessId') harnessId: string) {
    const servers = await this.service.listForHarness(harnessId);
    return { data: servers };
  }

  @Post()
  async create(
    @Param('harnessId') harnessId: string,
    @Body() body: { serverType: string; displayName: string; config: Record<string, unknown> },
  ) {
    const result = await this.service.create({
      harnessId,
      serverType: body.serverType,
      displayName: body.displayName,
      config: body.config,
    });
    return { data: result };
  }

  @Post(':mcpServerId/test')
  @HttpCode(200)
  async testConnection(@Param('mcpServerId') mcpServerId: string) {
    const result = await this.service.testConnection(mcpServerId);
    return { data: result };
  }

  @Delete(':mcpServerId')
  async remove(@Param('mcpServerId') mcpServerId: string) {
    const result = await this.service.remove(mcpServerId);
    return { data: result };
  }

  @Get(':mcpServerId/tools')
  async listTools(@Param('mcpServerId') mcpServerId: string) {
    const tools = await this.service.listTools(mcpServerId);
    return { data: tools };
  }
}
