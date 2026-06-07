import { Module } from '@nestjs/common';
import { GenerationController } from './generation.controller';
import { AssetsController } from './assets.controller';
import { ProjectGenerationsController } from './project-generations.controller';
import { GenerationService } from './generation.service';
import { JobStore } from './job.store';
import { ProvidersModule } from '../providers/providers.module';
import { UsageModule } from '../usage/usage.module';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [ProvidersModule, UsageModule, ProjectsModule],
  controllers: [
    GenerationController,
    AssetsController,
    ProjectGenerationsController,
  ],
  providers: [GenerationService, JobStore],
  exports: [GenerationService],
})
export class GenerationModule {}
