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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
