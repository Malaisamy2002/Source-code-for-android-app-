import { toast } from "sonner";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useBills } from "@/lib/data";
import { useExpensesV2, useSnackSales, useTurfBookings } from "@/lib/ops";
import { dayKey, paymentSplit, statsForDay } from "@/lib/analytics";
import { BUSINESS_NAME, money } from "@/lib/biz";
import { usePrintSettings } from "@/lib/print";
import { useAppSettings } from "@/lib/settings";

export function WhatsAppSummaryCard() {
  const { settings, save } = useAppSettings();
  const { settings: printSettings } = usePrintSettings();
  const { data: bills = [] } = useBills();
  const { data: bookings = [] } = useTurfBookings();
  const { data: sales = [] } = useSnackSales();
  const { data: expenses = [] } = useExpensesV2();

  const send = () => {
    const today = dayKey(new Date());
    const src = { bills, bookings, sales, expenses };
    const s = statsForDay(src, today);
    const split = paymentSplit(src, (iso) => dayKey(iso) === today);
    const modeText = split
      .filter((m) => m.value > 0)
      .map((m) => `${m.name} ${money(m.value)}`)
      .join(" · ");
    const dateText = new Date().toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

    const text = [
      `*${printSettings.shopName || BUSINESS_NAME} — Daily summary (${dateText})*`,
      `Collected: ${money(s.collected)}${modeText ? `\n${modeText}` : ""}`,
      `Revenue: ${money(s.revenue)} (Tax: ${money(s.tax)}) · Expenses: ${money(s.expenses)} · Profit: ${money(s.profit)}`,
      `Turf bookings: ${bookings.filter((b) => b.booking_date === today && b.status !== "Cancelled").length} · Snack bills: ${sales.filter((x) => x.sale_date === today).length}`,
      `Pending dues: ${money(s.dues)}`,
    ].join("\n");

    const phone = settings.whatsappOwner.replace(/\D/g, "");
    const url = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank", "noopener");
    toast.success("Opening WhatsApp", { description: "Review and tap send." });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageCircle className="h-4 w-4" /> Daily summary on WhatsApp
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Builds today&apos;s collection, profit and dues summary and opens WhatsApp with the
          message pre-filled — one tap to send it to the owner.
        </p>
        <div className="space-y-1">
          <Label className="text-xs">Owner&apos;s WhatsApp number (with country code)</Label>
          <Input
            inputMode="tel"
            value={settings.whatsappOwner}
            onChange={(e) => save({ ...settings, whatsappOwner: e.target.value })}
            placeholder="91 98765 43210"
          />
        </div>
        <Button onClick={send}>
          <MessageCircle className="mr-1 h-4 w-4" /> Send today&apos;s summary
        </Button>
      </CardContent>
    </Card>
  );
}
