import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';

export class CreateCallDto {
  @IsOptional()
  @IsBoolean()
  summaryEnabled?: boolean;

  @IsUUID('4')
  clientRequestId!: string;

  @IsIn(['audio', 'video'])
  type!: 'audio' | 'video';
}

export class AcceptCallDto {
  @IsOptional()
  @IsBoolean()
  summaryEnabled?: boolean;
}
