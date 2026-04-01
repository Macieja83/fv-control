import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 chars"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be at least 32 chars"),
  JWT_ACCESS_TTL_MIN: z.coerce.number().int().positive().default(15),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  UPLOAD_DIR: z.string().default("./storage/uploads"),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(25),
  ENCRYPTION_KEY: z
    .string()
    .min(1)
    .describe("Base64-encoded 32-byte key for AES-256-GCM (POS API keys)"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_LOGIN_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  APP_NAME: z.string().default("FV Resta API"),
  APP_VERSION: z.string().default("1.0.0"),
});

export type AppConfig = z.infer<typeof envSchema>;

function parseCorsOrigins(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

let cached: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (process.env.NODE_ENV === "production" && cached) {
    return cached;
  }
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.flatten().fieldErrors;
    throw new Error(`Invalid environment: ${JSON.stringify(msg)}`);
  }
  if (process.env.NODE_ENV === "production") {
    cached = parsed.data;
  }
  return parsed.data;
}

export function getCorsOriginList(): string[] {
  return parseCorsOrigins(loadConfig().CORS_ORIGINS);
}
