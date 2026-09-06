import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Download, Upload, Github, CloudUpload, CloudDownload, Save, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { shortDate } from "@/lib/biz";
import { useQueryClient } from "@tanstack/react-query";
import {
  backupSummary,
  buildBackup,
  downloadBackup,
  parseBackup,
  pickBackupFile,
  restoreBackup,
  type BackupFile,
} from "@/lib/backup";
import { isDesktop } from "@/lib/desktop";
import {
  DEFAULT_GITHUB_CONFIG,
  githubPull,
  githubPush,
  isGithubConfigured,
  readGithubConfig,
  writeGithubConfig,
} from "@/lib/github";
import {
  useAppSettings,
  writeAppSettings,
  readAppSettings,
  type BackupReminder,
} from "@/lib/settings";

export function BackupCard() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [merge, setMerge] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<BackupFile | null>(null);
  const { settings: appSettings, save: saveAppSettings } = useAppSettings();
  const [cfg, setCfg] = useState(DEFAULT_GITHUB_CONFIG);
  const [editing, setEditing] = useState(true);

  // Saved GitHub details live in this browser only; load them after mount so
  // server and client render the same markup.
  useEffect(() => {
    void (async () => {
      const saved = await readGithubConfig();
      setCfg(saved);
      setEditing(!isGithubConfigured(saved));
    })();
  }, []);

  const configured = isGithubConfigured(cfg);

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

  const applyBackup = async (text: string) => {
    const backup = parseBackup(text);
    if (!merge) {
      // Replace mode wipes existing data — confirm before doing it.
      setPendingRestore(backup);
      return;
    }
    const count = await restoreBackup(backup, "merge");
    await qc.invalidateQueries();
    toast.success(`Restored ${count} records`, { description: backupSummary(backup) });
  };

  const confirmRestore = async () => {
    if (!pendingRestore) return;
    const backup = pendingRestore;
    setPendingRestore(null);
    setBusy("restore");
    try {
      const count = await restoreBackup(backup, "replace");
      await qc.invalidateQueries();
      toast.success(`Restored ${count} records`, { description: backupSummary(backup) });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const saveCfg = (next: typeof cfg) => {
    setCfg(next);
    // Persist on every change so typed details survive reloads/navigation.
    void writeGithubConfig(next);
  };

  return (
    <section className="space-y-3">
      <Card className="frost">
        <CardHeader>
          <CardTitle className="text-base">Single-file backup</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Exports every customer, bill, expense, booking and snack sale into one
            <code className="mx-1 rounded bg-muted px-1">.db</code> file you can keep or move to
            another device.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy !== null}
              onClick={() =>
                run("export", async () => {
                  const backup = await buildBackup();
                  const savedTo = await downloadBackup(backup);
                  if (savedTo === null) return; // user cancelled the save dialog
                  writeAppSettings({
                    ...readAppSettings(),
                    lastBackupAt: new Date().toISOString(),
                  });
                  toast.success(isDesktop() ? "Backup saved" : "Backup file downloaded", {
                    description: backupSummary(backup),
                  });
                })
              }
            >
              <Download className="mr-1 h-4 w-4" /> Export .db file
            </Button>
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() => {
                if (isDesktop()) {
                  void run("import", async () => {
                    const text = await pickBackupFile();
                    if (text === null) return; // user cancelled the open dialog
                    await applyBackup(text);
                  });
                  return;
                }
                fileRef.current?.click();
              }}
            >
              <Upload className="mr-1 h-4 w-4" /> Import .db file
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".db,.json,application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                void run("import", async () => applyBackup(await file.text()));
              }}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={merge} onCheckedChange={setMerge} />
            Merge with existing data (off = replace everything)
          </label>

          <div className="frost-well flex flex-wrap items-center justify-between gap-2 rounded-xl p-3">
            <div className="text-sm">
              <p className="micro-label">Backup reminders</p>
              <span className="block text-xs text-muted-foreground">
                {appSettings.lastBackupAt
                  ? `Last backup: ${shortDate(appSettings.lastBackupAt)}`
                  : "No backup downloaded yet on this device."}
              </span>
            </div>
            <div className="flex gap-2">
              {(["off", "daily", "weekly"] as BackupReminder[]).map((opt) => (
                <Button
                  key={opt}
                  size="sm"
                  variant={appSettings.backupReminder === opt ? "default" : "outline"}
                  onClick={() => saveAppSettings({ ...appSettings, backupReminder: opt })}
                >
                  {opt === "off" ? "Off" : opt === "daily" ? "Daily" : "Weekly"}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="frost">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Github className="h-4 w-4" /> GitHub backup
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {editing ? (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">Repo owner</Label>
                  <Input
                    value={cfg.owner}
                    onChange={(e) => saveCfg({ ...cfg, owner: e.target.value.trim() })}
                    placeholder="your-username"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Repository</Label>
                  <Input
                    value={cfg.repo}
                    onChange={(e) => saveCfg({ ...cfg, repo: e.target.value.trim() })}
                    placeholder="turf-backups"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Branch</Label>
                  <Input
                    value={cfg.branch}
                    onChange={(e) => saveCfg({ ...cfg, branch: e.target.value.trim() })}
                    placeholder="main"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">File path</Label>
                  <Input
                    value={cfg.path}
                    onChange={(e) => saveCfg({ ...cfg, path: e.target.value.trim() })}
                    placeholder="backups/turf-ledger.db"
                  />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <Label className="text-xs">
                    Personal access token (repo contents: read &amp; write)
                  </Label>
                  <Input
                    type="password"
                    value={cfg.token}
                    onChange={(e) => saveCfg({ ...cfg, token: e.target.value.trim() })}
                    placeholder="ghp_..."
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={!isGithubConfigured(cfg)}
                  onClick={() =>
                    run("save-github", async () => {
                      await writeGithubConfig(cfg);
                      setEditing(false);
                      toast.success(
                        isDesktop()
                          ? "GitHub details saved — token stored in Windows Credential Manager"
                          : "GitHub details saved on this device",
                      );
                    })
                  }
                >
                  <Save className="mr-1 h-4 w-4" /> Save details
                </Button>
                {configured && (
                  <Button variant="ghost" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                The token stays on this device only. Use a fine-grained token limited to this one
                repository, and keep the repo private.
              </p>
            </>
          ) : (
            <>
              <div className="frost-well flex items-start justify-between gap-3 rounded-xl p-3">
                <div className="min-w-0 text-sm">
                  <p className="truncate font-medium">
                    {cfg.owner}/{cfg.repo}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {cfg.branch || "main"} &middot; {cfg.path}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                  <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                </Button>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy !== null}
                  onClick={() =>
                    run("push", async () => {
                      const sha = await githubPush(cfg, await buildBackup());
                      toast.success(`Pushed to GitHub (${sha})`);
                    })
                  }
                >
                  <CloudUpload className="mr-1 h-4 w-4" /> Push backup
                </Button>
                <Button
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => run("pull", async () => applyBackup(await githubPull(cfg)))}
                >
                  <CloudDownload className="mr-1 h-4 w-4" /> Pull &amp; restore
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={pendingRestore != null}
        onOpenChange={(o) => (o ? undefined : setPendingRestore(null))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace all data with this backup?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRestore
                ? `This deletes everything currently on this device and replaces it with ${backupSummary(pendingRestore)}. This can't be undone. Turn on "Merge with existing data" instead if you want to add these records without deleting anything.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmRestore();
              }}
              disabled={busy !== null}
            >
              Replace everything
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
