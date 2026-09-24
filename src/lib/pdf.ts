import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import type { ReportSnapshot } from "./reports";
import { fmtChange, fmtValue } from "./reports";
import { formatMoney } from "./time";

const EXTRA = new Set("–—‘’“”€•…™©®°±×÷£¥§¶·".split(""));
/** Standard PDF fonts only support WinAnsi; replace anything else so generation never fails. */
export function pdfSafe(s: string): string {
  return Array.from(s ?? "")
    .map((ch) => {
      const c = ch.codePointAt(0)!;
      if (ch === "\n") return ch;
      if ((c >= 32 && c <= 126) || (c >= 160 && c <= 255) || EXTRA.has(ch)) return ch;
      if (c === 9) return " ";
      return "?";
    })
    .join("");
}

function hexToRgb(hex: string | null | undefined, fallback: RGB = rgb(0.31, 0.27, 0.9)): RGB {
  const m = (hex ?? "").match(/^#?([0-9a-f]{6})$/i);
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of pdfSafe(text).split("\n")) {
    const words = para.split(/\s+/);
    let line = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(test, size) > width && line) {
        out.push(line);
        line = w;
      } else line = test;
    }
    out.push(line);
  }
  return out;
}

class Writer {
  page: PDFPage;
  y: number;
  constructor(
    public doc: PDFDocument,
    public font: PDFFont,
    public bold: PDFFont,
  ) {
    this.page = doc.addPage([595.28, 841.89]);
    this.y = 841.89 - 50;
  }
  ensure(h: number) {
    if (this.y - h < 60) {
      this.page = this.doc.addPage([595.28, 841.89]);
      this.y = 841.89 - 50;
    }
  }
  text(s: string, opts: { size?: number; bold?: boolean; color?: RGB; x?: number; width?: number; gap?: number } = {}) {
    const size = opts.size ?? 11;
    const font = opts.bold ? this.bold : this.font;
    const lines = wrap(s, font, size, opts.width ?? 495);
    for (const l of lines) {
      this.ensure(size + 4);
      this.page.drawText(l, { x: opts.x ?? 50, y: this.y, size, font, color: opts.color ?? rgb(0.1, 0.1, 0.12) });
      this.y -= size + (opts.gap ?? 5);
    }
  }
}

async function embedLogo(doc: PDFDocument, dataUrl: string | null | undefined) {
  if (!dataUrl) return null;
  const m = dataUrl.match(/^data:image\/(png|jpe?g);base64,(.+)$/);
  if (!m) return null;
  try {
    const bytes = Buffer.from(m[2], "base64");
    return m[1] === "png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  } catch {
    return null;
  }
}

async function header(w: Writer, brand: { name: string; color: string; logo?: string | null }, title: string, subtitle: string) {
  const color = hexToRgb(brand.color);
  w.page.drawRectangle({ x: 0, y: 841.89 - 90, width: 595.28, height: 90, color });
  const logo = await embedLogo(w.doc, brand.logo);
  let x = 50;
  if (logo) {
    const scale = Math.min(50 / logo.height, 120 / logo.width);
    w.page.drawImage(logo, { x, y: 841.89 - 70, width: logo.width * scale, height: logo.height * scale });
    x += logo.width * scale + 14;
  }
  w.page.drawText(pdfSafe(brand.name), { x, y: 841.89 - 52, size: 16, font: w.bold, color: rgb(1, 1, 1) });
  w.y = 841.89 - 130;
  w.text(title, { size: 20, bold: true });
  w.text(subtitle, { size: 11, color: rgb(0.4, 0.4, 0.45), gap: 14 });
}

export async function reportPdf(input: {
  brand: { name: string; color: string; logo?: string | null };
  clientName: string;
  snapshot: ReportSnapshot;
  narrative: string;
  nextStep: string;
  poweredBy: boolean;
}): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafe(`${input.clientName} — ${input.snapshot.periodLabel} results`));
  doc.setProducer("ClientWrap");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new Writer(doc, font, bold);
  await header(w, input.brand, `${input.clientName}: ${input.snapshot.periodLabel}`, "Monthly results wrap");

  // Metric table
  const rows = input.snapshot.metrics.filter((m) => m.value !== null || m.previous !== null);
  w.text("Headline numbers", { size: 13, bold: true, gap: 8 });
  const cols = [50, 280, 390, 480];
  w.ensure(20);
  ["Metric", "This month", "Last month", "Change"].forEach((h, i) =>
    w.page.drawText(h, { x: cols[i], y: w.y, size: 9, font: bold, color: rgb(0.4, 0.4, 0.45) }),
  );
  w.y -= 16;
  for (const m of rows) {
    w.ensure(20);
    w.page.drawText(pdfSafe(m.label).slice(0, 40), { x: cols[0], y: w.y, size: 11, font });
    w.page.drawText(pdfSafe(fmtValue(m)), { x: cols[1], y: w.y, size: 11, font: bold });
    w.page.drawText(pdfSafe(fmtValue({ value: m.previous, unit: m.unit })), { x: cols[2], y: w.y, size: 11, font });
    const color = m.trend === "improved" ? rgb(0.05, 0.55, 0.3) : m.trend === "declined" ? rgb(0.75, 0.2, 0.2) : rgb(0.4, 0.4, 0.45);
    w.page.drawText(pdfSafe(m.value === null ? "—" : fmtChange(m.changePct)), { x: cols[3], y: w.y, size: 11, font: bold, color });
    w.y -= 8;
    w.page.drawLine({ start: { x: 50, y: w.y }, end: { x: 545, y: w.y }, thickness: 0.5, color: rgb(0.9, 0.9, 0.92) });
    w.y -= 14;
  }
  if (rows.length === 0) w.text("No results recorded for this period.", { color: rgb(0.4, 0.4, 0.45) });
  w.y -= 10;
  w.text("What changed", { size: 13, bold: true, gap: 8 });
  w.text(input.narrative || "—", { size: 11, gap: 5 });
  w.y -= 10;
  w.text("Suggested next step", { size: 13, bold: true, gap: 8 });
  w.text(input.nextStep || "—", { size: 11 });
  if (input.poweredBy) {
    const last = doc.getPages()[doc.getPageCount() - 1];
    last.drawText("Made with ClientWrap", { x: 50, y: 30, size: 8, font, color: rgb(0.6, 0.6, 0.65) });
  }
  return Buffer.from(await doc.save());
}

export async function invoicePdf(input: {
  brand: { name: string; color: string; logo?: string | null };
  invoice: { number: string; issue_date: string; due_date: string; currency: string; total_cents: number; notes?: string | null; status: string };
  items: { description: string; quantity: number; unit_amount_cents: number; amount_cents: number }[];
  client: { name: string; contact_name?: string | null; contact_email?: string | null };
  payUrl?: string | null;
  paymentInstructions?: string | null;
  poweredBy: boolean;
}): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafe(`Invoice ${input.invoice.number}`));
  doc.setProducer("ClientWrap");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new Writer(doc, font, bold);
  const inv = input.invoice;
  await header(w, input.brand, `Invoice ${inv.number}`, `Issued ${inv.issue_date} · Due ${inv.due_date}${inv.status === "paid" ? " · PAID" : ""}`);
  w.text("Bill to", { size: 9, bold: true, color: rgb(0.4, 0.4, 0.45) });
  w.text(input.client.name, { bold: true });
  if (input.client.contact_name) w.text(input.client.contact_name);
  if (input.client.contact_email) w.text(input.client.contact_email, { gap: 16 });
  const cols = [50, 330, 400, 480];
  w.ensure(20);
  ["Description", "Qty", "Unit", "Amount"].forEach((h, i) =>
    w.page.drawText(h, { x: cols[i], y: w.y, size: 9, font: bold, color: rgb(0.4, 0.4, 0.45) }),
  );
  w.y -= 16;
  for (const it of input.items) {
    const lines = wrap(it.description, font, 11, 270);
    w.ensure(lines.length * 15 + 10);
    const top = w.y;
    lines.forEach((l, i) => w.page.drawText(l, { x: cols[0], y: top - i * 15, size: 11, font }));
    w.page.drawText(String(Number(it.quantity)), { x: cols[1], y: top, size: 11, font });
    w.page.drawText(pdfSafe(formatMoney(it.unit_amount_cents, inv.currency)), { x: cols[2], y: top, size: 11, font });
    w.page.drawText(pdfSafe(formatMoney(it.amount_cents, inv.currency)), { x: cols[3], y: top, size: 11, font });
    w.y = top - lines.length * 15 - 4;
    w.page.drawLine({ start: { x: 50, y: w.y + 6 }, end: { x: 545, y: w.y + 6 }, thickness: 0.5, color: rgb(0.9, 0.9, 0.92) });
    w.y -= 8;
  }
  w.ensure(30);
  w.page.drawText("Total", { x: cols[2], y: w.y, size: 12, font: bold });
  w.page.drawText(pdfSafe(formatMoney(inv.total_cents, inv.currency)), { x: cols[3], y: w.y, size: 12, font: bold });
  w.y -= 30;
  if (inv.notes) {
    w.text("Notes", { size: 11, bold: true });
    w.text(inv.notes, { gap: 12 });
  }
  if (inv.status !== "paid") {
    if (input.payUrl) {
      w.text("Pay online", { size: 11, bold: true });
      w.text(input.payUrl, { size: 9, color: rgb(0.2, 0.3, 0.8), gap: 12 });
    }
    if (input.paymentInstructions) {
      w.text("Payment instructions", { size: 11, bold: true });
      w.text(input.paymentInstructions);
    }
  }
  if (input.poweredBy) {
    const last = doc.getPages()[doc.getPageCount() - 1];
    last.drawText("Made with ClientWrap", { x: 50, y: 30, size: 8, font, color: rgb(0.6, 0.6, 0.65) });
  }
  return Buffer.from(await doc.save());
}
