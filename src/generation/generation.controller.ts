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
import { GenerationService } from './generation.service';
import { CreateGenerationDto } from './dto/create-generation.dto';
import { AssignProjectDto } from './dto/assign-project.dto';
import { CurrentUser } from '../common/current-user.decorator';

@Controller('generations')
export class GenerationController {
  constructor(private readonly service: GenerationService) {}

  /** Start a generation job. Returns 202 with the queued job. */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  create(@Body() dto: CreateGenerationDto, @CurrentUser() ownerId: string) {
    return this.service.create(dto, ownerId);
  }

  @Get()
  list(@CurrentUser() ownerId: string) {
    return this.service.list(ownerId);
  }

  /** Provider capabilities for the composer (e.g. draft support). Declared
      before the `:id` route so it isn't swallowed by the wildcard. */
  @Get('capabilities')
  capabilities() {
    return this.service.capabilities();
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() ownerId: string) {
    return this.service.get(id, ownerId);
  }

  /** Approve a draft_ready job and kick off the full render. Returns 202. */
  @Post(':id/approve')
  @HttpCode(HttpStatus.ACCEPTED)
  approve(@Param('id') id: string, @CurrentUser() ownerId: string) {
    return this.service.approve(id, ownerId);
  }

  /** Move a generation into a project ("save to project"). Returns the job. */
  @Patch(':id/project')
  assignProject(
    @Param('id') id: string,
    @Body() dto: AssignProjectDto,
    @CurrentUser() ownerId: string,
  ) {
    return this.service.assignProject(id, dto.projectId, ownerId);
  }

  /** Cancel an in-flight generation (won't bill). Returns 204. */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  cancel(@Param('id') id: string, @CurrentUser() ownerId: string) {
    return this.service.cancel(id, ownerId);
  }

  /** Delete a generation the caller owns. Returns 204. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() ownerId: string) {
    return this.service.remove(id, ownerId);
  }
}
