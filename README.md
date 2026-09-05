# ChanaX

ChanaX is a CA-centric workspace for multi-entity invoicing, payslip
generation, GSTIN verification, and Tally-ready exports.

## Project structure

```text
frontend/   React, TypeScript, Vite and shadcn/ui
backend/    FastAPI, GSTINAPI integration and Celery worker
compose.yaml
```

## Run the frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

The application is available at `http://localhost:5173`.

## Run the backend locally

```bash
cd backend
cp .env.example .env
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload
```

The API is available at `http://localhost:8000` and its documentation at
`http://localhost:8000/docs`.

## Run backend services with Docker

```bash
cp backend/.env.example backend/.env
docker compose up --build
```

This starts FastAPI, a Celery worker, and Redis. PostgreSQL, authentication and
private document storage are provided by Supabase.

## Required configuration

- Create separate Supabase projects for development and production.
- Put only the Supabase public URL and anonymous key in the frontend environment.
- Keep the Supabase service key and GSTINAPI key on the backend.

Never commit real credentials.

## Connect the application database

Before using entities, customers, invoices, employees or payslips, run these
migrations in the Supabase SQL Editor in order:

```text
supabase/migrations/202607290001_auth_profiles.sql
supabase/migrations/202607290002_workspace_data.sql
...
supabase/migrations/202608280001_remaining_product_features.sql
supabase/migrations/202609040001_razorpay_billing.sql
supabase/migrations/202609050001_separate_quotation_credits.sql
supabase/migrations/202609050002_private_super_admin.sql
supabase/migrations/202609050003_custom_subscription_plans.sql
supabase/migrations/202609050004_fixed_subscription_plans.sql
supabase/migrations/202609050005_admin_email_credit_grants.sql
supabase/migrations/202609050006_chanax_brand_defaults.sql
```

The migrations create user-owned tables and Row Level Security policies. The
MVP data tables use the `breezy_` prefix so they do not overwrite any older
normalized tables already present in the Supabase project.
After they are applied, sign out and sign in again. ChanaX will load
data from Supabase and automatically import any existing browser-only MVP data
when the signed-in user's database workspace is empty.
