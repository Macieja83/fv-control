declare module "mailparser" {
  import type { Readable } from "node:stream";

  export type AddressObject = { text?: string; value?: Array<{ address?: string; name?: string }> };

  export function simpleParser(source: Buffer | string | Readable): Promise<{
    messageId?: string;
    subject?: string;
    date?: Date;
    from?: AddressObject;
    headers?: Map<string, unknown>;
    attachments?: Array<{
      filename?: string;
      contentType?: string;
      content: Buffer;
    }>;
  }>;
}
