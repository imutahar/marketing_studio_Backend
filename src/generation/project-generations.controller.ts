import { Controller, Get, Param } from '@nestjs/common';
import { GenerationService } from './generation.service';

/** Lives in the generation module (has GenerationService) — exposes a
 *  project's generations without coupling ProjectsModule to generation. */
@Controller('projects')
export class ProjectGenerationsController {
  constructor(private readonly generation: GenerationService) {}

  @Get(':id/generations')
  byProject(@Param('id') id: string) {
    return this.generation.listByProject(id);
  }
}
