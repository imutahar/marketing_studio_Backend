import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ExtractDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  url: string;
}
