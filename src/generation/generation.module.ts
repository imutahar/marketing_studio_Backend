import { Module } from '@nestjs/common';
import { GenerationController } from './generation.controller';
import { AssetsController } from './assets.controller';
import { GenerationService } from './generation.service';
import { JobStore } from './job.store';
import { ProvidersModule } from '../providers/providers.module';
import { UsageModule } from '../usage/usage.module';

@Module({
  imports: [ProvidersModule, UsageModule],
  controllers: [GenerationController, AssetsController],
  providers: [GenerationService, JobStore],
  exports: [GenerationService],
})
export class GenerationModule {}
