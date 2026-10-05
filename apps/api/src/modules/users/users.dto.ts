import { Transform } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';
import { PageDto } from '../../common/page.dto';

export class UpdateProfileDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 100)
  @Matches(/\S/)
  displayName!: string;
}

export class SearchUsersDto extends PageDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(2, 100)
  query!: string;
}
