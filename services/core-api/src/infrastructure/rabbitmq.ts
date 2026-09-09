import type { FastifyBaseLogger } from "fastify";
import amqp, { type ChannelModel, type ConfirmChannel, type ConsumeMessage } from "amqplib";

import {
  MessageEnvelopeSchema,
  RABBITMQ_EXCHANGES,
  type MessageEnvelope,
} from "@scarline/contracts";

const RECONNECT_DELAY_MILLISECONDS = 5_000;
const CORE_COMMAND_QUEUE = "scarline.core-api.commands";
const CORE_EVENT_QUEUE = "scarline.core-api.events";
const CORE_DEAD_LETTER_QUEUE = "scarline.core-api.dead-letters";

export type RabbitMessageHandler = (message: MessageEnvelope) => Promise<void>;

interface ConsumerDefinition {
  readonly queue: string;
  readonly exchange: string;
  readonly patterns: readonly string[];
  readonly handler: RabbitMessageHandler;
}

export class RabbitConnection {
  readonly #url: string;
  readonly #logger: FastifyBaseLogger;
  readonly #consumers: ConsumerDefinition[] = [];
  #connection: ChannelModel | undefined;
  #channel: ConfirmChannel | undefined;
  #connecting: Promise<void> | undefined;
  #reconnectTimer: NodeJS.Timeout | undefined;
  #stopped = true;

  constructor(url: string, logger: FastifyBaseLogger) {
    this.#url = url;
    this.#logger = logger;
  }

  get isReady(): boolean {
    return this.#connection !== undefined && this.#channel !== undefined;
  }

  registerCoreCommandConsumer(handler: RabbitMessageHandler): void {
    this.#registerConsumer({
      queue: CORE_COMMAND_QUEUE,
      exchange: RABBITMQ_EXCHANGES.commands,
      patterns: ["commands.core-api.*"],
      handler,
    });
  }

  registerCoreEventConsumer(handler: RabbitMessageHandler): void {
    this.#registerConsumer({
      queue: CORE_EVENT_QUEUE,
      exchange: RABBITMQ_EXCHANGES.events,
      patterns: ["events.#"],
      handler,
    });
  }

  async publish(envelope: MessageEnvelope): Promise<void> {
    const parsed = MessageEnvelopeSchema.parse(envelope);
    const channel = this.#channel;
    if (channel === undefined) throw new Error("RabbitMQ channel is not ready");
    const exchange = parsed.routingKey.startsWith("commands.")
      ? RABBITMQ_EXCHANGES.commands
      : RABBITMQ_EXCHANGES.events;
    channel.publish(exchange, parsed.routingKey, Buffer.from(JSON.stringify(parsed)), {
      contentType: "application/json",
      deliveryMode: 2,
      messageId: parsed.id,
      timestamp: Date.parse(parsed.timestamp),
    });
    await channel.waitForConfirms();
  }

  async start(): Promise<void> {
    if (!this.#stopped) return;
    this.#stopped = false;
    await this.#connect();
  }

  async close(): Promise<void> {
    this.#stopped = true;
    if (this.#reconnectTimer !== undefined) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = undefined;
    }
    const channel = this.#channel;
    const connection = this.#connection;
    this.#channel = undefined;
    this.#connection = undefined;
    await channel?.close().catch(() => undefined);
    await connection?.close().catch(() => undefined);
  }

  #registerConsumer(definition: ConsumerDefinition): void {
    if (this.#consumers.some(({ queue }) => queue === definition.queue)) {
      throw new Error(`RabbitMQ consumer already registered for ${definition.queue}`);
    }
    this.#consumers.push(definition);
  }

  async #connect(): Promise<void> {
    if (this.#stopped || this.isReady) return;
    if (this.#connecting !== undefined) return this.#connecting;
    this.#connecting = this.#open().finally(() => { this.#connecting = undefined; });
    return this.#connecting;
  }

  async #open(): Promise<void> {
    try {
      const connection = await amqp.connect(this.#url);
      const channel = await connection.createConfirmChannel();
      await Promise.all([
        channel.assertExchange(RABBITMQ_EXCHANGES.commands, "topic", { durable: true }),
        channel.assertExchange(RABBITMQ_EXCHANGES.events, "topic", { durable: true }),
        channel.assertExchange(RABBITMQ_EXCHANGES.deadLetters, "topic", { durable: true }),
      ]);
      await channel.assertQueue(CORE_DEAD_LETTER_QUEUE, { durable: true });
      await channel.bindQueue(CORE_DEAD_LETTER_QUEUE, RABBITMQ_EXCHANGES.deadLetters, "#");
      await channel.prefetch(20);
      for (const consumer of this.#consumers) await this.#activateConsumer(channel, consumer);
      if (this.#stopped) {
        await channel.close();
        await connection.close();
        return;
      }
      this.#connection = connection;
      this.#channel = channel;
      connection.on("error", (error) => this.#logger.warn({ err: error }, "RabbitMQ connection error"));
      connection.on("close", () => {
        this.#connection = undefined;
        this.#channel = undefined;
        if (!this.#stopped) {
          this.#logger.warn("RabbitMQ connection closed; reconnecting");
          this.#scheduleReconnect();
        }
      });
      this.#logger.info("RabbitMQ connection established");
    } catch (error) {
      this.#logger.warn({ err: error }, "RabbitMQ is unavailable; reconnecting");
      this.#scheduleReconnect();
    }
  }

  async #activateConsumer(channel: ConfirmChannel, definition: ConsumerDefinition): Promise<void> {
    await channel.assertQueue(definition.queue, {
      durable: true,
      arguments: {
        "x-dead-letter-exchange": RABBITMQ_EXCHANGES.deadLetters,
        "x-dead-letter-routing-key": `dead.${definition.queue}`,
      },
    });
    for (const pattern of definition.patterns) {
      await channel.bindQueue(definition.queue, definition.exchange, pattern);
    }
    await channel.consume(definition.queue, (raw) => {
      if (raw !== null) void this.#handleDelivery(channel, raw, definition);
    }, { noAck: false });
  }

  async #handleDelivery(channel: ConfirmChannel, raw: ConsumeMessage, definition: ConsumerDefinition): Promise<void> {
    let envelope: MessageEnvelope;
    try {
      envelope = MessageEnvelopeSchema.parse(JSON.parse(raw.content.toString("utf8")));
    } catch (error) {
      this.#logger.error({ err: error, queue: definition.queue }, "Invalid RabbitMQ envelope dead-lettered");
      channel.nack(raw, false, false);
      return;
    }
    try {
      await definition.handler(envelope);
      channel.ack(raw);
    } catch (error) {
      this.#logger.error({ err: error, messageId: envelope.id, queue: definition.queue }, "RabbitMQ handler failed");
      channel.nack(raw, false, false);
    }
  }

  #scheduleReconnect(): void {
    if (this.#stopped || this.#reconnectTimer !== undefined) return;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined;
      void this.#connect();
    }, RECONNECT_DELAY_MILLISECONDS);
    this.#reconnectTimer.unref();
  }
}

export function createRabbitUrl(host: string, port: number, username: string, password: string): string {
  return `amqp://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`;
}
