#!/bin/bash
set -e
cd /opt/fv-control/backend

KSEF_TOKEN=$(grep '^KSEF_TOKEN=' .env | head -1 | cut -d= -f2-)
KSEF_TOKEN_PASSWORD=$(grep '^KSEF_TOKEN_PASSWORD=' .env | head -1 | cut -d= -f2-)
KSEF_NIP=$(grep '^KSEF_NIP=' .env | head -1 | cut -d= -f2-)

echo "=== Decrypting private key ==="
# Extract base64 of encrypted key
echo "$KSEF_TOKEN" | base64 -d > /tmp/ksef-encrypted.der

# Decrypt PKCS#5 to get PKCS#8 private key
# The encrypted key is in PKCS#5 format, we need openssl to handle it
# First wrap it in PEM format
echo "-----BEGIN ENCRYPTED PRIVATE KEY-----" > /tmp/ksef.key.pem
echo "$KSEF_TOKEN" | fold -w 64 >> /tmp/ksef.key.pem
echo "-----END ENCRYPTED PRIVATE KEY-----" >> /tmp/ksef.key.pem

echo "=== Decrypting with password ==="
openssl ec -in /tmp/ksef.key.pem -passin "pass:${KSEF_TOKEN_PASSWORD}" -out /tmp/ksef-decrypted.pem 2>&1 || \
openssl pkey -in /tmp/ksef.key.pem -passin "pass:${KSEF_TOKEN_PASSWORD}" -out /tmp/ksef-decrypted.pem 2>&1

echo "=== Key info ==="
openssl pkey -in /tmp/ksef-decrypted.pem -text -noout 2>&1 | head -5

echo "=== Generating self-signed certificate ==="
openssl req -new -x509 -key /tmp/ksef-decrypted.pem \
  -out /tmp/ksef-cert.pem \
  -days 365 \
  -subj "/CN=FVControl KSeF/O=Tutto Pizza/C=PL/serialNumber=VATPL-${KSEF_NIP}" \
  -sha256

echo "=== Certificate info ==="
openssl x509 -in /tmp/ksef-cert.pem -text -noout | head -15

echo "=== Base64 DER cert ==="
CERT_B64=$(openssl x509 -in /tmp/ksef-cert.pem -outform DER | base64 -w 0)
echo "Length: ${#CERT_B64}"

# Add to .env if not present
grep -q 'KSEF_CERT=' .env && sed -i "s|^KSEF_CERT=.*|KSEF_CERT=${CERT_B64}|" .env || echo "KSEF_CERT=${CERT_B64}" >> .env
echo "=== KSEF_CERT saved to .env ==="

# Cleanup
rm -f /tmp/ksef-encrypted.der /tmp/ksef.key.pem /tmp/ksef-decrypted.pem /tmp/ksef-cert.pem

echo "DONE"
