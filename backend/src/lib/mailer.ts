import nodemailer from "nodemailer";
import { isSmtpConfigured, type AppConfig } from "../config.js";

function buildVerificationUrl(cfg: AppConfig, token: string): string {
  const base = cfg.WEB_APP_URL.replace(/\/$/, "");
  return `${base}/login?token=${encodeURIComponent(token)}`;
}

function buildPasswordResetUrl(cfg: AppConfig, token: string): string {
  const base = cfg.WEB_APP_URL.replace(/\/$/, "");
  return `${base}/login?pwd_reset=${encodeURIComponent(token)}`;
}

/**
 * Wysyła link aktywacyjny na adres użytkownika (rejestracja hasłem lub Google).
 * Bez SMTP w development: loguje link do konsoli (bez rzucania wyjątku).
 * W production bez SMTP: rzuca — najpierw skonfiguruj serwer pocztowy.
 */
export async function sendTenantVerificationEmail(cfg: AppConfig, to: string, token: string): Promise<void> {
  const verifyUrl = buildVerificationUrl(cfg, token);
  const subject = `Potwierdź adres e-mail — ${cfg.APP_NAME}`;
  const text =
    `Dzień dobry,\n\n` +
    `Aby aktywować konto w ${cfg.APP_NAME}, otwórz w przeglądarce:\n\n` +
    `${verifyUrl}\n\n` +
    `Link jest ważny 48 godzin. Jeśli to nie Ty zakładałeś konto, zignoruj tę wiadomość.\n`;
  const html =
    `<p>Dzień dobry,</p>` +
    `<p>Aby <strong>aktywować konto</strong> w ${escapeHtml(cfg.APP_NAME)}, kliknij:</p>` +
    `<p><a href="${escapeHtml(verifyUrl)}">Potwierdź adres e-mail</a></p>` +
    `<p style="color:#666;font-size:12px">Jeśli przycisk nie działa, wklej ten adres w przeglądarkę:<br/>` +
    `<span style="word-break:break-all">${escapeHtml(verifyUrl)}</span></p>`;

  if (!isSmtpConfigured(cfg)) {
    if (cfg.NODE_ENV === "production") {
      throw new Error("SMTP is not configured (set SMTP_HOST and related variables)");
    }
    console.info(`[email] (dev, brak SMTP) weryfikacja dla ${to}: ${verifyUrl}`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: cfg.SMTP_HOST,
    port: cfg.SMTP_PORT,
    secure: cfg.SMTP_SECURE,
    auth:
      cfg.SMTP_USER && cfg.SMTP_PASS !== undefined
        ? { user: cfg.SMTP_USER, pass: cfg.SMTP_PASS }
        : undefined,
  });

  await transporter.sendMail({
    from: cfg.EMAIL_FROM,
    to,
    subject,
    text,
    html,
  });
}

/** Link ważny ~1 h — reset hasła (konto z hasłem e-mail). */
export async function sendPasswordResetEmail(cfg: AppConfig, to: string, token: string): Promise<void> {
  const resetUrl = buildPasswordResetUrl(cfg, token);
  const subject = `Reset hasła — ${cfg.APP_NAME}`;
  const text =
    `Dzień dobry,\n\n` +
    `Aby ustawić nowe hasło w ${cfg.APP_NAME}, otwórz w przeglądarce:\n\n` +
    `${resetUrl}\n\n` +
    `Link jest ważny ok. 1 godziny. Jeśli to nie Ty prosiłeś o reset, zignoruj tę wiadomość.\n`;
  const html =
    `<p>Dzień dobry,</p>` +
    `<p>Aby <strong>ustawić nowe hasło</strong> w ${escapeHtml(cfg.APP_NAME)}, kliknij:</p>` +
    `<p><a href="${escapeHtml(resetUrl)}">Ustaw nowe hasło</a></p>` +
    `<p style="color:#666;font-size:12px">Jeśli przycisk nie działa, wklej ten adres w przeglądarkę:<br/>` +
    `<span style="word-break:break-all">${escapeHtml(resetUrl)}</span></p>`;

  if (!isSmtpConfigured(cfg)) {
    if (cfg.NODE_ENV === "production") {
      throw new Error("SMTP is not configured (set SMTP_HOST and related variables)");
    }
    console.info(`[email] (dev, brak SMTP) reset hasła dla ${to}: ${resetUrl}`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: cfg.SMTP_HOST,
    port: cfg.SMTP_PORT,
    secure: cfg.SMTP_SECURE,
    auth:
      cfg.SMTP_USER && cfg.SMTP_PASS !== undefined
        ? { user: cfg.SMTP_USER, pass: cfg.SMTP_PASS }
        : undefined,
  });

  await transporter.sendMail({
    from: cfg.EMAIL_FROM,
    to,
    subject,
    text,
    html,
  });
}

/**
 * Wysyła powiadomienie o wystawionej fakturze VAT za subskrypcję PRO (B15 dogfood).
 * Bez SMTP w development: loguje do konsoli (zgodnie z konwencją tego pliku).
 * W production bez SMTP: throw — najpierw skonfiguruj Resend/SMTP (B7).
 *
 * Po deploy B7 + Resend env (SMTP_HOST=smtp.resend.com, SMTP_USER=resend,
 * SMTP_PASS=re_xxx API key) ten email pójdzie do klienta automatycznie po
 * KSeF submit. PDF + UPO attachments w przyszłej iteracji (etap 6+).
 */
export async function sendSubscriptionInvoiceEmail(
  cfg: AppConfig,
  to: string,
  params: {
    invoiceNumber: string;
    grossTotalPln: number;
    issueDateIso: string;
    ksefNumber?: string | null;
    periodLabel: string;
  },
): Promise<void> {
  const dashboardBase = cfg.WEB_APP_URL.replace(/\/$/, "");
  const subject = `FV ${params.invoiceNumber} — ${cfg.APP_NAME} (subskrypcja ${params.periodLabel})`;
  const dateLabel = params.issueDateIso.slice(0, 10);

  const text =
    `Dzień dobry,\n\n` +
    `Dziękujemy za płatność za subskrypcję ${cfg.APP_NAME} (okres ${params.periodLabel}).\n\n` +
    `Wystawiliśmy fakturę VAT:\n` +
    `  Numer: ${params.invoiceNumber}\n` +
    `  Data wystawienia: ${dateLabel}\n` +
    `  Kwota brutto: ${params.grossTotalPln.toFixed(2)} PLN\n` +
    (params.ksefNumber ? `  Numer KSeF (MF): ${params.ksefNumber}\n` : "") +
    `\n` +
    `Faktura jest dostępna w panelu klienta:\n` +
    `${dashboardBase}/faktury\n\n` +
    `Pozdrawiamy,\n` +
    `Zespół ${cfg.APP_NAME}\n`;

  const html =
    `<p>Dzień dobry,</p>` +
    `<p>Dziękujemy za płatność za subskrypcję <strong>${escapeHtml(cfg.APP_NAME)}</strong> (okres ${escapeHtml(params.periodLabel)}).</p>` +
    `<p>Wystawiliśmy fakturę VAT:</p>` +
    `<ul>` +
    `<li>Numer: <strong>${escapeHtml(params.invoiceNumber)}</strong></li>` +
    `<li>Data wystawienia: ${escapeHtml(dateLabel)}</li>` +
    `<li>Kwota brutto: <strong>${params.grossTotalPln.toFixed(2)} PLN</strong></li>` +
    (params.ksefNumber ? `<li>Numer KSeF (MF): ${escapeHtml(params.ksefNumber)}</li>` : "") +
    `</ul>` +
    `<p><a href="${escapeHtml(dashboardBase)}/faktury">Otwórz fakturę w panelu klienta</a></p>` +
    `<p style="color:#666;font-size:12px">Pozdrawiamy,<br/>Zespół ${escapeHtml(cfg.APP_NAME)}</p>`;

  if (!isSmtpConfigured(cfg)) {
    if (cfg.NODE_ENV === "production") {
      throw new Error("SMTP is not configured (set SMTP_HOST and related variables)");
    }
    console.info(`[email] (dev, brak SMTP) FV ${params.invoiceNumber} dla ${to}: ${dashboardBase}/faktury`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: cfg.SMTP_HOST,
    port: cfg.SMTP_PORT,
    secure: cfg.SMTP_SECURE,
    auth:
      cfg.SMTP_USER && cfg.SMTP_PASS !== undefined
        ? { user: cfg.SMTP_USER, pass: cfg.SMTP_PASS }
        : undefined,
  });

  await transporter.sendMail({
    from: cfg.EMAIL_FROM,
    to,
    subject,
    text,
    html,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
