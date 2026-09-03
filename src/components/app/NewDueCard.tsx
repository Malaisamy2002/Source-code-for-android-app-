import { useState } from "react";
import { toast } from "sonner";
import { PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CustomerFields } from "@/components/app/CustomerFields";
import { TAB_BUSINESSES, useAddTabEntry } from "@/lib/tabs";
import { money } from "@/lib/biz";
import { cn, localDateStr } from "@/lib/utils";

/**
 * "New due" entry point: puts an amount on a customer's running tab.
 * Tab dues stay separate from bill / booking balances so no rupee is
 * counted twice — see lib/tabs.ts.
 */
export function NewDueCard() {
  const addEntry = useAddTabEntry();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [business, setBusiness] = useState<string>("Turf");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(() => localDateStr());

  const value = Number(amount) || 0;
  const canSave = name.trim().length > 0 && value > 0 && !addEntry.isPending;

  const save = () => {
    addEntry.mutate(
      {
        name: name.trim(),
        phone: phone.trim() || null,
        kind: "charge",
        business,
        amount: value,
        note,
        entry_date: date,
      },
      {
        onSuccess: () => {
          toast.success(`${money(value)} added to ${name.trim()}'s tab`);
          setAmount("");
          setNote("");
        },
        onError: (e) => toast.error(e.message),
      },
    );
  };

  return (
    <Card className="frost">
      <CardContent className="space-y-4 pt-5">
        <CustomerFields
          name={name}
          phone={phone}
          onChange={(next) => {
            setName(next.name);
            setPhone(next.phone);
          }}
        />

        <div className="space-y-1.5">
          <Label className="text-xs">Business</Label>
          <div className="flex gap-2">
            {TAB_BUSINESSES.map((b) => (
              <Button
                key={b}
                type="button"
                variant={business === b ? "default" : "outline"}
                className={cn("flex-1")}
                onClick={() => setBusiness(b)}
              >
                {b}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Amount</Label>
            <Input
              type="number"
              inputMode="decimal"
              min="0"
              placeholder="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Note (optional)</Label>
          <Input
            placeholder="What is this due for?"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <Button className="w-full" disabled={!canSave} onClick={save}>
          <PlusCircle className="mr-1 size-4" />
          Add due {value > 0 ? money(value) : ""}
        </Button>
        <p className="text-xs text-muted-foreground">
          Dues on bills and turf bookings are collected from those tabs — only add manual dues here
          so the same amount is never owed twice.
        </p>
      </CardContent>
    </Card>
  );
}
