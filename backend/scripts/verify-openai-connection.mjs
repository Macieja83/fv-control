#!/usr/bin/env node
/**
 * Szybki test: czy OPENAI_API_KEY z backend/.env działa z api.openai.com.
 * Uruchom z katalogu backend: node scripts/verify-openai-connection.mjs
 * Nie wypisuje klucza.
 */
import "dotenv/config";
import OpenAI from "openai";

const key = process.env.OPENAI_API_KEY?.trim();
if (!key) {
  console.error("Brak OPENAI_API_KEY — ustaw w backend/.env (niekomentowana linia OPENAI_API_KEY=sk-...).");
  process.exit(1);
}

const client = new OpenAI({ apiKey: key });
try {
  const list = await client.models.list();
  const n = list.data?.length ?? 0;
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o";
  const hasModel = list.data?.some((m) => m.id === model);
  console.log(`OK: API OpenAI odpowiada (lista modeli: ${n} pozycji).`);
  console.log(`OPENAI_MODEL=${model} ${hasModel ? "(jest na liście)" : "(nie znaleziono dokładnego id — sprawdź nazwę w panelu OpenAI)"}`);
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error("BŁĄD:", msg);
  process.exit(1);
}
