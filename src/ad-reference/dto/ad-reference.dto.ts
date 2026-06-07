import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';

export class CreateAdReferenceDto {
  @IsString()
  @MaxLength(2048)
  referenceVideoUrl: string;

  @IsOptional()
  @IsString()
  productImage?: string;

  @IsOptional()
  @IsString()
  avatarImage?: string;

  @IsOptional()
  @IsString()
  avatarName?: string;
}

class ShotDto {
  @IsInt() index: number;
  @IsNumber() start: number;
  @IsNumber() end: number;
  @IsString() type: string;
  @IsString() @MaxLength(1000) visual: string;
  @IsString() @MaxLength(1000) spoken: string;
  @IsString() @MaxLength(500) onScreenText: string;
}

export class UpdateScriptDto {
  @IsInt() durationSec: number;
  @IsString() aspectRatio: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShotDto)
  shots: ShotDto[];
}

export class GenerateAdReferenceDto {
  @IsOptional() @IsString() resolution?: string;
  @IsOptional() @IsString() aspectRatio?: string;
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsInt() @Min(1) @Max(4) variations?: number;
}
