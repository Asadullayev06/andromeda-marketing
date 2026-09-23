# ANDROMEDA Sales (`marketing_control`)

A dedicated **Sales-department** platform for Synergy Pharmco. It is a second,
purpose-built frontend + backend that reads (and lightly writes) the **same
PostgreSQL database** as ANDROMEDA (`custom_control`). Whatever ANDROMEDA
changes appears here instantly, and vice-versa — because it is literally the
same database. There is no sync job.

Scope is intentionally narrow: **stock ("ostatok"), sales analytics, and the
read-only certificate library** — no tasks, chat, contracts, finance,
logistics, or registration workflows.

## Modules

| Route | Module | Source tables |
|-------|--------|---------------|
| `/` | Dashboard | aggregates of the below |
| `/company-stock` | Company stock (company ostatok) + expiry snapshot | `analytics_stock_company` + marketing-only Smartup export |
| `/warehouses`, `/warehouses/:id` | Per-warehouse stock | `warehouses`, `warehouse_stocks` |
| `/customs` | Customs warehouse (customs ostatok) | `customs_warehouse_invoices/products/series` |
| `/catalog` | Product catalog | `analytics_products` |
| `/certificates` | Read-only certificate library | `certificates`, `certificate_products` |
| `/sales` | Sales analytics | `analytics_sales`, `analytics_fact_sales` |
| `/orders` | Read-only purchase orders and documents | `analytics_orders` |
| `/operations` | Alerts, purchase planning, quality and audit | shared read models + marketing-owned files |

## Architecture

- **Frontend**: React 19 + TypeScript + Vite + React Router. A distinct Sales
  design system (`src/styles.css`) — larger type, rounded cards, blue-gradient
  table headers, status chips, a timeline stepper. i18n in UZ / RU / EN.
- **Backend**: FastAPI + SQLAlchemy 2 + Pydantic v2 (`backend/app`). Snake_case
  wire; the frontend maps to camelCase in `src/api.ts`.
- The wire contract mirrors ANDROMEDA: `CORSMiddleware` is added **last** so it
  wraps the auth gate (outermost) — otherwise errors return without CORS headers
  and the browser reports the misleading "Failed to fetch".

### How the shared database is wired

The backend reads `DATABASE_URL` (same value as ANDROMEDA) and maps the existing
tables with SQLAlchemy. **It never runs Alembic migrations — ANDROMEDA owns the
schema.** Keep this app read-mostly; if you add a column that stores a
Cloudflare R2 object key, follow ANDROMEDA's storage-GC rule (name it
`*_storage_path` or register it) or the object is garbage-collected after 24h.

### Shared login (SSO-style)

Login reuses ANDROMEDA's `users` + `auth_sessions` tables and the **same
`AUTH_SECRET_KEY`**, so a Sales user signs in with their existing ANDROMEDA
account and the JWT is a first-class ANDROMEDA session. Roles: `guest` is
read-only (blocked from all writes by the auth gate); `admin`/`sysadmin` may
edit stock quantities. New Sales sessions use a secure HttpOnly cookie; bearer
tokens already issued by older versions remain accepted during migration.

## Local development

**Backend** (`backend/`):
```bash
cp .env.example .env      # set DATABASE_URL + AUTH_SECRET_KEY to ANDROMEDA's values
python -m venv .venv && . .venv/Scripts/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8010
```

**Frontend** (repo root):
```bash
npm install
npm run dev                # http://localhost:5175 ; /api proxies to :8010
```

## Deployment

Deploy as two services (a Coolify/Railway pair, same model as ANDROMEDA):

- **Backend** — start command: `python -m uvicorn app.main:app --host 0.0.0.0 --port $PORT`
  (do **not** add `alembic upgrade head`). Env: `DATABASE_URL`, `AUTH_SECRET_KEY`
  (identical to ANDROMEDA), `CORS_ORIGINS` (the Sales frontend origin), `ENV=production`.
- **Frontend** — build the Vite SPA and serve `dist/`. Point `/api` at the
  backend origin (or bake a base URL / proxy in front).

## Important shared rules (inherited from ANDROMEDA)

- Currencies **never blend** — USD / EUR / UZS are always kept separate.
- User-facing dates are `dd.mm.yyyy`; API/DB dates stay ISO.
- Manufacturers come from canonical `suppliers` rows (`supplier_kind =
  Manufacturer`), not free-text product labels.

### Shared UI components

Common actions, inputs, status badges, login fields/alerts, and the warehouse
breakdown dialog use shadcn/ui (Base UI), with source in `src/components/ui`.
`components.json` configures the registry and `@/` aliases. Add components with
`pnpm dlx shadcn@latest add <component>` and keep utility imports pointed at
`@/lib/utils`.

Tailwind v4 utilities are enabled through Vite without its global preflight
reset. Semantic colors in `src/styles.css` map to the existing Sales palette;
keep those mappings when adding components. Specialized data tables, charts,
and navigation retain their existing layout.

### Marketing-owned operational data

Expiry imports and stock-edit audit events are stored outside the shared
ANDROMEDA schema. Set `MARKETING_DATA_DIR` to a persistent mounted directory in
production. Admins can replace the expiry snapshot from the Company stock page
using a Smartup `.xlsx` export; imports are validated and written atomically.
