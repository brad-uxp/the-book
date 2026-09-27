# AccountBook — API

REST API over the same handlers the web UI uses, at `https://book.bolstro.com`.
Every route is available to machine clients; there is no reduced surface.

## Authentication

Two credentials are accepted, checked in every handler:

| Caller | Credential |
|---|---|
| Browser | NextAuth session cookie (Google OAuth) |
| Machine | `Authorization: Bearer tb_…` |

Create a token in **Settings → Tokens de API**. It is shown once and never
again — only its SHA-256 is stored. Tokens expire in 90 days by default and can
be revoked instantly from the same screen.

```bash
curl https://book.bolstro.com/api/invoices \
  -H "Authorization: Bearer $THEBOOK_TOKEN"
```

A token has **the same access as the account owner**, including `DELETE`.
Two things it deliberately cannot do:

- **Manage tokens.** `/api/settings/tokens` returns 403 for a token. A
  credential that can mint credentials cannot be revoked, so that stays
  interactive-only.
- **Exceed 300 requests/minute.** Over that, `429` with a `Retry-After`
  header. Back off and retry; do not spin.

Every mutation is recorded in the audit log as `token:<name>`, distinct from
the human's email. That is what makes "did I do this or did the agent?"
answerable — visible under `/admin-logs`.

## Conventions

- **Money is integer cents.** `amount_cents: 150000` is $1,500.00. Never send
  floats or formatted strings.
- **Dates** are `YYYY-MM-DD` (or any string `Date` can parse) and are stored at
  UTC midnight. Timezone is `America/Montevideo`.
- **Bodies are JSON** and validated with Zod. A rejection returns `400` with
  `{"error": {"formErrors": [...], "fieldErrors": {...}}}` naming the fields.
- **Errors**: `400` invalid body · `401` no/expired/revoked credential ·
  `403` interactive session required · `404` missing · `409` conflict
  (duplicate invoice number, or a delete blocked because history depends on it)
  · `429` rate limited · `500` unexpected.

### Deletes that are refused on purpose

Deleting a `Person` or a `Subscription` that has payments returns `409`. Those
payments are booked accounting history and cascading would rewrite months that
are already closed. Set `status: "inactive"` instead — it hides the record and
keeps the history.

## Endpoints

### Invoices
| Method | Path | Notes |
|---|---|---|
| GET/POST | `/api/invoices` | |
| GET/PATCH/DELETE | `/api/invoices/{id}` | |
| POST | `/api/invoices/{id}/upload-url` | presigned PUT for a PDF |
| GET | `/api/invoices/{id}/download-url` | presigned GET |

`invoice_number` is optional but unique, case-insensitive. `fee_cents` is the
referrer commission and is stored **negative** — it is a deduction, and the
dashboard adds it to the amount.

### Issues (tasks and notes)
| Method | Path |
|---|---|
| GET/POST | `/api/issues` |
| GET/PATCH/DELETE | `/api/issues/{id}` |
| GET | `/api/issues/linked-counts` |

`category` is `task` or `note`; `status` is `pending`, `in_progress`,
`blocked` or `done`; `progress` is 0–100.

`note_format` is `text` (default: the note is its `description`) or `canvas`
(the note is a canvas of connected ideas, and `description` is unused). Only a
note can be a canvas — `{"category": "task", "note_format": "canvas"}` is a
`400`. Changing shape through `PATCH`:

| From → to | Result |
|---|---|
| task ↔ text note | allowed |
| text note (or task) → canvas | allowed; a non-blank `description` becomes the first idea and is emptied, in one transaction |
| canvas → anything else | `409` — flattening would drop its connections |

"Linked issues" (`?personId=` / `?invoiceId=`) and `linked-counts` find
mentions in descriptions **and** in canvas ideas, counted once per issue.

### Canvas notes
| Method | Path |
|---|---|
| GET | `/api/issues/{id}/canvas` → `{ nodes, edges }` |
| POST | `/api/issues/{id}/canvas/nodes` |
| PATCH/DELETE | `/api/issues/{id}/canvas/nodes/{nodeId}` |
| PATCH | `/api/issues/{id}/canvas/layout` |
| POST | `/api/issues/{id}/canvas/edges` |
| DELETE | `/api/issues/{id}/canvas/edges/{edgeId}` |

On an issue that is not a canvas note these return `409`; on one that does
not exist, `404`.

- **A node** is one idea: `{ id, content, color, x, y, width, height }`.
  `content` is HTML in the same format as `description` (mentions included).
  `color` is a palette key (`slate`, `blue`, `green`, `amber`, `red`, `violet`,
  `pink`) or `null`. Width 160–4000, height 64–4000, content up to 200 000
  characters.
- **Create** with `{ x, y, content?, color?, width?, height?, id? }`. `id` is
  optional; if you send one it must be a UUID, and a duplicate is a `409`
  rather than an overwrite.
- **Edit** a node's `content` and/or `color` with `PATCH` — only the keys you
  send are written. Position and size go through `layout`, which takes
  `{ "nodes": [{ id, x, y, width?, height? }] }` (up to 1000) and ignores ids
  that are not on this canvas.
- **An edge** is `{ id, source_id, target_id }`, directed, between two nodes
  of the same canvas. A duplicate is `409`; a self-link, or an end that is not
  a node of this canvas, is `400`.
- Deleting a node deletes its edges. Deleting a node that held text is
  audited with its content and edges, so it can be recovered from the audit
  log; nothing else on a canvas is audited.

### People and salaries
| Method | Path |
|---|---|
| GET/POST | `/api/people` |
| GET/PATCH/DELETE | `/api/people/{id}` |
| GET/POST | `/api/people/{id}/payments` |
| PATCH/DELETE | `/api/salary-payments/{id}` |
| GET/POST/PATCH/DELETE | `/api/people/{id}/reminders` |
| GET/POST | `/api/roles` · PATCH/DELETE `/api/roles/{id}` |

### Subscriptions
| Method | Path |
|---|---|
| GET/POST | `/api/subscriptions` |
| GET/PATCH/DELETE | `/api/subscriptions/{id}` |
| GET/POST/DELETE | `/api/subscriptions/{id}/payments` |
| PATCH/DELETE | `/api/subscription-payments/{id}` |

`frequency` is `monthly` or `annual` (annual requires `pay_month`);
`payment_mode` is `auto` (the daily job records the payment) or `manual`.
Payments are soft-deleted, so a delete is undoable.

### Expenses, clients, referrers
| Method | Path |
|---|---|
| GET/POST | `/api/other-expenses` · PATCH/DELETE `/api/other-expenses/{id}` |
| GET/POST | `/api/fee-payments` · PATCH/DELETE `/api/fee-payments/{id}` |
| GET/POST | `/api/clients` · PATCH/DELETE `/api/clients/{id}` |
| GET/POST | `/api/referrers` · PATCH/DELETE `/api/referrers/{id}` |
| GET | `/api/referrers/{id}/clients` · `/api/referrers/{id}/detail` · `/api/referrers/summary` |

### System
| Method | Path |
|---|---|
| GET/PATCH | `/api/notifications` · GET `/api/notifications/count` · POST `/api/notifications/mark-all-read` |
| GET | `/api/audit-logs` |
| GET/PATCH | `/api/settings` |

## Example

```bash
TOKEN=tb_…
BASE=https://book.bolstro.com

# A client id to bill
CLIENT=$(curl -s "$BASE/api/clients" -H "Authorization: Bearer $TOKEN" \
  | jq -r '.[0].id')

# $1,500.00 due at the end of September
curl -s -X POST "$BASE/api/invoices" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"client_id\":\"$CLIENT\",\"amount_cents\":150000,\"fee_cents\":0,
       \"status\":\"pending\",\"due_date\":\"2026-09-30\",
       \"invoice_number\":\"F-2026-042\"}"
```

## Security notes for whoever integrates this

- The token is a **bearer** credential: whoever holds it is you. Keep it in an
  environment variable, never in a prompt, a commit or a log line.
- There are **no CORS headers** on the API. That is deliberate — machine
  clients call server-side, where CORS does not apply, and the wildcard that
  used to be there would let a leaked token be used from any web page.
- If an agent builds requests from content it did not author — invoices, email,
  PDFs — treat that content as untrusted input. This token can delete records,
  and the audit log is what lets you find and undo the damage, not prevent it.
