"use client";

import { useEffect, useRef } from "react";

interface ShortcutOptions {
  /** Require Cmd (macOS) / Ctrl (Windows/Linux) to be held. */
  mod?: boolean;
  /**
   * Allow the shortcut to fire even while the user is typing in an
   * input, textarea, or contenteditable element. Off by default so
   * single-key shortcuts (like "/") never hijack normal typing.
   */
  allowInTypingContext?: boolean;
  /** Prevent the browser's default behavior for this key combination. */
  preventDefault?: boolean;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

/**
 * Registers a single keyboard shortcut for as long as the calling
 * component is mounted. Centralizing the "don't fire while typing"
 * and "support both Cmd and Ctrl" logic here means every shortcut in
 * the app behaves consistently instead of each call site reimplementing
 * its own key-matching rules.
 */
export function useKeyboardShortcut(
  key: string,
  handler: (event: KeyboardEvent) => void,
  { mod = false, allowInTypingContext = false, preventDefault = true }: ShortcutOptions = {},
) {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const modPressed = event.metaKey || event.ctrlKey;
      if (mod && !modPressed) return;
      if (!mod && modPressed) return;
      if (event.key.toLowerCase() !== key.toLowerCase()) return;
      if (!allowInTypingContext && isTypingTarget(event.target)) return;

      if (preventDefault) event.preventDefault();
      handlerRef.current(event);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [key, mod, allowInTypingContext, preventDefault]);
}
