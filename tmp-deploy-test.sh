#!/bin/bash
set -e

cd /opt/fv-control && git fetch origin && git reset --hard origin/main
cd backend && npm install --silent 2>&1 | tail -3
npx tsc --build 2>&1 | grep -v webhook-log

export KSEF_TOKEN=$(grep '^KSEF_TOKEN=' .env | head -1 | cut -d= -f2-)
export KSEF_TOKEN_PASSWORD=$(grep '^KSEF_TOKEN_PASSWORD=' .env | head -1 | cut -d= -f2-)
export KSEF_NIP=$(grep '^KSEF_NIP=' .env | head -1 | cut -d= -f2-)
export DATABASE_URL=$(grep '^DATABASE_URL=' .env | head -1 | cut -d= -f2-)

echo "=== Testing KSeF XAdES auth ==="
node --input-type=module -e '
import { KsefClient } from "./dist/modules/ksef/ksef-client.js";

try {
  const client = await KsefClient.fromEncryptedCertificate(
    "production",
    process.env.KSEF_TOKEN,
    process.env.KSEF_TOKEN_PASSWORD,
    process.env.KSEF_NIP,
  );
  console.log("Client created, authenticating with XAdES...");
  const tokens = await client.authenticate();
  console.log("AUTH SUCCESS!");
  console.log("Access valid until:", tokens.accessValidUntil);
} catch(e) {
  console.error("AUTH FAILED:", e.message);
  if (e.stack) console.error(e.stack.split("\n").slice(0,5).join("\n"));
}
'
