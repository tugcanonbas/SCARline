import type { FastifyBaseLogger } from "fastify";
import amqp, { type ChannelModel, type ConfirmChannel, type ConsumeMessage } from "amqplib";

import {
  MessageEnvelopeSchema,
  RABBITMQ_EXCHANGES,
  type MessageEnvelope,
} from "@scarline/contracts";

const COMMAND_QUEUE = "scarline.sim-bridge.commands";
const DEAD_LETTER_QUEUE = "scarline.sim-bridge.dead-letters";
const RECONNECT_DELAY_MILLISECONDS = 5_000;

export type CommandHandler = (message: MessageEnvelope) => Promise<void>;
export type RealtimeHandler = (message: unknown) => Promise<void>;

export class SimBridgeRabbitConnection {
  readonly #url: string;
  readonly #logger: FastifyBaseLogger;
  readonly #handler: CommandHandler;
  readonly #realtimeHandler: RealtimeHandler;
  #connection: ChannelModel | undefined;
  #channel: ConfirmChannel | undefined;
  #connecting: Promise<void> | undefined;
  #reconnectTimer: NodeJS.Timeout | undefined;
  #stopped = true;

  constructor(
    url: string,
    logger: FastifyBaseLogger,
    handler: CommandHandler,
    realtimeHandler: RealtimeHandler,
  ) {
    this.#url = url;
    this.#logger = logger;
    this.#handler = handler;
    this.#realtimeHandler = realtimeHandler;
  }

  get isReady(): boolean {
    return this.#connection !== undefined && this.#channel !== undefined;
  }

  async start(): Promise<void> {
    if (!this.#stopped) return;
    this.#stopped = false;
    await this.#connect();
  }

  async close(): Promise<void> {
    this.#stopped = true;
    if (this.#reconnectTimer !== undefined) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = undefined;
    const channel = this.#channel;
    const connection = this.#connection;
    this.#channel = undefined;
    this.#connection = undefined;
    await channel?.close().catch(() => undefined);
    await connection?.close().catch(() => undefined);
  }

  async publish(envelope: MessageEnvelope): Promise<void> {
    const parsed = MessageEnvelopeSchema.parse(envelope);
    const channel = this.#channel;
    if (channel === undefined) throw new Error("RabbitMQ channel is not ready.");
    const exchange = parsed.routingKey.startsWith("commands.")
      ? RABBITMQ_EXCHANGES.commands
      : RABBITMQ_EXCHANGES.events;
    channel.publish(exchange, parsed.routingKey, Buffer.from(JSON.stringify(parsed)), {
      contentType: "application/json",
      deliveryMode: 2,
      messageId: parsed.id,
      correlationId: parsed.metadata.correlationId ?? undefined,
      timestamp: Date.parse(parsed.timestamp),
    });
    await channel.waitForConfirms();
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
        channel.assertExchange(RABBITMQ_EXCHANGES.realtime, "topic", { durable: true }),
        channel.assertExchange(RABBITMQ_EXCHANGES.deadLetters, "topic", { durable: true }),
      ]);
      await channel.assertQueue(DEAD_LETTER_QUEUE, { durable: true });
      await channel.bindQueue(DEAD_LETTER_QUEUE, RABBITMQ_EXCHANGES.deadLetters, "dead.scarline.sim-bridge.#");
      await channel.assertQueue(COMMAND_QUEUE, {
        durable: true,
        arguments: {
          "x-dead-letter-exchange": RABBITMQ_EXCHANGES.deadLetters,
          "x-dead-letter-routing-key": `dead.${COMMAND_QUEUE}`,
        },
      });
      await channel.bindQueue(COMMAND_QUEUE, RABBITMQ_EXCHANGES.commands, "commands.sim-bridge.*");
      const realtimeQueue = await channel.assertQueue("", { exclusive: true, autoDelete: true });
      await channel.bindQueue(realtimeQueue.queue, RABBITMQ_EXCHANGES.realtime, "controls.*");
      await channel.prefetch(10);
      await channel.consume(COMMAND_QUEUE, (raw) => {
        if (raw !== null) void this.#handleDelivery(channel, raw);
      }, { noAck: false });
      await channel.consume(realtimeQueue.queue, (raw) => {
        if (raw !== null) void this.#handleRealtimeDelivery(channel, raw);
      }, { noAck: false });
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
        if (!this.#stopped) this.#scheduleReconnect();
      });
      this.#logger.info("Sim Bridge connected to RabbitMQ");
    } catch (error) {
      this.#logger.warn({ err: error }, "RabbitMQ is unavailable; Sim Bridge will reconnect");
      this.#scheduleReconnect();
    }
  }

  async #handleDelivery(channel: ConfirmChannel, raw: ConsumeMessage): Promise<void> {
    let envelope: MessageEnvelope;
    try {
      envelope = MessageEnvelopeSchema.parse(JSON.parse(raw.content.toString("utf8")));
    } catch (error) {
      this.#logger.error({ err: error }, "Invalid Sim Bridge command was dead-lettered");
      channel.nack(raw, false, false);
      return;
    }
    try {
      await this.#handler(envelope);
      channel.ack(raw);
    } catch (error) {
      const requeue = !raw.fields.redelivered;
      this.#logger.error(
        { err: error, messageId: envelope.id, requeue },
        requeue
          ? "Sim Bridge command processing failed; retrying once"
          : "Sim Bridge command processing failed again; dead-lettering",
      );
      channel.nack(raw, false, requeue);
    }
  }

  async #handleRealtimeDelivery(channel: ConfirmChannel, raw: ConsumeMessage): Promise<void> {
    try {
      await this.#realtimeHandler(JSON.parse(raw.content.toString("utf8")) as unknown);
    } catch (error) {
      this.#logger.warn({ err: error }, "Invalid real-time simulator control was dropped");
    } finally {
      channel.ack(raw);
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
