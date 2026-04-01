import "dotenv/config";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

async function main() {
  const cfg = loadConfig();
  const app = await buildApp();
  await app.listen({ port: cfg.PORT, host: cfg.HOST });
  app.log.info({ port: cfg.PORT, host: cfg.HOST }, "server listening");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
