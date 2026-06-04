import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { GenerationService } from '../generation/generation.service';
import { CreateProjectDto, UpdateProjectDto } from './dto/projects.dto';

@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly generation: GenerationService,
  ) {}

  @Get()
  list() {
    return this.projects.list();
  }

  @Post()
  create(@Body() dto: CreateProjectDto) {
    return this.projects.create(dto);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.projects.get(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProjectDto) {
    return this.projects.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    this.projects.remove(id);
  }

  /** The project's generations (its ad history), newest first. */
  @Get(':id/generations')
  generations(@Param('id') id: string) {
    this.projects.get(id); // ensure it exists
    return this.generation.listByProject(id);
  }
}
