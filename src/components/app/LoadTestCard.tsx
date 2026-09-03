import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Gauge, FileDown, Trash2, Play, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { downloadReportPdf } from "@/lib/report-pdf";
import {
  benchmarkPdfDoc,
  clearLoadTestData,
  countLoadTestRows,
  estimatedRows,
  loadTestYears,
  LOAD_TEST_MIXES,
  runLoadTestBenchmark,
  seedLoadTestData,
  type BenchmarkResult,
} from "@/lib/loadtest";

type MixKey = keyof typeof LOAD_TEST_MIXES;

const ms = (n: number) => `${n < 10 ? n.toFixed(1) : n.toFixed(0)} ms`;

/**
 * Settings-only tool: seeds five years of synthetic ledger data and times the
 * reads, analytics, PDF and Excel paths at that scale. Generated rows are
 * tagged so "Remove test data" deletes exactly them.
 */
export function LoadTestCard() {
  const years = loadTestYears();
  const [rows, setRows] = useState<number | null>(null);
  const [busy, setBusy] = useState<null | "seed" | "bench" | "clear">(null);
  const [progress, setProgress] = useState({ done: 0, total: 1, label: "" });
  const [result, setResult] = useState<BenchmarkResult | null>(null);
  const [mixKey, setMixKey] = useState<MixKey>("light");
  const mix = LOAD_TEST_MIXES[mixKey].mix;

  const refresh = () => countLoadTestRows().then(setRows);
  useEffect(() => {
    refresh();
  }, []);

  const seed = async () => {
    setBusy("seed");
    setProgress({ done: 0, total: 60, label: "Starting…" });
    try {
      const { rows: written, ms: took } = await seedLoadTestData({ mix }, setProgress);
      toast.success(
        `Seeded ${written.toLocaleString("en-IN")} records in ${(took / 1000).toFixed(1)}s`,
      );
      refresh();
    } catch (e) {
      toast.error(`Seeding failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const bench = async () => {
    setBusy("bench");
    setProgress({ done: 0, total: years.length + 1, label: "Starting…" });
    try {
      const r = await runLoadTestBenchmark(years, setProgress);
      setResult(r);
      toast.success(`Benchmark done in ${(r.totalMs / 1000).toFixed(1)}s`);
    } catch (e) {
      toast.error(`Benchmark failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const clear = async () => {
    setBusy("clear");
    try {
      const removed = await clearLoadTestData();
      setResult(null);
      toast.success(`Removed ${removed.toLocaleString("en-IN")} test records`);
      refresh();
    } finally {
      setBusy(null);
    }
  };

  const pct = Math.round((progress.done / Math.max(1, progress.total)) * 100);

  return (
    <Card className="frost">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge className="h-4 w-4" /> 5-year load test
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-0">
        <p className="text-sm text-muted-foreground">
          Generates {years[0]}–{years[years.length - 1]} of synthetic bookings, snack sales, bills
          and expenses (~{estimatedRows(mix).toLocaleString("en-IN")} records at the{" "}
          {LOAD_TEST_MIXES[mixKey].label.toLowerCase()} pace) and times the year reads, report
          maths, PDF and Excel exports. Test rows are tagged and removable.
        </p>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Daily load</span>
          <Select value={mixKey} onValueChange={(v) => setMixKey(v as MixKey)} disabled={!!busy}>
            <SelectTrigger className="h-9 w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(LOAD_TEST_MIXES) as MixKey[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {LOAD_TEST_MIXES[k].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <Database className="h-4 w-4 text-muted-foreground" />
          <span className="tabular-nums">
            {rows === null ? "…" : rows.toLocaleString("en-IN")} test records in the database
          </span>
        </div>

        {busy && busy !== "clear" ? (
          <div className="space-y-1">
            <Progress value={pct} />
            <p className="text-xs text-muted-foreground">{progress.label}</p>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button onClick={seed} disabled={busy !== null} size="sm">
            <Play className="mr-1 h-4 w-4" /> Seed 5 years
          </Button>
          <Button onClick={bench} disabled={busy !== null || !rows} size="sm" variant="secondary">
            <Gauge className="mr-1 h-4 w-4" /> Run benchmark
          </Button>
          <Button
            onClick={() => result && downloadReportPdf(benchmarkPdfDoc(result))}
            disabled={busy !== null || !result}
            size="sm"
            variant="outline"
          >
            <FileDown className="mr-1 h-4 w-4" /> Results PDF
          </Button>
          <Button onClick={clear} disabled={busy !== null || !rows} size="sm" variant="destructive">
            <Trash2 className="mr-1 h-4 w-4" /> Remove test data
          </Button>
        </div>

        {result ? (
          <div className="space-y-3">
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 text-left">Year</th>
                    <th className="py-1 text-right">Rows</th>
                    <th className="py-1 text-right">Read</th>
                    <th className="py-1 text-right">Analytics</th>
                    <th className="py-1 text-right">PDF</th>
                    <th className="py-1 text-right">Excel</th>
                  </tr>
                </thead>
                <tbody>
                  {result.years.map((y) => (
                    <tr key={y.year} className="border-t border-border/60">
                      <td className="py-1 text-left">{y.year}</td>
                      <td className="py-1 text-right">{y.rows.toLocaleString("en-IN")}</td>
                      <td className="py-1 text-right">{ms(y.readMs)}</td>
                      <td className="py-1 text-right">{ms(y.analyticsMs)}</td>
                      <td className="py-1 text-right">
                        {ms(y.pdfMs)} · {y.pdfKb} KB
                      </td>
                      <td className="py-1 text-right">
                        {ms(y.excelMs)} · {y.excelKb} KB
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="rounded-md border border-border/60 p-3 text-sm">
              <p className="font-medium">All five years at once</p>
              <p className="text-muted-foreground tabular-nums">
                {result.allYears.rows.toLocaleString("en-IN")} rows · read{" "}
                {ms(result.allYears.readMs)} · analytics {ms(result.allYears.analyticsMs)} · PDF{" "}
                {ms(result.allYears.pdfMs)} ({result.allYears.pdfKb} KB) · whole run{" "}
                {(result.totalMs / 1000).toFixed(1)} s
              </p>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
