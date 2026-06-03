import { Controller, Get } from '@nestjs/common';
import { UsageService } from './usage.service';
import type { UsageSummary } from './usage.types';

@Controller('usage')
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  @Get()
  get(): UsageSummary {
    return this.usage.getSummary();
  }
}
