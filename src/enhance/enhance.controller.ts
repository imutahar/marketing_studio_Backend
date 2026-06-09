import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { EnhanceService } from './enhance.service';
import { EnhancePromptDto } from './dto/enhance-prompt.dto';

@Controller('enhance')
export class EnhanceController {
  constructor(private readonly service: EnhanceService) {}

  /** Capability probe so the UI hides the button when the feature is off. */
  @Get('status')
  status(): { available: boolean } {
    return { available: this.service.isAvailable() };
  }

  /** Rewrite a rough prompt into a richer ad prompt. Tighter rate limit since
      it makes a paid LLM call. */
  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async enhance(@Body() dto: EnhancePromptDto): Promise<{ prompt: string }> {
    const prompt = await this.service.enhance(dto);
    return { prompt };
  }
}
