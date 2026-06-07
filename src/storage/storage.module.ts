import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';

// ConfigModule is global (registered in AppModule), so no import needed here.
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
