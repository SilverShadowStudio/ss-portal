import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, ChevronRight } from "lucide-react";

// Section header used as an accordion toggle.
// Label flush-left in gold; rule in #2A2820 fills the remaining width; optional
// inline action; chevron at the far right rotates 90° when expanded. The whole
// row is clickable and toggles the open section; the optional action button
// intercepts clicks so it doesn't trigger the toggle.
// `count` is optional — when undefined the "· N" suffix is hidden, for sections
// that aren't lists of N items (e.g. Settings).
export function AccordionHeader({ label, count, isOpen, onToggle, action }: {
  label: string;
  count?: number;
  isOpen: boolean;
  onToggle: () => void;
  action?: { label: string; onClick: () => void };
}) {
  const showCount = typeof count === "number";
  const countLabel = count === 0 ? "None" : String(count);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={isOpen}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      className="group flex items-center gap-4 cursor-pointer select-none"
    >
      <p
        className="shrink-0 font-sans uppercase text-gold"
        style={{ fontSize: 10, letterSpacing: "0.18em" }}
      >
        {label}
        {showCount && (
          <span style={{ opacity: count === 0 ? 0.4 : 1 }}>
            {" · "}
            {countLabel}
          </span>
        )}
      </p>
      <div className="flex-1 h-px" style={{ background: "#2A2820" }} />
      {action && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            action.onClick();
          }}
          className="shrink-0 flex items-center gap-1.5 font-sans uppercase text-foreground/40 hover:text-foreground transition-colors"
          style={{ fontSize: 10, letterSpacing: "0.16em" }}
        >
          {action.label}
          <ArrowRight style={{ width: 11, height: 11 }} strokeWidth={1.5} />
        </button>
      )}
      <ChevronRight
        className="shrink-0 text-foreground/45 group-hover:text-foreground/70 transition-transform duration-200"
        style={{
          width: 14,
          height: 14,
          transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
        }}
        strokeWidth={1.5}
      />
    </div>
  );
}

// Wraps an accordion section body in a height + opacity transition.
// Renders with overflow hidden so the height animation doesn't visibly leak.
export function AccordionPanel({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {isOpen && (
        <motion.div
          key="content"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          style={{ overflow: "hidden" }}
        >
          {/* 20px top margin from the header rule before content begins. */}
          <div className="pt-5">{children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
