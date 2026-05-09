import React from "react";
import { cn } from "@/lib/utils";

interface BreadcrumbItem {
  label: string;
  onClick?: () => void;
}

interface ArborescenceTitleProps {
  items: BreadcrumbItem[];
}

export function ArborescenceTitle({ items }: ArborescenceTitleProps) {
  return (
    <div className="flex items-center gap-2">
      {items.map((item, idx) => (
        <React.Fragment key={idx}>
          {idx > 0 && (
            <span className="text-muted-foreground opacity-30">/</span>
          )}
          <button
            onClick={item.onClick}
            disabled={!item.onClick}
            className={cn(
              "text-sm font-medium font-sans transition-colors",
              item.onClick
                ? "text-primary hover:text-primary/80 cursor-pointer"
                : "text-foreground cursor-default"
            )}
          >
            {item.label}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}