import { AdminLayout } from "@/components/AdminLayout";

export default function AdminTeamInvoices() {
  return (
    <AdminLayout>
      <div className="mb-12 animate-fade-in">
        <div className="mb-6 flex items-center gap-3">
          <div className="h-px w-10 bg-gold-muted" />
          <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-gold font-sans">
            Team Management
          </span>
        </div>
        <h1
          className="font-serif font-normal text-foreground"
          style={{ fontSize: "2.4rem", letterSpacing: "-0.005em" }}
        >
          Team Invoices
        </h1>
        <p className="mt-3 font-serif italic text-foreground/45" style={{ fontSize: 14 }}>
          Coming soon.
        </p>
      </div>

      <div className="flex justify-center py-24 animate-fade-in" style={{ animationDelay: "0.1s" }}>
        <p
          className="font-serif italic text-foreground/45 text-center max-w-xl"
          style={{ fontSize: 13, lineHeight: 1.7 }}
        >
          This page will show team and freelancer invoices, calculated from rates and logged time. Currently in design.
        </p>
      </div>
    </AdminLayout>
  );
}
