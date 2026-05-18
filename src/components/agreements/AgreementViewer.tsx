import { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { Download } from "lucide-react";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface AgreementViewerData {
  id: string;
  storage_path: string;
  file_name: string;
  company_name?: string | null;
  agreement_version?: string | null;
}

interface Props {
  agreement: AgreementViewerData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AgreementViewer({ agreement, open, onOpenChange }: Props) {
  const { toast } = useToast();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const label = agreement?.company_name
    ? `Services Agreement — ${agreement.company_name}`
    : agreement?.file_name || "Agreement";

  const getBlobUrlForPdf = async (): Promise<string> => {
    if (pdfData) {
      const blob = new Blob([new Uint8Array(pdfData)], { type: "application/pdf" });
      return URL.createObjectURL(blob);
    }
    const target = downloadUrl || previewUrl;
    if (!target) throw new Error("No PDF URL available yet");
    const res = await fetch(target);
    if (!res.ok) throw new Error(`Refetch failed: ${res.status} ${res.statusText}`);
    const buf = await res.arrayBuffer();
    return URL.createObjectURL(new Blob([buf], { type: "application/pdf" }));
  };

  const handleDownload = async () => {
    if (loading || downloading || !agreement) return;
    setDownloading(true);
    try {
      const objectUrl = await getBlobUrlForPdf();
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = agreement.file_name;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Sandbox fallback (Lovable preview blocks programmatic <a download>)
      setTimeout(() => {
        window.open(objectUrl, "_blank", "noopener,noreferrer");
        setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      }, 250);
    } catch (e: any) {
      toast({ title: "Download failed", description: e?.message, variant: "destructive" });
    } finally {
      setDownloading(false);
    }
  };

  // Load signed URLs + bytes when opened
  useEffect(() => {
    if (!open || !agreement) {
      setPreviewUrl(null);
      setDownloadUrl(null);
      setPdfData(null);
      setError(null);
      setNumPages(0);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const { data: previewSigned, error: pErr } = await supabase.storage
          .from("agreements")
          .createSignedUrl(agreement.storage_path, 300);
        if (pErr || !previewSigned?.signedUrl)
          throw pErr || new Error("Could not sign agreement URL");
        const { data: dlSigned } = await supabase.storage
          .from("agreements")
          .createSignedUrl(agreement.storage_path, 300, { download: agreement.file_name });
        if (cancelled) return;
        setPreviewUrl(previewSigned.signedUrl);
        setDownloadUrl(dlSigned?.signedUrl || previewSigned.signedUrl);

        const res = await fetch(previewSigned.signedUrl);
        if (!res.ok) throw new Error(`PDF fetch failed (${res.status})`);
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        setPdfData(new Uint8Array(buf));
      } catch (e: any) {
        if (cancelled) return;
        const msg = e?.message || "Could not load agreement preview";
        setError(msg);
        toast({ title: "Could not load agreement", description: msg, variant: "destructive" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, agreement?.id]);

  useEffect(() => {
    if (!open) return;
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, pdfData]);

  const fileProp = useMemo(
    () => (pdfData ? { data: new Uint8Array(pdfData) } : null),
    [pdfData],
  );

  if (!agreement) return null;

  const pageWidth = containerWidth ? Math.min(containerWidth - 32, 900) : undefined;
  const canDownload = !!(downloadUrl || previewUrl) && !loading && !error;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[92vh] p-0 gap-0 flex flex-col [&>button.absolute]:hidden">
        <DialogTitle className="sr-only">{label}</DialogTitle>
        <DialogDescription className="sr-only">
          Preview and download the signed services agreement PDF.
        </DialogDescription>

        {/* Top bar: title (left) + download icon (right) only.
            Dialog still closes via outside-click and Escape — no explicit
            close button is rendered. */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-3 border-b border-border/60 bg-background/95 backdrop-blur shrink-0">
          <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground truncate pr-4">
            {label}
          </div>
          {(loading || previewUrl) && (
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Download"
                    disabled={!canDownload || downloading}
                    onClick={handleDownload}
                    className="shrink-0 inline-flex h-8 w-8 items-center justify-center bg-transparent border-0 p-0 cursor-pointer transition-opacity disabled:cursor-not-allowed"
                    style={{ opacity: 0.35 }}
                    onMouseEnter={(e) => { if (canDownload && !downloading) e.currentTarget.style.opacity = "1"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.35"; }}
                  >
                    {loading || downloading ? (
                      <BrandLoader size="sm" className="h-4 w-4" />
                    ) : (
                      <Download className="h-4 w-4 text-foreground" strokeWidth={1.5} />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={8}>Download</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>

        <div ref={containerRef} className="flex-1 min-h-0 bg-muted/30 relative overflow-auto">
          {loading && (
            <div className="h-full w-full flex flex-col items-center justify-center text-muted-foreground gap-3">
              <BrandLoader size="md" />
              <p className="text-sm">Preparing agreement…</p>
            </div>
          )}
          {!loading && error && (
            <div className="h-full w-full flex flex-col items-center justify-center text-center px-6 gap-3">
              <p className="text-sm font-medium">Unable to load agreement</p>
              <p className="text-xs text-muted-foreground max-w-md">{error}</p>
            </div>
          )}
          {!loading && !error && fileProp && (
            <div className="flex flex-col items-center py-4 gap-4">
              <Document
                file={fileProp}
                onLoadSuccess={({ numPages: n }) => setNumPages(n)}
                onLoadError={(err) => {
                  const msg = err?.message || "Failed to render PDF";
                  setError(msg);
                  toast({ title: "Could not render PDF", description: msg, variant: "destructive" });
                }}
                loading={
                  <div className="flex items-center gap-2 text-muted-foreground py-12">
                    <BrandLoader size="md" />
                    <span className="text-sm">Rendering preview…</span>
                  </div>
                }
              >
                {Array.from({ length: numPages }, (_, i) => (
                  <Page
                    key={`page_${i + 1}`}
                    pageNumber={i + 1}
                    width={pageWidth}
                    renderAnnotationLayer
                    renderTextLayer
                    className="shadow-lg bg-background mb-4"
                  />
                ))}
              </Document>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}