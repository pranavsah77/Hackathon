# Qartix — Campus EV Cart Transit System

[![Production Deployment](https://img.shields.io/badge/Vercel-Live-brightgreen)](https://qartix-hackathon.vercel.app)
[![Supabase Backend](https://img.shields.io/badge/Supabase-Hardened%20Postgres%2015-emerald)](https://supabase.com)
[![Security Status](https://img.shields.io/badge/Security-RLS%20Enforced%20%E2%80%A2%20Audit%20Logged-blue)](#security--isolation)

Qartix is an accessible, on-demand campus electric vehicle (EV) cart transit application designed for university students with temporary or permanent mobility impairments, campus drivers, and transport office fleet dispatchers.

Frontend is deployed on Vercel at [qartix-hackathon.vercel.app](https://qartix-hackathon.vercel.app).

---

## 1. System Architecture

```mermaid
flowchart TD
    subgraph Client ["Client Tier (Vite + React SPA)"]
        Landing["3D Landing (Three.js WebGL)"]
        StudentDash["Student Dashboard & Pass Builder"]
        DriverCockpit["Driver Cockpit & Queue"]
        AdminConsole["Transport Admin Console (/admin)"]
    end

    subgraph Edge ["Supabase Edge Runtime & Gateway"]
        AuthLogin["auth-login Edge Function"]
        AuthSignup["auth-signup Edge Function"]
        NotifyOffice["notify-transport-office Edge Function"]
    end

    subgraph Database ["Supabase Database (PostgreSQL 15)"]
        Profiles["public.profiles (Role Lock)"]
        PassReqs["public.pass_requests"]
        Rides["public.rides (State Machine)"]
        Carts["public.carts (Live Telemetry)"]
        AuditLogs["public.audit_logs (Immutable)"]
        Realtime["Supabase Realtime (CDC / Broadcast)"]
        Storage["Private Storage ('medical-certificates')"]
        Cron["pg_cron (Scheduled Top-Up & Purge)"]
    end

    StudentDash -->|Upload Medical Cert| Storage
    StudentDash -->|submit_pass_request()| PassReqs
    AdminConsole -->|review_pass_request()| PassReqs
    PassReqs -->|Triggers Generation| Rides
    StudentDash -->|skip_ride()| Rides
    Rides -.->|Realtime Broadcast| DriverCockpit
    DriverCockpit -->|update_cart_location()| Carts
    Carts -.->|GPS / ETA Realtime| StudentDash
    DriverCockpit -->|mark_arrived()| Rides
    Rides -.->|Arrival Alert| StudentDash
    Edge --> Profiles
    Cron -->|Daily Purge 30d| Storage
    Cron -->|Daily Top-Up| Rides
```

---

## 2. Environments & Supabase Projects

Qartix maintains dual isolated Supabase environments:

| Environment | Supabase Project ID | URL | Purpose |
| :--- | :--- | :--- | :--- |
| **Production** | `arbwqtudubtyxufbjojq` | `https://arbwqtudubtyxufbjojq.supabase.co` | Live Vercel production system |
| **Development** | `bhttyptrqxnciedtkffe` | `https://bhttyptrqxnciedtkffe.supabase.co` | Staging, CI/CD, and migration testing |

### Vercel Environment Variables
Set the following public environment variables in your Vercel Project Settings (**Settings** > **Environment Variables**):

```bash
# Production Vercel Environment
VITE_SUPABASE_URL="https://arbwqtudubtyxufbjojq.supabase.co"
VITE_SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFyYndxdHVkdWJ0eXh1ZmJqb2pxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI5MTk3MjcsImV4cCI6MjEwODQ5NTcyN30.cOkLai5YpcN2d_FOidjkwGKoAweXn3YAVoFA2ERW5QA"
VITE_DEMO_MODE="false"

# Preview / Staging Vercel Environment (Optional Dev Branch)
VITE_SUPABASE_URL="https://bhttyptrqxnciedtkffe.supabase.co"
VITE_SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJodHR5cHRycXhuY2llZHRrZmZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUxMTI2MzgsImV4cCI6MjExMDY4ODYzOH0.8OF3oc8cPPjF6T9eEoX66X-XE9CuPnxqWq16L1tn-lc"
```

> [!IMPORTANT]
> **Zero Secrets in Client Bundles:** Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are exposed to the client. The `SUPABASE_SERVICE_ROLE_KEY` and third-party API keys (like `RESEND_API_KEY`) reside exclusively in Supabase Vault / Edge Function secrets.

---

## 3. Local Development Setup

### Prerequisites
- Node.js 18+ (or Python 3.10+ for headless test execution)
- Git

### Installation
```bash
# Clone the repository
git clone https://github.com/pranavsah77/Hackathon.git
cd Hackathon

# Install frontend dependencies
npm install

# Start local Vite development server
npm run dev
```

Visit `http://localhost:5173` in your browser.

---

## 4. Applying Migrations to a Fresh Supabase Project

To stand up the complete database schema, RLS policies, storage bucket, triggers, and functions on any clean project:

### Option A: Using the Consolidated SQL Setup Script
1. Open the [Supabase Dashboard SQL Editor](https://supabase.com/dashboard).
2. Copy and paste the contents of [`scripts/setup_fresh_db.sql`](scripts/setup_fresh_db.sql).
3. Click **Run**. All tables, storage buckets, constraints, and initial fleet stations will be provisioned.

### Option B: Using Supabase CLI Migrations
If using the Supabase CLI:
```bash
supabase link --project-ref <your-project-id>
supabase db push
```

---

## 5. How to Seed Demo Data

Qartix includes default seed fixtures for immediate end-to-end evaluation:

### Seed Accounts (Pre-configured)
| Persona | Login Identifier | Password / PIN | Role | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Student** | `STU-84920` | `studentPassword123` | `student` | Pranav Kumar (Has active monthly pass) |
| **Student 2** | `STU-82194` | `studentPassword123` | `student` | Neha Patel (New applicant) |
| **Driver** | `CART-04` | `4021` | `driver` | Vikram Singh (Assigned to Cart #04) |
| **Unapproved Driver** | `CART-99` | `4021` | `driver` | Pending approval demonstration |
| **Administrator** | `ADMIN-01` | `adminPassword123` | `admin` | Transport Office Fleet Administrator |

---

## 6. How to Promote an Account to Administrator

In accordance with strict security standards, **no client API endpoint exists to create or promote admins**. To elevate any user account to administrator:

1. Open the [Supabase Dashboard SQL Editor](https://supabase.com/dashboard).
2. Execute the following SQL snippet:

```sql
-- Promote user account to Administrator
UPDATE public.profiles
SET 
  role = 'admin',
  status = 'active',
  updated_at = now()
WHERE login_identifier = 'ADMIN-01'  -- Or match by email: id = (SELECT id FROM auth.users WHERE email = 'you@campus.edu')
RETURNING id, full_name, role, login_identifier, status;
```

---

## 7. Automated Testing & Verification

### Running Playwright E2E Suites
```bash
# Run all Playwright E2E tests across Chromium, Firefox, and WebKit
npx playwright test

# Run interactive UI test viewer
npx playwright test --ui
```

### Running Backend Security & Lifecycle Verification
An automated test runner script validates all backend RPCs, Edge Functions, RLS boundaries, and rate limits:
```bash
python scripts/run_automated_security_and_e2e_tests.py
```

### Test Suite Results Summary
```
======================================================================
TEST EXECUTION SUMMARY
======================================================================
Total Tests Executed: 14
Passed: 14
Failed: 0
Success Rate: 100.0%

[PASS] Unhappy Path 1: Wrong password returns 401 generic error
[PASS] Unhappy Path 2: Unapproved driver blocked from login (403 Pending)
[PASS] Unhappy Path 3: Student account blocked from driver tab (403)
[PASS] Unhappy Path 4: Executable (.exe) binary header rejected by magic-bytes
[PASS] Unhappy Path 5: Oversized file (20 MB) rejected against 5 MB ceiling
[PASS] Unhappy Path 6: Double-submit handles idempotency without duplication
[PASS] Unhappy Path 7: Request extra ride without active pass is rejected
[PASS] Unhappy Path 8: Student 1 reading Student 2 rides returns 0 rows (RLS)
[PASS] Lifecycle 1: Student authentication succeeded
[PASS] Lifecycle 2: Admin authentication succeeded
[PASS] Lifecycle 3: Admin reads audit log stream
[PASS] Lifecycle 4: Driver authentication succeeded
[PASS] Lifecycle 5: Driver assigned shift queue fetched
[PASS] Lifecycle 6: Cart telemetry updated & rapid updates throttled gracefully
======================================================================
```

---

## 8. Manual QA Checklist

Before shipping releases to production, complete the following 10-point checklist:

- [x] **1. Student Registration & Login:** Student signs up with roll number, phone, and password; receives automatic login session and profile row.
- [x] **2. Pass Application & Magic-Byte Validation:** Student uploads a PDF medical certificate (< 5 MB). File type is validated by content magic-bytes; status displays `PENDING` with QR token hidden.
- [x] **3. Document Privacy:** Public GET requests to `storage/v1/object/public/medical-certificates/...` return `400 Bad Request`. Document view opens private signed URL with 60-second TTL.
- [x] **4. Admin Review & Audit Logging:** Admin logs into `/admin`, inspects medical slip, and approves pass with remarks. Status changes to `APPROVED`, QR token generates, and entry is written to `audit_logs`.
- [x] **5. Scheduled Rides & Skip Today:** Approved student sees today's scheduled rides and clicks "Skip Today". Ride transitions optimistically to `SKIPPED`.
- [x] **6. Driver Cockpit Queue:** Driver logs in with Cart ID + PIN; shift queue automatically updates in real time to reflect student's skipped ride.
- [x] **7. Driver Arrival Dispatch:** Driver clicks "I Have Arrived". Student receives real-time broadcast notification with cart status.
- [x] **8. Rate Limiting Protection:** 5 consecutive failed login attempts trigger a 15-minute lockout. Rapid cart telemetry updates (< 1.5s) are throttled.
- [x] **9. Role Boundary Guard (/admin):** Student or driver navigating to `/admin` encounters a styled 403 Access Denied screen.
- [x] **10. Medical Retention Policy:** Passes expired for > 30 days have their medical certificates automatically purged by `public.purge_expired_medical_records()`.
