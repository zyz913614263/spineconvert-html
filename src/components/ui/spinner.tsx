import { cn } from "@/lib/utils";
import { Loader2Icon } from "lucide-react";

/* eslint-disable jsx-a11y/prefer-tag-over-role -- An SVG status icon has no semantic HTML equivalent. */
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon
      data-slot="spinner"
      role="status"
      aria-label="加载中"
      className={cn("size-4 animate-spin [animation-duration:var(--duration-spinner)]", className)}
      {...props}
    />
  );
}

export { Spinner };
