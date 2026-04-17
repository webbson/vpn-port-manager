import { z } from "zod";

const configSchema = z.object({
  port: z.number().int().positive().default(3000),
  appSecretKey: z.string().min(16, "APP_SECRET_KEY must be at least 16 characters"),
  dbPath: z.string().min(1).default("/data/vpnportmanager.db"),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  return configSchema.parse({
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
    appSecretKey: process.env.APP_SECRET_KEY,
    dbPath: process.env.DB_PATH,
  });
}
