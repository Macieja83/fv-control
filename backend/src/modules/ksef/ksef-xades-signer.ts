/**
 * XAdES-BES signer for KSeF AuthTokenRequest.
 *
 * Produces an enveloped XAdES signature with ECDSA-SHA256
 * compatible with POST /auth/xades-signature.
 */

import { createHash, createPrivateKey, createSign, X509Certificate, randomUUID } from "node:crypto";

const AUTH_NS = "http://ksef.mf.gov.pl/auth/token/2.0";
const DS_NS = "http://www.w3.org/2000/09/xmldsig#";
const XADES_NS = "http://uri.etsi.org/01903/v1.3.2#";

export type XadesSignParams = {
  challenge: string;
  nip: string;
  /** PKCS#8 DER private key (EC P-256). */
  privateKeyDer: Buffer;
  /** DER-encoded X.509 certificate. */
  certDer: Buffer;
};

/**
 * Build and sign the AuthTokenRequest XML with XAdES-BES enveloped signature.
 * Returns the complete signed XML string.
 */
export function signAuthTokenRequest(params: XadesSignParams): string {
  const { challenge, nip, privateKeyDer, certDer } = params;

  const x509 = new X509Certificate(certDer);
  const certB64 = certDer.toString("base64");
  const certDigest = createHash("sha256").update(certDer).digest("base64");
  const issuerName = x509.issuer;
  const serialNumber = BigInt(`0x${x509.serialNumber}`).toString(10);
  const signingTime = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  const sigId = `ID-${randomUUID()}`;
  const signedInfoId = `ID-${randomUUID()}`;
  const refBodyId = `ID-${randomUUID()}`;
  const refPropsId = `ID-${randomUUID()}`;
  const sigValueId = `ID-${randomUUID()}`;
  const qualPropsId = `ID-${randomUUID()}`;
  const signedPropsId = `ID-${randomUUID()}`;

  // 1. Build the unsigned document (without Signature)
  const bodyXml = buildBodyXml(challenge, nip);

  // 2. Digest the body (c14n of the document without the Signature element)
  const bodyDigest = createHash("sha256").update(bodyXml, "utf-8").digest("base64");

  // 3. Build SignedProperties
  const signedPropsXml = buildSignedProperties(
    signedPropsId,
    signingTime,
    certDigest,
    issuerName,
    serialNumber,
  );

  // 4. Digest SignedProperties (c14n)
  const propsDigest = createHash("sha256").update(signedPropsXml, "utf-8").digest("base64");

  // 5. Build SignedInfo
  const signedInfoXml = buildSignedInfo(signedInfoId, refBodyId, bodyDigest, refPropsId, propsDigest, signedPropsId);

  // 6. Sign the SignedInfo with ECDSA-SHA256
  const keyObj = createPrivateKey({ key: privateKeyDer, format: "der", type: "pkcs8" });
  const signer = createSign("SHA256");
  signer.update(signedInfoXml);
  const signatureValue = signer.sign({ key: keyObj, dsaEncoding: "ieee-p1363" }, "base64");

  // 7. Assemble the full signed XML
  const signatureBlock = [
    `<ds:Signature xmlns:ds="${DS_NS}" Id="${sigId}">`,
    signedInfoXml,
    `<ds:SignatureValue Id="${sigValueId}">${signatureValue}</ds:SignatureValue>`,
    `<ds:KeyInfo>`,
    `<ds:X509Data>`,
    `<ds:X509Certificate>${certB64}</ds:X509Certificate>`,
    `</ds:X509Data>`,
    `</ds:KeyInfo>`,
    `<ds:Object>`,
    `<xades:QualifyingProperties xmlns:xades="${XADES_NS}" Id="${qualPropsId}" Target="#${sigId}">`,
    signedPropsXml,
    `</xades:QualifyingProperties>`,
    `</ds:Object>`,
    `</ds:Signature>`,
  ].join("");

  // Insert Signature before </AuthTokenRequest>
  const signedXml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<AuthTokenRequest xmlns="${AUTH_NS}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<Challenge>${challenge}</Challenge>` +
    `<ContextIdentifier><Nip>${nip}</Nip></ContextIdentifier>` +
    `<SubjectIdentifierType>certificateSubject</SubjectIdentifierType>` +
    signatureBlock +
    `</AuthTokenRequest>`;

  return signedXml;
}

function buildBodyXml(challenge: string, nip: string): string {
  return (
    `<AuthTokenRequest xmlns="${AUTH_NS}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<Challenge>${challenge}</Challenge>` +
    `<ContextIdentifier><Nip>${nip}</Nip></ContextIdentifier>` +
    `<SubjectIdentifierType>certificateSubject</SubjectIdentifierType>` +
    `</AuthTokenRequest>`
  );
}

function buildSignedInfo(
  id: string,
  refBodyId: string,
  bodyDigest: string,
  refPropsId: string,
  propsDigest: string,
  signedPropsId: string,
): string {
  return (
    `<ds:SignedInfo xmlns:ds="${DS_NS}" Id="${id}">` +
    `<ds:CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>` +
    `<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"/>` +
    `<ds:Reference Id="${refBodyId}" URI="">` +
    `<ds:Transforms><ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/></ds:Transforms>` +
    `<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>` +
    `<ds:DigestValue>${bodyDigest}</ds:DigestValue>` +
    `</ds:Reference>` +
    `<ds:Reference Id="${refPropsId}" Type="http://uri.etsi.org/01903#SignedProperties" URI="#${signedPropsId}">` +
    `<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>` +
    `<ds:DigestValue>${propsDigest}</ds:DigestValue>` +
    `</ds:Reference>` +
    `</ds:SignedInfo>`
  );
}

function buildSignedProperties(
  id: string,
  signingTime: string,
  certDigest: string,
  issuerName: string,
  serialNumber: string,
): string {
  return (
    `<xades:SignedProperties xmlns:xades="${XADES_NS}" xmlns:ds="${DS_NS}" Id="${id}">` +
    `<xades:SignedSignatureProperties>` +
    `<xades:SigningTime>${signingTime}</xades:SigningTime>` +
    `<xades:SigningCertificate>` +
    `<xades:Cert>` +
    `<xades:CertDigest>` +
    `<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>` +
    `<ds:DigestValue>${certDigest}</ds:DigestValue>` +
    `</xades:CertDigest>` +
    `<xades:IssuerSerial>` +
    `<ds:X509IssuerName>${issuerName}</ds:X509IssuerName>` +
    `<ds:X509SerialNumber>${serialNumber}</ds:X509SerialNumber>` +
    `</xades:IssuerSerial>` +
    `</xades:Cert>` +
    `</xades:SigningCertificate>` +
    `</xades:SignedSignatureProperties>` +
    `</xades:SignedProperties>`
  );
}
