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
  /** Max size for streaming GET …/primary-document (preview); independent of upload limit. */
  MAX_DOCUMENT_PREVIEW_MB: z.coerce.number().positive().default(35),
  ENCRYPTION_KEY: z
    .string()
    .min(1)
    .describe("Base64-encoded 32-byte key for AES-256-GCM (credentials, tokens at rest)"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_LOGIN_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_WEBHOOK_MAX: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_WEBHOOK_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  APP_NAME: z.string().default("FVControl API"),
  APP_VERSION: z.string().default("1.0.0"),

  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
  BULLMQ_PREFIX: z.string().default("fvcontrol"),

  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_BUCKET: z.string().default("fvcontrol-documents"),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),

  FEATURE_AI_EXTRACTION_MOCK: z.coerce.boolean().default(true),
  WEBHOOK_SIGNING_SECRET: z
    .preprocess((v) => (v === "" || v === undefined ? undefined : v), z.string().min(16).optional()),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  KSEF_ENV: z.enum(["sandbox", "production", "mock"]).default("mock"),
  RESTA_API_BASE_URL: z.string().optional(),

  PIPELINE_MAX_ATTEMPTS: z.coerce.number().int().positive().default(8),
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().int().positive().default(24),

  WEBHOOK_DELIVERY_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  WEBHOOK_DELIVERY_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
  WEBHOOK_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  /** Max |now - X-FVControl-Timestamp| for inbound signed webhooks (seconds). */
  WEBHOOK_MAX_SKEW_SECONDS: z.coerce.number().int().positive().default(300),
  /** Delete terminal SENT outbox rows older than this many days (housekeeping). */
  WEBHOOK_OUTBOX_SENT_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  /** Reclaim stuck PROCESSING deliveries not updated for this long (ms). */
  WEBHOOK_PROCESSING_STALE_MS: z.coerce.number().int().positive().default(900_000),
  HOUSEKEEPING_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),

  /** Simplified receipt (paragon z NIP) — max gross in PLN for out-of-KSeF simplified path */
  SIMPLIFIED_RECEIPT_MAX_PLN: z.coerce.number().positive().default(450),
  SIMPLIFIED_RECEIPT_MAX_EUR: z.coerce.number().positive().default(100),

  /** Default n8n / automation webhook URL for outbox events (optional in prod if using per-tenant config later). */
  N8N_WEBHOOK_URL: z.preprocess(
    (v) => (v === "" || v === undefined ? undefined : v),
    z.string().url().optional(),
  ),

  /** Zenbox IMAP (ImapFlow) timeouts */
  IMAP_FLOW_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  IMAP_FLOW_GREETING_TIMEOUT_MS: z.coerce.number().int().positive().default(16_000),
  IMAP_FLOW_SOCKET_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),

  /** Max messages per BullMQ `imap-sync-zenbox` job iteration (UID batch). */
  IMAP_ZENBOX_FETCH_BATCH_SIZE: z.coerce.number().int().positive().default(25),
  /** Safety cap: max UID batches processed in one job run. */
  IMAP_ZENBOX_MAX_BATCHES_PER_JOB: z.coerce.number().int().positive().default(40),
  /** Redis lock TTL (seconds) for per-(tenant, account) sync exclusivity. */
  IMAP_ZENBOX_LOCK_TTL_SEC: z.coerce.number().int().positive().default(600),
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
