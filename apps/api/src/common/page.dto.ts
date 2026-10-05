import { Transform } from 'class-transformer';
import {
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class PageDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value,
  )
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(64)
  @Matches(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  )
  cursor?: string;
}

export function pageResult<T extends { id: string }>(rows: T[], limit: number) {
  const more = rows.length > limit;
  const items = rows.slice(0, limit);
  return { items, nextCursor: more ? items.at(-1)!.id : null };
}
