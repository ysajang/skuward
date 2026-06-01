import type { PlanType } from "@prisma/client";

/**
 * Client-safe billing constants & pure logic. No prisma / server-only imports
 * here, so this module can be imported from React components AND server code.
 * Server-only DB sync lives in billing.server.ts.
 *
 * Plan name constants are stable identifiers: they are the keys in the
 * shopifyApp({ billing }) config and what Shopify stores as the subscription
 * `name`. Renaming after launch orphans existing subscriptions.
 */
export const STARTER_PLAN = "Starter" as const;
export const PRO_PLAN = "Pro" as const;

export type BillingPlanName = typeof STARTER_PLAN | typeof PRO_PLAN;

export interface BillingPlanConfig {
  amount: number;
  currencyCode: "USD";
  /** Shopify BillingInterval enum value for a 30-day recurring charge. */
  interval: "EVERY_30_DAYS";
  planType: Extract<PlanType, "STARTER" | "PRO">;
}

/** Single source of truth for paid plan pricing. */
export const BILLING_PLANS: Record<BillingPlanName, BillingPlanConfig> = {
  [STARTER_PLAN]: {
    amount: 9.99,
    currencyCode: "USD",
    interval: "EVERY_30_DAYS",
    planType: "STARTER",
  },
  [PRO_PLAN]: {
    amount: 19.99,
    currencyCode: "USD",
    interval: "EVERY_30_DAYS",
    planType: "PRO",
  },
};

/** All paid plan names, for billing.check({ plans }) / billing.require(). */
export const PAID_PLAN_NAMES: BillingPlanName[] = [STARTER_PLAN, PRO_PLAN];

/** Higher number = higher tier. Used to pick the dominant active plan. */
const PLAN_RANK: Record<PlanType, number> = { FREE: 0, STARTER: 1, PRO: 2 };

/**
 * Maps a Shopify subscription name back to our PlanType.
 * Unknown or undefined names (e.g. legacy plans) resolve to FREE.
 */
export function planNameToPlanType(name: string | undefined | null): PlanType {
  if (name && name in BILLING_PLANS) {
    return BILLING_PLANS[name as BillingPlanName].planType;
  }
  return "FREE";
}

export interface ActiveSubscription {
  name: string;
  id: string;
}

export interface ResolvedPlan {
  plan: PlanType;
  chargeId: string | null;
}

/**
 * Given the list of currently-active subscriptions returned by billing.check,
 * resolve the effective plan + charge id. Picks the highest tier if more than
 * one is somehow active. No active (or only unknown) subs => FREE.
 */
export function resolvePlanFromSubscriptions(
  subscriptions: ActiveSubscription[],
): ResolvedPlan {
  let best: ResolvedPlan = { plan: "FREE", chargeId: null };
  for (const sub of subscriptions) {
    const plan = planNameToPlanType(sub.name);
    if (plan !== "FREE" && PLAN_RANK[plan] > PLAN_RANK[best.plan]) {
      best = { plan, chargeId: sub.id };
    }
  }
  return best;
}

/** True when the current store is a Shopify dev store (use test charges). */
export function isDevStore(shop: string): boolean {
  return shop === "skuward-dev.myshopify.com";
}

/**
 * Build the post-approval returnUrl. Shopify redirects the merchant here after
 * they approve/decline the charge. We point at the app's admin deep-link so the
 * embedded session is restored cleanly (a raw app URL drops the session and
 * forces re-auth — see shopify-app-js#476). Re-entering /app re-runs the loader,
 * which calls syncShopPlan to persist the new charge.
 *
 * Requires SHOPIFY_APP_HANDLE. Falls back to the embedded app root if unset.
 */
export function buildReturnUrl(shop: string, appHandle?: string): string {
  const storeHandle = shop.replace(".myshopify.com", "");
  if (appHandle) {
    return `https://admin.shopify.com/store/${storeHandle}/apps/${appHandle}`;
  }
  return "/app";
}
