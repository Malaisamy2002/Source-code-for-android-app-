import { jsPDF } from "jspdf";
import { BUSINESS_NAME, billGrossTotal, billPaidAmount, formatDMY, money, type Bill } from "./biz";
import { isDesktop, isMobileShell, openExternal, saveFile } from "./desktop";
import { rupees } from "./money";
import type { SnackSale, TurfBooking } from "./ops";
import { paperInfo, paperWidthMm, readPrintSettings, type PrintSettings } from "./print";
import { readAppSettings, taxBreakdown } from "./settings";

/** PDF-safe money: helvetica has no rupee glyph, and receipts drop paise.
 *  Handles negative amounts (used for the "Advance paid" / "Offer" line
 *  items, which are shown as deductions) as "-Rs 500" rather than the
 *  confusing "Rs -500". */
const pmoney = (n: number, symbol = readPrintSettings().currencySymbol) => {
  const v = rupees(n);
  const sym = (symbol || "Rs").trim();
  const prefix = sym ? `${sym} ` : "";
  return (v < 0 ? "-" : "") + prefix + Math.abs(v).toLocaleString("en-IN");
};

/** jsPDF's addImage wants an explicit format string matching the data URL's
 * actual encoding — branding images may be PNG (small crisp logos/headers)
 * or JPEG (large photo-like backgrounds, kept small via lossy compression). */
const imgFormat = (dataUrl: string): "PNG" | "JPEG" =>
  dataUrl.startsWith("data:image/jpeg") ? "JPEG" : "PNG";

/** Where the printable content starts on an A4 sheet once the full-bleed
 * background artwork's own header block + divider line are cleared. Measured
 * against the bundled CSS letterhead (header art ends ~37mm in, footer band
 * starts ~271mm in on a 297mm page) with a little breathing room on each side. */
const A4_BACKGROUND_CONTENT_TOP_MM = 68;

/** `qty` is shown in its own column on the item table when present; `sub`
 * (e.g. a rate breakdown like "1 hr x Rs 1200") still prints as a smaller
 * line under the item label either way. */
export type ReceiptLine = { label: string; sub?: string; amount?: number; qty?: number | string };
export type ReceiptTotal = { label: string; value: string; strong?: boolean };

export type ReceiptDoc = {
  kind: string;
  docNo: string;
  dateText: string;
  customer?: string | null;
  phone?: string | null;
  /** Customer email, shown in the Bill To block when the record has one. */
  email?: string | null;
  lines: ReceiptLine[];
  totals: ReceiptTotal[];
  note?: string | null;
  fileName: string;
};

/** Line-height multipliers for the "compact / normal / relaxed" line-spacing
 * setting, applied on top of the paper's base line height. */
const LINE_SPACING_SCALE: Record<PrintSettings["lineSpacing"], number> = {
  compact: 0.85,
  normal: 1,
  relaxed: 1.2,
};

/** Text darkness for the "light / normal / dark" density setting. Lower is
 * darker (0 = pure black); mirrors a thermal printer's darkness dial. */
const DENSITY_SHADE: Record<PrintSettings["density"], number> = {
  light: 90,
  normal: 30,
  dark: 0,
};

/** Builds a receipt PDF sized for the printer selected in Settings. */
export function buildReceiptPdf(doc: ReceiptDoc, s: PrintSettings = readPrintSettings()): jsPDF {
  const paper = paperInfo(s.paper);
  const width = paperWidthMm(s);
  const wide = paper.kind === "sheet";
  const scale = s.fontScale || 1;
  const spacing = LINE_SPACING_SCALE[s.lineSpacing] || 1;
  const shade = DENSITY_SHADE[s.density] ?? 30;
  const lineH = (wide ? 6 : 5) * scale * spacing;

  // Full-bleed A4 background takes priority on A4 sheets — it carries the
  // header AND footer artwork, so nothing else (banner/logo/text header) is
  // drawn on top of it. Roll header artwork plays the same role for thermal
  // rolls, replacing the small square logo + text header. Plain banner stays
  // available for A5/letter sheets that don't have a matching full-page asset.
  const showBranding = s.showLogo;
  const showFullBackground = showBranding && wide && paper.id === "a4" && !!s.background;
  const showRollHeader = showBranding && !wide && !!s.rollHeader;
  const showBanner = showBranding && wide && !!s.banner && !showFullBackground;
  const showLogo =
    showBranding && !!s.logo && !showBanner && !showFullBackground && !showRollHeader;
  const extraBrandH = !wide && showLogo ? 18 : 0;

  // 0 = automatic: 12 mm on sheets, 5 mm on rolls. Clamped so a large custom
  // margin can never eat the whole printable width. The designed A4 letterhead
  // reads better with a slightly wider gutter than the plain-text header.
  const marginX =
    s.marginMm > 0 ? Math.min(s.marginMm, width / 3) : wide ? (showFullBackground ? 20 : 12) : 5;

  // The roll-header artwork is scaled to the printable width, same inset as
  // everything else on the receipt, so its drawn height depends on the
  // paper's own width and has to be known before the page height is fixed.
  const rollHeaderDrawW = width - marginX * 2;
  const rollHeaderH =
    showRollHeader && s.rollHeader
      ? rollHeaderDrawW * (s.rollHeader.height / s.rollHeader.width)
      : 0;
  // Extra blank feed at the very bottom so a thermal auto-cutter doesn't
  // slice through the last printed line. Sheets ignore this — they're cut
  // to size already.
  const cutFeedMm = wide ? 0 : Math.max(0, Math.min(40, s.cutFeedMm || 0));

  // The shop address/phone lines are optional header rows added after the
  // original height baseline was written, so their space has to be added or a
  // long address overflows the generated roll page. The address wraps to the
  // printable width, so estimate its line count from the average helvetica
  // glyph width (~0.5 em) at the header font size.
  const headerFontMm = (wide ? 9 : 7) * scale * 0.3528;
  const charsPerLine = Math.max(8, Math.floor((width - marginX * 2) / (headerFontMm * 0.5)));
  const address = s.shopAddress.trim();
  // Address/phone text lines are baked into the roll-header artwork when
  // it's shown, so they aren't drawn (or budgeted for) separately.
  const addressLines =
    !showRollHeader && address
      ? address
          .split(/\r?\n/)
          .reduce((n, part) => n + Math.max(1, Math.ceil(part.length / charsPerLine)), 0)
      : 0;
  const phoneLines = !showRollHeader && s.shopPhone.trim() ? 1 : 0;
  // +1 line of slack, since the estimate is character-count based.
  const headerExtraH = (addressLines + phoneLines) * lineH + (addressLines ? lineH : 0);

  // The "95" baseline below was calibrated for the plain-text header (start
  // margin + shop name + tagline + rule + doc-info block + item header row +
  // closing rules + footer line, with some safety slack for longer text).
  // The roll-header artwork replaces all of that text, and already includes
  // its own top/bottom padding, so reusing the full text baseline on top of
  // the image's own height would double-count and print a lot of wasted
  // blank paper below the receipt. A much smaller baseline (just the doc-info
  // block, item header, closing rules and footer line, plus a little slack)
  // is enough once the header artwork's own height is added separately.
  const height = wide
    ? paper.heightMm!
    : (showRollHeader ? 36 : 112) +
      doc.lines.length * lineH * 2 +
      doc.totals.length * lineH +
      extraBrandH +
      (showRollHeader ? rollHeaderH + 2 : 0) +
      headerExtraH +
      cutFeedMm;

  const pdf = new jsPDF({ unit: "mm", format: [width, height] });
  let y = wide ? 16 : 10;

  // Body font sizes (doc-info block, item rows, totals) scale with the paper
  // kind the same way the header text does, so a sheet printout doesn't end
  // up with a big title sitting over cramped, thermal-sized body copy. Ratio
  // matches the header/footer scale-up (roughly 1.25x sheet vs roll).
  const bodyFont = wide ? 10 : 8;
  const noteFont = wide ? 8 : 7;

  const center = (text: string, size: number, bold = false) => {
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setFontSize(size * scale);
    pdf.text(text, width / 2, y, { align: "center" });
    y += lineH;
  };
  // Centered title that wraps to multiple lines (and shrinks a little if it
  // still doesn't fit on one) instead of running off the page edges — used
  // for the shop name, which varies a lot in length.
  const centerFit = (text: string, size: number, bold = true) => {
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    const maxW = width - marginX * 2;
    let fitSize = size;
    pdf.setFontSize(fitSize * scale);
    while (fitSize > size * 0.7 && pdf.getTextWidth(text) > maxW) {
      fitSize -= 0.5;
      pdf.setFontSize(fitSize * scale);
    }
    const lines = pdf.splitTextToSize(text, maxW) as string[];
    for (const line of lines) center(line, fitSize, bold);
  };
  const left = (text: string, size = bodyFont, bold = false) => {
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setFontSize(size * scale);
    pdf.text(text, marginX, y);
    y += lineH - 0.6;
  };
  const row = (l: string, r: string, bold = false) => {
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setFontSize(bodyFont * scale);
    pdf.text(l, marginX, y);
    pdf.text(r, width - marginX, y, { align: "right" });
    y += lineH - 0.6;
  };
  const rule = () => {
    pdf.setDrawColor(120);
    pdf.line(marginX, y - 3, width - marginX, y - 3);
    y += 1.5;
  };
  // Dashed divider — used around the shop header block, matching the
  // "- - - -" break in the reference receipt template.
  const dashedRule = () => {
    pdf.setDrawColor(120);
    pdf.setLineDashPattern([wide ? 1.5 : 1, wide ? 1.2 : 0.8], 0);
    pdf.line(marginX, y - 3, width - marginX, y - 3);
    pdf.setLineDashPattern([], 0);
    y += 1.5;
  };
  // "Label : value" row with the value column starting at a fixed x, so the
  // colons line up top-to-bottom regardless of label length (helvetica isn't
  // monospaced, so padding label strings with spaces wouldn't align).
  const labelColW = wide ? 24 : 17;
  const field = (label: string, value: string, size = bodyFont, bold = false) => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(size * scale);
    pdf.text(label, marginX, y);
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.text(`: ${value}`, marginX + labelColW, y);
    y += lineH - 0.6;
  };
  // Item table columns: "#" | item (+ optional smaller sub-line) | qty | amount.
  // qtyColW reserves enough room from the right edge for the amount column's
  // own text (it right-aligns flush to the edge and grows leftward), so the
  // qty column's right edge has to sit further in than that — otherwise
  // "QTY" and "AMOUNT" (or a wide amount value) print on top of each other.
  const noColW = wide ? 9 : 7;
  const qtyColW = wide ? 26 : 19;
  const itemRow = (no: string, label: string, qty: string, amount: string, bold = false) => {
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setFontSize(bodyFont * scale);
    pdf.text(no, marginX, y);
    pdf.text(label, marginX + noColW, y);
    pdf.text(qty, width - marginX - qtyColW, y, { align: "right" });
    pdf.text(amount, width - marginX, y, { align: "right" });
    y += lineH - 0.6;
  };

  if (showFullBackground && s.background) {
    // Full-bleed: covers the entire page, corner to corner. The artwork
    // already carries the logo, business name, tagline, address, phone and
    // footer band, so everything below skips straight to the blank zone the
    // letterhead was designed to leave for the bill's own content.
    pdf.addImage(s.background.dataUrl, imgFormat(s.background.dataUrl), 0, 0, width, height);
    y = A4_BACKGROUND_CONTENT_TOP_MM;
  } else if (showBanner && s.banner) {
    const maxW = width - marginX * 2;
    const maxH = 28;
    let drawW = maxW;
    let drawH = drawW * (s.banner.height / s.banner.width);
    if (drawH > maxH) {
      drawH = maxH;
      drawW = drawH * (s.banner.width / s.banner.height);
    }
    pdf.addImage(
      s.banner.dataUrl,
      imgFormat(s.banner.dataUrl),
      (width - drawW) / 2,
      y,
      drawW,
      drawH,
    );
    y += drawH + 3;
  } else if (showLogo && s.logo) {
    const drawH = wide ? 20 : 14;
    const drawW = drawH * (s.logo.width / s.logo.height);
    pdf.addImage(s.logo.dataUrl, imgFormat(s.logo.dataUrl), (width - drawW) / 2, y, drawW, drawH);
    // Logo artwork (crest + wings) commonly has little internal bottom
    // padding, so give the title below it real breathing room rather than
    // the couple of mm used elsewhere.
    y += drawH + (wide ? 6 : 4);
  } else if (showRollHeader && s.rollHeader) {
    // Same left/right inset as the rest of the receipt, not full-bleed —
    // the artwork already has its own internal padding, so this keeps it
    // flush with the item table and totals below it.
    const drawY = 3;
    pdf.addImage(
      s.rollHeader.dataUrl,
      imgFormat(s.rollHeader.dataUrl),
      marginX,
      drawY,
      rollHeaderDrawW,
      rollHeaderH,
    );
    y = drawY + rollHeaderH + 2;
  }

  // The banner/full-page background/roll-header artwork already carries the
  // business name, tagline, address and phone visually — skip the redundant
  // text so the header doesn't repeat itself. GSTIN/FSSAI are dynamic (set
  // in App Settings, not baked into any artwork) so they always still print
  // when set.
  pdf.setTextColor(21, 105, 60);
  if (!showBanner && !showFullBackground && !showRollHeader)
    centerFit((s.shopName || BUSINESS_NAME).toUpperCase(), wide ? 16 : 12, true);
  pdf.setTextColor(shade);
  if (!showFullBackground && !showRollHeader) {
    if (s.headerLine) center(s.headerLine, wide ? 9 : 7);
    if (s.shopAddress.trim()) {
      // Wrap the address to the printable width so long addresses don't run
      // off the edge of a narrow thermal roll.
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize((wide ? 9 : 7) * scale);
      for (const line of pdf.splitTextToSize(
        s.shopAddress.trim(),
        width - marginX * 2,
      ) as string[]) {
        center(line, wide ? 9 : 7);
      }
    }
    if (s.shopPhone.trim()) center(`Ph: ${s.shopPhone.trim()}`, wide ? 9 : 7);
    if (s.shopEmail.trim()) center(s.shopEmail.trim(), wide ? 9 : 7);
  }
  const app = readAppSettings();
  // Each registration line prints only when its own toggle is on, independent
  // of the GST-on-bills toggle — a business can hold either registration
  // without charging GST on a particular sale.
  if (app.gstinEnabled && app.gstin) center(`GSTIN: ${app.gstin}`, wide ? 8 : 6);
  if (app.fssaiEnabled && app.fssaiNumber) center(`FSSAI: ${app.fssaiNumber}`, wide ? 8 : 6);
  y += 1;
  // The roll-header/full-background artwork already bakes in a dashed rule
  // and the "BILL"-style title, so only draw them here for the plain-text
  // header and banner cases, which don't carry a title of their own.
  if (!showFullBackground && !showRollHeader) {
    dashedRule();
    y += 1;
    center(doc.kind.toUpperCase(), wide ? 14 : 11, true);
    rule();
  } else {
    rule();
  }
  y += 0.5;
  if (doc.customer) field("Bill To", doc.customer);
  if (doc.phone && s.showPhone) field("Phone", doc.phone);
  if (doc.email) field("Email", doc.email);
  field("Date", doc.dateText);
  field(`${doc.kind} No.`, doc.docNo);
  y += 1;
  rule();
  itemRow("#", "ITEM", "QTY", "AMOUNT", true);
  y += 1;
  doc.lines.forEach((it, i) => {
    itemRow(
      String(i + 1),
      it.label,
      it.qty !== undefined ? String(it.qty) : "",
      pmoney(it.amount ?? 0),
    );
    if (it.sub) left(`   ${it.sub}`, wide ? 9 : 7, false);
  });
  y += 1;
  rule();
  for (const t of doc.totals) row(t.label, t.value, t.strong);
  if (doc.note) {
    y += 1;
    left(`Note: ${doc.note}`, noteFont);
  }
  y += 2;
  // The full-page background's own footer band (address/phone/location,
  // baked into the artwork ~271mm down the A4 page) would collide with a
  // second footer line drawn in the default text color, so it's skipped
  // there; the roll-header case has plain paper below it and is unaffected.
  if (!showFullBackground) {
    rule();
    if (s.footerLine) center(s.footerLine, wide ? 10 : 8);
  }
  if (cutFeedMm) y += cutFeedMm;

  return pdf;
}

/**
 * Saves the receipt PDF. In the browser/PWA this is jsPDF's own Blob-download
 * `save()`. In the desktop shell it opens a native Save dialog and writes the
 * PDF bytes via `tauri-plugin-fs` instead — see backup.ts's `downloadBackup`
 * for the same pattern. Kept async so both branches share one call site;
 * existing unawaited callers (`downloadBillPdf`, print/share fallbacks below)
 * keep working unchanged.
 */
export async function downloadReceipt(
  doc: ReceiptDoc,
  s: PrintSettings = readPrintSettings(),
): Promise<void> {
  const pdf = buildReceiptPdf(doc, s);
  if (isDesktop()) {
    const bytes = pdf.output("arraybuffer") as ArrayBuffer;
    await saveFile(new Uint8Array(bytes), `${doc.fileName}.pdf`, "application/pdf", {
      name: "PDF",
      extensions: ["pdf"],
    });
    return;
  }
  pdf.save(`${doc.fileName}.pdf`);
}

/**
 * Opens the print dialog with the receipt, honouring the copies setting.
 *
 * Desktop (Windows/macOS/Linux, WebView2/WebKit): `contentWindow.print()` on
 * the hidden iframe below opens the same native OS print dialog it would in
 * any browser, listing whatever printer the OS has a driver for. STILL
 * NEEDS VERIFICATION ON REAL HARDWARE — see the "still open" section of the
 * port report; this file was not tested against a physical thermal printer.
 *
 * Mobile (Android/iOS): Android's system WebView does not implement
 * `window.print()` at all — calling it doesn't throw, it just does nothing,
 * which is why tapping Print looked like a dead button. There's also no
 * native "open in default app" for local files on mobile (`openPath` from
 * `tauri-plugin-opener` only handles URLs there). So on mobile we hand the
 * PDF to the OS share sheet instead (`navigator.share`) — the person picks
 * a PDF viewer or a print/share target from there, and most Android PDF
 * viewers (Drive, Adobe, etc.) have their own Print button that does go
 * through Android's native print framework. If the share sheet itself is
 * unavailable, we fall back to just saving the file so it's not a dead end.
 */
export async function printReceipt(doc: ReceiptDoc, s: PrintSettings = readPrintSettings()) {
  const url = buildReceiptPdf(doc, s).output("bloburl") as unknown as string;

  // "Preview before print": open the PDF in a normal tab so the person can
  // check the layout and pick their printer from the browser's own dialog,
  // instead of jumping straight into a hidden-iframe silent print.
  if (s.previewBeforePrint && !isMobileShell()) {
    window.open(url, "_blank");
    return;
  }

  if (isMobileShell()) {
    const pdf = buildReceiptPdf(doc, s);
    const blob = pdf.output("blob");
    const file = new File([blob], `${doc.fileName}.pdf`, { type: "application/pdf" });
    const nav = navigator as Navigator & {
      canShare?: (data: ShareData) => boolean;
      share?: (data: ShareData) => Promise<void>;
    };
    if (nav.canShare?.({ files: [file] }) && nav.share) {
      try {
        await nav.share({ files: [file], title: `${BUSINESS_NAME} ${doc.docNo}` });
        return;
      } catch {
        // person cancelled the share sheet — fall through to saving instead
      }
    }
    await downloadReceipt(doc, s);
    return;
  }

  const copies = Math.max(1, Math.min(5, Math.round(s.copies || 1)));
  for (let i = 0; i < copies; i++) {
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    frame.src = url;
    frame.onload = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } catch {
        window.open(url, "_blank");
      }
    };
    document.body.appendChild(frame);
  }
}

export async function shareReceipt(
  doc: ReceiptDoc,
  fallbackUrl: string,
  s: PrintSettings = readPrintSettings(),
) {
  const blob = buildReceiptPdf(doc, s).output("blob");
  const file = new File([blob], `${doc.fileName}.pdf`, { type: "application/pdf" });
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean;
    share?: (data: ShareData) => Promise<void>;
  };
  // Desktop (Windows/macOS/Linux, WebView2/WebKit): the Web Share API isn't
  // implemented there at all, so `nav.canShare`/`nav.share` are undefined
  // and the branch below would never run anyway. More importantly, the
  // fallback's `window.open()` can't be relied on inside a Tauri webview:
  // it either does nothing or tries to open a second webview window pointed
  // at wa.me, which is not what "share on WhatsApp" should do on a desktop.
  // So on desktop we skip the Web Share attempt entirely, save the PDF via
  // the native dialog, and hand the WhatsApp URL to the OS default browser
  // through the opener plugin. Android/iOS are excluded from this branch —
  // `isDesktop()` is true there too (same Tauri global), but their system
  // WebView does support `navigator.share`, which is the normal way to
  // hand a file to another app on mobile.
  if (isDesktop() && !isMobileShell()) {
    await downloadReceipt(doc, s);
    await openExternal(fallbackUrl);
    return "fallback";
  }
  if (nav.canShare?.({ files: [file] }) && nav.share) {
    try {
      await nav.share({ files: [file], title: `${BUSINESS_NAME} ${doc.docNo}` });
      return "shared";
    } catch {
      return "cancelled";
    }
  }
  downloadReceipt(doc, s);
  await openExternal(fallbackUrl);
  return "fallback";
}

/* ---------- document builders ---------- */

export function billReceipt(bill: Bill): ReceiptDoc {
  const app = readAppSettings();
  const { taxAmount, lines: taxLines } = taxBreakdown(bill.total, app);
  const grandTotal = billGrossTotal(bill);
  const paid = billPaidAmount(bill);
  const due = Math.max(0, grandTotal - paid);
  return {
    kind: "Bill",
    docNo: bill.invoice_no,
    dateText: formatDMY(bill.bill_date),
    customer: bill.customer_name,
    phone: bill.customer_phone,
    lines: [
      ...bill.items.map((it) => ({
        label: it.item || "Item",
        sub: `${it.qty} ${it.unit ?? "kg"} x ${pmoney(it.rate)}`,
        qty: `${it.qty} ${it.unit ?? "kg"}`,
        amount: it.total,
      })),
      // Itemized alongside the products, in addition to the totals block
      // below, so offer/advance show as line entries on the printed bill.
      ...(bill.discount ? [{ label: "Offer / Discount", amount: -bill.discount }] : []),
      ...(paid ? [{ label: "Advance paid", amount: -paid }] : []),
    ],
    totals: [
      { label: "Subtotal", value: pmoney(bill.subtotal) },
      ...(bill.discount ? [{ label: "Discount", value: "-" + pmoney(bill.discount) }] : []),
      // Every switched-on tax (GST plus any custom tax) is added on top of
      // the bill here — a tax that's off contributes nothing and doesn't
      // appear at all; switching one on adds its amount to the grand total.
      // GST keeps its conventional CGST/SGST split; each custom tax prints
      // as its own named line.
      ...(taxAmount > 0
        ? [
            { label: "Taxable Amount", value: pmoney(bill.total) },
            ...taxLines.map((l) => ({ label: l.label, value: pmoney(l.value) })),
          ]
        : []),
      { label: "GRAND TOTAL", value: pmoney(grandTotal), strong: true },
      { label: "Paid", value: pmoney(paid) },
      ...(due > 0 ? [{ label: "Balance due", value: pmoney(due) }] : []),
      { label: "Status", value: bill.status.toUpperCase() },
    ],
    fileName: `${bill.invoice_no}-${bill.customer_name.replace(/\s+/g, "-")}`,
  };
}

/** "1 hr 30 min" from fractional hours. */
const durationText = (hours: number) => {
  const mins = Math.round((Number(hours) || 0) * 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0 && m > 0) return `${h} hr ${m} min`;
  if (h > 0) return `${h} hr`;
  return `${m} min`;
};

export function bookingReceipt(b: TurfBooking): ReceiptDoc {
  const due = Math.max(0, b.total_amount - b.advance_paid);
  const courts = b.courts ?? 1;
  const snacks = b.snacks ?? [];
  const snacksTotal = b.snacks_total ?? 0;
  const turfAmount = b.turf_amount || b.hours * b.rate_per_hour * courts;
  const timeText = b.start_time && b.end_time ? ` ${b.start_time}-${b.end_time}` : "";
  return {
    kind: "Booking",
    docNo: b.booking_no,
    dateText: formatDMY(b.booking_date),
    customer: b.customer_name,
    phone: b.phone,
    lines: [
      {
        label: `${b.slot_name} slot${timeText}`,
        sub: durationText(b.hours),
        qty: `${courts} court${courts > 1 ? "s" : ""}`,
        amount: turfAmount,
      },
      ...snacks.map((it) => ({
        label: it.item_name,
        sub: `x ${pmoney(it.unit_price)}`,
        qty: it.qty,
        amount: it.amount,
      })),
      // Offer/discount and advance paid are itemized here too (not just in
      // the totals block below) so they're visible as line-by-line entries
      // on the printed receipt, matching how turf/snack items are shown.
      ...(b.discount ? [{ label: "Offer / Discount", amount: -b.discount }] : []),
      ...(b.advance_paid ? [{ label: "Advance paid", amount: -b.advance_paid }] : []),
    ],
    totals: [
      { label: "Turf", value: pmoney(turfAmount) },
      ...(snacksTotal ? [{ label: "Snacks", value: pmoney(snacksTotal) }] : []),
      ...(b.discount ? [{ label: "Discount", value: "-" + pmoney(b.discount) }] : []),
      { label: "GRAND TOTAL", value: pmoney(b.total_amount), strong: true },
      { label: "Paid", value: pmoney(b.advance_paid) },
      ...(due ? [{ label: "Balance due", value: pmoney(due) }] : []),
      { label: "Mode", value: b.payment_mode },
      { label: "Status", value: b.status },
    ],
    note: b.notes,
    fileName: `${b.booking_no}-${b.customer_name.replace(/\s+/g, "-")}`,
  };
}

export function snackSaleReceipt(s: SnackSale): ReceiptDoc {
  return {
    kind: "Bill",
    docNo: s.bill_no,
    dateText: formatDMY(s.sale_date),
    customer: s.customer_name,
    lines: s.items.map((it) => ({
      label: it.item_name,
      sub: `x ${pmoney(it.unit_price)}`,
      qty: it.qty,
      amount: it.amount,
    })),
    totals: [
      { label: "GRAND TOTAL", value: pmoney(s.total), strong: true },
      { label: "Mode", value: s.payment_mode },
      ...(s.booking_no ? [{ label: "Linked booking", value: s.booking_no }] : []),
    ],
    note: s.notes,
    fileName: `${s.bill_no}-snacks`,
  };
}

/** Plain-text version, used for WhatsApp / copy actions. */
export function receiptText(doc: ReceiptDoc) {
  return [
    readPrintSettings().shopName.trim() || BUSINESS_NAME,

    `${doc.kind} ${doc.docNo} · ${doc.dateText}`,
    doc.customer ? `Customer: ${doc.customer}` : "",
    "",
    ...doc.lines.map(
      (l) =>
        `${l.label}${l.sub ? ` — ${l.sub}` : ""}${l.amount !== undefined ? ` = ${money(l.amount)}` : ""}`,
    ),
    "",
    ...doc.totals.map((t) => `${t.label}: ${t.value}`),
    doc.note ? `Note: ${doc.note}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/* ---------- backwards-compatible bill helpers ---------- */

export const buildBillPdf = (bill: Bill) => buildReceiptPdf(billReceipt(bill));
export const downloadBillPdf = (bill: Bill) => downloadReceipt(billReceipt(bill));
export const printBillPdf = (bill: Bill) => printReceipt(billReceipt(bill));
export const shareBillPdf = (bill: Bill, fallbackUrl: string) =>
  shareReceipt(billReceipt(bill), fallbackUrl);
