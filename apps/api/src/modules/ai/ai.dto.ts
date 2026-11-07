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

export interface AiResult {
  summary: string;
  decisions: string[];
  tasks: string[];
  replies: string[];
  translation: string;
}
