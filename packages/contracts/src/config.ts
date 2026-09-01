import { z } from "zod";

import { SimulatorTypeSchema } from "./simulator.js";

const PortSchema = z.number().int().min(1).max(65_535);
const NonEmptyPathSchema = z.string().trim().min(1);
const PositiveDurationSchema = z.number().int().positive();
const PositiveRateSchema = z.number().positive().max(1_000);

export const ScarlineConfigSchema = z
  .object({
    version: z.literal(1),
    bootstrap: z
      .object({
        admin_username: z
          .string()
          .trim()
          .min(1)
          .max(100)
          .regex(/^[a-zA-Z0-9_.-]+$/),
      })
      .strict(),
    api: z
      .object({
        allowed_origins: z.array(z.string().url()).min(1),
        command_timeout_seconds: PositiveDurationSchema,
        access_token_ttl_minutes: PositiveDurationSchema,
        refresh_token_ttl_days: PositiveDurationSchema,
        overlay_token_ttl_minutes: PositiveDurationSchema,
        overlay_renderer_session_ttl_hours: PositiveDurationSchema,
        pagination_default_limit: z.number().int().min(1).max(500),
        pagination_max_limit: z.number().int().min(1).max(1_000),
        event_batch_size: z.number().int().min(1).max(10_000),
        event_flush_milliseconds: z.number().int().min(10).max(60_000),
        exports_directory: NonEmptyPathSchema,
        widgets_directory: NonEmptyPathSchema,
        sensors_directory: NonEmptyPathSchema,
      })
      .strict()
      .refine(
        (value) => value.pagination_default_limit <= value.pagination_max_limit,
        { message: "pagination_default_limit must not exceed pagination_max_limit" },
      ),
    platform: z
      .object({
        environment: z.enum(["development", "test", "production"]),
        port: PortSchema,
        runtime_directory: NonEmptyPathSchema,
        open_browser: z.boolean(),
        startup_timeout_seconds: z.number().int().positive(),
        shutdown_timeout_seconds: z.number().int().positive(),
      })
      .strict(),
    docker: z
      .object({
        compose_file: NonEmptyPathSchema,
        project_name: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
        remove_orphans: z.boolean(),
      })
      .strict(),
    database: z
      .object({
        host: z.string().trim().min(1),
        port: PortSchema,
        name: z.string().trim().min(1),
        user: z.string().trim().min(1),
      })
      .strict(),
    rabbitmq: z
      .object({
        host: z.string().trim().min(1),
        port: PortSchema,
        management_port: PortSchema,
        user: z.string().trim().min(1),
      })
      .strict(),
    sim_bridge: z
      .object({
        host: z.string().trim().min(1),
        public_host: z.string().trim().min(1),
        port: PortSchema,
        adapter_path: z.string().regex(/^\/[a-z0-9/_-]*$/),
        adapter_command_timeout_seconds: PositiveDurationSchema,
        adapter_heartbeat_interval_seconds: PositiveDurationSchema,
        adapter_stale_timeout_seconds: PositiveDurationSchema,
        adapter_reconnect_grace_seconds: PositiveDurationSchema,
        maximum_websocket_message_bytes: z.number().int().min(1_024).max(16_777_216),
        telemetry_maximum_hz: PositiveRateSchema,
        command_journal: NonEmptyPathSchema,
      })
      .strict()
      .refine(
        (value) => value.adapter_heartbeat_interval_seconds < value.adapter_stale_timeout_seconds,
        { message: "adapter_heartbeat_interval_seconds must be less than adapter_stale_timeout_seconds" },
      ),
    simulator: z
      .object({
        default: SimulatorTypeSchema,
        autostart: z.boolean(),
        carla: z
          .object({
            version: z.literal("0.9.16"),
            executable: NonEmptyPathSchema.nullable(),
            public_host: z.literal("127.0.0.1"),
            host: z.literal("host.docker.internal"),
            port: z.literal(2000),
            quality: z.enum(["Low", "Epic"]),
            additional_arguments: z.array(z.string().trim().min(1)),
            synchronous_mode: z.literal(true),
            fixed_delta_seconds: z.literal(0.05),
            adapter_id: z.string().regex(/^[a-z][a-z0-9-]*$/),
            priority: z.number().int().min(0).max(10_000),
            reconnect_interval_seconds: PositiveDurationSchema,
            health_port: PortSchema,
            command_journal: NonEmptyPathSchema,
            media_directory: NonEmptyPathSchema,
            control_timeout_milliseconds: z.number().int().min(100).max(10_000),
          })
          .strict(),
        mock: z
          .object({
            enabled: z.boolean(),
            telemetry_hz: PositiveRateSchema.max(20),
            adapter_id: z.string().regex(/^[a-z][a-z0-9-]*$/),
            priority: z.number().int().min(0).max(10_000),
            reconnect_interval_seconds: PositiveDurationSchema,
            command_journal: NonEmptyPathSchema,
          })
          .strict(),
      })
      .strict(),
    services: z
      .object({
        core_api: z.object({ enabled: z.boolean() }).strict(),
        admin_panel: z.object({ enabled: z.boolean(), port: PortSchema }).strict(),
        sim_bridge: z.object({ enabled: z.boolean() }).strict(),
        overlay_web: z
          .object({
            enabled: z.boolean(),
            port: PortSchema,
            public_origin: z.string().url(),
          })
          .strict(),
        desktop_overlay: z.object({ enabled: z.boolean() }).strict(),
        io_client: z.object({
          enabled: z.boolean(),
          runtime: z.enum(["host", "docker"]),
          python_executable: NonEmptyPathSchema,
          heartbeat_interval_seconds: PositiveDurationSchema,
          stale_timeout_seconds: PositiveDurationSchema,
          health_port: PortSchema,
          command_journal: NonEmptyPathSchema,
          media_directory: NonEmptyPathSchema,
          mock_enabled: z.boolean(),
          batch_max_samples: z.number().int().min(1).max(10_000),
          batch_max_milliseconds: z.number().int().min(10).max(10_000),
        }).strict().refine(
          (value) => value.heartbeat_interval_seconds < value.stale_timeout_seconds,
          { message: "heartbeat_interval_seconds must be less than stale_timeout_seconds" },
        ),
      })
      .strict(),
    logging: z
      .object({
        level: z.enum(["trace", "debug", "info", "warn", "error"]),
        directory: NonEmptyPathSchema,
      })
      .strict(),
  })
  .strict();

export const EnvironmentSecretsSchema = z
  .object({
    POSTGRES_PASSWORD: z.string().min(1),
    RABBITMQ_DEFAULT_PASS: z.string().min(1),
    JWT_ACCESS_SECRET: z.string().min(32),
    REFRESH_TOKEN_PEPPER: z.string().min(32),
    BOOTSTRAP_ADMIN_PASSWORD: z.string().min(1).max(128),
    OVERLAY_CONTROL_SECRET: z.string().min(32),
    SIM_BRIDGE_ADAPTER_SECRET: z.string().min(32),
  })
  .strict();

export const CoreApiSecretsSchema = EnvironmentSecretsSchema.pick({
  POSTGRES_PASSWORD: true,
  RABBITMQ_DEFAULT_PASS: true,
  JWT_ACCESS_SECRET: true,
  REFRESH_TOKEN_PEPPER: true,
  BOOTSTRAP_ADMIN_PASSWORD: true,
  OVERLAY_CONTROL_SECRET: true,
});

export const SimBridgeSecretsSchema = EnvironmentSecretsSchema.pick({
  RABBITMQ_DEFAULT_PASS: true,
  SIM_BRIDGE_ADAPTER_SECRET: true,
});

export const SimulatorAdapterSecretsSchema = EnvironmentSecretsSchema.pick({
  SIM_BRIDGE_ADAPTER_SECRET: true,
});

export type ScarlineConfig = z.infer<typeof ScarlineConfigSchema>;
export type EnvironmentSecrets = z.infer<typeof EnvironmentSecretsSchema>;
export type CoreApiSecrets = z.infer<typeof CoreApiSecretsSchema>;
export type SimBridgeSecrets = z.infer<typeof SimBridgeSecretsSchema>;
export type SimulatorAdapterSecrets = z.infer<typeof SimulatorAdapterSecretsSchema>;
