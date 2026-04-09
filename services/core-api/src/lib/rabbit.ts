import { randomUUID } from 'node:crypto';
import amqp, { type Channel, type ConsumeMessage } from 'amqplib';
import {
  rabbitMessageSchema,
  RABBITMQ_EXCHANGES,
  type RabbitMessage
} from '@scarline/contracts';

type PendingResponse = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

export class RabbitManager {
  private connection: Awaited<ReturnType<typeof amqp.connect>> | null = null;
  private channel: Channel | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private readonly pendingResponses = new Map<string, PendingResponse>();

  constructor(private readonly url: string) {}

  async connect(): Promise<void> {
    this.connection = await amqp.connect(this.url);
    this.channel = await this.connection.createChannel();

    this.connection.on('close', () => {
      this.connection = null;
      this.channel = null;
      this.scheduleReconnect();
    });

    await this.channel.assertExchange(RABBITMQ_EXCHANGES.events, 'topic', { durable: true });
    await this.channel.assertExchange(RABBITMQ_EXCHANGES.commands, 'topic', { durable: true });
    await this.channel.assertExchange(RABBITMQ_EXCHANGES.dlx, 'fanout', { durable: true });
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
    }, 2000);
  }

  async publish(exchange: string, routingKey: string, message: RabbitMessage): Promise<void> {
    if (!this.channel) {
      throw new Error('RabbitMQ channel not connected');
    }

    rabbitMessageSchema.parse(message);
    this.channel.publish(exchange, routingKey, Buffer.from(JSON.stringify(message)), {
      contentType: 'application/json',
      deliveryMode: 2,
      messageId: message.id,
      correlationId: message.metadata.correlationId ?? undefined,
      timestamp: Date.now()
    });
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

    await this.publish(RABBITMQ_EXCHANGES.commands, routingKey, message);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingResponses.delete(correlationId);
        reject(new Error(`Timed out waiting for command response: ${routingKey}`));
      }, 15_000);

      this.pendingResponses.set(correlationId, { resolve, reject, timeout });
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
    if (!this.channel) {
      throw new Error('RabbitMQ channel not connected');
    }

    await this.channel.consume(queue, async (raw) => {
      if (!raw) {
        return;
      }

      await this.handleMessage(raw, handler);
    });
  }

  private async handleMessage(raw: ConsumeMessage, handler: (message: RabbitMessage) => Promise<void>): Promise<void> {
    if (!this.channel) {
      return;
    }

    try {
      const parsed = rabbitMessageSchema.parse(JSON.parse(raw.content.toString('utf8')));
      await handler(parsed);
      this.channel.ack(raw);
    } catch (error) {
      this.channel.nack(raw, false, false);
      throw error;
    }
  }
}
