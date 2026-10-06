import { HttpException, Inject, Logger } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import type { OnGatewayDisconnect, OnGatewayInit } from '@nestjs/websockets';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { Namespace, Socket } from 'socket.io';
import type { Environment } from '../../config/environment';
import { Public } from '../auth/auth.decorators';
import { AuthService } from '../auth/auth.service';
import { MessagesService } from '../messages/messages.service';
import { RealtimeEvents } from './realtime-events.module';
import type { ChatEvent } from './realtime-events.module';
import {
  ConversationSocketDto,
  ReceiptSocketDto,
  SendSocketDto,
  SyncSocketDto,
  TypingSocketDto,
} from './realtime.dto';

interface Connection {
  token: string;
  userId: string;
  expiresAt: number;
  window: number;
  requests: number;
  pending: number;
  rooms: Set<string>;
}

function reject(status: number, code: string, message: string): never {
  throw new HttpException({ code, message }, status);
}

// HTTP's global guard delegates this gateway to handshake + per-event auth below.
// Unknown payloads bypass HTTP pipes; validation and errors become socket ACKs.
@Public()
@WebSocketGateway({
  namespace: '/chat',
  transports: ['websocket'],
  maxHttpBufferSize: 64 * 1024,
})
export class ChatGateway
  implements OnGatewayInit, OnGatewayDisconnect, OnModuleDestroy
{
  private readonly logger = new Logger(ChatGateway.name);
  private server!: Namespace;
  private readonly connections = new Map<string, Connection>();
  private readonly queue: ChatEvent[] = [];
  private draining = false;
  private closing = false;
  private handshakes = 0;
  private deliveryTask?: Promise<void>;
  private sweep?: ReturnType<typeof setInterval>;

  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(MessagesService) private readonly messages: MessagesService,
    @Inject(RealtimeEvents) private readonly events: RealtimeEvents,
    @Inject(ConfigService)
    private readonly config: ConfigService<Environment, true>,
  ) {}

  afterInit(server: Namespace) {
    this.server = server;
    server.use((socket, next) => {
      if (
        this.closing ||
        this.handshakes >= 100 ||
        this.connections.size >= 1000
      ) {
        next(new Error('REALTIME_BUSY'));
        return;
      }
      this.handshakes++;
      void this.connect(socket)
        .then(
          () => next(),
          (error: unknown) => {
            const response = this.error(error);
            const failure = new Error(response.code);
            Object.assign(failure, { data: response });
            next(failure);
          },
        )
        .finally(() => {
          this.handshakes--;
        });
    });
    this.events.listen((event) => {
      if (this.queue.length >= 1000) {
        this.logger.warn({ code: 'REALTIME_QUEUE_FULL' });
        // No private payload: clients must resync their authorized conversations.
        this.server.emit('sync:required', { reason: 'DELIVERY_BACKLOG' });
        return;
      }
      this.queue.push(event);
      if (!this.draining)
        this.deliveryTask = this.drain().catch(() => {
          this.logger.error({ code: 'REALTIME_DELIVERY_FAILED' });
        });
    });
    this.sweep = setInterval(() => {
      void this.revalidate();
    }, 30000);
    this.sweep.unref();
  }

  private async connect(socket: Socket) {
    const origin = socket.handshake.headers.origin;
    if (
      origin !== undefined &&
      origin !== this.config.get('WEB_ORIGIN', { infer: true })
    )
      reject(403, 'ORIGIN_FORBIDDEN', 'Origin is not allowed');
    if (Object.keys(socket.handshake.query).some((key) => /token/i.test(key)))
      reject(400, 'INVALID_HANDSHAKE', 'Use auth.accessToken, not a URL token');
    const token: unknown = socket.handshake.auth.accessToken;
    if (typeof token !== 'string' || token.length > 2048)
      reject(401, 'AUTH_REQUIRED', 'Access token is required');
    const principal = await this.auth.authenticate(token);
    const count = [...this.connections.values()].filter(
      (item) => item.userId === principal.user.id,
    ).length;
    if (count >= 5 || this.connections.size >= 1000)
      reject(429, 'CONNECTION_LIMIT', 'Too many active connections');
    const claims = JSON.parse(
      Buffer.from(token.split('.')[1]!, 'base64url').toString(),
    ) as { exp: number };
    if (!socket.conn || socket.conn.readyState !== 'open')
      reject(400, 'CONNECTION_CLOSED', 'Connection closed');
    this.connections.set(socket.id, {
      token,
      userId: principal.user.id,
      expiresAt: claims.exp * 1000,
      window: Date.now(),
      requests: 0,
      pending: 0,
      rooms: new Set(),
    });
    // Middleware may finish after the transport closes, before Nest disconnect hooks.
    socket.conn.once('close', () => this.connections.delete(socket.id));
  }

  handleDisconnect(socket: Socket) {
    this.connections.delete(socket.id);
  }

  private error(error: unknown) {
    if (error instanceof HttpException && error.getStatus() < 500) {
      const body = error.getResponse();
      if (
        typeof body === 'object' &&
        body !== null &&
        'code' in body &&
        'message' in body
      )
        return {
          ok: false as const,
          code: String(body.code),
          message: String(body.message),
        };
    }
    this.logger.error({ code: 'REALTIME_OPERATION_FAILED' });
    return {
      ok: false as const,
      code: 'INTERNAL_ERROR',
      message: 'Operation failed',
    };
  }

  private async run<T extends object>(
    socket: Socket,
    payload: unknown,
    dto: new () => T,
    action: (
      userId: string,
      input: T,
      connection: Connection,
    ) => Promise<unknown>,
  ) {
    const connection = this.connections.get(socket.id);
    let acquired = false;
    try {
      if (!connection)
        reject(401, 'AUTH_REQUIRED', 'Connection is unauthenticated');
      if (Date.now() - connection.window >= 60000) {
        connection.window = Date.now();
        connection.requests = 0;
      }
      if (++connection.requests > 60 || connection.pending >= 4)
        reject(429, 'RATE_LIMITED', 'Too many realtime requests');
      connection.pending++;
      acquired = true;
      const principal = await this.auth.authenticate(connection.token);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload))
        reject(400, 'INVALID_PAYLOAD', 'Payload must be an object');
      const input = plainToInstance(dto, payload);
      const errors = await validate(input, {
        whitelist: true,
        forbidNonWhitelisted: true,
        forbidUnknownValues: true,
      });
      if (errors.length)
        reject(400, 'INVALID_PAYLOAD', 'Payload validation failed');
      return {
        ok: true as const,
        data: await action(principal.user.id, input, connection),
      };
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 401)
        setImmediate(() => socket.disconnect(true));
      return this.error(error);
    } finally {
      if (connection && acquired) connection.pending--;
    }
  }

  @SubscribeMessage('conversation:subscribe')
  subscribe(socket: Socket, payload: unknown) {
    return this.run(
      socket,
      payload,
      ConversationSocketDto,
      async (userId, input, connection) => {
        const id = input.conversationId.toLowerCase();
        await this.messages.authorizedEvent(userId, id, undefined, async () => {
          if (!connection.rooms.has(id) && connection.rooms.size >= 50)
            reject(429, 'ROOM_LIMIT', 'Subscription limit reached');
          connection.rooms.add(id);
          await socket.join(`conversation:${id}`);
        });
        return { conversationId: id };
      },
    );
  }

  @SubscribeMessage('conversation:unsubscribe')
  unsubscribe(socket: Socket, payload: unknown) {
    return this.run(
      socket,
      payload,
      ConversationSocketDto,
      async (_userId, input, connection) => {
        const id = input.conversationId.toLowerCase();
        connection.rooms.delete(id);
        await socket.leave(`conversation:${id}`);
        return { conversationId: id };
      },
    );
  }

  @SubscribeMessage('message:send')
  send(socket: Socket, payload: unknown) {
    return this.run(socket, payload, SendSocketDto, (userId, input) =>
      this.messages.send(userId, input.conversationId.toLowerCase(), input),
    );
  }

  @SubscribeMessage('message:sync')
  sync(socket: Socket, payload: unknown) {
    return this.run(socket, payload, SyncSocketDto, (userId, input) =>
      this.messages.history(userId, input.conversationId.toLowerCase(), input),
    );
  }

  @SubscribeMessage('message:delivered')
  delivered(socket: Socket, payload: unknown) {
    return this.acknowledge(socket, payload, false);
  }

  @SubscribeMessage('message:read')
  read(socket: Socket, payload: unknown) {
    return this.acknowledge(socket, payload, true);
  }

  private acknowledge(socket: Socket, payload: unknown, read: boolean) {
    return this.run(socket, payload, ReceiptSocketDto, (userId, input) =>
      this.messages.receipt(
        userId,
        input.conversationId.toLowerCase(),
        input.messageId.toLowerCase(),
        read,
      ),
    );
  }

  @SubscribeMessage('typing:update')
  typing(socket: Socket, payload: unknown) {
    return this.run(socket, payload, TypingSocketDto, async (userId, input) => {
      const id = input.conversationId.toLowerCase();
      await this.messages.authorizedEvent(userId, id, undefined, () => {
        this.events.publish({
          name: 'typing:update',
          conversationId: id,
          actorId: userId,
          payload: {
            conversationId: id,
            userId,
            typing: input.typing,
            expiresAt: new Date(Date.now() + 5000).toISOString(),
          },
        });
      });
      return { conversationId: id };
    });
  }

  private async drain() {
    if (this.draining || this.closing) return;
    this.draining = true;
    try {
      let event: ChatEvent | undefined;
      while (!this.closing && (event = this.queue.shift())) {
        const current = event;
        const ids = [
          ...(this.server.adapter.rooms.get(
            `conversation:${current.conversationId}`,
          ) ?? []),
        ];
        for (const id of ids) {
          const socket = this.server.sockets.get(id);
          const connection = this.connections.get(id);
          if (!socket || !connection || current.actorId === connection.userId)
            continue;
          try {
            await this.auth.authenticate(connection.token);
            await this.messages.authorizedEvent(
              connection.userId,
              current.conversationId,
              current.messageId,
              () => {
                if (
                  socket.connected &&
                  connection.rooms.has(current.conversationId)
                )
                  socket.emit(current.name, current.payload);
              },
              current.actorId,
            );
          } catch (error) {
            if (error instanceof HttpException && error.getStatus() === 401)
              socket.disconnect(true);
            else if (
              error instanceof HttpException &&
              error.getStatus() === 404
            ) {
              // Rejoined users may lack access to just this historical message.
              if (!current.messageId) {
                connection.rooms.delete(current.conversationId);
                await socket.leave(`conversation:${current.conversationId}`);
              }
            } else this.logger.error({ code: 'REALTIME_DELIVERY_FAILED' });
          }
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private checking = false;
  private async revalidate() {
    if (this.checking || this.closing) return;
    this.checking = true;
    try {
      for (const [id, connection] of this.connections) {
        if (this.closing) break;
        const socket = this.server.sockets.get(id);
        if (!socket) continue;
        if (Date.now() >= connection.expiresAt) {
          socket.disconnect(true);
          continue;
        }
        try {
          await this.auth.authenticate(connection.token);
        } catch (error) {
          if (error instanceof HttpException && error.getStatus() === 401)
            socket.disconnect(true);
          else this.logger.error({ code: 'REALTIME_SESSION_CHECK_FAILED' });
        }
      }
    } finally {
      this.checking = false;
    }
  }

  async onModuleDestroy() {
    this.closing = true;
    if (this.sweep) clearInterval(this.sweep);
    this.events.close();
    this.queue.length = 0;
    this.server?.disconnectSockets(true);
    this.connections.clear();
    await this.deliveryTask;
  }
}
