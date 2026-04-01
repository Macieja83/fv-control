import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ObjectStorageAdapter } from "./storage.types.js";

export function createLocalObjectStorage(uploadRoot: string): ObjectStorageAdapter {
  return {
    async putObject({ key, body, tenantId }) {
      const dir = join(uploadRoot, "objects", tenantId);
      await mkdir(dir, { recursive: true });
      const full = join(dir, key.replace(/[/\\]/g, "_"));
      await writeFile(full, body);
      return { key: join("objects", tenantId, key.replace(/[/\\]/g, "_")) };
    },
    async getObjectStream({ key }) {
      const full = join(uploadRoot, key);
      const st = await stat(full);
      return { stream: createReadStream(full), contentLength: st.size };
    },
  };
}
