import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Cookie,
  FileText,
  Wallet,
  BookOpen,
  BarChart3,
  Trophy,
  Settings,
  LayoutDashboard,
  MoreHorizontal,
  type LucideIcon,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { DashboardTab } from "@/components/app/DashboardTab";
import { SnacksTab } from "@/components/app/SnacksTab";
import { BillsTab } from "@/components/app/BillsTab";
import { ExpensesTab } from "@/components/app/ExpensesTab";
import { DuesTab } from "@/components/app/DuesTab";
import { ReportsTab } from "@/components/app/ReportsTab";
import { TurfTab } from "@/components/app/TurfTab";
import { SettingsTab } from "@/components/app/SettingsTab";
import { ArchiveYearDialog } from "@/components/app/ArchiveYearDialog";
import { DesktopFirstRunNotice } from "@/components/app/DesktopFirstRunNotice";
import { YearSwitcher } from "@/components/app/YearSwitcher";
import { BUSINESS_NAME } from "@/lib/biz";
import { usePrintSettings } from "@/lib/print";

import { backupReminderDue, readAppSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";

const TITLE = "Turf Bookings & Sales — Booking, Billing & Reports";
const DESC =
  "Calculate turf bookings, generate numbered invoices with PDF receipts, track expenses and profit, and share bills on WhatsApp.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const TABS = [
  { id: "home", label: "Home", icon: LayoutDashboard },
  { id: "turf", label: "Turf", icon: Trophy },
  { id: "snacks", label: "Snacks", icon: Cookie },
  { id: "bills", label: "Bills", icon: FileText },
  { id: "money", label: "Money", icon: Wallet },
  { id: "dues", label: "Dues", icon: BookOpen },
  { id: "reports", label: "Reports", icon: BarChart3 },
  { id: "settings", label: "Settings", icon: Settings },
] as const;

type TabId = (typeof TABS)[number]["id"];

// Android tab bar shows five destinations; the rest live behind "More".
const PRIMARY_IDS: TabId[] = ["home", "turf", "snacks", "bills", "dues"];
const PRIMARY_TABS = PRIMARY_IDS.map((id) => TABS.find((t) => t.id === id)!);
const MORE_TABS = TABS.filter((t) => !PRIMARY_IDS.includes(t.id));

function Index() {
  const [tab, setTab] = useState<TabId>("home");
  const [moreOpen, setMoreOpen] = useState(false);
  const { settings: printSettings } = usePrintSettings();
  const shopTitle = printSettings.shopName.trim() || BUSINESS_NAME;

  // One-time backup reminder, per the Settings → Backup frequency.
  useEffect(() => {
    const s = readAppSettings();
    if (!backupReminderDue(s)) return;
    const t = window.setTimeout(() => {
      toast.info("Time for a backup", {
        description: `Your ${s.backupReminder} backup is due. Open Settings → Backup & restore to export.`,
        duration: 10000,
      });
    }, 4000);
    return () => window.clearTimeout(t);
  }, []);

  const inBar = PRIMARY_TABS.some((t) => t.id === tab);

  return (
    <div className="min-h-screen bg-background pb-[calc(4.75rem+env(safe-area-inset-bottom))] md:pb-8">
      <ArchiveYearDialog />
      <DesktopFirstRunNotice />
      <header className="safe-top sticky top-0 z-20 border-b border-white/15 brand-gradient text-primary-foreground shadow-[0_10px_30px_-20px_oklch(0.4_0.1_250)] backdrop-blur-xl">
        <div className="safe-x mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 md:flex md:justify-between md:gap-6 md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl border border-white/25 bg-white/15 backdrop-blur-md">
              <Trophy className="size-5" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold leading-tight tracking-tight md:text-lg">
                {shopTitle}
              </h1>
              <p className="truncate text-[11px] uppercase tracking-[0.08em] opacity-75">
                Booking, billing &amp; business manager
              </p>
            </div>
          </div>

          <YearSwitcher />

          <nav className="hidden items-center gap-1 rounded-full border border-white/20 bg-white/10 p-1 backdrop-blur-md md:flex">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition-all",
                    active
                      ? "bg-background text-primary shadow-sm"
                      : "text-primary-foreground/85 hover:bg-white/15",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {t.label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="safe-x mx-auto max-w-2xl p-4 md:max-w-6xl md:px-8 md:py-8">
        {tab === "home" && <DashboardTab />}
        {tab === "turf" && <TurfTab />}

        {tab === "snacks" && <SnacksTab />}
        {tab === "bills" && <BillsTab />}
        {tab === "money" && <ExpensesTab />}
        {tab === "dues" && <DuesTab />}
        {tab === "reports" && <ReportsTab />}
        {tab === "settings" && <SettingsTab />}
      </main>

      {/* Android tab bar: five 48dp targets, no horizontal scrolling, overflow in a sheet. */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t bg-background/95 shadow-[0_-8px_24px_-18px_oklch(0.4_0.1_250)] backdrop-blur-xl md:hidden">
        {PRIMARY_TABS.map((t) => (
          <TabBarButton
            key={t.id}
            icon={t.icon}
            label={t.label}
            active={tab === t.id}
            onClick={() => setTab(t.id)}
          />
        ))}

        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetTrigger asChild>
            <TabBarButton icon={MoreHorizontal} label="More" active={!inBar} />
          </SheetTrigger>
          <SheetContent side="bottom" className="safe-bottom rounded-t-3xl border-t px-4 pb-4">
            <SheetHeader className="px-0 text-left">
              <SheetTitle>More</SheetTitle>
            </SheetHeader>
            <div className="mt-2 grid grid-cols-3 gap-3">
              {MORE_TABS.map((t) => {
                const Icon = t.icon;
                const active = tab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => {
                      setTab(t.id);
                      setMoreOpen(false);
                    }}
                    className={cn(
                      "tap flex flex-col items-center justify-center gap-2 rounded-2xl border p-4 text-xs font-semibold",
                      active
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border bg-card text-foreground",
                    )}
                  >
                    <Icon className="h-6 w-6" />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </SheetContent>
        </Sheet>
      </nav>
    </div>
  );
}

function TabBarButton({
  icon: Icon,
  label,
  active,
  onClick,
  ...rest
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick?: () => void;
} & React.ComponentPropsWithoutRef<"button">) {
  return (
    <button
      {...rest}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "tap touch-target relative flex min-w-0 flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium",
        active ? "text-primary" : "text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "grid h-8 w-14 place-items-center rounded-full transition-all",
          active ? "bg-primary/12 shadow-[0_6px_16px_-10px_var(--primary)]" : "",
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}
