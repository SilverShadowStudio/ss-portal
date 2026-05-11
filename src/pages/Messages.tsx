import { ClientLayout } from "@/components/ClientLayout";
import { MessageSquare } from "lucide-react";

export default function Messages() {
  return (
    <ClientLayout>
      <div className="mb-10 animate-fade-in">
        <div className="mb-4 flex items-center gap-3">
          <div className="h-px w-12 bg-gold-muted" />
          <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-gold font-sans">
            Communication
          </span>
        </div>
        <h1 className="font-serif text-4xl font-normal tracking-tight text-foreground md:text-5xl mb-4">
          MESSAGES
        </h1>
        <p className="text-sm text-muted-foreground">
          Direct conversations with the Silvershadow studio team.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-16 text-center">
        <MessageSquare className="h-6 w-6 text-muted-foreground/30 mx-auto mb-4" strokeWidth={1.5} />
        <p className="font-serif text-base text-muted-foreground">
          Messaging is coming soon.
        </p>
      </div>
    </ClientLayout>
  );
}
