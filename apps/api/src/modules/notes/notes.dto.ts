import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUrl,
  Length,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class SaveNoteDto {
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  body!: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @Length(1, 120)
  musicTitle?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  musicArtist?: string;

  @Transform(trim)
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(1000)
  musicUrl?: string;

  @Transform(trim)
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(1000)
  musicPreviewUrl?: string;
}
