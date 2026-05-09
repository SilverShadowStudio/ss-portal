import { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import {
  Download, X, Loader2, ExternalLink,
  ZoomIn, ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
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
  const [scale, setScale] = useState(1);
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

  const handleOpenInNewTab = async () => {
    if (loading) return;
    const win = window.open("", "_blank", "noopener,noreferrer");
    try {
      const blobUrl = await getBlobUrlForPdf();
      if (win) win.location.href = blobUrl;
      else {
        const a = document.createElement("a");
        a.href = blobUrl;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (e: any) {
      win?.close();
      toast({ title: "Could not open agreement", description: e?.message, variant: "destructive" });
    }
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
      setScale(1);
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

  const pageWidth = containerWidth ? Math.min(containerWidth - 32, 900) * scale : undefined;
  const canDownload = !!(downloadUrl || previewUrl) && !loading && !error;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[92vh] p-0 gap-0 flex flex-col [&>button.absolute]:hidden">
        <DialogTitle className="sr-only">{label}</DialogTitle>
        <DialogDescription className="sr-only">
          Preview and download the signed services agreement PDF.
        </DialogDescription>

        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-3 border-b border-border/60 bg-background/95 backdrop-blur shrink-0">
          <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground truncate pr-4">
            {label}
            {agreement.agreement_version && (
              <span className="ml-2 text-muted-foreground/60">· {agreement.agreement_version}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {pdfData && numPages > 0 && (
              <div className="flex items-center gap-1 mr-2">
                <span className="text-xs tabular-nums text-muted-foreground min-w-[3rem] text-center">
                  {numPages} {numPages === 1 ? "page" : "pages"}
                </span>
                <Button variant="ghost" size="icon" className="h-8 w-8 ml-1"
                  onClick={() => setScale((s) => Math.max(0.5, +(s - 0.1).toFixed(2)))}>
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8"
                  onClick={() => setScale((s) => Math.min(2.5, +(s + 0.1).toFixed(2)))}>
                  <ZoomIn className="h-4 w-4" />
                </Button>
              </div>
            )}
            {(loading || previewUrl) && (
              <>
                <Button variant="outline" size="sm" disabled={!previewUrl} onClick={handleOpenInNewTab}>
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open in new tab
                </Button>
                <Button variant="outline" size="sm" disabled={!canDownload || downloading} onClick={handleDownload}>
                  {loading || downloading ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {loading ? "Preparing PDF…" : downloading ? "Downloading…" : "Download PDF"}
                </Button>
              </>
            )}
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div ref={containerRef} className="flex-1 min-h-0 bg-muted/30 relative overflow-auto">
          {loading && (
            <div className="h-full w-full flex flex-col items-center justify-center text-muted-foreground gap-3">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p className="text-sm">Preparing agreement…</p>
            </div>
          )}
          {!loading && error && (
            <div className="h-full w-full flex flex-col items-center justify-center text-center px-6 gap-3">
              <p className="text-sm font-medium">Unable to load agreement</p>
              <p className="text-xs text-muted-foreground max-w-md">{error}</p>
              {(downloadUrl || previewUrl) && (
                <Button variant="outline" size="sm" onClick={handleOpenInNewTab}>
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open in new tab
                </Button>
              )}
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
                    <Loader2 className="h-5 w-5 animate-spin" />
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