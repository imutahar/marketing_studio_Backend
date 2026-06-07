import { Controller, Get } from '@nestjs/common';
import { GenerationService } from './generation.service';
import type { Asset } from './asset.types';

@Controller('assets')
export class AssetsController {
  constructor(private readonly generation: GenerationService) {}

  /** Global asset library — every generated output, newest first. */
  @Get()
  list(): Asset[] {
    return this.generation.listAssets();
  }
}
