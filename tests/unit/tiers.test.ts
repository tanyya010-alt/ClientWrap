import { describe, expect, it } from "vitest";
import { PLANS, PAID_PLANS, PLAN_ORDER, can, limit, resolveEntitlement, planForAppsumoTier, requiredPlanFor, type Feature } from "@/lib/tiers";

describe("tier config", () => {
  it("maps AppSumo tiers to plans", () => {
    expect(planForAppsumoTier(1)).toBe("solo");
    expect(planForAppsumoTier(2)).toBe("growth");
    expect(planForAppsumoTier(3)).toBe("agency");
    expect(planForAppsumoTier(7)).toBe("agency");
  });

  it("each tier includes every feature of the tier below and has >= 3 plan-specific features", () => {
    for (let i = 1; i < PLAN_ORDER.length; i++) {
      const lower = PLANS[PLAN_ORDER[i - 1]];
      const upper = PLANS[PLAN_ORDER[i]];
      for (const f of lower.features) expect(upper.features).toContain(f);
      const specific = upper.features.filter((f) => !lower.features.includes(f));
      expect(specific.length, `${upper.key} plan-specific features`).toBeGreaterThanOrEqual(3);
    }
  });

  it("limits never decrease with higher tiers", () => {
    for (let i = 1; i < PLAN_ORDER.length; i++) {
      const lower = PLANS[PLAN_ORDER[i - 1]].limits;
      const upper = PLANS[PLAN_ORDER[i]].limits;
      for (const k of Object.keys(lower) as (keyof typeof lower)[]) expect(upper[k]).toBeGreaterThanOrEqual(lower[k]);
    }
  });

  it("matches the AppSumo tier spec (5 / 15 / 40 client workspaces)", () => {
    expect(PLANS.solo.limits.clients).toBe(5);
    expect(PLANS.growth.limits.clients).toBe(15);
    expect(PLANS.agency.limits.clients).toBe(40);
    expect(PLANS.solo.features).toContain("email_reminders");
    expect(PLANS.growth.features).toEqual(expect.arrayContaining(["renewal_generator", "case_study_generator", "sms_whatsapp"]));
    expect(PLANS.agency.features).toEqual(expect.arrayContaining(["white_label", "custom_domain", "custom_email_sender"]));
  });

  it("regular annual prices always exceed the AppSumo lifetime price", () => {
    for (const k of PAID_PLANS) {
      const p = PLANS[k];
      expect(p.annualPriceUsd!).toBeGreaterThan(p.appsumoLifetimePriceUsd!);
      expect(p.monthlyPriceUsd! * 12).toBeGreaterThan(p.appsumoLifetimePriceUsd!);
      expect(p.annualPriceUsd!).toBeLessThan(p.monthlyPriceUsd! * 12); // annual is a discount
    }
  });

  it("requiredPlanFor returns the lowest plan with a feature", () => {
    expect(requiredPlanFor("client_portal")).toBe("free");
    expect(requiredPlanFor("email_reminders")).toBe("solo");
    expect(requiredPlanFor("case_study_generator")).toBe("growth");
    expect(requiredPlanFor("white_label")).toBe("agency");
  });
});

describe("resolveEntitlement", () => {
  const now = new Date("2026-09-01T00:00:00Z");
  it("defaults to free", () => {
    expect(resolveEntitlement({ licenses: [], subscriptions: [], now })).toMatchObject({ plan: "free", mode: "full" });
  });
  it("uses an active license tier", () => {
    const e = resolveEntitlement({ licenses: [{ license_key: "a", tier: 2, status: "active", deactivated_at: null }], subscriptions: [], now });
    expect(e).toMatchObject({ plan: "growth", source: "appsumo", mode: "full" });
    expect(can(e, "case_study_generator")).toBe(true);
    expect(can(e, "white_label")).toBe(false);
    expect(limit(e, "clients")).toBe(15);
  });
  it("ignores inactive (not yet activated) licenses", () => {
    expect(resolveEntitlement({ licenses: [{ license_key: "a", tier: 3, status: "inactive", deactivated_at: null }], subscriptions: [], now }).plan).toBe("free");
  });
  it("picks the highest of license and subscription", () => {
    const e = resolveEntitlement({
      licenses: [{ license_key: "a", tier: 1, status: "active", deactivated_at: null }],
      subscriptions: [{ plan: "agency", status: "active", current_period_end: null }],
      now,
    });
    expect(e.plan).toBe("agency");
    expect(e.source).toBe("stripe");
  });
  it("deactivated license => read-only for 30 days, then expired", () => {
    const lic = { license_key: "a", tier: 3, status: "deactivated", deactivated_at: "2026-08-20T00:00:00Z" };
    expect(resolveEntitlement({ licenses: [lic], subscriptions: [], now })).toMatchObject({ mode: "readonly" });
    expect(resolveEntitlement({ licenses: [lic], subscriptions: [], now: new Date("2026-09-25T00:00:00Z") })).toMatchObject({ mode: "expired" });
  });
  it("a superseded (upgraded) license does not make the account read-only", () => {
    const e = resolveEntitlement({
      licenses: [
        { license_key: "old", tier: 1, status: "deactivated", deactivated_at: "2026-08-30T00:00:00Z", superseded_by: "new" },
        { license_key: "new", tier: 2, status: "active", deactivated_at: null },
      ],
      subscriptions: [],
      now,
    });
    expect(e).toMatchObject({ plan: "growth", mode: "full", licenseKey: "new" });
  });
  it("canceled subscriptions give no access", () => {
    expect(resolveEntitlement({ licenses: [], subscriptions: [{ plan: "growth", status: "canceled", current_period_end: null }], now }).plan).toBe("free");
  });
  it("every feature has a label and a required plan", () => {
    const all = new Set<Feature>(PLANS.agency.features);
    for (const f of all) expect(PLANS[requiredPlanFor(f)].features).toContain(f);
  });
});
