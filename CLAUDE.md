# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FundFlow is a real-time, browser-based funding platform for demo-day-style events where startups pitch to investors. It features live funding sessions with role-based access (Facilitator/Startup/Investor), real-time investment tracking, session stage control, and live chat. Licensed under GPL.

**Status**: Front-end demo complete; backend is Supabase (no custom API routes).

## Commands

- `npm run dev` — Vite dev server on port 8080
- `npm run build` — production build
- `npm run lint` — ESLint
- `npm test` — Vitest (single run)
- `npm run test:watch` — Vitest in watch mode

Tests live in `src/**/*.{test,spec}.{ts,tsx}` and use jsdom environment with globals enabled. Setup file: `src/test/setup.ts`.

## Architecture

**Stack**: React 18 + TypeScript, Vite (SWC), Supabase (Postgres + realtime), TanStack React Query, Tailwind CSS, shadcn/ui (Radix), Framer Motion.

**Path alias**: `@/*` → `./src/*`

**Data flow**: App.tsx sets up providers (QueryClient, Router, SessionProvider) → Routes map to pages → SessionProvider (React Context in `src/lib/sessionContext.tsx`) manages user login state → Supabase client handles all DB operations → Real-time Postgres subscriptions on `investments` and `chat_messages` tables drive live updates.

**Key directories**:
- `src/pages/` — Index (landing), Login (join), Session (main app), Admin, DemoLogins, NotFound
- `src/components/` — Custom components (ChatPanel, FundingMeter, InvestDialog, SessionTimer, StageSelector, VideoPane) plus `ui/` subdirectory with shadcn/ui primitives
- `src/hooks/` — useSessionStages, useDemoMode, useSessionUser
- `src/integrations/supabase/` — Client config and auto-generated types

**Database tables**: `sessions`, `session_participants`, `investments`, `chat_messages`, `session_logs`, `app_settings`. Key enums: `participant_role` (facilitator/startup/investor), `session_status` (draft/scheduled/live/completed).

## Environment

Supabase config is in `.env` with `VITE_` prefix (exposed to browser). The publishable anon key is checked in — this is intentional for a client-side Supabase setup.

## Style & Config Notes

- TypeScript is configured loosely (`noImplicitAny: false`, `skipLibCheck: true`)
- ESLint disables `@typescript-eslint/no-unused-vars`
- Tailwind uses CSS variable theming with HSL colors and dark mode via class selector
- shadcn/ui components are configured via `components.json` with path aliases
