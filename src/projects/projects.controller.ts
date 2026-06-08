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
import { CreateProjectDto, UpdateProjectDto } from './dto/projects.dto';
import { CurrentUser } from '../common/current-user.decorator';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@CurrentUser() ownerId: string) {
    return this.projects.list(ownerId);
  }

  @Post()
  create(@Body() dto: CreateProjectDto, @CurrentUser() ownerId: string) {
    return this.projects.create(dto, ownerId);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() ownerId: string) {
    return this.projects.get(id, ownerId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() ownerId: string,
  ) {
    return this.projects.update(id, dto, ownerId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() ownerId: string) {
    this.projects.remove(id, ownerId);
  }
}
