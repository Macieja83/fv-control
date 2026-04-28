/**
 * XAdES-BES signer for KSeF AuthTokenRequest.
 *
 * Produces an enveloped XAdES signature with ECDSA-SHA256.
 * Uses exclusive C14N for SignedInfo and Reference transforms.
 */

import { createHash, createSign, X509Certificate, randomUUID } from "node:crypto";

const AUTH_NS = "http://ksef.mf.gov.pl/auth/token/2.0";
const XSI_NS = "http://www.w3.org/2001/XMLSchema-instance";
const DS_NS = "http://www.w3.org/2000/09/xmldsig#";
const XADES_NS = "http://uri.etsi.org/01903/v1.3.2#";
const EXC_C14N_ALG = "http://www.w3.org/2001/10/xml-exc-c14n#";

/**
 * Namespace context used to construct canonicalized fragments for digest/signature.
 */
const NS_ROOT = `xmlns="${AUTH_NS}"`;
const NS_SIG = `xmlns:ds="${DS_NS}"`;
const NS_PROPS = `xmlns:ds="${DS_NS}" xmlns:xades="${XADES_NS}"`;

export type XadesSignParams = {
  challenge: string;
  nip: string;
  privateKeyDer: Buffer;
  certDer: Buffer;
};

export function signAuthTokenRequest(params: XadesSignParams): string {
  const { challenge, nip, privateKeyDer, certDer } = params;

  const x509 = new X509Certificate(certDer);
  const certB64 = certDer.toString("base64");
  const certDigest = createHash("sha256").update(certDer).digest("base64");
  const issuerDN = formatIssuerDN(x509.issuer);
  const serialNumber = BigInt(`0x${x509.serialNumber}`).toString(10);
  const signingTime = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  const sigId = `ID-${randomUUID()}`;
  const signedInfoId = `ID-${randomUUID()}`;
  const refBodyId = `ID-${randomUUID()}`;
  const refPropsId = `ID-${randomUUID()}`;
  const sigValueId = `ID-${randomUUID()}`;
  const qualPropsId = `ID-${randomUUID()}`;
  const signedPropsId = `ID-${randomUUID()}`;

  // 1. Body digest (enveloped-signature: document without Signature, then C14N)
  const bodyC14n =
    `<AuthTokenRequest ${NS_ROOT}>` +
    `<Challenge>${challenge}</Challenge>` +
    `<ContextIdentifier><Nip>${nip}</Nip></ContextIdentifier>` +
    `<SubjectIdentifierType>certificateSubject</SubjectIdentifierType>` +
    `</AuthTokenRequest>`;
  const bodyDigest = sha256b64(bodyC14n);

  // 2. SignedProperties C14N form (with all in-scope namespaces from final doc)
  const signedPropsC14n =
    `<xades:SignedProperties ${NS_PROPS} Id="${signedPropsId}">` +
    `<xades:SignedSignatureProperties>` +
    `<xades:SigningTime>${signingTime}</xades:SigningTime>` +
    `<xades:SigningCertificate>` +
    `<xades:Cert>` +
    `<xades:CertDigest>` +
    `<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod>` +
    `<ds:DigestValue>${certDigest}</ds:DigestValue>` +
    `</xades:CertDigest>` +
    `<xades:IssuerSerial>` +
    `<ds:X509IssuerName>${issuerDN}</ds:X509IssuerName>` +
    `<ds:X509SerialNumber>${serialNumber}</ds:X509SerialNumber>` +
    `</xades:IssuerSerial>` +
    `</xades:Cert>` +
    `</xades:SigningCertificate>` +
    `</xades:SignedSignatureProperties>` +
    `</xades:SignedProperties>`;
  const propsDigest = sha256b64(signedPropsC14n);

  // 3. SignedInfo C14N form (with all in-scope namespaces)
  const signedInfoC14n =
    `<ds:SignedInfo ${NS_SIG} Id="${signedInfoId}">` +
    `<ds:CanonicalizationMethod Algorithm="${EXC_C14N_ALG}"></ds:CanonicalizationMethod>` +
    `<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"></ds:SignatureMethod>` +
    `<ds:Reference Id="${refBodyId}" URI="">` +
    `<ds:Transforms>` +
    `<ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></ds:Transform>` +
    `<ds:Transform Algorithm="${EXC_C14N_ALG}"></ds:Transform>` +
    `</ds:Transforms>` +
    `<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod>` +
    `<ds:DigestValue>${bodyDigest}</ds:DigestValue>` +
    `</ds:Reference>` +
    `<ds:Reference Id="${refPropsId}" Type="http://uri.etsi.org/01903#SignedProperties" URI="#${signedPropsId}">` +
    `<ds:Transforms><ds:Transform Algorithm="${EXC_C14N_ALG}"></ds:Transform></ds:Transforms>` +
    `<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod>` +
    `<ds:DigestValue>${propsDigest}</ds:DigestValue>` +
    `</ds:Reference>` +
    `</ds:SignedInfo>`;

  // 4. Sign the canonical SignedInfo
  const signer = createSign("SHA256");
  signer.update(signedInfoC14n);
  const signatureValue = signer.sign(
    { key: privateKeyDer, format: "der", type: "pkcs8", dsaEncoding: "ieee-p1363" },
    "base64",
  );

  // 5. Assemble the final XML (non-canonical form for transport — verifier re-canonicalizes)
  const signedInfoXml =
    `<ds:SignedInfo Id="${signedInfoId}">` +
    `<ds:CanonicalizationMethod Algorithm="${EXC_C14N_ALG}"/>` +
    `<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"/>` +
    `<ds:Reference Id="${refBodyId}" URI="">` +
    `<ds:Transforms>` +
    `<ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>` +
    `<ds:Transform Algorithm="${EXC_C14N_ALG}"/>` +
    `</ds:Transforms>` +
    `<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>` +
    `<ds:DigestValue>${bodyDigest}</ds:DigestValue>` +
    `</ds:Reference>` +
    `<ds:Reference Id="${refPropsId}" Type="http://uri.etsi.org/01903#SignedProperties" URI="#${signedPropsId}">` +
    `<ds:Transforms><ds:Transform Algorithm="${EXC_C14N_ALG}"/></ds:Transforms>` +
    `<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>` +
    `<ds:DigestValue>${propsDigest}</ds:DigestValue>` +
    `</ds:Reference>` +
    `</ds:SignedInfo>`;

  const signedPropsXml =
    `<xades:SignedProperties Id="${signedPropsId}">` +
    `<xades:SignedSignatureProperties>` +
    `<xades:SigningTime>${signingTime}</xades:SigningTime>` +
    `<xades:SigningCertificate>` +
    `<xades:Cert>` +
    `<xades:CertDigest>` +
    `<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>` +
    `<ds:DigestValue>${certDigest}</ds:DigestValue>` +
    `</xades:CertDigest>` +
    `<xades:IssuerSerial>` +
    `<ds:X509IssuerName>${issuerDN}</ds:X509IssuerName>` +
    `<ds:X509SerialNumber>${serialNumber}</ds:X509SerialNumber>` +
    `</xades:IssuerSerial>` +
    `</xades:Cert>` +
    `</xades:SigningCertificate>` +
    `</xades:SignedSignatureProperties>` +
    `</xades:SignedProperties>`;

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<AuthTokenRequest xmlns="${AUTH_NS}" xmlns:xsi="${XSI_NS}">` +
    `<Challenge>${challenge}</Challenge>` +
    `<ContextIdentifier><Nip>${nip}</Nip></ContextIdentifier>` +
    `<SubjectIdentifierType>certificateSubject</SubjectIdentifierType>` +
    `<ds:Signature xmlns:ds="${DS_NS}" Id="${sigId}">` +
    signedInfoXml +
    `<ds:SignatureValue Id="${sigValueId}">${signatureValue}</ds:SignatureValue>` +
    `<ds:KeyInfo><ds:X509Data><ds:X509Certificate>${certB64}</ds:X509Certificate></ds:X509Data></ds:KeyInfo>` +
    `<ds:Object>` +
    `<xades:QualifyingProperties xmlns:xades="${XADES_NS}" Id="${qualPropsId}" Target="#${sigId}">` +
    signedPropsXml +
    `</xades:QualifyingProperties>` +
    `</ds:Object>` +
    `</ds:Signature>` +
    `</AuthTokenRequest>`
  );
}

function sha256b64(data: string): string {
  return createHash("sha256").update(data, "utf-8").digest("base64");
}

/** Format X509Certificate.issuer into RFC 2253 DN string. */
function formatIssuerDN(raw: string): string {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(",");
}
