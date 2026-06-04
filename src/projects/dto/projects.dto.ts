import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;
}

export class UpdateProjectDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;
}
