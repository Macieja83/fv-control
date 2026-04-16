import path from "node:path";
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
  UPLOAD_DIR: z
    .string()
    .default("./storage/uploads")
    .transform((p) => (path.isAbsolute(p) ? p : path.resolve(process.cwd(), p))),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(25),
  /** Max size for streaming GET …/primary-document (preview); independent of upload limit. */
  MAX_DOCUMENT_PREVIEW_MB: z.coerce.number().positive().default(35),
  ENCRYPTION_KEY: z
    .string()
    .min(1)
    .refine((v) => {
      try {
        return Buffer.from(v, "base64").length === 32;
      } catch {
        return false;
      }
    }, "ENCRYPTION_KEY must be base64 of exactly 32 bytes")
    .describe("Base64-encoded 32-byte key for AES-256-GCM (credentials, tokens at rest)"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_LOGIN_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_REGISTER_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_REGISTER_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_REFRESH_MAX: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_REFRESH_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_VERIFY_EMAIL_MAX: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_VERIFY_EMAIL_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_RESEND_VERIFICATION_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_RESEND_VERIFICATION_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  /**
   * Limit ręcznego `POST /connectors/ksef/sync` na tenant (po uwierzytelnieniu). 0 = wyłączony.
   */
  RATE_LIMIT_KSEF_SYNC_MAX: z.coerce.number().int().min(0).default(8),
  RATE_LIMIT_KSEF_SYNC_WINDOW_MS: z.coerce.number().int().min(0).default(300_000),
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
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o"),

  /** How often (ms) the worker auto-enqueues IMAP sync for every active mailbox. 0 = disabled. */
  IMAP_AUTO_SYNC_INTERVAL_MS: z.coerce.number().int().min(0).default(300_000),
  METRICS_BEARER_TOKEN: z
    .preprocess((v) => (v === "" || v === undefined ? undefined : v), z.string().min(24).optional()),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().url().optional(),
  WEB_APP_URL: z.string().url().default("http://localhost:5173"),
  /**
   * Jedno konto operatora platformy (lista tenantów, impersonacja, /platform-admin/*).
   * Produkcja: ustaw na adres operatora (np. kontakt@tuttopizza.pl).
   */
  PLATFORM_ADMIN_EMAIL: z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? undefined : String(v).trim().toLowerCase()),
    z.string().email().optional(),
  ),
  /** @deprecated Użyj PLATFORM_ADMIN_EMAIL; pozostawione dla istniejących wdrożeń (lista po przecinku). */
  SUPER_ADMIN_EMAILS: z.string().default(""),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PRICE_ID_STARTER: z.string().optional(),
  STRIPE_PRICE_ID_PRO: z.string().optional(),
  STRIPE_BILLING_WEBHOOK_SECRET: z.preprocess(
    (v) => (v === "" || v === undefined ? undefined : v),
    z.string().min(16).optional(),
  ),
  /** Bazowy URL API dostawcy PISP (np. Tink, Salt Edge) — bez ukończenia integracji endpoint zwraca status „wyłączone”. */
  PISP_PROVIDER_BASE_URL: z.preprocess(
    (v) => (v === "" || v === undefined ? undefined : v),
    z.string().url().optional(),
  ),
  PISP_API_KEY: z.preprocess((v) => (v === "" || v === undefined ? undefined : v), z.string().optional()),
  P24_BILLING_WEBHOOK_SECRET: z.preprocess(
    (v) => (v === "" || v === undefined ? undefined : v),
    z.string().min(16).optional(),
  ),
  KSEF_ENV: z.enum(["sandbox", "production", "mock"]).default("mock"),
  /** KSeF authorization token — raw string or base64-encoded PKCS#5 encrypted blob from the portal. */
  KSEF_TOKEN: z.string().optional(),
  /** Password/PIN used when generating the KSeF token/key (required if KSEF_TOKEN is PKCS#5-encrypted). */
  KSEF_TOKEN_PASSWORD: z.string().optional(),
  /** Base64-encoded DER X.509 certificate for XAdES auth. Required when KSEF_TOKEN is a private key. */
  KSEF_CERT: z.string().optional(),
  /** NIP of the company context for KSeF API auth. */
  KSEF_NIP: z.string().optional(),
  /**
   * Jak często worker próbuje dodać auto-sync KSeF (na tenant). 0 = wyłączone.
   * Domyślnie 5 min; kolizje z limitami MF ogranicza deduplikacja jobów (`auto-ksef:<tenantId>`) + odstępy między zapytaniami.
   */
  KSEF_AUTO_SYNC_INTERVAL_MS: z.coerce.number().int().min(0).default(300_000),
  /**
   * Cache procesowy dla `getKsefQueueSnapshotForTenant` (status KSeF w API). 0 = wyłączony.
   * Krótki TTL ogranicza serie `getJobs` do Redis przy częstym odświeżaniu UI.
   */
  KSEF_QUEUE_SNAPSHOT_CACHE_MS: z.coerce.number().int().min(0).max(60_000).default(2_500),
  /** Min delay (ms) between KSeF GET invoice XML calls (MF limit ~16/min). 0 = no delay. */
  KSEF_INVOICE_FETCH_MIN_INTERVAL_MS: z.coerce.number().int().min(0).default(4_500),
  /**
   * Po pipeline: podmień `Invoice.primaryDocId` na jednostronicowy PDF „podsumowanie” zamiast FA XML.
   * Domyślnie **false** — zostaje XML jako główny dokument (pełny podgląd w UI jak u pozostałych źródeł z treścią faktury).
   * `true` = stare zachowanie (PDF w primary + `GET …?source=ksef-fa-xml` dla pełnego podglądu).
   */
  KSEF_PROMOTE_SUMMARY_PDF_PRIMARY: z.coerce.boolean().default(false),
  /**
   * Zapytania `POST /invoices/query/metadata` — lista ról MF (`Subject1` = m.in. wystawca, `Subject2` = m.in. nabywca).
   * Domyślnie oba: część faktur widoczna w portalu tylko w jednym kontekście; deduplikacja po `ksefNumber`.
   * Skrót: tylko zakupy → `Subject2`.
   */
  KSEF_SYNC_SUBJECT_TYPES: z.preprocess(
    (v) => (v === "" || v === undefined ? "Subject2,Subject1" : String(v).trim()),
    z.string(),
  ).transform((raw): ("Subject1" | "Subject2")[] => {
    const out: ("Subject1" | "Subject2")[] = [];
    const seen = new Set<string>();
    for (const part of raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)) {
      if (part !== "Subject1" && part !== "Subject2") continue;
      if (seen.has(part)) continue;
      seen.add(part);
      out.push(part);
    }
    return out.length > 0 ? out : ["Subject2", "Subject1"];
  }),
  /**
   * Zapytania metadanych: `PermanentStorage` (oficjalny przyrost) oraz opcjonalnie `Issue` (data wystawienia — zgodnie z widokiem w portalu).
   * Gdy MF zwróci błąd dla `Issue`, ten przebieg jest pomijany (nie blokuje zapisu hwmDate z PermanentStorage).
   */
  KSEF_SYNC_DATE_TYPES: z.preprocess(
    (v) => (v === "" || v === undefined ? "PermanentStorage,Issue" : String(v).trim()),
    z.string(),
  ).transform((raw): ("PermanentStorage" | "Issue")[] => {
    const out: ("PermanentStorage" | "Issue")[] = [];
    const seen = new Set<string>();
    for (const part of raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)) {
      if (part !== "PermanentStorage" && part !== "Issue") continue;
      if (seen.has(part)) continue;
      seen.add(part);
      out.push(part);
    }
    return out.length > 0 ? out : ["PermanentStorage", "Issue"];
  }),
  /**
   * Przy automatycznym `from` z hwmDate: cofnij początek o tyle dni względem „teraz” (max z hwm i now−N),
   * żeby ponownie objąć faktury zgrzytające się między datą zapisu a datą wystawienia.
   */
  KSEF_SYNC_HWN_OVERLAP_DAYS: z.coerce.number().int().min(0).max(14).default(7),
  /**
   * Pauza (ms) przed **pierwszym** zapytaniem `dateType=Issue` po przebiegach `PermanentStorage`.
   * MF limituje `POST …/invoices/query/metadata` (np. ~20/h); bez pauzy Issue często zwraca 429 i cały przebieg się pomija.
   * 0 = wyłączone (np. sandbox).
   */
  KSEF_METADATA_INTER_PASS_PAUSE_MS: z.coerce.number().int().min(0).default(90_000),
  /**
   * Pauza (ms) po każdej stronie `POST …/invoices/query/metadata` gdy są kolejne strony (`hasMore`).
   * 0 = wyłączone. Delikatnie rozprasza burst zapytań wobec limitów MF.
   */
  KSEF_METADATA_PAGE_PAUSE_MS: z.coerce.number().int().min(0).default(1_200),
  /**
   * Wysyłka faktur sprzedaży do KSeF: `stub` — tylko zapis PENDING w bazie;
   * `live` — próba wywołania API (wymaga KSEF_ENV≠mock, tokenów i poprawnego XML wg MF).
   */
  KSEF_ISSUANCE_MODE: z.enum(["stub", "live"]).default("stub"),
  /**
   * SaaS multi-tenant: gdy `true`, KSeF **nie** używa globalnych `KSEF_TOKEN` / `KSEF_NIP` z `.env` —
   * tylko poświadczeń zapisanych przez tenanta (Ustawienia). Zalecane na produkcji współdzielonym hoście.
   */
  KSEF_DISABLE_GLOBAL_FALLBACK: z.coerce.boolean().default(false),
  RESTA_API_BASE_URL: z.string().optional(),

  /**
   * GUS BIR 1.1 — wyszukiwarka REGON po NIP (integracja „Wystaw fakturę”).
   * Produkcja: https://wyszukiwarkaregon.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc + klucz z api.stat.gov.pl
   */
  GUS_BIR_SERVICE_URL: z.preprocess((v) => (v === "" || v === undefined ? undefined : v), z.string().url().optional()),
  GUS_BIR_API_KEY: z.preprocess((v) => (v === "" || v === undefined ? undefined : v), z.string().optional()),
  /** Środowisko testowe GUS (klucz domyślny z dokumentacji, jeśli GUS_BIR_API_KEY puste). */
  GUS_BIR_USE_TEST: z.coerce.boolean().default(false),

  PIPELINE_MAX_ATTEMPTS: z.coerce.number().int().positive().default(8),
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().int().positive().default(24),

  HOUSEKEEPING_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),

  /** Simplified receipt (paragon z NIP) — max gross in PLN for out-of-KSeF simplified path */
  SIMPLIFIED_RECEIPT_MAX_PLN: z.coerce.number().positive().default(450),
  SIMPLIFIED_RECEIPT_MAX_EUR: z.coerce.number().positive().default(100),

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
  if (parsed.data.NODE_ENV === "production") {
    if (parsed.data.FEATURE_AI_EXTRACTION_MOCK) {
      throw new Error("Invalid environment: FEATURE_AI_EXTRACTION_MOCK must be false in production");
    }
    if (!parsed.data.METRICS_BEARER_TOKEN) {
      throw new Error("Invalid environment: METRICS_BEARER_TOKEN is required in production");
    }
  }
  if (process.env.NODE_ENV === "production") {
    cached = parsed.data;
  }
  return parsed.data;
}

export function getCorsOriginList(): string[] {
  return parseCorsOrigins(loadConfig().CORS_ORIGINS);
}

/** E-maile z uprawnieniami operatora platformy (zakładka Admin + API platform-admin). */
export function getPlatformAdminEmails(): string[] {
  const cfg = loadConfig();
  if (cfg.PLATFORM_ADMIN_EMAIL) return [cfg.PLATFORM_ADMIN_EMAIL];
  const legacy = cfg.SUPER_ADMIN_EMAILS.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (legacy.length) return [...new Set(legacy)];
  if (cfg.NODE_ENV !== "production") return ["kontakt@tuttopizza.pl"];
  return [];
}

export function isPlatformAdminEmail(email: string): boolean {
  const e = email.trim().toLowerCase();
  return getPlatformAdminEmails().includes(e);
}
