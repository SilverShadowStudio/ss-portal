// The portal's standard for a running list of recent things — the activity
// log, the Dropzone's history, and every list like them that comes later.
//
// FOREVER (Fred, 11 Nov 2026), one behaviour everywhere:
//   • a fixed window that scrolls, so a busy list never pushes the page down;
//   • click a line and it leaves YOUR view (remembered per person, per list);
//   • click the list's title and the whole history comes back.
//
// Use FeedList for the window, useFeedDismissals for the memory. A new list
// needs nothing but a feed key: dismissals live in feed_dismissals.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Clock, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

/** The window height every feed shares. */
export const FEED_WINDOW = "max-h-[28rem]";

const sb = supabase as any;

/** What this person has cleared from one list, and how to clear more. */
export function useFeedDismissals(feed: string) {
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    sb.from("feed_dismissals").select("item_id").eq("user_id", user.id).eq("feed", feed)
      .then(({ data }: { data: { item_id: string }[] | null }) => {
        if (cancelled) return;
        setDismissed(new Set((data ?? []).map((d) => d.item_id)));
        setReady(true);
      });
    return () => { cancelled = true; };
  }, [user, feed]);

  const dismiss = useCallback(async (id: string) => {
    if (!user) return;
    setDismissed((prev) => new Set(prev).add(id)); // optimistic
    const { error } = await sb.from("feed_dismissals").insert({ user_id: user.id, feed, item_id: id });
    // A duplicate key means it was already cleared — that's still cleared.
    if (error && error.code !== "23505") {
      setDismissed((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
  }, [user, feed]);

  return { dismissed, dismiss, ready };
}

interface FeedListProps<T extends { id: string }> {
  title: string;
  items: T[];
  dismissed: Set<string>;
  onDismiss: (id: string) => void;
  /** One line. Its own buttons and links must stopPropagation, or they'd clear it too. */
  renderItem: (item: T, cleared: boolean) => ReactNode;
  /** Where the whole history lives, when it's a page of its own (the activity
   *  log). Without one, the title shows the history right here in the window. */
  historyHref?: string;
  /** For lists whose title also sits above other content (the Dropzone). */
  headerless?: boolean;
  /** Controlled history toggle, for a title rendered by the caller. */
  history?: boolean;
  onHistoryChange?: (v: boolean) => void;
  loading?: boolean;
  emptyText?: string;
  className?: string;
}

export function FeedList<T extends { id: string }>({
  title, items, dismissed, onDismiss, renderItem, historyHref, headerless,
  history: historyProp, onHistoryChange, loading, emptyText = "All caught up", className,
}: FeedListProps<T>) {
  const [historyLocal, setHistoryLocal] = useState(false);
  const history = historyProp ?? historyLocal;
  const setHistory = onHistoryChange ?? setHistoryLocal;
  const shown = history ? items : items.filter((i) => !dismissed.has(i.id));
  const label = history ? `${title} · history` : title;

  return (
    <div className={className}>
      {!headerless && (
        <div className="mb-4 flex items-center gap-3">
          <div className="h-px w-6 bg-gold-muted" />
          {historyHref ? (
            <Link to={historyHref} title="Open the whole history"
              className="group inline-flex items-center gap-2 text-label transition-colors hover:text-foreground">
              <span>{title}</span>
              <ArrowRight className="h-3 w-3 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
            </Link>
          ) : (
            <button type="button" onClick={() => setHistory(!history)}
              title={history ? "Back to what's new" : "Show the whole history"}
              className="text-label transition-colors hover:text-foreground">
              {label}
            </button>
          )}
          {!loading && (
            <span className="ml-auto text-[10px] tracking-[0.2em] text-muted-foreground">
              {shown.length} {shown.length === 1 ? "ENTRY" : "ENTRIES"}
            </span>
          )}
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-sm tracking-wider text-muted-foreground">Loading…</div>
      ) : shown.length === 0 ? (
        <div className="py-10 text-center">
          <Clock className="mx-auto mb-3 h-4 w-4 text-muted-foreground/30" />
          <p className="font-serif text-base text-muted-foreground">{history ? "Nothing yet" : emptyText}</p>
        </div>
      ) : (
        <ul className={cn("flex flex-col gap-2 overflow-y-auto pr-1", FEED_WINDOW)}>
          {shown.map((item) => {
            const cleared = dismissed.has(item.id);
            return (
              <li key={item.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => { if (!cleared) onDismiss(item.id); }}
                  onKeyDown={(e) => { if (!cleared && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onDismiss(item.id); } }}
                  title={cleared ? "Cleared from your list" : "Click to clear it from your list"}
                  className={cn("group relative cursor-pointer", cleared && "cursor-default opacity-50")}
                >
                  {renderItem(item, cleared)}
                  {!cleared && (
                    <X className="pointer-events-none absolute right-3 top-3 h-3.5 w-3.5 text-muted-foreground/30 transition-colors group-hover:text-foreground" />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
