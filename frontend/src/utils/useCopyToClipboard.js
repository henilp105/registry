import { useCallback, useEffect, useRef, useState } from "react";

/**
 * `navigator.clipboard` is promise-based, only exists in secure contexts, and
 * is undefined on plain HTTP -- which is how the app is served by nginx
 * (`listen 80`). Every call site used to do:
 *
 *   navigator.clipboard.writeText(x).then(() => setCopied(true));
 *
 * with no `.catch`. On HTTP, `navigator.clipboard` itself is undefined, so the
 * line throws a synchronous TypeError; on a permission denial it rejects; and
 * `setTimeout` was never cleared, so a dialog closing inside 2 s left a
 * pending timer firing into an unmounted component (defect D84).
 *
 * This hook returns `(copied, copy)`:
 *   - `copied` flips true for 2 s after a successful write;
 *   - `copy(text)` resolves `true` on success, `false` when the API is
 *     unavailable or the write was refused, so callers can surface "Copy
 *     failed" instead of a silent no-op;
 *   - the reset timer is cleared on unmount.
 */
export function useCopyToClipboard() {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const copy = useCallback(async (text) => {
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
        // Fallback for legacy/insecure contexts: a transient textarea plus
        // execCommand. It is deprecated but still the only path on http://.
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (!ok) return false;
      } else {
        await navigator.clipboard.writeText(text);
      }
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
      return true;
    } catch {
      return false;
    }
  }, []);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setCopied(false);
  }, []);

  return [copied, copy, clear];
}
