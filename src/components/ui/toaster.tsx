import { useToast } from "@/hooks/use-toast";
import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "@/components/ui/toast";

export function Toaster() {
  const { toasts, dismiss } = useToast();

  return (
    <ToastProvider>
      {/* Dim the page behind, like a dialog. Nothing auto-dismisses now, so the
          toast is a modal moment — the backdrop says so, and clicking it is the
          same as clicking the card. */}
      {toasts.some((t) => t.open) && (
        <div
          aria-hidden
          onClick={() => dismiss()}
          className="fixed inset-0 z-[190] bg-black/60 backdrop-blur-[2px] animate-in fade-in-0 duration-200"
        />
      )}
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          // Clicking anywhere on the card dismisses it — nothing times out now,
          // so hunting for a small ✕ would be the whole interaction.
          <Toast key={id} {...props} onClick={() => dismiss(id)} className="cursor-pointer">
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription>{description}</ToastDescription>}
            </div>
            {action}
            <ToastClose />
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
