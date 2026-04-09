import amqp, { type Channel } from 'amqplib';
import { rabbitMessageSchema, RABBITMQ_EXCHANGES } from '@scarline/contracts';
import type { RabbitMessage } from '@scarline/contracts';

export class RabbitManager {
  private connection: Awaited<ReturnType<typeof amqp.connect>> | null = null;
  private channel: Channel | null = null;

  constructor(private readonly url: string) {}

  async connect(): Promise<void> {
    this.connection = await amqp.connect(this.url);
    this.channel = await this.connection.createChannel();
    await this.channel.assertExchange(RABBITMQ_EXCHANGES.events, 'topic', { durable: true });
    await this.channel.assertExchange(RABBITMQ_EXCHANGES.commands, 'topic', { durable: true });
  }

  async publish(message: RabbitMessage): Promise<void> {
    if (!this.channel) {
      throw new Error('Rabbit channel unavailable');
    }

    rabbitMessageSchema.parse(message);
    this.channel.publish(
      message.type === 'event' ? RABBITMQ_EXCHANGES.events : RABBITMQ_EXCHANGES.commands,
      message.routingKey,
      Buffer.from(JSON.stringify(message)),
      {
        contentType: 'application/json',
        deliveryMode: 2,
        messageId: message.id,
        correlationId: message.metadata.correlationId ?? undefined
      }
    );
  }

  async consume(queue: string, handler: (message: RabbitMessage) => Promise<void>): Promise<void> {
    if (!this.channel) {
      throw new Error('Rabbit channel unavailable');
    }

    await this.channel.consume(queue, async (raw) => {
      if (!raw) {
        return;
      }

      try {
        const message = rabbitMessageSchema.parse(JSON.parse(raw.content.toString('utf8')));
        await handler(message);
        this.channel?.ack(raw);
      } catch (error) {
        this.channel?.nack(raw, false, false);
        throw error;
      }
    });
  }
}
