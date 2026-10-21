import { IsIn, IsUUID } from 'class-validator';

export class CreateCallDto {
  @IsUUID('4')
  clientRequestId!: string;

  @IsIn(['audio', 'video'])
  type!: 'audio' | 'video';
}
