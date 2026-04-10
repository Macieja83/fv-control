import { loadConfig } from "../../config.js";
import { createLocalObjectStorage } from "./local-object.storage.js";
import { createS3ObjectStorage } from "./s3-object.storage.js";
import type { ObjectStorageAdapter } from "./storage.types.js";

function hasS3Config(): boolean {
  const cfg = loadConfig();
  return !!(cfg.S3_ENDPOINT && cfg.S3_ACCESS_KEY && cfg.S3_SECRET_KEY);
}

/**
 * Returns a storage adapter that uses the configured driver for writes.
 * For reads, documents with a storageBucket are fetched from S3 regardless
 * of the configured driver — this handles the mixed local+S3 state where
 * IMAP docs live in MinIO and KSeF/camera docs live on local disk.
 */
export function createObjectStorage(): ObjectStorageAdapter {
  const cfg = loadConfig();
  const primary =
    cfg.STORAGE_DRIVER === "s3"
      ? createS3ObjectStorage(cfg)
      : createLocalObjectStorage(cfg.UPLOAD_DIR);

  if (cfg.STORAGE_DRIVER === "s3" || !hasS3Config()) {
    return primary;
  }

  const s3Fallback = createS3ObjectStorage(cfg);
  const local = primary;

  return {
    putObject: (params) => local.putObject(params),
    getObjectStream: async (params) => {
      if (params.bucket) {
        return s3Fallback.getObjectStream(params);
      }
      try {
        return await local.getObjectStream(params);
      } catch {
        // Local file missing — try S3 with key adapted from local format.
        // Local keys look like "objects/<tenantId>/hash-file" while S3
        // stores them as "<tenantId>/hash-file".
        const s3Key = params.key.startsWith("objects/")
          ? params.key.slice("objects/".length)
          : params.key;
        return s3Fallback.getObjectStream({ key: s3Key, bucket: params.bucket });
      }
    },
    getPublicUrl: local.getPublicUrl,
  };
}
