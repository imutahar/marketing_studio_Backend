import { Module } from '@nestjs/common';
import { ExtractController } from './extract.controller';
import { ExtractService } from './extract.service';

@Module({
  controllers: [ExtractController],
  providers: [ExtractService],
})
export class ExtractModule {}
