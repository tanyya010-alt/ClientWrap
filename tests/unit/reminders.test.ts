import { describe, expect, it } from "vitest";
import { planReminders, renderReminder, TEMPLATES, DEFAULT_REMINDER_RULES, stepKey, type RuleLike } from "@/lib/reminders";
import { isQuietTime } from "@/lib/time";
import { checkTone } from "@/lib/tone";
import { canMessage } from "@/lib/messaging";

const rules: RuleLike[] = DEFAULT_REMINDER_RULES.map((r) => ({ ...r, channel: "email", enabled: true }));

describe("planReminders", () => {
  it("sends nothing before the first step", () => {
    expect(planReminders({ dueDate: "2026-09-20", todayLocal: "2026-09-10", rules, handledStepKeys: new Set() }).send).toEqual([]);
  });
  it("sends the before-due reminder 3 days early", () => {
    const r = planReminders({ dueDate: "2026-09-20", todayLocal: "2026-09-17", rules, handledStepKeys: new Set() });
    expect(r.send.map((x) => x.offset_days)).toEqual([-3]);
  });
  it("follows the 1/7/14/30 day sequence after due", () => {
    for (const [today, offset] of [["2026-09-21", 1], ["2026-09-27", 7], ["2026-10-04", 14], ["2026-10-20", 30]] as const) {
      const handled = new Set(rules.filter((r) => r.offset_days < offset).map(stepKey));
      const r = planReminders({ dueDate: "2026-09-20", todayLocal: today, rules, handledStepKeys: handled });
      expect(r.send.map((x) => x.offset_days)).toEqual([offset]);
    }
  });
  it("never re-sends a handled step", () => {
    const r = planReminders({ dueDate: "2026-09-20", todayLocal: "2026-09-21", rules, handledStepKeys: new Set(["email:-3", "email:1"]) });
    expect(r.send).toEqual([]);
  });
  it("only sends the latest due step and supersedes older ones (no bursts)", () => {
    const r = planReminders({ dueDate: "2026-09-20", todayLocal: "2026-09-28", rules, handledStepKeys: new Set() });
    expect(r.send.map((x) => x.offset_days)).toEqual([7]);
    expect(r.supersede.map((x) => x.offset_days).sort((a, b) => a - b)).toEqual([-3, 1]);
  });
  it("does not send stale steps", () => {
    const r = planReminders({ dueDate: "2026-09-20", todayLocal: "2026-10-01", rules, handledStepKeys: new Set() });
    expect(r.send).toEqual([]); // 7-day step is 4 days old -> superseded
  });
  it("skips disabled rules", () => {
    const r = planReminders({ dueDate: "2026-09-20", todayLocal: "2026-09-17", rules: rules.map((x) => ({ ...x, enabled: false })), handledStepKeys: new Set() });
    expect(r.send).toEqual([]);
  });
  it("plans channels independently", () => {
    const both = [...rules, { offset_days: 1, channel: "sms", enabled: true, template_key: "friendly_after" }];
    const r = planReminders({ dueDate: "2026-09-20", todayLocal: "2026-09-21", rules: both, handledStepKeys: new Set(["email:-3"]) });
    expect(r.send.map(stepKey).sort()).toEqual(["email:1", "sms:1"]);
  });
});

describe("quiet hours (timezone-aware)", () => {
  // 2026-09-23 is a Wednesday
  it("respects the local time of the recipient", () => {
    const t = new Date("2026-09-23T02:00:00Z"); // 22:00 in New York (quiet), 04:00 in Berlin (quiet), 11:00 in Tokyo
    expect(isQuietTime(t, "America/New_York", 20, 8, false)).toBe(true);
    expect(isQuietTime(t, "Asia/Tokyo", 20, 8, false)).toBe(false);
  });
  it("handles non-wrapping windows", () => {
    expect(isQuietTime(new Date("2026-09-23T13:00:00Z"), "UTC", 12, 14, false)).toBe(true);
    expect(isQuietTime(new Date("2026-09-23T15:00:00Z"), "UTC", 12, 14, false)).toBe(false);
  });
  it("skips weekends when enabled", () => {
    const sat = new Date("2026-09-26T12:00:00Z");
    expect(isQuietTime(sat, "UTC", 20, 8, true)).toBe(true);
    expect(isQuietTime(sat, "UTC", 20, 8, false)).toBe(false);
  });
});

describe("tone guardrails", () => {
  const vars = { clientName: "Acme", contactName: "Jane", providerName: "Studio", invoiceNumber: "INV-0001", amount: "$1,000.00", dueDate: "Sep 20, 2026", daysOverdue: 14, daysUntilDue: 3 };
  it("all built-in templates pass", () => {
    for (const t of Object.values(TEMPLATES)) {
      expect(checkTone(t.body(vars)).ok).toBe(true);
      expect(checkTone(t.subject(vars)).ok).toBe(true);
    }
  });
  it.each([
    "Pay now or we will take legal action",
    "We will send this to a collection agency",
    "This will hurt your credit score",
    "PAY THIS INVOICE IMMEDIATELY YOU HAVE IGNORED US",
    "Pay now!!!",
    "You are a deadbeat",
    "Final warning, or else.",
  ])("blocks: %s", (text) => {
    expect(checkTone(text).ok).toBe(false);
  });
  it("renders custom messages with variables", () => {
    const r = renderReminder({ offset_days: 1, channel: "email", enabled: true, template_key: "friendly_after", custom_message: "Hi {{contact_name}}, {{invoice_number}} for {{amount}}" }, vars);
    expect(r.body).toBe("Hi Jane, INV-0001 for $1,000.00");
  });
});

describe("consent rules", () => {
  it("email is allowed unless unsubscribed", () => {
    expect(canMessage("email", null).ok).toBe(true);
    expect(canMessage("email", "unsubscribed").ok).toBe(false);
    expect(canMessage("email", "resubscribed").ok).toBe(true);
  });
  it("SMS/WhatsApp require explicit consent", () => {
    expect(canMessage("sms", null).ok).toBe(false);
    expect(canMessage("sms", "granted").ok).toBe(true);
    expect(canMessage("whatsapp", "revoked").ok).toBe(false);
  });
});
