#!/bin/bash
cd /opt/fv-control/backend

# Quick test: try to call challenge endpoint
echo "=== Testing KSeF challenge endpoint ==="
curl -s -X POST https://api.ksef.mf.gov.pl/v2/auth/challenge | python3 -m json.tool 2>/dev/null || curl -s -X POST https://api.ksef.mf.gov.pl/v2/auth/challenge

echo ""
echo "=== Testing public key endpoint ==="
curl -s https://api.ksef.mf.gov.pl/v2/security/public-key-certificates | python3 -c '
import sys, json
certs = json.load(sys.stdin)
for c in certs:
    print(f"  usage: {c.get(\"usage\")}, cert[:50]: {c.get(\"certificate\",\"\")[:50]}...")
' 2>/dev/null || echo "Failed to fetch public keys"

echo ""
echo "=== Test decryption + auth inline ==="
node --input-type=module -e '
import { decryptKsefTokenPkcs5 } from "./dist/modules/ksef/ksef-client.js";
const token = process.env.KSEF_TOKEN;
const pass = process.env.KSEF_TOKEN_PASSWORD;
try {
  const raw = decryptKsefTokenPkcs5(token, pass);
  console.log("Decrypted token length:", raw.length);
  console.log("Token preview:", raw.substring(0, 20) + "...");
} catch(e) {
  console.error("Decryption FAILED:", e.message);
}
'
