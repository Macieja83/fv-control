import { loadConfig } from "../../config.js";
import { createLocalObjectStorage } from "./local-object.storage.js";
import { createS3ObjectStorage } from "./s3-object.storage.js";
import type { ObjectStorageAdapter } from "./storage.types.js";

export function createObjectStorage(): ObjectStorageAdapter {
  const cfg = loadConfig();
  if (cfg.STORAGE_DRIVER === "s3") {
    return createS3ObjectStorage(cfg);
  }
  return createLocalObjectStorage(cfg.UPLOAD_DIR);
}
