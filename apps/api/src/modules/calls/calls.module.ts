import { Module } from '@nestjs/common';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';
import { RealtimeEventsModule } from '../realtime/realtime-events.module';

@Module({
  imports: [RealtimeEventsModule],
  controllers: [CallsController],
  providers: [CallsService],
})
export class CallsModule {}
