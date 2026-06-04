import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import type { BrandAssetKind } from '../projects.types';

class BrandAssetDto {
  @IsString() id: string;
  @IsIn(['logo', 'guideline', 'sheet', 'reference']) kind: BrandAssetKind;
  @IsString() @MaxLength(200) name: string;
  @IsString() url: string;
}

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  instructions?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => BrandAssetDto)
  brandAssets?: BrandAssetDto[];
}

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  instructions?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => BrandAssetDto)
  brandAssets?: BrandAssetDto[];
}
