import type { Readable } from "node:stream";

export type PutObjectResult = {
  key: string;
  bucket?: string;
};

export type ObjectStorageAdapter = {
  putObject(params: {
    key: string;
    body: Buffer;
    contentType: string;
    tenantId: string;
  }): Promise<PutObjectResult>;
  /** Stream object bytes (same `storageKey` / `storageBucket` as in `Document`). */
  getObjectStream(params: {
    key: string;
    bucket?: string | null;
  }): Promise<{ stream: Readable; contentLength?: number }>;
  getPublicUrl?(key: string): string;
};
