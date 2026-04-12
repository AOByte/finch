import { Module } from '@nestjs/common';
import { MemoryConnectorService } from './memory-connector.service';

@Module({
  providers: [MemoryConnectorService],
  exports: [MemoryConnectorService],
})
export class MemoryModule {}
