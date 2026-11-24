/**
 * Deep links (plan phase 8): a `printninja://print?…` link from a web
 * page, a message, or the shell hands the app a URL. The listener
 * parses it through the core, resolves the template by name, and
 * prefill-only — it navigates to the print screen and stops there.
 * The screen is the confirmation: the person sees what will print
 * and presses Print. That press is the confirmation the plan promises
 * for untrusted sources, and it applies to every source, because a
 * link does not carry the caller's identity.
 *
 * A link can arrive twice — the cold-start read and the warm-start
 * event race — so dispatches are deduplicated, in memory and across
 * webview reloads (sessionStorage), the way the old app did it.
 */
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { loadTemplates, parseDeeplink } from "@/api";
import { mergeTemplates, starters, type AppTemplate } from "@/templates";

/** A resolved deep link: the template found, plus the rest as given. */
export interface DeepLinkPrint {
  template: AppTemplate;
  printer: string | null;
  copies: number | null;
}

const DISPATCHED_KEY = "printninja-deeplink-dispatched";
const DISPATCHED_KEEP = 20;

/** The links already dispatched, this run plus the session's last 20. */
function dispatchedList(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(DISPATCHED_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function rememberDispatched(url: string) {
  try {
    const seen = new Set(dispatchedList());
    seen.add(url);
    sessionStorage.setItem(
      DISPATCHED_KEY,
      JSON.stringify([...seen].slice(-DISPATCHED_KEEP)),
    );
  } catch {
    // Private mode and friends: dedupe in memory only, then.
  }
}

export function DeepLinkListener({
  onPrint,
  onError,
}: {
  onPrint: (p: DeepLinkPrint) => void;
  onError: (message: string) => void;
}) {
  // This run's dispatches: the warm listener and the cold-start read
  // race, and the same URL can reach both.
  const seenThisRun = useRef<Set<string>>(new Set());
  const { t } = useTranslation();

  const dispatch = useCallback(
    async (url: string) => {
      if (seenThisRun.current.has(url)) return;
      if (dispatchedList().includes(url)) {
        seenThisRun.current.add(url);
        return;
      }
      seenThisRun.current.add(url);
      rememberDispatched(url);
      try {
        const link = await parseDeeplink(url);
        if (!link.template) {
          onError(t("deeplink.no_template"));
          return;
        }
        const rows = await loadTemplates().catch(() => []);
        const all = mergeTemplates(starters, rows);
        const template = all.find((tpl) => tpl.name === link.template);
        if (!template) {
          onError(t("deeplink.unknown_template", { name: link.template }));
          return;
        }
        onPrint({
          template,
          printer: link.printer,
          copies: link.copies,
        });
      } catch (e) {
        onError(t("deeplink.unreadable", { error: String(e) }));
      }
    },
    [onPrint, onError, t],
  );

  useEffect(() => {
    // Warm start: links that arrive while the webview is up.
    const unlisten = onOpenUrl((urls) => {
      for (const url of urls) {
        if (typeof url === "string") void dispatch(url);
      }
    });

    // Cold start: the OS may have handed a link before the webview
    // was ready; the plugin keeps it, and the event above may not
    // have fired yet — so read it, and let the dedupe absorb the
    // duplicate when the event catches up.
    void getCurrent()
      .then((urls) => {
        for (const url of urls ?? []) void dispatch(url);
      })
      .catch(() => {});

    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [dispatch]);

  return null;
}
