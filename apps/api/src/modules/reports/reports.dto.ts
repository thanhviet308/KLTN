import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PageDto } from '../../common/page.dto';

export class AdminReportsDto extends PageDto {
  @IsOptional()
  @IsIn(['open', 'reviewing', 'resolved', 'dismissed'])
  status?: 'open' | 'reviewing' | 'resolved' | 'dismissed';

  @IsOptional()
  @IsIn(['user', 'conversation', 'message', 'call', 'attachment'])
  targetType?: 'user' | 'conversation' | 'message' | 'call' | 'attachment';
}

export class CreateReportDto {
  @IsIn(['user', 'message', 'call', 'attachment'])
  targetType!: 'user' | 'message' | 'call' | 'attachment';
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsUUID('4')
  targetId!: string;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  reason!: string;
}

export class ReviewReportDto {
  @IsIn(['reviewing', 'resolved', 'dismissed'])
  status!: 'reviewing' | 'resolved' | 'dismissed';
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  resolution!: string;
}
