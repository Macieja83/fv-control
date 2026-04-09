#!/bin/bash
cd /opt/fv-control/backend

export KSEF_TOKEN=$(grep '^KSEF_TOKEN=' .env | head -1 | cut -d= -f2-)
export KSEF_TOKEN_PASSWORD=$(grep '^KSEF_TOKEN_PASSWORD=' .env | head -1 | cut -d= -f2-)
export KSEF_NIP=$(grep '^KSEF_NIP=' .env | head -1 | cut -d= -f2-)

node --input-type=module -e '
import { decryptKsefTokenPkcs5 } from "./dist/modules/ksef/ksef-client.js";
import { X509Certificate } from "node:crypto";

// 1. Decrypt token
const raw = decryptKsefTokenPkcs5(process.env.KSEF_TOKEN, process.env.KSEF_TOKEN_PASSWORD);
console.log("Token length (chars):", raw.length);
console.log("Token length (bytes):", Buffer.from(raw, "utf-8").length);
console.log("Token hex preview:", Buffer.from(raw, "utf-8").subarray(0, 30).toString("hex"));
console.log("Token text preview:", raw.substring(0, 40) + "...");

// 2. Check challenge
const challengeRes = await fetch("https://api.ksef.mf.gov.pl/v2/auth/challenge", { method: "POST" });
const challengeData = await challengeRes.json();
console.log("\nChallenge:", challengeData.challenge);
console.log("TimestampMs:", challengeData.timestampMs);

// 3. Build plaintext
const plaintext = Buffer.from(raw + "|" + challengeData.timestampMs, "utf-8");
console.log("\nPlaintext length (bytes):", plaintext.length);

// 4. Check public key
const certsRes = await fetch("https://api.ksef.mf.gov.pl/v2/security/public-key-certificates");
const certs = await certsRes.json();
const tokenCert = certs.find(c => c.usage.includes("KsefTokenEncryption"));
const x509 = new X509Certificate(Buffer.from(tokenCert.certificate, "base64"));
console.log("\nPublic key type:", x509.publicKey.type);
console.log("Public key asymmetricKeyType:", x509.publicKey.asymmetricKeyType);
console.log("Public key asymmetricKeySize:", x509.publicKey.asymmetricKeySize);
const maxPayload = (x509.publicKey.asymmetricKeySize / 8) - 2 * 32 - 2;
console.log("Max OAEP+SHA256 payload:", maxPayload, "bytes");
console.log("Our payload fits:", plaintext.length <= maxPayload);
'
