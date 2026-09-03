import { useState } from "react";
import { Banknote, Copy, Smartphone, IndianRupee } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { balanceOf, billGrossTotal, money, type Bill } from "@/lib/biz";
import { useCreateBill, useUpdateBill } from "@/lib/data";

/** One-tap payment shortcuts, partial payment entry and "bill again" for a single bill. */
export function QuickPayRow({ bill }: { bill: Bill }) {
  const updateBill = useUpdateBill();
  const createBill = useCreateBill();
  const [part, setPart] = useState("");
  const [busy, setBusy] = useState(false);
  const due = balanceOf(bill);
  const gross = billGrossTotal(bill);

  const payFull = async (mode: "Cash" | "UPI") => {
    if (busy) return;
    setBusy(true);
    try {
      await updateBill.mutateAsync({
        id: bill.id,
        status: "paid",
        amount_paid: gross,
        payment_mode: mode,
      });
      toast.success(`Paid via ${mode}`);
    } finally {
      setBusy(false);
    }
  };

  const payPart = async () => {
    if (busy) return;
    const amt = Number(part);
    if (!amt || amt <= 0) {
      toast.error("Enter an amount");
      return;
    }
    setBusy(true);
    try {
      const paid = Math.min(gross, (Number(bill.amount_paid) || 0) + amt);
      await updateBill.mutateAsync({
        id: bill.id,
        status: paid >= gross ? "paid" : "partial",
        amount_paid: paid,
      });
      setPart("");
      toast.success(`Recorded ${money(amt)} · Due ${money(Math.max(0, gross - paid))}`);
    } finally {
      setBusy(false);
    }
  };

  const billAgain = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await createBill.mutateAsync({
        customer_name: bill.customer_name,
        customer_phone: bill.customer_phone ?? "",
        items: bill.items,
        subtotal: bill.subtotal,
        discount: bill.discount,
        total: bill.total,
        status: "unpaid",
        amount_paid: 0,
      });
      toast.success("New bill created with the same items");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      {due > 0 && (
        <div className="grid grid-cols-2 gap-2">
          <Button className="lift h-11" disabled={busy} onClick={() => payFull("Cash")}>
            <Banknote className="size-4" /> Paid · Cash
          </Button>
          <Button
            className="lift h-11"
            variant="secondary"
            disabled={busy}
            onClick={() => payFull("UPI")}
          >
            <Smartphone className="size-4" /> Paid · UPI
          </Button>
        </div>
      )}
      {due > 0 && (
        <div className="flex gap-2">
          <div className="relative flex-1">
            <IndianRupee className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-11 pl-9"
              type="number"
              inputMode="decimal"
              placeholder={`Part payment (due ${due})`}
              value={part}
              onChange={(e) => setPart(e.target.value)}
            />
          </div>
          <Button variant="outline" className="h-11" disabled={busy} onClick={payPart}>
            Record
          </Button>
        </div>
      )}
      <Button variant="outline" className="lift h-11 w-full" disabled={busy} onClick={billAgain}>
        <Copy className="size-4" /> Bill again
      </Button>
    </div>
  );
}
