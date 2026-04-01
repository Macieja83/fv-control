# Security hardening (v1)

## Outbound webhook signature (FVControl → receiver)

FVControl signs the **exact UTF-8 string** sent as the HTTP body.

1. Build **canonical JSON** from the payload object: recursively sort object keys (arrays keep order). Same logic as idempotency hashing (`stableStringify`).
2. Let `rawBody` be that UTF-8 string (no extra whitespace).
3. Let `timestamp` be Unix time in **seconds** (decimal string), e.g. `"1710000000"`.
4. Compute:

   ```text
   message = timestamp + "." + rawBody
   signature_hex = HMAC_SHA256(secret, message as UTF-8).digest as lowercase hex
   ```

5. Headers on the POST:

   - `X-FVControl-Timestamp: <timestamp>`
   - `X-FVControl-Signature: sha256=<signature_hex>`
   - Optional: `X-FVControl-Delivery-Attempt: <1-based attempt number>`

### Receiver verification (TypeScript-style)

Use the **raw request body bytes** (before JSON parse). Reject if parsing changes key order relative to what was signed.

```typescript
import { createHmac, timingSafeEqual } from "node:crypto";

function parseSig(h: string | undefined): Buffer | null {
  const m = h?.match(/^sha256=([a-f0-9]{64})$/i);
  return m ? Buffer.from(m[1]!, "hex") : null;
}

function verify(secret: string, rawBodyUtf8: string, sigHeader: string, tsHeader: string, maxSkewSec: number): boolean {
  const sig = parseSig(sigHeader);
  if (!sig || !/^\d+$/.test(tsHeader)) return false;
  const ts = Number(tsHeader);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > maxSkewSec) return false;
  const expected = createHmac("sha256", secret).update(`${tsHeader}.${rawBodyUtf8}`, "utf8").digest();
  return sig.length === expected.length && timingSafeEqual(sig, expected);
}
```

The API ships the same checks in `src/lib/webhook-signature-verify.ts` (`verifyFvControlWebhookSignature`) for symmetry with inbound hooks.

Configure **`WEBHOOK_MAX_SKEW_SECONDS`** on FVControl for inbound verification; receivers should use a similar clock-skew window.

### n8n Function node (verify)

Use the **same** string `timestamp + "." + rawBody` (UTF-8). In n8n, ensure the workflow receives the **unparsed** body string (Webhook node “Raw Body” or middleware); then:

```javascript
const crypto = require('crypto');
const secret = process.env.WEBHOOK_SIGNING_SECRET;
const rawBody = items[0].json.bodyRaw; // must match bytes FVControl signed
const ts = items[0].json.headers['x-fvcontrol-timestamp'];
const sigHeader = items[0].json.headers['x-fvcontrol-signature'] || '';
const m = sigHeader.match(/^sha256=([a-f0-9]{64})$/i);
if (!m || !/^\d+$/.test(ts)) return [{ json: { verified: false } }];
const expected = crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`, 'utf8').digest();
const ok = crypto.timingSafeEqual(Buffer.from(m[1], 'hex'), expected);
return [{ json: { verified: ok } }];
```

### Backward compatibility

Inbound `POST /api/v1/webhooks/inbound` still accepts legacy **`X-Signature`** = `hex(HMAC_SHA256(secret, JSON.stringify(body)))` when the new headers are not sent. Prefer the **FVControl** headers for new integrations.

## Logging

- **Do not** log full webhook bodies, signing secrets, or bearer tokens.
- Worker delivery logs are JSON lines with: `eventType`, `deliveryId`, `status`, `attempt`, `targetHost` (hostname only).

## Operational secrets

- Set a long random **`WEBHOOK_SIGNING_SECRET`** (≥ 16 chars) in production for both outbound signing and inbound verification.
- Rotate by deploying a new secret and updating consumers; use overlapping verification only if you run dual secrets (not implemented in v1).
