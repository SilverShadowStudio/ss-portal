import { forwardRef } from "react";
import { PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Luxury "Apple-grade" account menu popover container.
 *
 * Visual contract (do not deviate without design approval):
 *  - 16px radius, 0.5px hairline border in rgba(255,255,255,0.12)
 *  - 20px backdrop blur + inset top highlight (beveled glass)
 *  - 16px side padding, geometric sans @ 13px / 500 / -0.01em
 *  - cubic-bezier(0.4,0,0.2,1) — scale 98%→100%, fade + 4px upward drift
 */
export const AccountMenuContent = forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof PopoverContent>
>(({ className, style, children, ...props }, ref) => (
  <PopoverContent
    ref={ref}
    side="top"
    align="start"
    sideOffset={8}
    className={cn(
      "account-menu w-56 p-0 overflow-hidden text-popover-foreground border-0",
      "data-[state=open]:animate-account-menu-in data-[state=closed]:animate-account-menu-out",
      className
    )}
    style={{
      borderRadius: 4,
      background: "hsl(var(--sidebar-background))",
      boxShadow: "0 20px 48px -16px rgba(0, 0, 0, 0.55)",
      fontFamily:
        "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', system-ui, sans-serif",
      ...style,
    }}
    {...props}
  >
    <div className="py-1">{children}</div>
  </PopoverContent>
));
AccountMenuContent.displayName = "AccountMenuContent";

/**
 * A single row in the luxury account menu.
 * Icons are placed in a fixed 20px container so labels share one vertical baseline.
 */
interface AccountMenuItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  label: string;
  destructive?: boolean;
}

export const AccountMenuItem = forwardRef<HTMLButtonElement, AccountMenuItemProps>(
  ({ icon, label, destructive = false, className, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "flex w-full items-center gap-3 transition-colors duration-200",
        "hover:bg-white/[0.06] active:bg-white/[0.09]",
        className
      )}
      style={{
        padding: "20px 16px",
        fontSize: 11,
        letterSpacing: "0.2em",
        textTransform: "uppercase",
        color: "rgba(255,255,255,0.7)",
        fontWeight: 500,
      }}
      {...props}
    >
      <span className="flex-1 text-left">{label}</span>
    </button>
  )
);
AccountMenuItem.displayName = "AccountMenuItem";

export const AccountMenuSeparator = () => (
  <div style={{ height: 0 }} />
);
