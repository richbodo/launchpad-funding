

## Participant Management Overhaul

There are several issues and enhancements requested. Here is what needs to happen:

### Bug Fix: Plus Button Not Working

The `addParticipant` function looks correct, but the `<Button onClick={addParticipant}>` at line 419 has `size="sm"` — need to verify it's not a form submission issue. The button itself appears wired correctly. I'll ensure the click handler works and there are no silent errors (e.g., missing required fields failing silently).

Looking at `addParticipant` (line 178): it returns early if `!addEmail || !selectedSession` — likely the plus button works but silently fails if email is empty. The issue could also be that the `size="sm"` button inside the flex-wrap form isn't receiving clicks properly. I'll make sure the button type is explicit (`type="button"`) and add better validation feedback.

### Database Migration

Add two new nullable columns to `session_participants` for startup metadata:

- `dd_room_link` (text, nullable) — due diligence room URL
- `website_link` (text, nullable) — startup website URL

### Changes to `src/pages/Admin.tsx`

**1. Remove the "Order #" input from the add-participant form** — startups will no longer enter an order number when being added. Instead, new startups get auto-assigned the next available order number.

**2. Replace the participant list with a proper table** using the existing `Table` UI components, with sortable columns:

| Type | Name | Email | Order | Actions |
|------|------|-------|-------|---------|
| startup | AcmeCo | acme@co.com | [dropdown: 1] | [Metadata] [Remove] |
| investor | Jane | jane@vc.com | — | [Remove] |

- Columns have header click-to-sort on "Type" and "Name"
- "Order" column shows a `<select>` dropdown for startups only, with options 1 through N (N = number of startups)
- "Actions" column has a "Metadata" button for startups (opens a small dialog/popover to edit `dd_room_link` and `website_link`) and a remove button for all

**3. Order reordering algorithm:**

When a startup's order is changed from position A to position B:
- Remove the startup from position A
- Shift all startups between A and B to fill the gap
- Insert the startup at position B
- Concretely: if moving from 3→1, startups at positions 1 and 2 shift to 2 and 3. If moving from 1→3, startups at 2 and 3 shift to 1 and 2.
- This is a standard "drag to reorder" algorithm: extract, shift, insert. All affected startup rows get a single batch of UPDATE calls.

**4. Add a metadata dialog** — a small `Dialog` that opens when the "Metadata" button is clicked for a startup. Contains two input fields (DD Room Link, Website Link) and a Save button that updates the `session_participants` row.

### Files

**Database migration:**
```sql
ALTER TABLE public.session_participants
  ADD COLUMN dd_room_link text,
  ADD COLUMN website_link text;
```

**Modified:** `src/pages/Admin.tsx`
- Remove `addOrder` state and the Order # input from the add-participant form
- Auto-assign `presentation_order` to new startups (max existing order + 1)
- Fix the plus button (add `type="button"`, add toast if email missing)
- Replace participant list div with a `Table` component with sortable headers (Type, Name, Email, Order, Actions)
- Add sort state (`sortBy: 'role' | 'name'`, `sortDir: 'asc' | 'desc'`)
- Add order-change handler with the shift algorithm described above
- Add a `MetadataDialog` inline component for editing `dd_room_link` and `website_link`

**No other files need changes.** The `ParticipantRow` interface at the top of Admin.tsx will be extended with the two new fields.

### Order Reordering Algorithm Detail

```text
startups sorted by current order: [S1=1, S2=2, S3=3, S4=4]

User changes S3 from order 3 → order 1:
  1. Remove S3 from array → [S1=1, S2=2, S4=4]
  2. Insert S3 at index 0 → [S3, S1, S2, S4]
  3. Reassign orders: S3=1, S1=2, S2=3, S4=4
  4. Batch UPDATE all changed rows
```

This guarantees no gaps, no duplicates, and minimal DB writes.

