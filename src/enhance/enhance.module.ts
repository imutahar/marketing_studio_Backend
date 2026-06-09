import { Module } from '@nestjs/common';
import { EnhanceController } from './enhance.controller';
import { EnhanceService } from './enhance.service';
import { OpenAiEnhancer } from './openai.enhancer';
import { PROMPT_ENHANCER } from './enhance.types';

@Module({
  controllers: [EnhanceController],
  providers: [
    EnhanceService,
    { provide: PROMPT_ENHANCER, useClass: OpenAiEnhancer },
  ],
})
export class EnhanceModule {}
