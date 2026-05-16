import { AdminLayout } from "@/components/AdminLayout";
import { useBrand } from "@/contexts/BrandContext";

export default function AdminExpenses() {
  const { brand } = useBrand();

  return (
    <AdminLayout>
      <div className="max-w-3xl">
        <p
          className="font-sans uppercase mb-4"
          style={{ fontSize: 9, letterSpacing: "0.28em", color: brand.gold_color }}
        >
          Finance
        </p>
        <h1
          className="font-serif font-normal tracking-tight text-foreground mb-8"
          style={{ fontSize: "2.5rem", lineHeight: 1.05, letterSpacing: "-0.005em" }}
        >
          Expenses
        </h1>
        <p
          className="font-sans"
          style={{ fontSize: 14, lineHeight: 1.75, color: brand.text_color, opacity: 0.7 }}
        >
          Coming soon. This module is in development.
        </p>
      </div>
    </AdminLayout>
  );
}
