# Phase 4 Manual Testing Checklist

Everything below requires a real Supabase project (URL + anon key in
`.env.local`, migrations 0001–0005 applied) and at least one confirmed
user account, since it exercises live auth + RLS + Postgres. None of
this can be verified by `npm run build` alone.

## Dashboard
- [ ] New account with 0 notes shows the "Your second brain starts
      here." empty state with a working "+ Create your first note" button.
- [ ] After creating notes, stat cards show correct Total / Favorite /
      "created in last 7 days" counts, and Recent Notes shows the 5
      most recently updated notes.
- [ ] Favoriting a note from the dashboard's recent list updates the
      star instantly and the Favorite Notes count on next load.

## Create note (/notes/new)
- [ ] Empty title is rejected with an inline error; note is not created.
- [ ] Title + content + tags + favorite toggle all save correctly; you
      land on `/notes/[id]` for the new note afterward.
- [ ] Adding the same tag name in a different case as an existing tag
      (e.g. "react" then "React") reuses the existing tag — check
      `/tags` still shows only one row.

## Notes list (/notes)
- [ ] All of the user's notes appear, sorted by most recently updated.
- [ ] Typing in search filters by title/content after a short pause,
      not on every keystroke (watch the network tab / server logs).
- [ ] Clearing search restores the full list.
- [ ] Searching for nonsense text shows the "No notes match your
      search" empty state with a "Clear filters" action.
- [ ] Searching for text containing `%`, `_`, `,`, `(`, or `)` doesn't
      error and doesn't return unrelated notes — search now runs
      through the `search_note_ids` RPC (migration 0005) instead of a
      hand-built filter string, so these should behave as ordinary
      literal characters.
- [ ] Visiting `/notes?tag=<a-real-tag-id>` filters to only notes with
      that tag, and shows the removable "Tag: X" chip.

## Note editor (/notes/[id])
- [ ] Editing the title or content shows "Unsaved changes" immediately,
      then "Saving…", then "Saved" a moment after you stop typing.
- [ ] Typing continuously does not fire a request on every keystroke
      (autosave is debounced).
- [ ] Manually clicking "Save now" saves immediately and is disabled
      while already saved / already saving.
- [ ] Clearing the title entirely blocks autosave (shown as "Unsaved
      changes", not silently saved as blank) until you type something.
- [ ] Adding a tag, removing a tag, and toggling favorite all work and
      persist after a page reload.
- [ ] Deleting a note requires confirmation in a dialog, then redirects
      to `/notes` and the note is gone everywhere (list, favorites,
      tags counts, dashboard stats).
- [ ] Visiting `/notes/<a-made-up-uuid>` shows the "Note not found"
      page, not an error or someone else's data.

## Favorites (/favorites)
- [ ] Only favorited notes appear; unfavoriting one from here or the
      editor removes it from this list on next load.
- [ ] Empty state ("Favorite important notes...") shows with zero
      favorites; search empty state shows separately when filtered.

## Tags (/tags)
- [ ] Every tag the user has created appears with an accurate note
      count.
- [ ] Clicking a tag navigates to `/notes?tag=<id>` filtered correctly.
- [ ] Zero tags shows the "Organize your notes with tags" empty state.

## Cross-user isolation (needs two test accounts)
- [ ] User B cannot see User A's notes on `/notes`, `/favorites`, or `/tags`.
- [ ] User B visiting `/notes/<User A's note id>` directly gets "Note
      not found", not the note.
- [ ] User B cannot attach one of User A's tags to their own note (not
      reachable from the UI, but confirms defense-in-depth if tested
      directly against the API).

## Responsive / accessibility spot checks
- [ ] Mobile viewport: sidebar collapses into the hamburger menu; notes
      grid stacks to one column; editor and delete dialog remain usable.
- [ ] Tab through the new-note form, editor, and delete dialog using
      only the keyboard — focus is visible at every step and the
      delete dialog traps focus correctly (Radix Dialog default).
- [ ] Screen reader (or browser accessibility tree inspector) announces
      the save status region and the favorite button's pressed state.
