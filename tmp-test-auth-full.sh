#!/bin/bash
cd /opt/fv-control/backend

# Load env vars
set -a
source .env
set +a

node --input-type=module -e '
import { KsefClient } from "./dist/modules/ksef/ksef-client.js";

const token = process.env.KSEF_TOKEN;
const pass = process.env.KSEF_TOKEN_PASSWORD;
const nip = process.env.KSEF_NIP;

console.log("Token:", token?.substring(0,30) + "...");
console.log("Pass:", pass ? "SET" : "MISSING");
console.log("NIP:", nip);

try {
  const client = KsefClient.fromEncryptedToken("production", token, pass, nip);
  console.log("Client created OK, authenticating...");
  const tokens = await client.authenticate();
  console.log("AUTH SUCCESS!");
  console.log("Access token:", tokens.accessToken.substring(0, 50) + "...");
  console.log("Valid until:", tokens.accessValidUntil);
} catch(e) {
  console.error("AUTH FAILED:", e.message);
  if (e.cause) console.error("Cause:", e.cause);
}
'
