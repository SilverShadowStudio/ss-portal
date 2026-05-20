import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { logActivity } from "@/lib/activityLog";

interface ManualInviteModalProps {
  isOpen: boolean;
  onClose: () => void;
  accountId: string | null;
  /** Used only for the activity_log description. */
  clientLabel: string;
}

interface InvitePayload {
  verify_url: string;
  recipient_email: string;
  recipient_first_name: string | null;
  subject: string;
  email_html: string;
  email_text: string;
}

function buildItMessage(firstName: string | null): string {
  const signature = firstName?.trim() || "[Your name]";
  return `Hi,

Silvershadow Studio sends transactional emails (project updates, agreements, invoices) from portal@silvershadowstudio.com. Our messages are being soft-bounced by your mail server.

Our domain (silvershadowstudio.com) is fully authenticated — SPF, DKIM and DMARC are all set up and verified. Could you whitelist portal@silvershadowstudio.com in your filters so legitimate transactional emails reach our team and any future colleagues?

Thanks,
${signature}`;
}

export function ManualInviteModal({
  isOpen,
  onClose,
  accountId,
  clientLabel,
}: ManualInviteModalProps) {
  const { toast } = useToast();
  const [data, setData] = useState<InvitePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activityLoggedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isOpen || !accountId) {
      setData(null);
      setError(null);
      activityLoggedRef.current = null;
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const { data: resp, error: invokeErr } = await supabase.functions.invoke(
          "admin-generate-manual-invite",
          { body: { account_id: accountId } },
        );
        if (cancelled) return;
        if (invokeErr || (resp as { error?: string })?.error) {
          throw new Error(
            (resp as { error?: string })?.error || invokeErr?.message || "Failed to generate",
          );
        }
        const payload = resp as InvitePayload;
        setData(payload);
        // Activity log: fire once per modal open. Idempotence keyed on
        // accountId so repeated openings on the same client don't spam.
        if (activityLoggedRef.current !== accountId) {
          activityLoggedRef.current = accountId;
          await logActivity({
            action: "manual_invite_generated",
            description: `Manual invite generated for ${clientLabel}`,
            actorRole: "admin",
            entityType: "account",
            entityId: accountId,
          });
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, accountId, clientLabel]);

  // Pre-build clipboard blobs whenever data is fresh. Safari rejects
  // navigator.clipboard.write() if there's an `await` between the user
  // gesture and the call; pre-computing here means the click handler is
  // synchronous from gesture → write.
  const emailItem = useMemo<ClipboardItem | null>(() => {
    if (!data) return null;
    if (typeof ClipboardItem === "undefined") return null;
    return new ClipboardItem({
      "text/html": new Blob([data.email_html], { type: "text/html" }),
      "text/plain": new Blob([data.email_text], { type: "text/plain" }),
    });
  }, [data]);

  const itMessage = useMemo(
    () => (data ? buildItMessage(data.recipient_first_name) : ""),
    [data],
  );

  const handleCopyEmail = () => {
    if (!data) return;
    const fallback = () => navigator.clipboard.writeText(data.email_text);
    const onOk = () =>
      toast({
        title: "Email content copied",
        description: "Paste into your inbox compose window.",
      });
    const onErr = (err: unknown) =>
      toast({
        title: "Couldn't copy to clipboard",
        description: (err as Error)?.message || "Try selecting the preview manually.",
        variant: "destructive",
      });
    if (emailItem) {
      navigator.clipboard.write([emailItem]).then(onOk).catch(() => {
        fallback().then(onOk).catch(onErr);
      });
    } else {
      fallback().then(onOk).catch(onErr);
    }
  };

  const handleCopyItMessage = () => {
    if (!data) return;
    navigator.clipboard
      .writeText(itMessage)
      .then(() =>
        toast({
          title: "IT message copied",
          description: "Paste below your invite when forwarding.",
        }),
      )
      .catch((err: unknown) =>
        toast({
          title: "Couldn't copy to clipboard",
          description: (err as Error)?.message || "Try selecting the text manually.",
          variant: "destructive",
        }),
      );
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[600px] w-[calc(100vw-2rem)] max-h-[90vh] overflow-y-auto p-0">
        <div className="px-7 sm:px-10 pt-9 pb-2">
          <h2 className="font-serif text-[22px] font-normal text-foreground leading-tight">
            Send invite manually
          </h2>
          <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            For clients blocked by corporate mail filters
          </p>
        </div>

        {loading && (
          <div className="px-7 sm:px-10 py-10 flex items-center justify-center">
            <BrandLoader size="md" />
          </div>
        )}

        {error && !loading && (
          <div className="px-7 sm:px-10 py-6">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {data && !loading && (
          <>
            {/* Section 1: rendered email preview */}
            <section className="px-7 sm:px-10 pt-6 pb-7">
              <h3 className="text-[12px] uppercase tracking-[0.22em] text-foreground mb-2 font-medium">
                Client invite email
              </h3>
              <p className="text-[11px] italic text-muted-foreground leading-relaxed mb-4">
                Same content the system would auto-send. Copy below, then paste into a new email from your inbox.
              </p>

              <div
                className="border border-border rounded-sm overflow-hidden bg-[#EDE8E0]"
                style={{ height: 360 }}
              >
                <iframe
                  title="Invite email preview"
                  srcDoc={data.email_html}
                  sandbox="allow-same-origin"
                  className="w-full h-full border-0"
                />
              </div>
              <p className="text-[10px] italic text-muted-foreground/70 mt-2">
                This link is single-use and expires in 24 hours.
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  onClick={handleCopyEmail}
                  className="text-[11px] uppercase tracking-[0.18em]"
                >
                  Copy email
                </Button>
              </div>

              <div className="mt-4 space-y-1 text-[11px] text-muted-foreground leading-relaxed">
                <p>
                  Paste into a new email from your address.
                </p>
                <p>
                  <span className="text-foreground/80">Subject:</span> {data.subject}
                </p>
                <p>
                  <span className="text-foreground/80">Send to:</span> {data.recipient_email}
                </p>
              </div>
            </section>

            <hr className="border-border/50 mx-7 sm:mx-10" />

            {/* Section 2: IT whitelist request */}
            <section className="px-7 sm:px-10 pt-7 pb-9">
              <h3 className="text-[12px] uppercase tracking-[0.22em] text-foreground mb-2 font-medium">
                IT whitelist request
              </h3>
              <p className="text-[11px] italic text-muted-foreground leading-relaxed mb-4">
                Send this message to the client separately, asking them to forward it to their IT team. Once whitelisted, future portal emails deliver normally.
              </p>

              <div className="border border-border rounded-sm bg-muted/30 px-4 py-3">
                <pre className="text-[12px] text-foreground whitespace-pre-wrap font-sans leading-relaxed m-0">
{itMessage}
                </pre>
              </div>

              <div className="mt-4">
                <Button
                  type="button"
                  onClick={handleCopyItMessage}
                  className="text-[11px] uppercase tracking-[0.18em]"
                >
                  Copy message
                </Button>
              </div>
            </section>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
