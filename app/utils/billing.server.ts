import type { PlanType } from "@prisma/client";
import prisma from "../db.server";
import {
  PAID_PLAN_NAMES,
  resolvePlanFromSubscriptions,
} from "./billing-plans";

// Re-export client-safe constants/logic so existing server imports keep working.
export * from "./billing-plans";

/** Minimal shape of the SDK billing.check result we depend on. */
interface BillingCheckResult {
  hasActivePayment: boolean;
  appSubscriptions: { name: string; id: string }[];
}

/**
 * Structural supertype of the SDK billing context's `check`. The SDK types
 * `plans` as `(keyof Config['billing'])[]`, which TS narrows to `never[]` at
 * generic boundaries like this one; accepting `readonly string[]` keeps the
 * real billing object assignable here while we cast plan names at the call.
 */
interface BillingLike {
  check: (opts: {
    plans?: readonly string[];
    isTest?: boolean;
  }) => Promise<BillingCheckResult>;
}

/**
 * Source-of-truth sync: query Shopify for active subscriptions and reconcile
 * the local ShopPlan row. Called on every app load so the DB never drifts
 * from Shopify (cancellations/declines fall back to FREE automatically).
 *
 * Returns the reconciled PlanType for immediate gating use.
 */
export async function syncShopPlan(
  billing: BillingLike,
  shop: string,
  isTest: boolean,
): Promise<PlanType> {
  const result = await billing.check({ plans: PAID_PLAN_NAMES, isTest });
  const { plan, chargeId } = resolvePlanFromSubscriptions(
    result.appSubscriptions ?? [],
  );

  const existing = await prisma.shopPlan.findUnique({ where: { shop } });

  const changed =
    !existing ||
    existing.plan !== plan ||
    existing.shopifyChargeId !== chargeId;

  if (changed) {
    await prisma.shopPlan.upsert({
      where: { shop },
      create: {
        shop,
        plan,
        shopifyChargeId: chargeId,
        activatedAt: plan === "FREE" ? null : new Date(),
      },
      update: {
        plan,
        shopifyChargeId: chargeId,
        activatedAt:
          plan === "FREE" ? null : (existing?.activatedAt ?? new Date()),
      },
    });
  }

  return plan;
}

/** Read the current plan from DB (no Shopify call). For gating in actions. */
export async function getShopPlan(shop: string): Promise<PlanType> {
  const row = await prisma.shopPlan.findUnique({ where: { shop } });
  return row?.plan ?? "FREE";
}
