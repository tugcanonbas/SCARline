import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().min(1),
  AMQP_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16).default('scarline-development-secret'),
  PM_SOCKET_PATH: z.string().default('/tmp/scarline.sock'),
  SCARLINE_INTERNAL_API_TOKEN: z.string().min(16).default('scarline-development-internal-token'),
  SCARLINE_PORT: z.coerce.number().int().positive().default(8088),
  WIDGETS_DIR: z.string().default('/workspace/widgets'),
  EXPORTS_DIR: z.string().default('/data/scarline/exports')
});

export type CoreApiConfig = z.infer<typeof configSchema>;

export function loadConfig(): CoreApiConfig {
  return configSchema.parse(process.env);
}
