import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useQueryClient } from "@tanstack/react-query";
import {
  buildReceiptsArchive,
  countReceipts,
  downloadReceiptsArchive,
  importReceiptsArchive,
  pickReceiptsArchiveFile,
  type ImportReceiptsArchiveResult,
} from "@/lib/receipts-share";
import { isAndroid, isDesktop } from "@/lib/desktop";

export function ReceiptsCard() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [pendingImportBytes, setPendingImportBytes] = useState<Uint8Array | null>(null);

  const refreshCount = () => {
    void countReceipts().then(setCount);
  };

  useEffect(() => {
    refreshCount();
  }, []);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const reportImport = (result: ImportReceiptsArchiveResult) => {
    const parts = [`Restored ${result.restored} receipt${result.restored === 1 ? "" : "s"}`];
    if (result.skippedExisting > 0) parts.push(`${result.skippedExisting} already on this device`);
    if (result.skippedUnmatched > 0)
      parts.push(`${result.skippedUnmatched} didn't match a current expense`);
    toast.success(parts[0], {
      description: parts.length > 1 ? parts.slice(1).join(" · ") : undefined,
    });
    refreshCount();
  };

  const applyImport = async (bytes: Uint8Array) => {
    const result = await importReceiptsArchive(bytes);
    await qc.invalidateQueries();
    reportImport(result);
  };

  return (
    <section className="space-y-3">
      <Card className="frost">
        <CardHeader>
          <CardTitle className="text-base">Receipt photos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Backs up just the receipt photos attached to expenses, separately from the main{" "}
            <code className="mx-1 rounded bg-muted px-1">.db</code> backup above (which doesn't
            include them). Bring this <code className="mx-1 rounded bg-muted px-1">.zip</code> to
            another device to re-attach the same photos there.
          </p>
          <p className="text-sm text-muted-foreground">
            {count === null
              ? "Checking receipts on this device…"
              : count === 0
                ? "No expenses have a receipt attached yet."
                : `${count} expense${count === 1 ? "" : "s"} ${count === 1 ? "has" : "have"} a receipt attached.`}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy !== null || count === 0}
              onClick={() =>
                run("export", async () => {
                  const { blob, included, missing } = await buildReceiptsArchive();
                  const savedTo = await downloadReceiptsArchive(blob);
                  if (savedTo === null) return; // user cancelled the save dialog
                  toast.success(isDesktop() ? "Receipts archive saved" : "Receipts archive downloaded", {
                    description:
                      missing.length > 0
                        ? `${included} photos · ${missing.length} couldn't be found on this device`
                        : `${included} photos`,
                  });
                })
              }
            >
              <Download className="mr-1 h-4 w-4" /> Export receipts (.zip)
            </Button>
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() => {
                // Android satisfies isDesktop() too, but
                // pickReceiptsArchiveFile()'s native open dialog (SAF picker)
                // isn't implemented there — fall through to the
                // <input type="file"> below instead, same as the browser/PWA
                // build.
                if (isDesktop() && !isAndroid()) {
                  void run("import", async () => {
                    const bytes = await pickReceiptsArchiveFile();
                    if (bytes === null) return; // user cancelled the open dialog
                    setPendingImportBytes(bytes);
                  });
                  return;
                }
                fileRef.current?.click();
              }}
            >
              <Upload className="mr-1 h-4 w-4" /> Import receipts (.zip)
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                void run("import", async () => {
                  const bytes = new Uint8Array(await file.arrayBuffer());
                  setPendingImportBytes(bytes);
                });
              }}
            />
          </div>
        </CardContent>
      </Card>

      <AlertDialog
        open={pendingImportBytes != null}
        onOpenChange={(o) => (o ? undefined : setPendingImportBytes(null))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Import receipts from this archive?</AlertDialogTitle>
            <AlertDialogDescription>
              Only restores photos for expenses that already exist on this device and already
              point at that file — it won't create new expenses. Files already saved here are left
              untouched (never overwritten).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                const bytes = pendingImportBytes;
                setPendingImportBytes(null);
                if (!bytes) return;
                void run("import", async () => applyImport(bytes));
              }}
              disabled={busy !== null}
            >
              Import
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
