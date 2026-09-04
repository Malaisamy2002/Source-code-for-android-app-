import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

const KEY_PREFIX = "ks:settings-open:";

/**
 * Collapsible wrapper for one settings block. The trigger doubles as the
 * section heading so a long settings page reads as a short list of dropdowns.
 * Open/closed state is remembered per section on this device.
 */
export function SettingsSection({
  id,
  eyebrow,
  title,
  hint,
  icon: Icon,
  defaultOpen = false,
  children,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  hint?: string;
  icon?: LucideIcon;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  // Read the saved state after mount so server and client render the same markup.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY_PREFIX + id);
      if (saved != null) setOpen(saved === "1");
    } catch {
      /* storage unavailable — keep the default */
    }
  }, [id]);

  const change = (v: boolean) => {
    setOpen(v);
    try {
      localStorage.setItem(KEY_PREFIX + id, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  return (
    <Collapsible open={open} onOpenChange={change} className="space-y-3">
      <CollapsibleTrigger
        className={cn(
          "frost lift flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors",
          "hover:bg-accent/40",
        )}
      >
        {Icon ? (
          <span className="frost-soft grid size-9 shrink-0 place-items-center rounded-xl border">
            <Icon className="size-4 text-primary" />
          </span>
        ) : null}
        <span className="min-w-0 flex-1">
          {eyebrow ? <span className="micro-label block truncate">{eyebrow}</span> : null}
          <span className="page-title block truncate">{title}</span>
          {hint ? (
            <span className="block truncate text-xs text-muted-foreground">{hint}</span>
          ) : null}
        </span>
        <ChevronDown
          className={cn(
            "size-5 shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}
