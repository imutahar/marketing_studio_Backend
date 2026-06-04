import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { AdReferenceService } from './ad-reference.service';
import {
  CreateAdReferenceDto,
  GenerateAdReferenceDto,
  UpdateScriptDto,
} from './dto/ad-reference.dto';

@Controller('ad-references')
export class AdReferenceController {
  constructor(private readonly service: AdReferenceService) {}

  /** Start an analysis job → 202 with the analyzing reference. */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  create(@Body() dto: CreateAdReferenceDto) {
    return this.service.create(dto);
  }

  /** Poll analysis status/progress/script. */
  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  /** Save the edited script. */
  @Patch(':id/script')
  updateScript(@Param('id') id: string, @Body() dto: UpdateScriptDto) {
    return this.service.updateScript(id, dto);
  }

  /** Generate a video from the (edited) script → 202 with a generation id. */
  @Post(':id/generate')
  @HttpCode(HttpStatus.ACCEPTED)
  generate(@Param('id') id: string, @Body() dto: GenerateAdReferenceDto) {
    return this.service.generate(id, dto);
  }
}
