import { useRef, useState } from "react";
import { AlertTriangle, Upload } from "lucide-react";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { cn } from "@/lib/utils";

const ACCEPT = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";

/**
 * A "<something> missing" alert that is ALSO a dropzone. Click to pick, or drop
 * a file to attach the supporting document for a money movement (invoice,
 * payslip, tax document, …). The attach logic belongs to the caller — this only
 * delivers the File and shows the busy/hover states. One shared affordance so
 * every "missing" flag across P&L and Debts behaves identically.
 */
export function MissingDocChip({
  label,
  title,
  onFile,
  accept = ACCEPT,
  className,
}: {
  label: string;                                   // e.g. "Invoice missing"
  title?: string;
  onFile: (file: File) => void | Promise<void>;    // caller attaches it
  accept?: string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handle(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try { await onFile(file); } finally { setBusy(false); }
  }

  if (busy) return <BrandLoader size="sm" className="h-3.5 w-3.5 inline-block" />;

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
        onDragOver={(e) => { e.preventDefault(); if (!over) setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); handle(e.dataTransfer.files?.[0]); }}
        className={cn(
          "group inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] uppercase tracking-[0.18em] transition-colors",
          over
            ? "border-[#C9A96A]/70 bg-[#C9A96A]/15 text-[#ecd39c]"
            : "border-[#c98a6a]/35 bg-[#c98a6a]/[0.07] text-[#d8a184] hover:border-[#C9A96A]/60 hover:bg-[#C9A96A]/[0.1] hover:text-[#ecd39c]",
          className,
        )}
        title={title ?? `${label} — click or drop the document`}
      >
        <Upload className={over ? "h-3 w-3" : "hidden h-3 w-3 group-hover:inline"} strokeWidth={1.6} />
        {!over && <AlertTriangle className="h-3 w-3 group-hover:hidden" strokeWidth={1.6} />}
        {over ? "Drop to attach" : label}
      </button>
      <input ref={inputRef} type="file" accept={accept} className="hidden"
        onChange={(e) => { handle(e.target.files?.[0]); e.target.value = ""; }} />
    </>
  );
}
