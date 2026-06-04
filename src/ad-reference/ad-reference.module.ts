import { Module } from '@nestjs/common';
import { AdReferenceController } from './ad-reference.controller';
import { AdReferenceService } from './ad-reference.service';
import { GenerationModule } from '../generation/generation.module';

@Module({
  imports: [GenerationModule],
  controllers: [AdReferenceController],
  providers: [AdReferenceService],
})
export class AdReferenceModule {}
