import { useEffect, useState } from "react";
import { DEFAULT_BACKGROUND, DEFAULT_LOGO, DEFAULT_ROLL_HEADER } from "./branding-assets";

/**
 * Paper/printer catalogue. "roll" papers are thermal receipt rolls whose
 * page height grows with the content (no fixed page size); "sheet" papers
 * are regular cut-sheet printers (inkjet/laser) with a fixed page height.
 * "custom" is a roll paper whose width comes from `PrintSettings.customWidthMm`
 * instead of `widthMm` here, for POS printers that don't match a common size.
 */
export const PAPER_TYPES = [
  { id: "50mm", label: 'Thermal 2" (50 mm)', widthMm: 50, kind: "roll" },
  { id: "58mm", label: "Thermal 58 mm", widthMm: 58, kind: "roll" },
  { id: "76mm", label: 'Thermal 3" (76 mm)', widthMm: 76, kind: "roll" },
  { id: "80mm", label: "Thermal 80 mm (default)", widthMm: 80, kind: "roll" },
  { id: "custom", label: "Custom thermal width…", widthMm: 80, kind: "roll" },
  { id: "a5", label: "A5 sheet", widthMm: 148, heightMm: 210, kind: "sheet" },
  { id: "a4", label: "A4 sheet", widthMm: 210, heightMm: 297, kind: "sheet" },
  { id: "letter", label: "Letter sheet (US)", widthMm: 215.9, heightMm: 279.4, kind: "sheet" },
] as const;

export type PaperId = (typeof PAPER_TYPES)[number]["id"];
export type PaperKind = (typeof PAPER_TYPES)[number]["kind"];

export function paperInfo(paper: PaperId): (typeof PAPER_TYPES)[number] & { heightMm?: number } {
  return PAPER_TYPES.find((p) => p.id === paper) ?? PAPER_TYPES.find((p) => p.id === "80mm")!;
}

export function isRollPaper(paper: PaperId) {
  return paperInfo(paper).kind === "roll";
}

/** Print darkness — mirrors the "density"/"darkness" dial on real thermal
 * printers, and gently lightens/darkens sheet printers too. */
export const DENSITY_OPTIONS = [
  { id: "light", label: "Light (saves ribbon/ink)" },
  { id: "normal", label: "Normal" },
  { id: "dark", label: "Dark / bold" },
] as const;
export type DensityId = (typeof DENSITY_OPTIONS)[number]["id"];

/** Space between printed lines. */
export const LINE_SPACING_OPTIONS = [
  { id: "compact", label: "Compact" },
  { id: "normal", label: "Normal" },
  { id: "relaxed", label: "Relaxed" },
] as const;
export type LineSpacingId = (typeof LINE_SPACING_OPTIONS)[number]["id"];

/** Ready-made setting bundles for common printer hardware, so the person
 * doesn't have to work out width/density/spacing by hand. Applied on top of
 * (merged with) whatever is already saved. */
export const PRINTER_PRESETS: { id: string; label: string; settings: Partial<PrintSettings> }[] = [
  {
    id: "generic-58",
    label: "Generic thermal — 58 mm",
    settings: { paper: "58mm", density: "normal", lineSpacing: "compact", cutFeedMm: 6 },
  },
  {
    id: "generic-80",
    label: "Generic thermal — 80 mm",
    settings: { paper: "80mm", density: "normal", lineSpacing: "normal", cutFeedMm: 8 },
  },
  {
    id: "escpos-80",
    label: "ESC/POS auto-cutter (Epson/Star, 80 mm)",
    settings: { paper: "80mm", density: "dark", lineSpacing: "normal", cutFeedMm: 16 },
  },
  {
    id: "mobile-58",
    label: "Portable Bluetooth printer — 58 mm",
    settings: { paper: "58mm", density: "dark", lineSpacing: "compact", cutFeedMm: 4 },
  },
  {
    id: "a5-sheet",
    label: "A5 sheet (inkjet/laser)",
    settings: { paper: "a5", density: "normal", lineSpacing: "normal", cutFeedMm: 0 },
  },
  {
    id: "a4-sheet",
    label: "A4 sheet (inkjet/laser)",
    settings: { paper: "a4", density: "normal", lineSpacing: "normal", cutFeedMm: 0 },
  },
  {
    id: "letter-sheet",
    label: "Letter sheet (US office printer)",
    settings: { paper: "letter", density: "normal", lineSpacing: "normal", cutFeedMm: 0 },
  },
];

export type PrintSettings = {
  paper: PaperId;
  /** Roll width in mm, used only when paper === "custom". */
  customWidthMm: number;
  fontScale: number;
  copies: number;
  shopName: string;
  /** Shop address printed under the shop name (blank = not printed). */
  shopAddress: string;
  /** Shop contact number printed in the receipt header (blank = not printed). */
  shopPhone: string;
  /** Shop email printed under the phone in the receipt header (blank = not printed). */
  shopEmail: string;
  /** Side margin in mm. 0 = automatic (5 mm on rolls, 12 mm on sheets). */
  marginMm: number;
  /** Currency prefix used for amounts on the PDF, e.g. "Rs" or "$". */
  currencySymbol: string;
  headerLine: string;
  footerLine: string;
  showPhone: boolean;
  autoPrint: boolean;
  logo: StoredImage;
  banner: StoredImage;
  /** Full-bleed A4 letterhead artwork (header + footer baked in). Takes over
   * the whole sheet page for "a4" paper when present, replacing the banner
   * and the plain-text shop name/address/phone header. */
  background: StoredImage;
  /** Full-width thermal receipt header artwork (shop name/address/phone/
   * "BILL" title baked in) for roll paper, replacing the logo and the
   * plain-text header on thermal printouts when present. */
  rollHeader: StoredImage;
  showLogo: boolean;
  /** Print darkness — light/normal/dark. */
  density: DensityId;
  /** Space between printed lines — compact/normal/relaxed. */
  lineSpacing: LineSpacingId;
  /** Extra blank feed (mm) left at the bottom of roll-paper receipts, so an
   * auto-cutter doesn't slice through the last line. Ignored for sheets. */
  cutFeedMm: number;
  /** Open the receipt in a normal browser tab instead of sending it straight
   * to the print dialog — lets the person double-check layout first. */
  previewBeforePrint: boolean;
};

/** A branding image kept small (resized client-side before storage) with its
 * aspect ratio, so the PDF can size it correctly without re-loading the file. */
export type StoredImage = { dataUrl: string; width: number; height: number } | null;

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  paper: "80mm",
  customWidthMm: 72,
  fontScale: 1,
  copies: 1,
  shopName: "Chennai Soccer & Sports School",
  shopAddress:
    "Second Floor, Pasumpon Devar Mandapam, 158/100, Habibullah Rd, Parthasarathy Puram, T. Nagar, Chennai, Tamil Nadu 600017",
  shopPhone: "+91 93611 15939",
  shopEmail: "chennaisoccerschool@gmail.com",
  marginMm: 0,
  currencySymbol: "Rs",
  headerLine: "Play | Train | Grow",
  footerLine: "Thank you! Visit again.",
  showPhone: true,
  autoPrint: false,
  logo: DEFAULT_LOGO,
  banner: null,
  background: DEFAULT_BACKGROUND,
  rollHeader: DEFAULT_ROLL_HEADER,
  showLogo: true,
  density: "normal",
  lineSpacing: "normal",
  cutFeedMm: 0,
  previewBeforePrint: false,
};

const KEY = "ks:print-settings";

export function readPrintSettings(): PrintSettings {
  if (typeof window === "undefined") return DEFAULT_PRINT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw
      ? { ...DEFAULT_PRINT_SETTINGS, ...(JSON.parse(raw) as Partial<PrintSettings>) }
      : DEFAULT_PRINT_SETTINGS;
  } catch {
    return DEFAULT_PRINT_SETTINGS;
  }
}

export function writePrintSettings(value: PrintSettings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent("ks:print-settings"));
}

/** Resolves the actual roll/sheet width in mm for the current settings,
 * honouring the custom-width field when "custom" is selected. */
export function paperWidthMm(s: Pick<PrintSettings, "paper" | "customWidthMm">) {
  const info = paperInfo(s.paper);
  // Floor of 50mm — the narrowest paper the item table's #/label/qty/amount
  // column layout can actually lay out without the columns' anchor points
  // colliding (worst case: "Extra large" text on an auto-margin roll). That
  // matches the narrowest built-in preset (Thermal 2" / 50mm) already
  // offered, so custom rolls never go narrower than real hardware this app
  // ships a preset for.
  if (s.paper === "custom") return Math.max(50, Math.min(300, s.customWidthMm || 72));
  return info.widthMm;
}

/** Reactive access to the saved printer preferences. */
export function usePrintSettings() {
  const [settings, setSettings] = useState<PrintSettings>(DEFAULT_PRINT_SETTINGS);

  useEffect(() => {
    setSettings(readPrintSettings());
    const sync = () => setSettings(readPrintSettings());
    window.addEventListener("ks:print-settings", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("ks:print-settings", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const save = (next: PrintSettings) => {
    setSettings(next);
    writePrintSettings(next);
  };

  return { settings, save };
}
