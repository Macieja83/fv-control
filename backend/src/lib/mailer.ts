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

function buildBillingPortalUrl(cfg: AppConfig): string {
  const base = cfg.WEB_APP_URL.replace(/\/$/, "");
  return `${base}/ustawienia/platnosci`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * CTA w mailu — tabela + jednoliniowy href zwiększa klikalność w Outlooku i niektórych klientach,
 * gdzie „gradientowy” inline-block na elemencie <a> bywa nieklikalny.
 */
function ctaButtonTable(href: string, label: string): string {
  const safeHref = escapeHtml(href);
  const safeLabel = escapeHtml(label);
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px auto">` +
    `<tr><td align="center" bgcolor="#4f46e5" style="border-radius:8px;mso-padding-alt:12px 28px">` +
    `<a href="${safeHref}" target="_blank" rel="noopener noreferrer" ` +
    `style="display:inline-block;padding:12px 28px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">` +
    `${safeLabel}</a>` +
    `</td></tr></table>`
  );
}

/**
 * Minimalny brand wrapper — header z marka + footer RODO + kontakt.
 * Spojny stylistycznie dla wszystkich emaili transakcyjnych.
 */
function brandHtml(cfg: AppConfig, innerHtml: string): string {
  const appName = escapeHtml(cfg.APP_NAME);
  const supportLink = `<a href="mailto:kontakt@tuttopizza.pl" style="color:#a855f7;text-decoration:none">kontakt@tuttopizza.pl</a>`;
  return `<!DOCTYPE html>
<html lang="pl"><head><meta charset="utf-8"><title>${appName}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#1f2937">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f4f5f7;padding:32px 0">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" width="560" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05)">
      <tr><td style="padding:20px 28px;background:linear-gradient(135deg,#4f6ef7 0%,#a855f7 100%);color:#ffffff;font-size:18px;font-weight:600">
        ${appName}
      </td></tr>
      <tr><td style="padding:28px;font-size:15px;line-height:1.6;color:#1f2937">
        ${innerHtml}
      </td></tr>
      <tr><td style="padding:18px 28px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;line-height:1.5">
        Wiadomość wysłana automatycznie przez ${appName}. Pomoc i kontakt: ${supportLink}.<br/>
        Dane przetwarzane zgodnie z RODO — szczegóły w polityce prywatności w panelu klienta.
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

/**
 * Wspolny helper — buduje transporter (jezeli SMTP skonfigurowany) i wysyla.
 * Bez SMTP w development: loguje info do konsoli (bez throw).
 * Bez SMTP w production: throw — najpierw skonfiguruj Resend/SMTP.
 */
async function sendEmail(
  cfg: AppConfig,
  args: { to: string; subject: string; text: string; html: string; devLogHint: string },
): Promise<void> {
  if (!isSmtpConfigured(cfg)) {
    if (cfg.NODE_ENV === "production") {
      throw new Error(
        "SMTP nie jest skonfigurowany. Ustaw SMTP_HOST, SMTP_USER, SMTP_PASS, EMAIL_FROM w .env (zalecane: Resend smtp.resend.com:465).",
      );
    }
    console.info(`[email] (dev, brak SMTP) ${args.devLogHint}`);
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
    to: args.to,
    subject: args.subject,
    text: args.text,
    html: args.html,
  });
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
  const inner =
    `<p>Dzień dobry,</p>` +
    `<p>Aby <strong>aktywować konto</strong> w ${escapeHtml(cfg.APP_NAME)}, kliknij przycisk poniżej (otwiera się w nowej karcie). Jeśli przycisk nie reaguje, użyj linku tekstowego pod spodem — to ten sam adres.</p>` +
    ctaButtonTable(verifyUrl, "Potwierdź adres e-mail") +
    `<p style="color:#6b7280;font-size:13px">Link jest ważny <strong>48 godzin</strong>. Jeśli to nie Ty zakładałeś konto, zignoruj tę wiadomość.</p>` +
    `<p style="color:#9ca3af;font-size:12px;margin-top:20px">Link bezpośredni (skopiuj do przeglądarki):<br/>` +
    `<a href="${escapeHtml(verifyUrl)}" target="_blank" rel="noopener noreferrer" style="word-break:break-all;color:#4f46e5">${escapeHtml(verifyUrl)}</a></p>`;

  await sendEmail(cfg, {
    to,
    subject,
    text,
    html: brandHtml(cfg, inner),
    devLogHint: `weryfikacja dla ${to}: ${verifyUrl}`,
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
  const inner =
    `<p>Dzień dobry,</p>` +
    `<p>Aby <strong>ustawić nowe hasło</strong> w ${escapeHtml(cfg.APP_NAME)}, kliknij przycisk poniżej (nowa karta). Jeśli przycisk nie reaguje — użyj linku pod spodem.</p>` +
    ctaButtonTable(resetUrl, "Ustaw nowe hasło") +
    `<p style="color:#6b7280;font-size:13px">Link jest ważny <strong>około 1 godziny</strong>. Jeśli to nie Ty prosiłeś o reset, zignoruj tę wiadomość — hasło nie zostanie zmienione.</p>` +
    `<p style="color:#9ca3af;font-size:12px;margin-top:20px">Link bezpośredni:<br/>` +
    `<a href="${escapeHtml(resetUrl)}" target="_blank" rel="noopener noreferrer" style="word-break:break-all;color:#4f46e5">${escapeHtml(resetUrl)}</a></p>`;

  await sendEmail(cfg, {
    to,
    subject,
    text,
    html: brandHtml(cfg, inner),
    devLogHint: `reset hasła dla ${to}: ${resetUrl}`,
  });
}

/**
 * Wysyła powiadomienie o wystawionej fakturze VAT za subskrypcję PRO (B15 dogfood).
 * Po deploy B7 + Resend env ten email pójdzie do klienta automatycznie po KSeF submit.
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

  const inner =
    `<p>Dzień dobry,</p>` +
    `<p>Dziękujemy za płatność za subskrypcję <strong>${escapeHtml(cfg.APP_NAME)}</strong> (okres ${escapeHtml(params.periodLabel)}).</p>` +
    `<p>Wystawiliśmy fakturę VAT:</p>` +
    `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:12px 0">` +
    `<tr><td style="padding:6px 14px 6px 0;color:#6b7280">Numer:</td><td style="padding:6px 0"><strong>${escapeHtml(params.invoiceNumber)}</strong></td></tr>` +
    `<tr><td style="padding:6px 14px 6px 0;color:#6b7280">Data wystawienia:</td><td style="padding:6px 0">${escapeHtml(dateLabel)}</td></tr>` +
    `<tr><td style="padding:6px 14px 6px 0;color:#6b7280">Kwota brutto:</td><td style="padding:6px 0"><strong>${params.grossTotalPln.toFixed(2)} PLN</strong></td></tr>` +
    (params.ksefNumber
      ? `<tr><td style="padding:6px 14px 6px 0;color:#6b7280">Numer KSeF (MF):</td><td style="padding:6px 0">${escapeHtml(params.ksefNumber)}</td></tr>`
      : "") +
    `</table>` +
    `<p style="text-align:center;margin:28px 0">` +
    `<a href="${escapeHtml(dashboardBase)}/faktury" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#4f6ef7 0%,#a855f7 100%);color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600">Otwórz fakturę</a>` +
    `</p>`;

  await sendEmail(cfg, {
    to,
    subject,
    text,
    html: brandHtml(cfg, inner),
    devLogHint: `FV ${params.invoiceNumber} dla ${to}: ${dashboardBase}/faktury`,
  });
}

/**
 * Welcome / aktywacja subskrypcji PRO — po pierwszej udanej platnosci Stripe.
 * Trigger: handleStripeCheckoutSessionCompleted + (BILLING_SELF_INVOICE_TENANT_ID == null
 * lub osobno od FV maila zeby klient zawsze dostal "subskrypcja aktywna").
 */
export async function sendSubscriptionActivatedEmail(
  cfg: AppConfig,
  to: string,
  params: { planLabel: string; activeUntilDate?: string | null; method?: string | null },
): Promise<void> {
  const billingUrl = buildBillingPortalUrl(cfg);
  const subject = `Subskrypcja ${params.planLabel} aktywna — ${cfg.APP_NAME}`;
  const until = params.activeUntilDate ? params.activeUntilDate.slice(0, 10) : null;

  const text =
    `Dzień dobry,\n\n` +
    `Twoja subskrypcja ${params.planLabel} w ${cfg.APP_NAME} jest aktywna. Dziękujemy!\n\n` +
    (until ? `Okres rozliczeniowy do: ${until}\n` : "") +
    (params.method ? `Metoda płatności: ${params.method}\n` : "") +
    `\n` +
    `Zarządzaj subskrypcją (zmiana karty, faktury, anulacja):\n` +
    `${billingUrl}\n\n` +
    `Powodzenia z porządkowaniem faktur!\n` +
    `Zespół ${cfg.APP_NAME}\n`;

  const inner =
    `<p>Dzień dobry,</p>` +
    `<p>Twoja subskrypcja <strong>${escapeHtml(params.planLabel)}</strong> w ${escapeHtml(cfg.APP_NAME)} jest <span style="color:#16a34a;font-weight:600">aktywna</span>. Dziękujemy!</p>` +
    (until || params.method
      ? `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:12px 0">` +
        (until
          ? `<tr><td style="padding:6px 14px 6px 0;color:#6b7280">Okres do:</td><td style="padding:6px 0"><strong>${escapeHtml(until)}</strong></td></tr>`
          : "") +
        (params.method
          ? `<tr><td style="padding:6px 14px 6px 0;color:#6b7280">Metoda płatności:</td><td style="padding:6px 0">${escapeHtml(params.method)}</td></tr>`
          : "") +
        `</table>`
      : "") +
    `<p style="text-align:center;margin:28px 0">` +
    `<a href="${escapeHtml(billingUrl)}" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#4f6ef7 0%,#a855f7 100%);color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600">Zarządzaj subskrypcją</a>` +
    `</p>` +
    `<p style="color:#6b7280;font-size:13px">Możesz w dowolnym momencie zmienić kartę, pobrać faktury lub anulować subskrypcję — anulacja zachowuje dostęp do końca opłaconego okresu.</p>`;

  await sendEmail(cfg, {
    to,
    subject,
    text,
    html: brandHtml(cfg, inner),
    devLogHint: `aktywacja ${params.planLabel} dla ${to}`,
  });
}

/**
 * Platnosc nie powiodla sie (Stripe charge.failed / invoice.payment_failed webhook).
 * Daje klientowi prosty link do panelu zeby zaktualizowal karte.
 */
export async function sendPaymentFailedEmail(
  cfg: AppConfig,
  to: string,
  params: { planLabel: string; reason?: string | null; retryDate?: string | null },
): Promise<void> {
  const billingUrl = buildBillingPortalUrl(cfg);
  const subject = `Nieudana płatność za subskrypcję — ${cfg.APP_NAME}`;
  const retry = params.retryDate ? params.retryDate.slice(0, 10) : null;
  const reasonText = params.reason && params.reason.trim().length > 0 ? params.reason.trim() : null;

  const text =
    `Dzień dobry,\n\n` +
    `Niestety, nie udało nam się pobrać płatności za Twoją subskrypcję ${params.planLabel} w ${cfg.APP_NAME}.\n\n` +
    (reasonText ? `Powód: ${reasonText}\n` : "") +
    (retry ? `Ponowna próba: ${retry}\n` : "Spróbujemy automatycznie jeszcze raz w ciągu kilku dni.\n") +
    `\n` +
    `Aby uniknąć przerwy w dostępie, zaktualizuj kartę lub wybierz inną metodę płatności:\n` +
    `${billingUrl}\n\n` +
    `Jeśli potrzebujesz pomocy, napisz na kontakt@tuttopizza.pl.\n\n` +
    `Pozdrawiamy,\n` +
    `Zespół ${cfg.APP_NAME}\n`;

  const inner =
    `<p>Dzień dobry,</p>` +
    `<p>Niestety, nie udało nam się pobrać płatności za Twoją subskrypcję <strong>${escapeHtml(params.planLabel)}</strong>.</p>` +
    (reasonText
      ? `<p style="padding:10px 14px;background:#fef2f2;border-left:3px solid #ef4444;color:#991b1b;font-size:14px;border-radius:4px"><strong>Powód:</strong> ${escapeHtml(reasonText)}</p>`
      : "") +
    `<p>${retry ? `Ponowna próba: <strong>${escapeHtml(retry)}</strong>.` : "Spróbujemy automatycznie jeszcze raz w ciągu kilku dni."}</p>` +
    `<p style="text-align:center;margin:28px 0">` +
    `<a href="${escapeHtml(billingUrl)}" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#4f6ef7 0%,#a855f7 100%);color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600">Zaktualizuj metodę płatności</a>` +
    `</p>` +
    `<p style="color:#6b7280;font-size:13px">Aby uniknąć przerwy w dostępie, zaktualizuj kartę lub wybierz inną metodę płatności.</p>`;

  await sendEmail(cfg, {
    to,
    subject,
    text,
    html: brandHtml(cfg, inner),
    devLogHint: `nieudana płatność ${params.planLabel} dla ${to}`,
  });
}

/**
 * Subskrypcja anulowana (przez klienta w Stripe Portal lub przez admin/policy).
 * Komunikuje do kiedy dzialaja funkcje PRO + jak wznowic.
 */
export async function sendSubscriptionCanceledEmail(
  cfg: AppConfig,
  to: string,
  params: { planLabel: string; accessUntilDate?: string | null; canceledBy?: "customer" | "admin" | "payment_failed" | null },
): Promise<void> {
  const billingUrl = buildBillingPortalUrl(cfg);
  const subject = `Subskrypcja ${params.planLabel} anulowana — ${cfg.APP_NAME}`;
  const until = params.accessUntilDate ? params.accessUntilDate.slice(0, 10) : null;

  const reasonByLabel: Record<string, string> = {
    customer: "Anulacja zgłoszona przez Ciebie",
    admin: "Anulacja przez zespół FV Control",
    payment_failed: "Anulacja po nieudanych próbach pobrania płatności",
  };
  const reasonLine = params.canceledBy ? reasonByLabel[params.canceledBy] : null;

  const text =
    `Dzień dobry,\n\n` +
    `Twoja subskrypcja ${params.planLabel} w ${cfg.APP_NAME} została anulowana.\n\n` +
    (reasonLine ? `${reasonLine}.\n\n` : "") +
    (until
      ? `Dostęp do funkcji PRO zachowujesz do: ${until}. Po tej dacie konto wróci do planu Free.\n\n`
      : "Dostęp do funkcji PRO zostaje wyłączony. Konto wraca do planu Free (Twoje dane zostają).\n\n") +
    `Jeśli chcesz wznowić subskrypcję, możesz to zrobić w dowolnym momencie:\n` +
    `${billingUrl}\n\n` +
    `Dziękujemy za korzystanie z ${cfg.APP_NAME}!\n` +
    `Zespół ${cfg.APP_NAME}\n`;

  const inner =
    `<p>Dzień dobry,</p>` +
    `<p>Twoja subskrypcja <strong>${escapeHtml(params.planLabel)}</strong> w ${escapeHtml(cfg.APP_NAME)} została anulowana.</p>` +
    (reasonLine ? `<p style="color:#6b7280;font-size:14px">${escapeHtml(reasonLine)}.</p>` : "") +
    (until
      ? `<p>Dostęp do funkcji PRO zachowujesz <strong>do ${escapeHtml(until)}</strong>. Po tej dacie konto wróci do planu Free.</p>`
      : `<p>Dostęp do funkcji PRO zostaje wyłączony. Konto wraca do planu Free — Twoje dane <strong>zostają</strong>.</p>`) +
    `<p style="text-align:center;margin:28px 0">` +
    `<a href="${escapeHtml(billingUrl)}" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#4f6ef7 0%,#a855f7 100%);color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600">Wznów subskrypcję</a>` +
    `</p>` +
    `<p style="color:#6b7280;font-size:13px">Dziękujemy za korzystanie z ${escapeHtml(cfg.APP_NAME)}. Możesz wrócić w dowolnym momencie — Twoje konto, faktury i konfiguracja KSeF czekają.</p>`;

  await sendEmail(cfg, {
    to,
    subject,
    text,
    html: brandHtml(cfg, inner),
    devLogHint: `anulacja ${params.planLabel} dla ${to}`,
  });
}

/**
 * Soft-delete tenant zostalo zgloszone (RODO art. 17).
 * Informuje admina o grace period + link do anulowania.
 */
export async function sendTenantDeletionRequestedEmail(
  cfg: AppConfig,
  to: string,
  params: { graceUntilIso: string; daysRemaining: number },
): Promise<void> {
  const billingUrl = buildBillingPortalUrl(cfg);
  const subject = `Zgłoszenie usunięcia konta — ${cfg.APP_NAME}`;
  const graceDate = params.graceUntilIso.slice(0, 10);

  const text =
    `Dzień dobry,\n\n` +
    `Twoje konto w ${cfg.APP_NAME} zostało zgłoszone do usunięcia (RODO art. 17).\n\n` +
    `Dane będą trwale usunięte: ${graceDate} (za ${params.daysRemaining} dni).\n\n` +
    `W okresie karencji (30 dni) możesz anulować usunięcie i odzyskać konto:\n` +
    `${billingUrl}\n\n` +
    `Po tej dacie odzyskanie konta nie będzie możliwe. Jeśli to nie Ty zgłosiłeś usunięcie, ` +
    `zaloguj się i anuluj operację albo napisz na kontakt@tuttopizza.pl.\n\n` +
    `Pozdrawiamy,\n` +
    `Zespół ${cfg.APP_NAME}\n`;

  const inner =
    `<p>Dzień dobry,</p>` +
    `<p>Twoje konto w <strong>${escapeHtml(cfg.APP_NAME)}</strong> zostało zgłoszone do <strong>usunięcia</strong> (RODO art. 17 — prawo do bycia zapomnianym).</p>` +
    `<p style="padding:14px 16px;background:#fef3c7;border-left:3px solid #f59e0b;color:#92400e;border-radius:4px">` +
    `Dane będą trwale usunięte: <strong>${escapeHtml(graceDate)}</strong> (za <strong>${params.daysRemaining}</strong> dni).` +
    `</p>` +
    `<p>W okresie karencji <strong>30 dni</strong> możesz anulować usunięcie i odzyskać konto:</p>` +
    `<p style="text-align:center;margin:28px 0">` +
    `<a href="${escapeHtml(billingUrl)}" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#4f6ef7 0%,#a855f7 100%);color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600">Anuluj usunięcie</a>` +
    `</p>` +
    `<p style="color:#6b7280;font-size:13px">Po tej dacie odzyskanie konta nie będzie możliwe. Jeśli to nie Ty zgłosiłeś usunięcie, zaloguj się i anuluj operację albo napisz na <a href="mailto:kontakt@tuttopizza.pl">kontakt@tuttopizza.pl</a>.</p>`;

  await sendEmail(cfg, {
    to,
    subject,
    text,
    html: brandHtml(cfg, inner),
    devLogHint: `deletion request dla ${to} (grace do ${graceDate})`,
  });
}

/**
 * Anulacja zgłoszenia usunięcia — konto przywrócone, dostęp wznowiony.
 */
export async function sendTenantDeletionCanceledEmail(cfg: AppConfig, to: string): Promise<void> {
  const dashboardBase = cfg.WEB_APP_URL.replace(/\/$/, "");
  const subject = `Konto przywrócone — ${cfg.APP_NAME}`;

  const text =
    `Dzień dobry,\n\n` +
    `Zgłoszenie usunięcia Twojego konta w ${cfg.APP_NAME} zostało anulowane. ` +
    `Dostęp jest w pełni przywrócony, wszystkie dane są nienaruszone.\n\n` +
    `Zaloguj się:\n` +
    `${dashboardBase}/login\n\n` +
    `Pozdrawiamy,\n` +
    `Zespół ${cfg.APP_NAME}\n`;

  const inner =
    `<p>Dzień dobry,</p>` +
    `<p>Zgłoszenie usunięcia Twojego konta w <strong>${escapeHtml(cfg.APP_NAME)}</strong> zostało <span style="color:#16a34a;font-weight:600">anulowane</span>. Dostęp jest w pełni przywrócony, wszystkie dane są nienaruszone.</p>` +
    `<p style="text-align:center;margin:28px 0">` +
    `<a href="${escapeHtml(dashboardBase)}/login" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#4f6ef7 0%,#a855f7 100%);color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600">Zaloguj się</a>` +
    `</p>`;

  await sendEmail(cfg, {
    to,
    subject,
    text,
    html: brandHtml(cfg, inner),
    devLogHint: `deletion canceled dla ${to}`,
  });
}
