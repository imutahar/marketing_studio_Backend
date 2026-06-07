import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { GenerationService } from './generation.service';
import { CreateGenerationDto } from './dto/create-generation.dto';

@Controller('generations')
export class GenerationController {
  constructor(private readonly service: GenerationService) {}

  /** Start a generation job. Returns 202 with the queued job. */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  create(@Body() dto: CreateGenerationDto) {
    return this.service.create(dto);
  }

  @Get()
  list() {
    return this.service.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  /** Approve a draft_ready job and kick off the full render. Returns 202. */
  @Post(':id/approve')
  @HttpCode(HttpStatus.ACCEPTED)
  approve(@Param('id') id: string) {
    return this.service.approve(id);
  }
}
