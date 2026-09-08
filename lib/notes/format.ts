/** First N characters of a note's content, collapsed to a single line, for list/card previews. */
export function notePreview(content: string, maxLength = 160): string {
  const collapsed = content.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, maxLength).trimEnd()}…`;
}

/** Relative "last updated" label (e.g. "Updated 3h ago"), falling back to a date once it's old. */
export function relativeUpdated(isoDate: string): string {
  const date = new Date(isoDate);
  const diffMs = Date.now() - date.getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) return "Updated just now";
  if (diffMs < hour) {
    const mins = Math.floor(diffMs / minute);
    return `Updated ${mins}m ago`;
  }
  if (diffMs < day) {
    const hours = Math.floor(diffMs / hour);
    return `Updated ${hours}h ago`;
  }
  if (diffMs < 7 * day) {
    const days = Math.floor(diffMs / day);
    return `Updated ${days}d ago`;
  }

  return `Updated ${date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  })}`;
}
