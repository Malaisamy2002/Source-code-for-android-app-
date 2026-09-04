import { toast } from "sonner";
import { Eye, Printer, RotateCcw, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DEFAULT_PRINT_SETTINGS,
  DENSITY_OPTIONS,
  LINE_SPACING_OPTIONS,
  PAPER_TYPES,
  PRINTER_PRESETS,
  isRollPaper,
  usePrintSettings,
  type DensityId,
  type LineSpacingId,
  type PaperId,
} from "@/lib/print";
import { buildReceiptPdf, printReceipt, type ReceiptDoc } from "@/lib/receipt";

const sample: ReceiptDoc = {
  kind: "Sample",
  docNo: "TEST-001",
  dateText: new Date().toISOString().slice(0, 10),
  customer: "Test Customer",
  phone: "9876543210",
  lines: [
    { label: "Turf slot", sub: "1 hr x Rs 1,200", amount: 1200 },
    { label: "Tea", sub: "2 x Rs 15", amount: 30 },
  ],
  totals: [{ label: "TOTAL", value: "Rs 1,230", strong: true }],
  fileName: "print-test",
};

export function PrintSettingsCard() {
  const { settings, save } = usePrintSettings();
  const set = <K extends keyof typeof settings>(k: K, v: (typeof settings)[K]) =>
    save({ ...settings, [k]: v });
  const rollPaper = isRollPaper(settings.paper);

  return (
    <section className="space-y-3">
      <Card className="frost">
        <CardContent className="space-y-4 p-4">
          <div className="space-y-1">
            <Label className="micro-label">Quick setup for your printer</Label>
            <Select
              value=""
              onValueChange={(id) => {
                const preset = PRINTER_PRESETS.find((p) => p.id === id);
                if (!preset) return;
                save({ ...settings, ...preset.settings });
                toast.success(`Applied "${preset.label}" printer settings`);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a printer to auto-fill the fields below…" />
              </SelectTrigger>
              <SelectContent>
                {PRINTER_PRESETS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Optional shortcut — fills in paper size, darkness and spacing for common hardware.
              Everything stays editable below.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label className="micro-label">Paper / printer type</Label>
              <Select value={settings.paper} onValueChange={(v) => set("paper", v as PaperId)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAPER_TYPES.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {settings.paper === "custom" ? (
              <div className="space-y-1">
                <Label className="micro-label">Custom roll width (mm)</Label>
                <Input
                  inputMode="numeric"
                  value={String(settings.customWidthMm)}
                  onChange={(e) =>
                    set("customWidthMm", Math.max(30, Math.min(300, Number(e.target.value) || 72)))
                  }
                  placeholder="e.g. 72"
                />
              </div>
            ) : (
              <div className="space-y-1">
                <Label className="micro-label">Text size</Label>
                <Select
                  value={String(settings.fontScale)}
                  onValueChange={(v) => set("fontScale", Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0.9">Small</SelectItem>
                    <SelectItem value="1">Normal</SelectItem>
                    <SelectItem value="1.15">Large</SelectItem>
                    <SelectItem value="1.3">Extra large</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label className="micro-label">Copies per print</Label>
              <Input
                inputMode="numeric"
                value={String(settings.copies)}
                onChange={(e) =>
                  set("copies", Math.max(1, Math.min(5, Number(e.target.value) || 1)))
                }
              />
            </div>
          </div>

          {settings.paper === "custom" && (
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <Label className="micro-label">Text size</Label>
                <Select
                  value={String(settings.fontScale)}
                  onValueChange={(v) => set("fontScale", Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0.9">Small</SelectItem>
                    <SelectItem value="1">Normal</SelectItem>
                    <SelectItem value="1.15">Large</SelectItem>
                    <SelectItem value="1.3">Extra large</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label className="micro-label">Print darkness</Label>
              <Select
                value={settings.density}
                onValueChange={(v) => set("density", v as DensityId)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DENSITY_OPTIONS.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="micro-label">Line spacing</Label>
              <Select
                value={settings.lineSpacing}
                onValueChange={(v) => set("lineSpacing", v as LineSpacingId)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LINE_SPACING_OPTIONS.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {rollPaper && (
              <div className="space-y-1">
                <Label className="micro-label">Feed before cut (mm)</Label>
                <Input
                  inputMode="numeric"
                  value={String(settings.cutFeedMm)}
                  onChange={(e) =>
                    set("cutFeedMm", Math.max(0, Math.min(40, Number(e.target.value) || 0)))
                  }
                  placeholder="0"
                />
              </div>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label className="micro-label">Shop name on receipt</Label>
              <Input
                value={settings.shopName}
                onChange={(e) => set("shopName", e.target.value)}
                placeholder="Leave blank for default"
              />
            </div>
            <div className="space-y-1">
              <Label className="micro-label">Header line</Label>
              <Input
                value={settings.headerLine}
                onChange={(e) => set("headerLine", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="micro-label">Footer line</Label>
              <Input
                value={settings.footerLine}
                onChange={(e) => set("footerLine", e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1 md:col-span-3">
              <Label className="micro-label">Shop address on receipt</Label>
              <Textarea
                rows={2}
                value={settings.shopAddress}
                onChange={(e) => set("shopAddress", e.target.value)}
                placeholder="Leave blank to skip printing the address"
              />
            </div>
            <div className="space-y-1">
              <Label className="micro-label">Shop phone on receipt</Label>
              <Input
                inputMode="tel"
                value={settings.shopPhone}
                onChange={(e) => set("shopPhone", e.target.value)}
                placeholder="Leave blank to skip"
              />
            </div>
            <div className="space-y-1">
              <Label className="micro-label">Shop email on receipt</Label>
              <Input
                type="email"
                value={settings.shopEmail}
                onChange={(e) => set("shopEmail", e.target.value)}
                placeholder="Leave blank to skip"
              />
            </div>
            <div className="space-y-1">
              <Label className="micro-label">Side margin (mm)</Label>
              <Input
                inputMode="numeric"
                value={String(settings.marginMm)}
                onChange={(e) =>
                  set("marginMm", Math.max(0, Math.min(40, Number(e.target.value) || 0)))
                }
                placeholder="0"
              />
              <p className="text-xs text-muted-foreground">
                0 = automatic (5 mm on rolls, 12 mm on sheets)
              </p>
            </div>
            <div className="space-y-1">
              <Label className="micro-label">Currency symbol</Label>
              <Input
                value={settings.currencySymbol}
                onChange={(e) => set("currencySymbol", e.target.value.slice(0, 4))}
                placeholder="Rs"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={settings.showPhone} onCheckedChange={(v) => set("showPhone", v)} />
              Print customer phone
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={settings.autoPrint} onCheckedChange={(v) => set("autoPrint", v)} />
              Auto-print after saving a bill
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={settings.previewBeforePrint}
                onCheckedChange={(v) => set("previewBeforePrint", v)}
              />
              Preview before printing (opens in a tab instead of printing right away)
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => printReceipt(sample, settings)}>
              <Printer className="mr-1 h-4 w-4" /> Test print
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const url = buildReceiptPdf(sample, settings).output(
                  "bloburl",
                ) as unknown as string;
                window.open(url, "_blank");
              }}
            >
              <Eye className="mr-1 h-4 w-4" /> Preview layout
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                save(DEFAULT_PRINT_SETTINGS);
                toast.success("Reset to thermal 80 mm default");
              }}
            >
              <RotateCcw className="mr-1 h-4 w-4" /> Reset defaults
            </Button>
          </div>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Wand2 className="h-3.5 w-3.5" /> Tip: try "Quick setup" above first, then fine-tune
            darkness or spacing if receipts print too light or too cramped.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
