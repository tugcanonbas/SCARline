import type { FastifyBaseLogger } from "fastify";
import type { PlatformHealth } from "@scarline/contracts";
import type { Pool } from "pg";

import type { CoreApiConfig } from "./config.js";
import { AdminBootstrapService } from "./bootstrap/admin.js";
import { checkDatabase, createDatabasePool } from "./infrastructure/database.js";
import { RabbitConnection, createRabbitUrl } from "./infrastructure/rabbitmq.js";

export interface CoreApiRuntime {
  start(): Promise<void>;
  stop(): Promise<void>;
  liveness(): PlatformHealth;
  readiness(): Promise<PlatformHealth>;
}

export interface ManagedCoreApiService {
  start(): Promise<void> | void;
  stop(): Promise<void> | void;
}

export class ProductionCoreApiRuntime implements CoreApiRuntime {
  readonly #pool: Pool;
  readonly #rabbit: RabbitConnection;
  readonly #bootstrap: AdminBootstrapService;
  readonly #services: ManagedCoreApiService[] = [];
  #started = false;
  readonly config: CoreApiConfig;

  constructor(config: CoreApiConfig, logger: FastifyBaseLogger) {
    this.config = config;
    this.#pool = createDatabasePool(config, logger);
    this.#rabbit = new RabbitConnection(
      createRabbitUrl(
        config.project.rabbitmq.host,
        config.project.rabbitmq.port,
        config.project.rabbitmq.user,
        config.secrets.RABBITMQ_DEFAULT_PASS,
      ),
      logger,
    );
    this.#bootstrap = new AdminBootstrapService(
      this.#pool,
      config.project.bootstrap.admin_username,
      config.secrets.BOOTSTRAP_ADMIN_PASSWORD,
      logger,
    );
  }

  get pool(): Pool {
    return this.#pool;
  }

  get rabbit(): RabbitConnection {
    return this.#rabbit;
  }

  registerService(service: ManagedCoreApiService): void {
    if (this.#started) {
      throw new Error("CoreAPI services must be registered before runtime start");
    }
    this.#services.push(service);
  }

  async start(): Promise<void> {
    if (this.#started) {
      return;
    }
    this.#started = true;
    this.#bootstrap.start();
    await this.#rabbit.start();
    for (const service of this.#services) {
      await service.start();
    }
  }

  async stop(): Promise<void> {
    if (!this.#started) {
      return;
    }
    this.#started = false;
    this.#bootstrap.stop();
    await Promise.all(this.#services.map((service) => service.stop()));
    await Promise.all([this.#rabbit.close(), this.#pool.end()]);
  }

  liveness(): PlatformHealth {
    const checkedAt = new Date().toISOString();
    return {
      status: "healthy",
      checkedAt,
      components: [
        {
          componentId: "core-api",
          status: "healthy",
          checkedAt,
          message: null,
          metadata: {},
        },
      ],
    };
  }

  async readiness(): Promise<PlatformHealth> {
    const checkedAt = new Date().toISOString();
    let databaseHealthy = false;
    let databaseMessage: string | null = null;
    try {
      await checkDatabase(this.#pool);
      databaseHealthy = true;
    } catch {
      databaseMessage = "PostgreSQL connection is not ready";
    }

    const rabbitHealthy = this.#rabbit.isReady;
    const bootstrapHealthy = this.#bootstrap.isComplete;
    const ready = databaseHealthy && rabbitHealthy && bootstrapHealthy;

    return {
      status: ready ? "healthy" : "degraded",
      checkedAt,
      components: [
        {
          componentId: "core-api",
          status: bootstrapHealthy ? "healthy" : "starting",
          checkedAt,
          message: bootstrapHealthy
            ? null
            : this.#bootstrap.lastError ?? "administrator bootstrap pending",
          metadata: {},
        },
        {
          componentId: "database",
          status: databaseHealthy ? "healthy" : "unhealthy",
          checkedAt,
          message: databaseMessage,
          metadata: {},
        },
        {
          componentId: "rabbitmq",
          status: rabbitHealthy ? "healthy" : "unavailable",
          checkedAt,
          message: rabbitHealthy ? null : "RabbitMQ connection is not ready",
          metadata: {},
        },
      ],
    };
  }
}
