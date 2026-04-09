#!/bin/bash
set -e

cd /opt/fv-control/backend

# Load env safely (skip lines with spaces in values, export only KSEF_ vars)
export KSEF_TOKEN=$(grep '^KSEF_TOKEN=' .env | head -1 | cut -d= -f2-)
export KSEF_TOKEN_PASSWORD=$(grep '^KSEF_TOKEN_PASSWORD=' .env | head -1 | cut -d= -f2-)
export KSEF_NIP=$(grep '^KSEF_NIP=' .env | head -1 | cut -d= -f2-)
export DATABASE_URL=$(grep '^DATABASE_URL=' .env | head -1 | cut -d= -f2-)

echo "KSEF_TOKEN set: $([ -n "$KSEF_TOKEN" ] && echo YES || echo NO)"
echo "KSEF_TOKEN_PASSWORD set: $([ -n "$KSEF_TOKEN_PASSWORD" ] && echo YES || echo NO)"
echo "KSEF_NIP: $KSEF_NIP"

echo "=== Testing KSeF auth ==="
node --input-type=module -e '
import { KsefClient } from "./dist/modules/ksef/ksef-client.js";

const token = process.env.KSEF_TOKEN;
const pass = process.env.KSEF_TOKEN_PASSWORD;
const nip = process.env.KSEF_NIP;

try {
  const client = KsefClient.fromEncryptedToken("production", token, pass, nip);
  const tokens = await client.authenticate();
  console.log("AUTH SUCCESS!");
  console.log("Access valid until:", tokens.accessValidUntil);
} catch(e) {
  console.error("AUTH FAILED:", e.message);
}
'
