import type { ReactNode } from "react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";

type ExportSettingsListRootProps = {
  children: ReactNode;
  className?: string;
  value: string | null;
  onValueChange: (value: string | null) => void;
};

type ExportSettingsListItemProps = {
  id: string;
  label: string;
  value: ReactNode;
  valueClassName?: string;
  children: ReactNode;
};

function Root({ children, className, value, onValueChange }: ExportSettingsListRootProps) {
  return (
    <Accordion
      value={value ? [value] : []}
      onValueChange={(values) => onValueChange(values[0] ?? null)}
      className={cn("overflow-hidden rounded-xl border border-border-soft", className)}
    >
      {children}
    </Accordion>
  );
}

function Item({ id, label, value, valueClassName, children }: ExportSettingsListItemProps) {
  return (
    <AccordionItem value={id} className="border-border-soft last:border-b-0">
      <AccordionTrigger
        id={id}
        className="rounded-none px-3 py-2.5 hover:no-underline [&_[data-slot=accordion-trigger-icon]]:ml-1"
      >
        <span className="shrink-0 text-xs font-medium text-foreground">{label}</span>
        <span
          className={cn(
            "ml-auto min-w-0 truncate text-xs font-normal text-muted-foreground",
            valueClassName,
          )}
        >
          {value}
        </span>
      </AccordionTrigger>
      <AccordionContent className="p-0">
        <div className="border-t border-border-soft bg-surface-raised p-3">{children}</div>
      </AccordionContent>
    </AccordionItem>
  );
}

export const ExportSettingsList = { Root, Item } as const;
