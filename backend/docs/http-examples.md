# FV Resta API — przykłady HTTP

Wszystkie endpointy (poza `health`, `version`, `register` przy pierwszym uruchomieniu, `login`, `refresh`) wymagają nagłówka:

```http
Authorization: Bearer <access_token>
```

## System

```http
GET /api/health
GET /api/version
```

## Auth

### Bootstrap pierwszego tenanta (tylko gdy w DB nie ma użytkowników)

```http
POST /api/auth/register
Content-Type: application/json

{
  "tenantName": "Moja Restauracja",
  "tenantNip": "1234567890",
  "email": "owner@example.com",
  "password": "SecurePass123!"
}
```

### Login

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "admin@fvresta.local",
  "password": "Admin123!"
}
```

### Refresh

```http
POST /api/auth/refresh
Content-Type: application/json

{
  "refreshToken": "<refresh_token_z_logowania>"
}
```

### Logout (opcjonalnie unieważnia jeden refresh)

```http
POST /api/auth/logout
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "refreshToken": "<opcjonalnie>"
}
```

### Ja

```http
GET /api/auth/me
Authorization: Bearer <access_token>
```

## Kontrahenci

```http
GET /api/contractors
POST /api/contractors
GET /api/contractors/:id
PATCH /api/contractors/:id
DELETE /api/contractors/:id
```

Przykład utworzenia:

```http
POST /api/contractors
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "name": "Dostawca Sp. z o.o.",
  "nip": "5260250999",
  "address": "ul. Testowa 1, Warszawa",
  "email": "kontakt@dostawca.pl",
  "phone": "+48111222333"
}
```

## Faktury

### Lista (filtry opcjonalne)

```http
GET /api/invoices?status=RECEIVED&contractorId=<uuid>&dateFrom=2026-01-01&dateTo=2026-12-31&q=FV&page=1&limit=20
Authorization: Bearer <access_token>
```

### Utworzenie z pozycjami (sumy wyliczane z pozycji)

```http
POST /api/invoices
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "contractorId": "<uuid>",
  "number": "FV/2026/100",
  "issueDate": "2026-04-01",
  "currency": "PLN",
  "status": "DRAFT",
  "items": [
    {
      "name": "Towar",
      "quantity": "2",
      "unit": "szt",
      "netPrice": "10.00",
      "vatRate": "23",
      "netValue": "20.00",
      "grossValue": "24.60"
    }
  ]
}
```

### CRUD

```http
GET /api/invoices/:id
PATCH /api/invoices/:id
PATCH /api/invoices/:id/status
DELETE /api/invoices/:id
```

Przykład zmiany statusu:

```http
PATCH /api/invoices/:id/status
Authorization: Bearer <access_token>
Content-Type: application/json

{ "status": "VERIFIED" }
```

### Pozycje

```http
POST /api/invoices/:id/items
PATCH /api/invoices/:id/items/:itemId
DELETE /api/invoices/:id/items/:itemId
```

### Audyt

```http
GET /api/invoices/:id/events
Authorization: Bearer <access_token>
```

## Pliki

### Upload (multipart, pole pliku: dowolna nazwa pola — pierwszy plik)

```http
POST /api/invoices/:id/files
Authorization: Bearer <access_token>
Content-Type: multipart/form-data; boundary=----boundary

------boundary
Content-Disposition: form-data; name="file"; filename="fv.pdf"
Content-Type: application/pdf

<binary>
------boundary--
```

### Lista / usunięcie

```http
GET /api/invoices/:id/files
DELETE /api/invoices/:id/files/:fileId
```

### Pobranie

```http
GET /api/files/:fileId/download
Authorization: Bearer <access_token>
```

## Integracja POS (POS-Resta)

```http
GET /api/integrations/pos/status
Authorization: Bearer <access_token>
```

```http
POST /api/integrations/pos/test-connection
Authorization: Bearer <access_token>
Content-Type: application/json

{}
```

(opcjonalnie zamiast konfiguracji z DB: `{ "baseUrl": "https://pos.example", "apiKey": "secret" }`)

```http
POST /api/integrations/pos/sync-contractors
Authorization: Bearer <access_token>
```
