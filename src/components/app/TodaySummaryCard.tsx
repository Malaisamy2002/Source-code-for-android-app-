import { useMemo } from "react";
import { CalendarDays, IndianRupee, ReceiptText, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeading } from "@/components/app/SectionHeading";
import { balanceOf, billGrossTotal, billPaidAmount, money } from "@/lib/biz";
import { useBills } from "@/lib/data";
import { useSnackSales, useTurfBookings } from "@/lib/ops";
import { dayKey, isFinancialBooking } from "@/lib/analytics";
import { localDateStr } from "@/lib/utils";
import { cn } from "@/lib/utils";

const todayISO = () => localDateStr();

/** Compact "how did today go" card shown at the top of the Bills tab. */
export function TodaySummaryCard() {
  const { data: bills = [] } = useBills();
  const { data: bookings = [] } = useTurfBookings();
  const { data: sales = [] } = useSnackSales();

  const stats = useMemo(() => {
    const day = todayISO();
    const todayBills = bills.filter((b) => dayKey(b.bill_date) === day);
    const todayBookings = bookings.filter(
      (b) => b.booking_date.slice(0, 10) === day && isFinancialBooking(b),
    );
    const todaySales = sales.filter((s) => s.sale_date.slice(0, 10) === day);

    const billed =
      todayBills.reduce((s, b) => s + billGrossTotal(b), 0) +
      todayBookings.reduce((s, b) => s + (Number(b.total_amount) || 0), 0) +
      todaySales.reduce((s, b) => s + (Number(b.total) || 0), 0);

    const collected =
      todayBills.reduce((s, b) => s + billPaidAmount(b), 0) +
      todayBookings.reduce((s, b) => s + (Number(b.advance_paid) || 0), 0) +
      todaySales.reduce((s, b) => s + (Number(b.total) || 0), 0);

    const due =
      todayBills.reduce((s, b) => s + balanceOf(b), 0) +
      todayBookings.reduce(
        (s, b) => s + Math.max(0, (Number(b.total_amount) || 0) - (Number(b.advance_paid) || 0)),
        0,
      );

    return {
      count: todayBills.length + todayBookings.length + todaySales.length,
      bookings: todayBookings.length,
      billed,
      collected,
      due,
    };
  }, [bills, bookings, sales]);

  return (
    <Card className="frost">
      <CardContent className="space-y-4 p-5">
        <SectionHeading eyebrow="TODAY" title="Today at a glance" icon={CalendarDays} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            icon={<ReceiptText className="size-4 text-primary" />}
            label="Bills today"
            value={String(stats.count)}
            hint={`${stats.bookings} turf booking${stats.bookings === 1 ? "" : "s"}`}
          />
          <Stat
            icon={<IndianRupee className="size-4 text-primary" />}
            label="Billed"
            value={money(stats.billed)}
          />
          <Stat
            icon={<TrendingUp className="size-4 text-success" />}
            label="Collected"
            value={money(stats.collected)}
            good
          />
          <Stat
            icon={<IndianRupee className="size-4 text-destructive" />}
            label="Pending"
            value={money(stats.due)}
            danger
          />
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({
  icon,
  label,
  value,
  hint,
  danger,
  good,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  danger?: boolean;
  good?: boolean;
}) {
  return (
    <div className="frost-soft rounded-xl border p-3">
      <p className="micro-label flex items-center gap-1.5">
        {icon}
        {label}
      </p>
      <p
        className={cn(
          "stat-value mt-1 text-lg",
          danger ? "text-destructive" : good ? "text-success" : "text-primary",
        )}
      >
        {value}
      </p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
