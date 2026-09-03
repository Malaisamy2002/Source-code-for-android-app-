import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Search, Trash2, Sparkles, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { customerTag, money, sameCustomerName } from "@/lib/biz";
import { isFinancialBooking } from "@/lib/analytics";
import { customerOutstanding, isFinancialSale } from "@/lib/dues";
import { useBills } from "@/lib/data";
import { useSnackSales, useTurfBookings } from "@/lib/ops";
import {
  useCleanupDuplicateCustomers,
  useCustomers,
  useDeleteCustomer,
  useSaveCustomer,
} from "@/lib/data";
import { tabKey, useTabEntries, useTabSummaries } from "@/lib/tabs";
import { compareBy, useSortState, type SortOption } from "@/lib/sort";

import { CustomerDetailDialog } from "./CustomerDetailDialog";
import { MergeCustomersDialog } from "./MergeCustomersDialog";
import { SectionHeading } from "./SectionHeading";
import { SortMenu } from "./SortMenu";

type CustomerSortField = "name" | "recent" | "due";

const CUSTOMER_SORT_OPTIONS: SortOption<CustomerSortField>[] = [
  { value: "recent", label: "Recently added", defaultDir: "desc" },
  { value: "name", label: "Name (A–Z)", defaultDir: "asc" },
  { value: "due", label: "Outstanding balance", defaultDir: "desc" },
];

export function CustomerDirectoryCard() {
  const { data: customers = [] } = useCustomers();
  const { data: bills = [] } = useBills();
  const { data: bookings = [] } = useTurfBookings();
  const { data: sales = [] } = useSnackSales();
  const save = useSaveCustomer();
  const del = useDeleteCustomer();
  const cleanup = useCleanupDuplicateCustomers();

  const [q, setQ] = useState("");
  const [form, setForm] = useState({ name: "", phone: "" });
  const [openCustomer, setOpenCustomer] = useState<{
    name: string;
    phone: string | null;
  } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);

  /** Visit count per customer = bills + turf bookings + snack sales under their name. */
  const visitsByName = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of customers) {
      const key = c.name.trim().toLowerCase();
      if (map.has(key)) continue;
      const count =
        bills.filter((b) => sameCustomerName(b.customer_name, c.name)).length +
        // A merged booking's visit is now represented by the bill it was
        // rolled into (counted above) — counting both double-counts the
        // same visit and can inflate a customer past the VIP threshold.
        // isFinancialBooking() also excludes Cancelled, which is correct
        // here too (a cancelled booking isn't a visit).
        bookings.filter((b) => sameCustomerName(b.customer_name, c.name) && isFinancialBooking(b))
          .length +
        sales.filter((s) => sameCustomerName(s.customer_name, c.name) && isFinancialSale(s)).length;
      map.set(key, count);
    }
    return map;
  }, [customers, bills, bookings, sales]);

  const tabSummaries = useTabSummaries();
  const { data: tabEntries = [] } = useTabEntries();

  /**
   * Outstanding balance per customer, straight from the one dues engine
   * (`customerOutstanding`): running tab + unpaid bookings + unpaid bills,
   * with tab-owned and merged amounts already removed at the source so no
   * rupee is counted twice.
   */
  const dueByName = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of customers) {
      const key = c.name.trim().toLowerCase();
      if (map.has(key)) continue;
      const phone = c.phone ?? null;
      map.set(
        key,
        customerOutstanding(
          { name: c.name, phone },
          {
            bills,
            bookings,
            tabEntries,
            tabBalance: tabSummaries.get(tabKey(c.name, phone))?.balance ?? 0,
            match: (n) => sameCustomerName(n, c.name),
          },
        ).total,
      );
    }
    return map;
  }, [customers, bills, bookings, tabEntries, tabSummaries]);

  /** Open-tab balance per customer, for the "On tab" badge in the list. */
  const tabDueByName = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of customers) {
      const key = c.name.trim().toLowerCase();
      if (map.has(key)) continue;
      map.set(key, tabSummaries.get(tabKey(c.name, c.phone ?? null))?.balance ?? 0);
    }
    return map;
  }, [customers, tabSummaries]);

  const sort = useSortState<CustomerSortField>("customers", CUSTOMER_SORT_OPTIONS, {
    field: "recent",
    dir: "desc",
  });

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const base = term
      ? customers.filter(
          (c) =>
            c.name.toLowerCase().includes(term) || (c.phone ?? "").toLowerCase().includes(term),
        )
      : customers;
    if (sort.field === "recent") {
      // customers already arrives newest-first from the query; flipping dir reverses it.
      return sort.dir === "desc" ? base : [...base].reverse();
    }
    return [...base].sort((a, b) => {
      if (sort.field === "due") {
        const da = dueByName.get(a.name.trim().toLowerCase()) ?? 0;
        const db = dueByName.get(b.name.trim().toLowerCase()) ?? 0;
        return compareBy(da, db, sort.dir);
      }
      return compareBy(a.name.toLowerCase(), b.name.toLowerCase(), sort.dir);
    });
  }, [customers, q, sort.field, sort.dir, dueByName]);

  const add = () => {
    if (!form.name.trim()) {
      toast.error("Customer name required");
      return;
    }
    if (form.phone && !/^\d{10}$/.test(form.phone)) {
      toast.error("Phone must be 10 digits");
      return;
    }
    save.mutate(
      { name: form.name.trim(), phone: form.phone.trim() || null },
      {
        onSuccess: (result) => {
          if (result === "duplicate") {
            toast.info("Customer already saved");
            return;
          }
          setForm({ name: "", phone: "" });
          toast.success(result === "updated" ? "Existing customer updated" : "Customer added");
        },
        onError: (e) => toast.error(e.message),
      },
    );
  };

  return (
    <section className="space-y-3">
      <SectionHeading
        eyebrow="CUSTOMERS"
        title="Customer database"
        icon={Users}
        action={
          <SortMenu
            options={CUSTOMER_SORT_OPTIONS}
            field={sort.field}
            dir={sort.dir}
            onFieldChange={sort.setField}
            onToggleDir={sort.toggleDir}
          />
        }
      />
      <Card className="frost">
        <CardContent className="space-y-3 p-4">
          <CustomerDetailDialog
            name={openCustomer?.name ?? null}
            phone={openCustomer?.phone ?? null}
            onOpenChange={(o) => !o && setOpenCustomer(null)}
          />
          <AlertDialog
            open={confirmDelete != null}
            onOpenChange={(o) => !o && setConfirmDelete(null)}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove "{confirmDelete?.name}" from customers?</AlertDialogTitle>
                <AlertDialogDescription>
                  This only removes the saved contact entry — their bills, bookings and sales
                  history are stored separately and are not affected. You can re-add them anytime.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    if (!confirmDelete) return;
                    const id = confirmDelete.id;
                    setConfirmDelete(null);
                    del.mutate(id, { onSuccess: () => toast.success("Removed") });
                  }}
                >
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name or phone"
            />
          </div>

          <div className="max-h-80 space-y-2 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {customers.length ? "No matches." : "No saved customers yet."}
              </p>
            ) : (
              filtered.map((c) => {
                const visits = visitsByName.get(c.name.trim().toLowerCase()) ?? 0;
                const due = dueByName.get(c.name.trim().toLowerCase()) ?? 0;
                const tabDue = tabDueByName.get(c.name.trim().toLowerCase()) ?? 0;

                const tag = customerTag(visits);
                return (
                  <div
                    key={c.id}
                    className="frost-soft lift flex items-center justify-between gap-3 rounded-xl border p-3"
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => setOpenCustomer({ name: c.name, phone: c.phone ?? null })}
                    >
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium underline decoration-dotted underline-offset-2">
                          {c.name}
                        </p>
                        <Badge
                          variant={
                            tag === "VIP" ? "default" : tag === "Regular" ? "secondary" : "outline"
                          }
                          className="shrink-0 text-[10px]"
                        >
                          {tag}
                        </Badge>
                        {tabDue > 0 && (
                          <Badge variant="destructive" className="shrink-0 text-[10px]">
                            On tab {money(tabDue)}
                          </Badge>
                        )}
                      </div>

                      <p className="text-xs text-muted-foreground">
                        {c.phone || "No phone"} · {visits} visit
                        {visits === 1 ? "" : "s"}
                        {due > 0 && <span className="text-destructive"> · Due {money(due)}</span>}
                      </p>
                    </button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setConfirmDelete({ id: c.id, name: c.name })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })
            )}
          </div>

          <div className="frost-well grid grid-cols-2 gap-2 rounded-xl p-3 md:grid-cols-[1.4fr_1fr_auto] md:items-end">
            <div className="space-y-1">
              <Label className="micro-label">Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Customer name"
              />
            </div>
            <div className="space-y-1">
              <Label className="micro-label">Phone</Label>
              <Input
                inputMode="numeric"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, "") })}
                placeholder="10 digits"
              />
            </div>
            <Button className="col-span-2 md:col-span-1" onClick={add}>
              <Plus className="mr-1 h-4 w-4" /> Add
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={cleanup.isPending}
              onClick={() =>
                cleanup.mutate(undefined, {
                  onSuccess: (n) =>
                    toast.success(
                      n ? `Removed ${n} duplicate${n > 1 ? "s" : ""}` : "No duplicates found",
                    ),
                  onError: (e) => toast.error(e.message),
                })
              }
            >
              <Sparkles className="mr-1 h-4 w-4" /> Remove duplicates
            </Button>
            <MergeCustomersDialog customers={customers} />
          </div>

          <p className="text-xs text-muted-foreground">
            Exact duplicate names/phones are merged automatically — use "Merge customers" for
            near-duplicates (e.g. a typo or a second phone number) that need a manual pick. VIP tag
            kicks in at 5+ visits. Saved customers power the name/phone autofill in Turf, Snacks and
            Bills.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
