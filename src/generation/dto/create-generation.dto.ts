import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import type {
  AttachmentKind,
  GenerationMode,
} from '../../common/generation.types';

export class AttachmentDto {
  @IsString()
  slotId: string;

  @IsIn(['product', 'character', 'image'])
  kind: AttachmentKind;

  @IsOptional()
  @IsString()
  fileName?: string;

  @IsOptional()
  @IsString()
  url?: string;
}

export class CreateGenerationDto {
  @IsIn(['image', 'video'])
  mode: GenerationMode;

  @IsString()
  @MaxLength(2000)
  prompt: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => AttachmentDto)
  attachments?: AttachmentDto[];
}
