import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Request to rewrite a rough composer prompt into a richer ad prompt. `prompt`
 * may be empty when a `productName` is supplied (enhance straight from the
 * product). Validation mirrors the keyed-options contract used elsewhere.
 */
export class EnhancePromptDto {
  @IsString()
  @MaxLength(2000)
  prompt: string;

  @IsIn(['image', 'video'])
  mode: 'image' | 'video';

  /** Toolbar selections (format, imageType, ratio, …) — light prompt context. */
  @IsOptional()
  @IsObject()
  options?: Record<string, string>;

  /** Name of the attached product, so the rewrite is product-specific. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  productName?: string;
}
