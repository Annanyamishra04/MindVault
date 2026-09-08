"use client";

import { useRouter } from "next/navigation";
import { useKeyboardShortcut } from "@/lib/hooks/use-keyboard-shortcut";

/**
 * App-wide keyboard shortcuts that don't belong to any single page.
 * Mounted once in the dashboard layout so they work no matter which
 * page is currently active.
 *
 * - Cmd/Ctrl+N: jump to the new-note page.
 * - "/": focus the on-page search box, if one is rendered. Looks the
 *   input up by a data attribute rather than holding a ref, since the
 *   search box lives in a different part of the tree (or isn't
 *   rendered at all) depending on the current route.
 *
 * Per-page shortcuts (like Cmd/Ctrl+S to save) live next to the
 * component they act on instead of here, since they need direct
 * access to that component's save logic.
 */
export function KeyboardShortcutsProvider() {
  const router = useRouter();

  useKeyboardShortcut(
    "n",
    () => {
      router.push("/notes/new");
    },
    { mod: true },
  );

  useKeyboardShortcut(
    "/",
    () => {
      const input = document.querySelector<HTMLInputElement>('[data-shortcut="search-input"]');
      input?.focus();
      input?.select();
    },
    { allowInTypingContext: false },
  );

  return null;
}
