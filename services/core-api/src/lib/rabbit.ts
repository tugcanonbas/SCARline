import { randomUUID } from 'node:crypto';
import amqp, { type ChannelModel, type ConfirmChannel, type ConsumeMessage } from 'amqplib';
import {
  rabbitMessageSchema,
  RABBITMQ_EXCHANGES,
  RABBITMQ_QUEUES,
  type RabbitMessage
} from '@scarline/contracts';

const RECONNECT_DELAY_MS = 2_000;
const PREFETCH_COUNT = 50;
const MAX_BUFFERED_PUBLISHES = 500;
const MAX_PROCESSED_MESSAGE_IDS = 2_000;
const QUEUE_ARGUMENTS = {
  'x-message-ttl': 300_000,
  'x-dead-letter-exchange': RABBITMQ_EXCHANGES.dlx
};

type PendingResponse = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

type ConsumerRegistration = {
  queue: string;
  handler: (message: RabbitMessage) => Promise<void>;
};

type BufferedPublish = {
  exchange: string;
  routingKey: string;
  message: RabbitMessage;
  resolve: () => void;
  reject: (error: Error) => void;
};

export class RabbitManager {
  private connection: ChannelModel | null = null;
  private channel: ConfirmChannel | null = null;
  private connecting: Promise<void> | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private readonly pendingResponses = new Map<string, PendingResponse>();
  private readonly consumers = new Map<string, ConsumerRegistration>();
  private readonly bufferedPublishes: BufferedPublish[] = [];
  private readonly processedMessageIds = new Set<string>();
  private readonly processedMessageIdOrder: string[] = [];

  constructor(private readonly url: string) {}

  isConnected(): boolean {
    return this.channel !== null;
  }

  async connect(): Promise<void> {
    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = this.openConnection().finally(() => {
      this.connecting = null;
    });

    return this.connecting;
  }

  private async openConnection(): Promise<void> {
    // carla connection - 2026-09-01: retry initial AMQP connection so a brief
    // delay between Docker's RabbitMQ healthcheck passing and port 5672 fully
    // accepting connections does not crash core-api on startup.
    const MAX_ATTEMPTS = 10;
    const RETRY_DELAY_MS = 2_000;
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const connection = await amqp.connect(this.url);
        const channel = await connection.createConfirmChannel();

        this.connection = connection;
        this.channel = channel;

        connection.on('error', (error) => {
          console.error('RabbitMQ connection error', error);
        });
        connection.on('close', () => {
          if (this.connection === connection) {
            this.connection = null;
            this.channel = null;
          }
          this.scheduleReconnect();
        });
        channel.on('error', (error) => {
          console.error('RabbitMQ channel error', error);
        });
        channel.on('close', () => {
          if (this.channel === channel) {
            this.channel = null;
          }
          this.scheduleReconnect();
        });

        await this.assertTopology(channel);
        await channel.prefetch(PREFETCH_COUNT);
        await this.restoreConsumers();
        await this.drainBufferedPublishes();
        return;
      } catch (error) {
        lastError = error;
        if (attempt < MAX_ATTEMPTS) {
          console.warn(`RabbitMQ connection attempt ${attempt}/${MAX_ATTEMPTS} failed — retrying in ${RETRY_DELAY_MS}ms`);
          await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        }
      }
    }

    throw lastError;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
      } catch {
        this.scheduleReconnect();
      }
    }, RECONNECT_DELAY_MS);
  }

  private async assertTopology(channel: ConfirmChannel): Promise<void> {
    await channel.assertExchange(RABBITMQ_EXCHANGES.events, 'topic', { durable: true });
    await channel.assertExchange(RABBITMQ_EXCHANGES.commands, 'topic', { durable: true });
    await channel.assertExchange(RABBITMQ_EXCHANGES.dlx, 'fanout', { durable: true });

    await channel.assertQueue(RABBITMQ_QUEUES.coreApiEvents, {
      durable: true,
      arguments: QUEUE_ARGUMENTS
    });
    await channel.assertQueue(RABBITMQ_QUEUES.coreApiCommands, {
      durable: true,
      arguments: QUEUE_ARGUMENTS
    });
    await channel.assertQueue(RABBITMQ_QUEUES.dlq, { durable: true });

    await channel.bindQueue(RABBITMQ_QUEUES.coreApiEvents, RABBITMQ_EXCHANGES.events, 'events.#');
    for (const routingKey of ['commands.session.*', 'commands.widget.*', 'commands.export.*']) {
      await channel.bindQueue(RABBITMQ_QUEUES.coreApiCommands, RABBITMQ_EXCHANGES.commands, routingKey);
    }
    await channel.bindQueue(RABBITMQ_QUEUES.dlq, RABBITMQ_EXCHANGES.dlx, '');
  }

  async publish(exchange: string, routingKey: string, message: RabbitMessage): Promise<void> {
    const parsed = rabbitMessageSchema.parse(message);
    const channel = this.channel;

    if (!channel) {
      return this.bufferPublish(exchange, routingKey, parsed);
    }

    try {
      await this.publishNow(channel, exchange, routingKey, parsed);
    } catch (error) {
      if (!this.channel) {
        return this.bufferPublish(exchange, routingKey, parsed);
      }
      throw error;
    }
  }

  private async publishNow(
    channel: ConfirmChannel,
    exchange: string,
    routingKey: string,
    message: RabbitMessage
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      channel.publish(exchange, routingKey, Buffer.from(JSON.stringify(message)), {
        contentType: 'application/json',
        deliveryMode: 2,
        messageId: message.id,
        correlationId: message.metadata.correlationId ?? undefined,
        timestamp: Date.now()
      }, (error: unknown) => {
        if (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        resolve();
      });
    });
  }

  private bufferPublish(exchange: string, routingKey: string, message: RabbitMessage): Promise<void> {
    if (this.bufferedPublishes.length >= MAX_BUFFERED_PUBLISHES) {
      return Promise.reject(new Error(`RabbitMQ publish buffer exceeded ${MAX_BUFFERED_PUBLISHES} messages`));
    }

    return new Promise((resolve, reject) => {
      this.bufferedPublishes.push({
        exchange,
        routingKey,
        message,
        resolve,
        reject
      });
      this.scheduleReconnect();
    });
  }

  private async drainBufferedPublishes(): Promise<void> {
    while (this.channel && this.bufferedPublishes.length > 0) {
      const next = this.bufferedPublishes.shift();
      if (!next) {
        return;
      }

      try {
        await this.publishNow(this.channel, next.exchange, next.routingKey, next.message);
        next.resolve();
      } catch (error) {
        next.reject(error instanceof Error ? error : new Error('Buffered RabbitMQ publish failed'));
        this.scheduleReconnect();
        return;
      }
    }
  }

  async publishAndWait(
    routingKey: string,
    payload: Record<string, unknown>,
    metadata: { studyId?: string; runId?: string } = {}
  ): Promise<Record<string, unknown>> {
    const correlationId = randomUUID();
    const message: RabbitMessage = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      routingKey,
      producer: 'core-api',
      type: 'command',
      payload,
      metadata: {
        studyId: metadata.studyId ?? null,
        runId: metadata.runId ?? null,
        correlationId
      }
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingResponses.delete(correlationId);
        reject(new Error(`Timed out waiting for command response: ${routingKey}`));
      }, 15_000);

      this.pendingResponses.set(correlationId, { resolve, reject, timeout });

      this.publish(RABBITMQ_EXCHANGES.commands, routingKey, message).catch((error: unknown) => {
        clearTimeout(timeout);
        this.pendingResponses.delete(correlationId);
        reject(error instanceof Error ? error : new Error('Failed to publish command'));
      });
    });
  }

  resolvePending(correlationId: string | null | undefined, payload: Record<string, unknown>): void {
    if (!correlationId) {
      return;
    }

    const pending = this.pendingResponses.get(correlationId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingResponses.delete(correlationId);
    pending.resolve(payload);
  }

  rejectPending(correlationId: string | null | undefined, error: Error): void {
    if (!correlationId) {
      return;
    }

    const pending = this.pendingResponses.get(correlationId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingResponses.delete(correlationId);
    pending.reject(error);
  }

  async consume(queue: string, handler: (message: RabbitMessage) => Promise<void>): Promise<void> {
    this.consumers.set(queue, {
      queue,
      handler
    });

    if (this.channel) {
      await this.consumeNow(this.channel, queue, handler);
    }
  }

  private async restoreConsumers(): Promise<void> {
    if (!this.channel) {
      return;
    }

    for (const consumer of this.consumers.values()) {
      await this.consumeNow(this.channel, consumer.queue, consumer.handler);
    }
  }

  private async consumeNow(
    channel: ConfirmChannel,
    queue: string,
    handler: (message: RabbitMessage) => Promise<void>
  ): Promise<void> {
    await channel.consume(queue, async (raw) => {
      if (!raw) {
        return;
      }

      await this.handleMessage(channel, raw, handler);
    });
  }

  private async handleMessage(
    channel: ConfirmChannel,
    raw: ConsumeMessage,
    handler: (message: RabbitMessage) => Promise<void>
  ): Promise<void> {
    try {
      const parsed = rabbitMessageSchema.parse(JSON.parse(raw.content.toString('utf8')));
      if (this.processedMessageIds.has(parsed.id)) {
        channel.ack(raw);
        return;
      }

      await handler(parsed);
      this.markProcessed(parsed.id);
      channel.ack(raw);
    } catch (error) {
      console.error('RabbitMQ consumer failed; dead-lettering message', error);
      channel.nack(raw, false, false);
    }
  }

  private markProcessed(messageId: string): void {
    this.processedMessageIds.add(messageId);
    this.processedMessageIdOrder.push(messageId);

    while (this.processedMessageIdOrder.length > MAX_PROCESSED_MESSAGE_IDS) {
      const oldest = this.processedMessageIdOrder.shift();
      if (oldest) {
        this.processedMessageIds.delete(oldest);
      }
    }
  }
}
