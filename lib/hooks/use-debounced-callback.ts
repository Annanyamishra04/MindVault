"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Returns a debounced version of `callback` that always calls the most
 * recent render's callback (avoiding stale-closure bugs) but only fires
 * `delayMs` after the caller stops invoking it. Used for search-as-you-type
 * and editor autosave, so we don't fire a request on every keystroke.
 */
export function useDebouncedCallback<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delayMs: number,
): (...args: Args) => void {
  const callbackRef = useRef(callback);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return useCallback(
    (...args: Args) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => callbackRef.current(...args), delayMs);
    },
    [delayMs],
  );
}
