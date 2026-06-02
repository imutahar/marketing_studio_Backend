import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  health() {
    return {
      status: 'ok',
      service: 'marketing-studio-backend',
      time: new Date().toISOString(),
    };
  }
}
