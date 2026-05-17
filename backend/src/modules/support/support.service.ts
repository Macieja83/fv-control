/**
 * B18 customer chat widget — warstwa serwisowa.
 * - Klient (auth, tenant-scoped): tworzenie ticketu, lista, detal, dodanie wiadomości.
 * - Admin/internal (Discord bot bearer): reply (STAFF), override severity, zmiana statusu.
 * SSE push do widgetu po STAFF/SYSTEM message + zmianie statusu/severity.
 *
 * Notification (Discord/n8n) = B18.4/B18.6 — tu zwracamy utworzone encje, route/follow-up
 * odpala powiadomienia. Idempotencja po Discord message ID = warstwa B18.4.
 */
import type {
  PrismaClient,
  SupportTicket,
  SupportMessage,
  SupportSeverity,
  SupportTicketStatus,
} from "@prisma/client";
import { AppError } from "../../lib/errors.js";
import { publishSupportEvent } from "./support.events.js";

const MAX_SUBJECT = 200;
const MAX_MESSAGE = 5000;

export type TicketWithMessages = SupportTicket & { messages: SupportMessage[] };

function clampSubject(raw: string): string {
  const s = raw.trim();
  if (!s) throw AppError.validation("Temat zgłoszenia nie może być pusty.");
  return s.slice(0, MAX_SUBJECT);
}

function clampMessage(raw: string): string {
  const s = raw.trim();
  if (!s) throw AppError.validation("Treść wiadomości nie może być pusta.");
  if (s.length > MAX_MESSAGE) {
    throw AppError.validation(`Wiadomość przekracza ${MAX_MESSAGE} znaków.`);
  }
  return s;
}

export async function createTicket(
  prisma: PrismaClient,
  tenantId: string,
  userId: string | null,
  input: { subject: string; message: string },
): Promise<TicketWithMessages> {
  const subject = clampSubject(input.subject);
  const content = clampMessage(input.message);

  return prisma.supportTicket.create({
    data: {
      tenantId,
      userId,
      subject,
      status: "OPEN",
      messages: {
        create: [
          {
            authorType: "CLIENT",
            authorUserId: userId,
            content,
          },
        ],
      },
    },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
}

export async function listTickets(
  prisma: PrismaClient,
  tenantId: string,
  limit = 30,
): Promise<Array<SupportTicket & { lastMessageAt: Date | null }>> {
  const tickets = await prisma.supportTicket.findMany({
    where: { tenantId },
    orderBy: { updatedAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
    include: {
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
    },
  });
  return tickets.map(({ messages, ...t }) => ({
    ...t,
    lastMessageAt: messages[0]?.createdAt ?? null,
  }));
}

async function getTenantScopedTicket(
  prisma: PrismaClient,
  tenantId: string,
  ticketId: string,
): Promise<SupportTicket> {
  const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
  if (!ticket || ticket.tenantId !== tenantId) {
    // Nie ujawniamy istnienia ticketu innego tenanta.
    throw AppError.notFound("Zgłoszenie nie znalezione.");
  }
  return ticket;
}

export async function getTicket(
  prisma: PrismaClient,
  tenantId: string,
  ticketId: string,
): Promise<TicketWithMessages> {
  await getTenantScopedTicket(prisma, tenantId, ticketId);
  return prisma.supportTicket.findUniqueOrThrow({
    where: { id: ticketId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
}

export async function addClientMessage(
  prisma: PrismaClient,
  tenantId: string,
  ticketId: string,
  userId: string | null,
  rawContent: string,
): Promise<SupportMessage> {
  const ticket = await getTenantScopedTicket(prisma, tenantId, ticketId);
  if (ticket.status === "CLOSED") {
    throw AppError.conflict("Zgłoszenie jest zamknięte — utwórz nowe.");
  }
  const content = clampMessage(rawContent);

  const [message] = await prisma.$transaction([
    prisma.supportMessage.create({
      data: { ticketId, authorType: "CLIENT", authorUserId: userId, content },
    }),
    prisma.supportTicket.update({
      where: { id: ticketId },
      // Odpowiedź klienta -> wraca do kolejki triage; RESOLVED reopen do OPEN.
      data: { status: ticket.status === "RESOLVED" ? "OPEN" : ticket.status },
    }),
  ]);
  return message;
}

export async function adminReply(
  prisma: PrismaClient,
  ticketId: string,
  input: { content: string; authorLabel?: string | null },
): Promise<SupportMessage> {
  const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw AppError.notFound("Zgłoszenie nie znalezione.");
  const content = clampMessage(input.content);
  const authorLabel = input.authorLabel?.trim().slice(0, 100) || "Support";

  const [message] = await prisma.$transaction([
    prisma.supportMessage.create({
      data: { ticketId, authorType: "STAFF", authorLabel, content },
    }),
    prisma.supportTicket.update({
      where: { id: ticketId },
      data: { status: "WAITING_USER" },
    }),
  ]);

  publishSupportEvent({
    type: "message",
    ticketId,
    message: {
      id: message.id,
      authorType: message.authorType,
      authorLabel: message.authorLabel,
      content: message.content,
      createdAt: message.createdAt.toISOString(),
    },
  });
  publishSupportEvent({ type: "status", ticketId, status: "WAITING_USER" });
  return message;
}

export async function adminSetSeverity(
  prisma: PrismaClient,
  ticketId: string,
  severity: SupportSeverity,
): Promise<SupportTicket> {
  const exists = await prisma.supportTicket.findUnique({ where: { id: ticketId }, select: { id: true } });
  if (!exists) throw AppError.notFound("Zgłoszenie nie znalezione.");
  const ticket = await prisma.supportTicket.update({ where: { id: ticketId }, data: { severity } });
  publishSupportEvent({ type: "severity", ticketId, severity });
  return ticket;
}

export async function adminSetStatus(
  prisma: PrismaClient,
  ticketId: string,
  status: SupportTicketStatus,
): Promise<SupportTicket> {
  const exists = await prisma.supportTicket.findUnique({ where: { id: ticketId }, select: { id: true } });
  if (!exists) throw AppError.notFound("Zgłoszenie nie znalezione.");
  const closing = status === "RESOLVED" || status === "CLOSED";
  const ticket = await prisma.supportTicket.update({
    where: { id: ticketId },
    data: { status, closedAt: closing ? new Date() : null },
  });
  publishSupportEvent({ type: "status", ticketId, status });
  return ticket;
}
