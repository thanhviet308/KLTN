import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsString,
  IsUUID,
  Length,
  ValidateIf,
} from 'class-validator';

export class CreateConversationDto {
  @IsIn(['direct', 'group'])
  type!: 'direct' | 'group';

  @ValidateIf(
    (object: CreateConversationDto, value: unknown) =>
      object.type === 'direct' || value !== undefined,
  )
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsUUID('4')
  recipientId?: string;

  @ValidateIf(
    (object: CreateConversationDto, value: unknown) =>
      object.type === 'group' || value !== undefined,
  )
  @IsUUID('4')
  clientRequestId?: string;

  @ValidateIf(
    (object: CreateConversationDto, value: unknown) =>
      object.type === 'group' || value !== undefined,
  )
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 200)
  title?: string;

  @ValidateIf(
    (object: CreateConversationDto, value: unknown) =>
      object.type === 'group' || value !== undefined,
  )
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value)
      ? value.map((item) =>
          typeof item === 'string' ? item.toLowerCase() : item,
        )
      : value,
  )
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(49)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  memberIds?: string[];
}

export class UpdateConversationDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 200)
  title!: string;
}

export class AddConversationMemberDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsUUID('4')
  userId!: string;
}

export class UpdateConversationMemberDto {
  @IsIn(['admin', 'member'])
  role!: 'admin' | 'member';
}

export class TransferOwnershipDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsUUID('4')
  userId!: string;
}
