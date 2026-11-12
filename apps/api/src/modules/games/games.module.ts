import { Module } from '@nestjs/common';
import { RealtimeEventsModule } from '../realtime/realtime-events.module';
import { GamesController } from './games.controller';
import { GamesService } from './games.service';

@Module({
  imports: [RealtimeEventsModule],
  controllers: [GamesController],
  providers: [GamesService],
})
export class GamesModule {}
