import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiProviderService } from './ai-provider.service';

@Module({
  imports: [ConversationsModule],
  controllers: [AiController],
  providers: [AiService, AiProviderService],
})
export class AiModule {}
