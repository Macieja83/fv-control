import fp from "fastify-plugin";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { FastifyPluginAsync } from "fastify";
import { loadConfig } from "../config.js";

const swaggerPlugin: FastifyPluginAsync = async (app) => {
  const cfg = loadConfig();
  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: cfg.APP_NAME,
        version: cfg.APP_VERSION,
        description: [
          "**FV Control — publiczne REST API** dla systemu fakturowania z integracją KSeF (Krajowy System eFaktur).",
          "",
          "Dla kogo:",
          "- **Księgowi / biura rachunkowe** — pobieranie faktur klienta przez tenant API key (read-only)",
          "- **Integratorzy systemów ERP/POS** — wystawianie i pobieranie faktur, sync KSeF",
          "- **Dev klientów** — automatyzacje pod custom workflowy",
          "",
          "Autoryzacja:",
          "- **JWT Bearer** (sesja użytkownika z `/auth/login`) — dla UI / własnych skryptów",
          "- **Tenant API key** (planowane, patrz `external/*` namespace) — dla integracji server-to-server",
          "",
          "Konwencje:",
          "- Wszystkie response/request — JSON, encoding UTF-8",
          "- Daty — ISO 8601 z timezone `Europe/Warsaw`",
          "- Kwoty — grosze (integer) lub PLN decimal (zależy od endpointu, opisane per schema)",
          "- Idempotency — header `Idempotency-Key` (UUID) dla operacji POST/PATCH na fakturach",
          "",
          "Status: Public Beta. Breaking changes ogłaszane min. 30 dni wcześniej przez webhook + email.",
        ].join("\n"),
        contact: {
          name: "FV Control — Support",
          email: "kontakt@tuttopizza.pl",
          url: "https://fv.resta.biz",
        },
        license: {
          name: "Proprietary — TT Grupa",
          url: "https://fv.resta.biz/legal/regulamin",
        },
      },
      servers: [
        { url: "/api/v1", description: "Bieżąca instancja (current host)" },
        { url: "https://fv.resta.biz/api/v1", description: "Produkcja" },
      ],
      tags: [
        { name: "System", description: "Health, readiness, version — dla monitoringu" },
        { name: "Auth", description: "Rejestracja, logowanie, weryfikacja email, reset hasła" },
        { name: "Tenant", description: "Konfiguracja tenantu, dane do faktur, API keys" },
        { name: "Invoices", description: "Faktury sprzedaży i zakupu — CRUD, filtracja, eksport" },
        { name: "KSeF", description: "Synchronizacja z Krajowym Systemem eFaktur (MF)" },
        { name: "Billing", description: "Subskrypcje, płatności Stripe, webhook" },
        { name: "Ingestion", description: "Import faktur (upload, IMAP, API)" },
        { name: "Contractors", description: "Kontrahenci (klienci/dostawcy), GUS BIR autocomplete" },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
            description: "JWT access token z `POST /auth/login`. TTL: 15 min, refresh przez `POST /auth/refresh`.",
          },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: true,
      tryItOutEnabled: true,
      persistAuthorization: true,
    },
    staticCSP: true,
  });
};

export default fp(swaggerPlugin, { name: "swagger" });
