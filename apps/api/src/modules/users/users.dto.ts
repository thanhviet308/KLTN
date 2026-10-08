import { Transform } from 'class-transformer';
import { IsString, Length, Matches, MaxLength } from 'class-validator';
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
export class UpdateAvatarDto {
  @IsString()
  @MaxLength(700000)
  @Matches(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/)
  image!: string;
}

export class SearchUsersDto extends PageDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(2, 100)
  query!: string;
}
