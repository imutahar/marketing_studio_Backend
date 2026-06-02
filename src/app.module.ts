import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { GenerationModule } from './generation/generation.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), GenerationModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
