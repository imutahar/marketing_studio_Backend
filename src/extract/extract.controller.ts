import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ExtractService } from './extract.service';
import { ExtractDto } from './dto/extract.dto';
import type { ProductInfo } from './extract.types';

@Controller('extract')
export class ExtractController {
  constructor(private readonly service: ExtractService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  extract(@Body() dto: ExtractDto): Promise<ProductInfo> {
    return this.service.extract(dto.url);
  }
}
