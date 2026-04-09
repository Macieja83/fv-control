#!/bin/bash
cd /opt/fv-control/backend

export KSEF_TOKEN=$(grep '^KSEF_TOKEN=' .env | head -1 | cut -d= -f2-)
export KSEF_TOKEN_PASSWORD=$(grep '^KSEF_TOKEN_PASSWORD=' .env | head -1 | cut -d= -f2-)
export KSEF_CERT=$(grep '^KSEF_CERT=' .env | head -1 | cut -d= -f2-)
export KSEF_NIP=$(grep '^KSEF_NIP=' .env | head -1 | cut -d= -f2-)
export DATABASE_URL=$(grep '^DATABASE_URL=' .env | head -1 | cut -d= -f2-)

echo "KSEF_TOKEN set: $([ -n "$KSEF_TOKEN" ] && echo YES || echo NO)"
echo "KSEF_CERT set: $([ -n "$KSEF_CERT" ] && echo YES || echo NO)"
echo "KSEF_NIP: $KSEF_NIP"

echo "=== Testing XAdES auth ==="
node --input-type=module -e '
import { KsefClient } from "./dist/modules/ksef/ksef-client.js";

const token = process.env.KSEF_TOKEN;
const pass = process.env.KSEF_TOKEN_PASSWORD;
const cert = process.env.KSEF_CERT;
const nip = process.env.KSEF_NIP;

try {
  const client = KsefClient.fromEncryptedCertificate("production", token, pass, cert, nip);
  console.log("Client created, authenticating via XAdES...");
  const tokens = await client.authenticate();
  console.log("AUTH SUCCESS!");
  console.log("Access valid until:", tokens.accessValidUntil);
} catch(e) {
  console.error("AUTH FAILED:", e.message);
  if (e.stack) console.error(e.stack.split("\n").slice(0,5).join("\n"));
}
'
