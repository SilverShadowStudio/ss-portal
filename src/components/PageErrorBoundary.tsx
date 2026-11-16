import { Component, type ErrorInfo, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

// A page that throws while rendering used to take the whole portal down to a
// black screen, with no trace of why. This catches it: the page says what
// happened and offers a way on, and the error is recorded in client_errors so
// it can be read back and fixed. Keyed on the path, so moving to another page
// clears it.

class Boundary extends Component<{ children: ReactNode; path: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[page error]", error, info.componentStack);
    void (supabase as unknown as { from: (t: string) => { insert: (r: Record<string, unknown>) => Promise<unknown> } })
      .from("client_errors")
      .insert({
        path: this.props.path,
        message: String(error?.message ?? error).slice(0, 2000),
        stack: String(error?.stack ?? "").slice(0, 8000),
        component_stack: String(info.componentStack ?? "").slice(0, 8000),
        user_agent: navigator.userAgent.slice(0, 500),
      })
      .catch(() => {});
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#1b1b1b] px-6">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-5 h-px w-12 bg-[#d3b47c]/60" />
          <p className="text-[9px] uppercase tracking-[0.28em] text-[#ecd39c]">Something went wrong</p>
          <p className="mt-4 text-sm text-white/70">This page couldn't be shown. The studio has been sent the details.</p>
          <p className="mt-3 break-words font-mono text-[11px] text-white/35">{this.state.error.message}</p>
          <div className="mt-8 flex items-center justify-center gap-6">
            <button onClick={() => window.history.back()} className="text-[10px] uppercase tracking-[0.2em] text-white/50 hover:text-white/80">Back</button>
            <button onClick={() => window.location.reload()} className="rounded-sm bg-[#d3b47c] px-4 py-2 text-[10px] uppercase tracking-[0.2em] text-[#1b1b1b] hover:bg-[#ecd39c]">Reload</button>
          </div>
        </div>
      </div>
    );
  }
}

export function PageErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <Boundary key={pathname} path={pathname}>{children}</Boundary>;
}
