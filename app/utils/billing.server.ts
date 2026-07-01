import type { PlanType } from "@prisma/client";
import prisma from "../db.server";
import {
  PAID_PLAN_NAMES,
  isDevStore,
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
 * isTest is pinned to true: the SDK's check filters subscriptions with
 * `(isTest || !subscription.test)`, so real (non-test) subscriptions ALWAYS
 * match regardless of this flag — it only controls whether TEST subscriptions
 * are also accepted. Test charges can only be created on partner development
 * stores (incl. Shopify app reviewers), so accepting them here is safe in
 * production and required for App Store review (1.2.2: reviewer's test
 * subscription must reflect in the app UI).
 *
 * Returns the reconciled PlanType for immediate gating use.
 */
export async function syncShopPlan(
  billing: BillingLike,
  shop: string,
): Promise<PlanType> {
  const result = await billing.check({ plans: PAID_PLAN_NAMES, isTest: true });
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

/** Minimal shape of the admin GraphQL client we depend on. */
interface AdminGraphqlLike {
  graphql: (query: string) => Promise<{ json: () => Promise<any> }>;
}

/**
 * Decide whether billing.request should create a TEST charge for this store.
 * Partner development stores (including Shopify App Store reviewer stores)
 * cannot complete real charges, so they must receive test charges.
 *
 * Detection is dynamic via shop.plan.partnerDevelopment — never a hardcoded
 * domain — with isDevStore() kept as a fast-path fallback. On query failure
 * we fail CLOSED (real charge) so production merchants are never accidentally
 * given free test subscriptions.
 */
export async function shouldUseTestCharge(
  admin: AdminGraphqlLike,
  shop: string,
): Promise<boolean> {
  if (isDevStore(shop)) return true;
  try {
    const response = await admin.graphql(
      `#graphql
      query ShopPlanForBilling {
        shop {
          plan {
            partnerDevelopment
          }
        }
      }`,
    );
    const body = await response.json();
    return Boolean(body?.data?.shop?.plan?.partnerDevelopment);
  } catch (error) {
    console.error("[billing] partnerDevelopment lookup failed:", error);
    return false;
  }
}
