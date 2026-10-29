import { memo, type ComponentProps, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type IconButtonProps = Omit<
  ComponentProps<typeof Button>,
  "children" | "size" | "value" | "variant"
> & {
  label: string;
  shortcut?: string;
  /** Shows the pressed state with a filled background. */
  active?: boolean;
  children: ReactNode;
};

/** Adds an accessible name and optional shortcut hint to an icon button. */
export const IconButton = memo(function IconButton({
  label,
  shortcut,
  active,
  className,
  children,
  ...props
}: IconButtonProps) {
  const controlClassName = cn(
    "text-muted-foreground hover:text-foreground",
    active !== undefined &&
      "[&[aria-pressed=true]]:bg-primary-soft [&[aria-pressed=true]]:text-focus [&[aria-pressed=true]]:hover:bg-primary-soft [&[aria-pressed=true]]:hover:text-focus",
    className,
  );

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          active === undefined ? (
            <Button
              size="icon-sm"
              variant="ghost"
              className={controlClassName}
              aria-label={label}
              {...props}
            />
          ) : (
            <Toggle
              size="sm"
              pressed={active}
              className={controlClassName}
              aria-label={label}
              {...props}
            />
          )
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent className="max-medium:hidden">
        {label}
        {shortcut ? (
          <kbd
            data-slot="kbd"
            className="rounded-sm bg-background/10 px-1.5 py-0.5 font-mono text-2xs tracking-data text-background/80"
          >
            {shortcut}
          </kbd>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
});
