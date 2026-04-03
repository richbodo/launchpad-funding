## Notes on building this app for your production environment

* Run npm run build locally before pushing — a clean Vite/Tailwind build catches purged classes that dev mode might let slide
* Treat tailwind.config.ts as the source of truth — if a color isn't there, it doesn't exist in production
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

### Stale seed data after schema changes

When you add a new column to the seed function (e.g. `funding_goal` on `session_participants`), **existing demo sessions in production won't pick up the new values** — the seed only writes columns on fresh inserts. Symptoms: the feature works in a newly-seeded local environment but fails in production because the rows were created by an older version of the seed.

**Fix:** Re-run the seed function after any schema or seed-data change:

```bash
# Via the edge function endpoint (demo mode must be enabled)
curl -X POST https://<project-ref>.supabase.co/functions/v1/seed-demo-data \
  -H "Authorization: Bearer <anon-key>"
```

This deletes all `[DEMO]` sessions and recreates them with the latest data — **session IDs will change**, so all participants must log in again via the Demo Logins page.

**Best practice:** After changing the seed function, always re-seed production *and* verify the new data landed:

```sql
SELECT email, display_name, funding_goal
FROM session_participants
WHERE role = 'startup'
ORDER BY session_id, presentation_order;
```