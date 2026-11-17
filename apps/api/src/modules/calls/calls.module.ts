import { Module } from '@nestjs/common';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';
import { RealtimeEventsModule } from '../realtime/realtime-events.module';
import { MessagesModule } from '../messages/messages.module';
import { AiProviderService } from '../ai/ai-provider.service';
import { CallSummaryService } from './call-summary.service';

@Module({
  imports: [RealtimeEventsModule, MessagesModule],
  controllers: [CallsController],
  providers: [CallsService, AiProviderService, CallSummaryService],
})
export class CallsModule {}
