import { loadConfig } from "../../config.js";
import { AppError } from "../../lib/errors.js";

const BIR_NS = "http://CIS/BIR/PUBL/2014/07";
const DAT_NS = "http://CIS/BIR/PUBL/2014/07/DataContract";

export type GusEntityLookupResult = {
  nip: string;
  regon: string | null;
  name: string;
  /** Ulica + numer + kod + miejscowość (jedna linia do pola adresu kontrahenta). */
  address: string;
  raw: Record<string, string | null>;
};

function defaultServiceUrl(useTest: boolean): string {
  return useTest
    ? "https://wyszukiwarkaregontest.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc"
    : "https://wyszukiwarkaregon.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc";
}

function getBirEndpoint(): { url: string; apiKey: string } | null {
  const cfg = loadConfig();
  const url = cfg.GUS_BIR_SERVICE_URL?.trim() || defaultServiceUrl(cfg.GUS_BIR_USE_TEST);
  const apiKey =
    cfg.GUS_BIR_API_KEY?.trim() ||
    (cfg.GUS_BIR_USE_TEST ? "abcde12345abcde12345" : "");
  if (!apiKey) return null;
  return { url, apiKey };
}

function soapEnvelope(action: string, serviceUrl: string, innerBody: string): string {
  return `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:ns="${BIR_NS}">
  <soap:Header xmlns:wsa="http://www.w3.org/2005/08/addressing">
    <wsa:Action>${action}</wsa:Action>
    <wsa:To>${serviceUrl}</wsa:To>
  </soap:Header>
  <soap:Body>
    ${innerBody}
  </soap:Body>
</soap:Envelope>`;
}

async function postSoap(serviceUrl: string, action: string, innerBody: string, sid?: string): Promise<string> {
  const body = soapEnvelope(action, serviceUrl, innerBody);
  const headers: Record<string, string> = {
    "Content-Type": "application/soap+xml; charset=utf-8",
  };
  if (sid) headers.sid = sid;
  const res = await fetch(serviceUrl, { method: "POST", headers, body });
  return res.text();
}

function firstMatch(xml: string, re: RegExp): string | null {
  const m = xml.match(re);
  const v = m?.[1]?.trim();
  return v && v.length > 0 ? v : null;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x0*d;&#x0*a;/gi, "")
    .replace(/&#13;&#10;/g, "")
    .replace(/&#xD;&#xA;/gi, "")
    .replace(/&#xD;/gi, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/** Wyciąga pierwszą wartość z tagu (pusta treść lub samozamykający tag → null). */
function tagText(xml: string, tag: string): string | null {
  const self = new RegExp(`<${tag}\\s*/>`, "i");
  if (self.test(xml)) return null;
  const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i"));
  const v = m?.[1]?.trim();
  return v && v.length > 0 ? v : null;
}

function normalizeNip(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 10);
}

function buildAddress(d: Record<string, string | null>): string {
  const street = [d.Ulica, d.NrNieruchomosci].filter(Boolean).join(" ").trim();
  const line1 = [street, d.NrLokalu ? `lok. ${d.NrLokalu}` : ""].filter(Boolean).join(", ");
  const line2 = [d.KodPocztowy, d.Miejscowosc].filter(Boolean).join(" ").trim();
  return [line1, line2].filter(Boolean).join(", ");
}

function parseDaneXml(innerXml: string): GusEntityLookupResult | null {
  const daneBlock = firstMatch(innerXml, /<dane[^>]*>([\s\S]*?)<\/dane>/i);
  if (!daneBlock) return null;
  const d: Record<string, string | null> = {
    Regon: tagText(daneBlock, "Regon"),
    Nip: tagText(daneBlock, "Nip"),
    Nazwa: tagText(daneBlock, "Nazwa"),
    Wojewodztwo: tagText(daneBlock, "Wojewodztwo"),
    Powiat: tagText(daneBlock, "Powiat"),
    Gmina: tagText(daneBlock, "Gmina"),
    Miejscowosc: tagText(daneBlock, "Miejscowosc"),
    KodPocztowy: tagText(daneBlock, "KodPocztowy"),
    Ulica: tagText(daneBlock, "Ulica"),
    NrNieruchomosci: tagText(daneBlock, "NrNieruchomosci"),
    NrLokalu: tagText(daneBlock, "NrLokalu"),
    MiejscowoscPoczty: tagText(daneBlock, "MiejscowoscPoczty"),
  };
  const nip = d.Nip?.replace(/\D/g, "") ?? "";
  const name = d.Nazwa?.trim() ?? "";
  if (!nip || !name) return null;
  return {
    nip,
    regon: d.Regon ?? null,
    name,
    address: buildAddress(d),
    raw: d,
  };
}

/**
 * Wyszukuje podmiot po NIP w publicznej usłudze BIR 1.1 (GUS).
 * Wymaga `GUS_BIR_API_KEY` (prod) lub `GUS_BIR_USE_TEST=true` (wtedy domyślny klucz testowy).
 */
export async function lookupEntityByNip(rawNip: string): Promise<GusEntityLookupResult> {
  const nip = normalizeNip(rawNip);
  if (nip.length !== 10) {
    throw AppError.validation("Podaj poprawny 10-cyfrowy numer NIP.");
  }
  const ep = getBirEndpoint();
  if (!ep) {
    throw AppError.unavailable(
      "Wyszukiwanie GUS jest wyłączone: ustaw GUS_BIR_API_KEY (produkcja) albo GUS_BIR_USE_TEST=true dla środowiska testowego.",
    );
  }
  const { url, apiKey } = ep;

  let sid: string | null = null;
  try {
    const loginXml = `<ns:Zaloguj xmlns:ns="${BIR_NS}"><ns:pKluczUzytkownika>${escapeXml(apiKey)}</ns:pKluczUzytkownika></ns:Zaloguj>`;
    const loginRaw = await postSoap(url, `${BIR_NS}/IUslugaBIRzewnPubl/Zaloguj`, loginXml);
    sid = firstMatch(loginRaw, /<ZalogujResult>([^<]+)<\/ZalogujResult>/i);
    if (!sid) {
      throw AppError.unavailable("GUS: nie udało się zalogować do usługi BIR (brak identyfikatora sesji).");
    }

    const searchInner = `<ns:DaneSzukajPodmioty xmlns:ns="${BIR_NS}" xmlns:dat="${DAT_NS}">
      <ns:pParametryWyszukiwania>
        <dat:Nip>${nip}</dat:Nip>
      </ns:pParametryWyszukiwania>
    </ns:DaneSzukajPodmioty>`;
    const searchRaw = await postSoap(url, `${BIR_NS}/IUslugaBIRzewnPubl/DaneSzukajPodmioty`, searchInner, sid);
    const encoded = firstMatch(
      searchRaw,
      /<DaneSzukajPodmiotyResult>([\s\S]*?)<\/DaneSzukajPodmiotyResult>/i,
    );
    if (!encoded || !encoded.trim()) {
      throw AppError.notFound("Brak podmiotu o podanym NIP w rejestrze REGON.");
    }
    const decoded = decodeXmlEntities(encoded);
    const parsed = parseDaneXml(decoded);
    if (!parsed) {
      throw AppError.notFound("Brak podmiotu o podanym NIP w rejestrze REGON.");
    }
    return parsed;
  } catch (e) {
    if (e instanceof AppError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw AppError.unavailable(`GUS / BIR: błąd połączenia (${msg})`);
  } finally {
    if (sid) {
      const logoutInner = `<ns:Wyloguj xmlns:ns="${BIR_NS}"><ns:pIdentyfikatorSesji>${escapeXml(sid)}</ns:pIdentyfikatorSesji></ns:Wyloguj>`;
      try {
        await postSoap(url, `${BIR_NS}/IUslugaBIRzewnPubl/Wyloguj`, logoutInner, sid);
      } catch {
        /* ignore */
      }
    }
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
