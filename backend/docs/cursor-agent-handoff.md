# Cursor Agent vs Ty — na jakim etapie jesteśmy i co robić dalej

Ten plik jest **punktem odniesienia** dla Ciebie i dla asystenta w Cursorze. Na początku rozmowy możesz napisać: *„czytaj `backend/docs/cursor-agent-handoff.md` i kontynuuj od sekcji N”*.

---

## Aktualny etap (stan na dziś)

| Obszar | Status |
|--------|--------|
| **Routing poczty (Google Workspace)** | Zrobione: faktury z domeny **tuttopizza** są **przekazywane** do skrzynki **`maciejewski@tuttos.pl`** (jeden INBOX do odczytu). |
| **IMAP / hasło aplikacji (Google)** | Zrobione: wygenerowane **App Password** dla konta, z którego FV ma czytać pocztę (`maciejewski@tuttos.pl`). Hasło trzymaj w menedżerze sekretów / tylko na serwerze — **nie w repo, nie na czacie**. |
| **FV Control — rejestracja IMAP w API** | **Do zrobienia na VPS:** ustawione `API` + `TOKEN`, `POST /api/v1/connectors/zenbox/accounts`, potem `POST .../sync`, `GET .../status`, test maila z PDF. |
| **Worker + Redis** | **Do weryfikacji na serwerze:** proces **`npm run worker`** działa z tym samym `REDIS_URL` co API (inaczej sync IMAP nie domknie pracy). |
| **n8n (eventy z FV)** | Kolejny etap po stabilnym mailu → FV. |
| **OpenClaw / Discord** | Po mailu + ewentualnie n8n. |
| **KSeF** | Później (connector wg planu rolloutu). |

**Jesteśmy więc na końcówce Fazy 1 z [integration-deployment-plan.md](./integration-deployment-plan.md):** poczta już trafia na właściwą skrzynkę; **brakuje operacyjnego podłączenia tej skrzynki do działającego API FV na serwerze**.

---

## Co może zrobić **Cursor Agent** (w tym repozytorium)

- Edytować **kod i dokumentację** w workspace (np. `backend/docs/*`, skrypty szablonowe w `scripts/`).
- Dodać **skrypt pomocniczy** z placeholderami / zmiennymi środowiskowymi (bez prawdziwych haseł w plikach commitowanych).
- Wyjaśnić błędy z logów / odpowiedzi API, jeśli wkleisz **fragment bez sekretów**.
- Przygotować **commity** na branchu (gdy poprosisz w trybie Agent).

**Agent nie ma dostępu do Twojego VPS ani Gmaila** — nie wykona za Ciebie `curl` na `srv1362287`, nie ustawi `export API=...` w Twojej sesji SSH.

---

## Co musisz zrobić **Ty** (lub osoba z dostępem do serwera)

1. SSH na serwer, gdzie stoi FV (lub maszyna z `curl` widzącą API).
2. `export API="https://PEŁNY-HOST"` — wcześniejszy błąd `No host part in the URL` = pusty `API`.
3. `POST /api/v1/auth/login` → `export TOKEN="..."`.
4. `POST /api/v1/connectors/zenbox/accounts` z danymi Gmail IMAP (`imap.gmail.com`, `maciejewski@tuttos.pl`, App Password).
5. Upewnić się, że **worker** działa.
6. `POST .../sync` + `GET .../status` + test mail z PDF.

Szczegóły poleceń: [zenbox-imap-setup.md](./zenbox-imap-setup.md).

---

## Jak pracować z Agentem krok po kroku (praktyka)

### Krok A — Ty na serwerze (bez Cursor)

Wykonaj checklistę z sekcji „Co musisz zrobić Ty”. Jeśli coś padnie, skopiuj **tylko** `lastError` albo kod HTTP + treść błędu **bez tokenów i haseł**.

### Krok B — Cursor Agent (workspace)

Możesz poprosić np.:

- *„Dodaj `scripts/fv-gmail-imap-setup.example.sh` który używa zmiennych `FV_API_URL`, `FV_ACCESS_TOKEN`, `FV_IMAP_APP_PASSWORD` z env i woła register + sync + status.”*
- *„Uzupełnij `cursor-agent-handoff.md` gdy skończę Fazę 1.”*

**Nigdy nie wklejaj** App Password ani hasła admina do czatu — użyj `read -s` w terminalu albo pliku `chmod 600` na serwerze.

### Krok C — Po sukcesie

Zaktualizuj tabelę „Aktualny etap” w tym pliku (sam lub przez Agenta): Faza 1 = ✅, następny focus = n8n lub OpenClaw.

---

## Szybki skrypt pierwszej wiadomości do Agenta

Wklej w nowym czacie (dostosuj jeśli coś się zmieni):

```
Przeczytaj backend/docs/cursor-agent-handoff.md.
Jesteśmy na etapie: poczta forwarduje na maciejewski@tuttos.pl, czekamy na rejestrację IMAP w FV na VPS.
Pomóż z [konkretna prośba: np. skrypt / dokumentacja / debug odpowiedzi status bez sekretów].
```

---

## Powiązane dokumenty

- [integration-deployment-plan.md](./integration-deployment-plan.md) — fazy 0–4 (mail → n8n → OpenClaw → KSeF).
- [zenbox-imap-setup.md](./zenbox-imap-setup.md) — API IMAP, worker, metryki.
- [openclaw-n8n-hybrid.md](./openclaw-n8n-hybrid.md) — po stabilnym mailu.
