## Notes on building this app for your production environment


* Run npm run build locally before pushing — a clean Vite/Tailwind build catches purged classes that dev mode might let slide
* Treat tailwind.config.ts as the source of truth — if a color isn't there, it doesn't exist in production
* Backend changes deploy instantly — DB migrations and edge functions go live immediately, no publish needed. Frontend requires clicking "Update"
* Test with fresh state — local dev often has cached data/state that masks issues; periodically clear and re-seed

### Supabase Realtime publication

Supabase Realtime only delivers change events for tables that have been explicitly added to the `supabase_realtime` publication. If your feature subscribes to `postgres_changes` on a table (e.g. `session_participants`) but that table isn't in the publication, the subscription will silently receive **no events** — the app appears to work locally only because the same browser tab that wrote the data also updates its own React state.

**Checklist when adding a new Realtime subscription:**

1. Confirm the table is in the publication:
   ```sql
   SELECT tablename FROM pg_publication_tables
   WHERE pubname = 'supabase_realtime';
   ```
2. If missing, add it via a migration:
   ```sql
   ALTER PUBLICATION supabase_realtime ADD TABLE public.<table_name>;
   ```
3. Remember that migrations deploy instantly to production — no frontend publish required.

**Why this is easy to miss locally:** During development the tab that performs an update (e.g. the startup editing their funding goal) also calls `setStartups(...)` directly, so the UI updates immediately. Other browser windows relying on Realtime will *not* update if the table isn't published, but you may never open multiple windows during local testing.