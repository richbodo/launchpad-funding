/**
 * Open an external URL in a new browser tab without ever navigating the
 * current tab. We use this everywhere a user-clickable link leaves the app —
 * critical inside the Session page, where a same-tab navigation tears down
 * the LiveKit call and drops the participant from the room.
 *
 * Why not just `<a target="_blank">`? In some embedded contexts (preview
 * iframes, restrictive sandboxes, certain mobile webviews) the `target`
 * attribute is silently ignored and the link replaces the current document.
 * `window.open(url, '_blank', 'noopener,noreferrer')` is the reliable
 * cross-context way to force a new tab, and we still pass `noopener` so the
 * opened page cannot reach back into our window via `window.opener`.
 */
export function openExternal(url: string | null | undefined): void {
  if (!url) return;
  try {
    const win = window.open(url, '_blank', 'noopener,noreferrer');
    // If the popup was blocked, fall back to a temporary anchor click so the
    // user still gets the link rather than nothing happening.
    if (!win) {
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  } catch {
    /* no-op — never let a popup blocker error bubble into the UI */
  }
}

/**
 * Click handler factory for anchors that should never navigate the current
 * tab. Prevents the default same-window navigation that some sandboxed
 * iframes fall back to when `target="_blank"` is stripped, then opens the
 * link via {@link openExternal}.
 */
export function externalLinkHandler(url: string | null | undefined) {
  return (e: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>) => {
    e.preventDefault();
    openExternal(url);
  };
}
