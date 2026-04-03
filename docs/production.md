## Notes on building this app for your production environment


* Run npm run build locally before pushing — a clean Vite/Tailwind build catches purged classes that dev mode might let slide
* Treat tailwind.config.ts as the source of truth — if a color isn't there, it doesn't exist in production
* Backend changes deploy instantly — DB migrations and edge functions go live immediately, no publish needed. Frontend requires clicking "Update"
* Test with fresh state — local dev often has cached data/state that masks issues; periodically clear and re-seed