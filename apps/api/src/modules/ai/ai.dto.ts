import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class AiRequestDto {
  @IsIn(['summary', 'replies', 'translate'])
  kind!: 'summary' | 'replies' | 'translate';

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  messageIds!: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @Matches(/^[a-f0-9]{64}$/, { each: true })
  sourceRevisions!: string[];

  @IsOptional()
  @IsUUID('4')
  targetMessageId?: string;

  @IsOptional()
  @IsIn(['concise', 'friendly', 'formal'])
  tone?: 'concise' | 'friendly' | 'formal';

  @IsOptional()
  @IsString()
  @IsIn(['vi', 'en', 'ja', 'ko', 'zh', 'fr'])
  language?: string;
}

export class AiChatTurnDto {
  @IsIn(['user', 'model'])
  role!: 'user' | 'model';

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  text!: string;
}

export class AiChatRequestDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AiChatTurnDto)
  messages!: AiChatTurnDto[];
}

export interface AiResult {
  summary: string;
  decisions: string[];
  tasks: string[];
  replies: string[];
  translation: string;
}

export interface AiChatResult {
  reply: string;
  suggestions: string[];
}
