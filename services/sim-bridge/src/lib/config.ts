import { z } from 'zod';

const configSchema = z.object({
  PORT: z.coerce.number().int().positive().default(9000),
  AMQP_URL: z.string().min(1)
});

export type SimBridgeConfig = z.infer<typeof configSchema>;

export function loadConfig(): SimBridgeConfig {
  return configSchema.parse(process.env);
}
