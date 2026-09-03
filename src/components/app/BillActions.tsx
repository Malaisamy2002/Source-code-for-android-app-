import { Copy, Download, Printer, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { billText, copyText, whatsappUrl, type Bill } from "@/lib/biz";
import { downloadBillPdf, printBillPdf, shareBillPdf } from "@/lib/receipt";

export function BillActions({ bill }: { bill: Bill }) {
  return (
    <div className="grid grid-cols-4 gap-2">
      <Button variant="outline" className="lift h-11" onClick={() => downloadBillPdf(bill)}>
        <Download className="size-4" /> PDF
      </Button>
      <Button
        variant="outline"
        className="lift h-11"
        aria-label="Print bill"
        title="Print"
        onClick={() => printBillPdf(bill)}
      >
        <Printer className="size-4" /> Print
      </Button>
      <Button
        className="lift h-11"
        aria-label="Share on WhatsApp"
        title="Share on WhatsApp"
        onClick={async () => {
          const res = await shareBillPdf(bill, whatsappUrl(billText(bill), bill.customer_phone));
          if (res === "fallback") toast.info("PDF downloaded — attach it in WhatsApp");
        }}
      >
        <Share2 className="size-4" /> WhatsApp
      </Button>
      <Button
        variant="outline"
        className="lift h-11"
        aria-label="Copy bill"
        title="Copy"
        onClick={async () => {
          const ok = await copyText(billText(bill));
          if (ok) toast.success("Bill copied");
          else toast.error("Copy failed");
        }}
      >
        <Copy className="size-4" />
      </Button>
    </div>
  );
}
