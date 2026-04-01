import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";
import type { AppConfig } from "../../config.js";
import type { ObjectStorageAdapter } from "./storage.types.js";

export function createS3ObjectStorage(cfg: AppConfig): ObjectStorageAdapter {
  if (!cfg.S3_ENDPOINT || !cfg.S3_ACCESS_KEY || !cfg.S3_SECRET_KEY) {
    throw new Error("S3 storage selected but S3_ENDPOINT / keys are missing");
  }
  const client = new S3Client({
    region: cfg.S3_REGION,
    endpoint: cfg.S3_ENDPOINT,
    credentials: {
      accessKeyId: cfg.S3_ACCESS_KEY,
      secretAccessKey: cfg.S3_SECRET_KEY,
    },
    forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
  });

  return {
    async putObject({ key, body, contentType, tenantId }) {
      const objectKey = `${tenantId}/${key}`;
      await client.send(
        new PutObjectCommand({
          Bucket: cfg.S3_BUCKET,
          Key: objectKey,
          Body: body,
          ContentType: contentType,
        }),
      );
      return { key: objectKey, bucket: cfg.S3_BUCKET };
    },
    async getObjectStream({ key, bucket }) {
      const Bucket = bucket ?? cfg.S3_BUCKET;
      const out = await client.send(new GetObjectCommand({ Bucket, Key: key }));
      const body = out.Body;
      if (!body || typeof body !== "object" || !("pipe" in body)) {
        throw new Error("S3 GetObject body is not a readable stream");
      }
      return {
        stream: body as Readable,
        contentLength: out.ContentLength ?? undefined,
      };
    },
    getPublicUrl(key: string) {
      return `${cfg.S3_ENDPOINT?.replace(/\/$/, "")}/${cfg.S3_BUCKET}/${key}`;
    },
  };
}
