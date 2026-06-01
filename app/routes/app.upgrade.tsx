import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import { authenticate } from "../shopify.server";
import {
  PAID_PLAN_NAMES,
  type BillingPlanName,
  isDevStore,
} from "../utils/billing-plans";

// Plan changes must be POST. A GET here just bounces back to settings.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return redirect("/app/settings");
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);

  const formData = await request.formData();
  const plan = String(formData.get("plan") ?? "");

  // Validate against the allow-list — never trust the posted plan name.
  if (!PAID_PLAN_NAMES.includes(plan as BillingPlanName)) {
    return redirect("/app/settings?billing_error=invalid_plan");
  }

  // No custom returnUrl: the SDK returns the merchant to the app's index after
  // approval, which re-runs the /app loader and syncs ShopPlan from the active
  // subscription. A hand-built admin deep-link requires the exact app handle
  // and 404s if wrong (shopify-app-js#476), so we rely on the SDK default.
  //
  // billing.request returns Promise<never>: it throws the redirect to Shopify's
  // confirmation page itself. Do NOT wrap in try/catch (would swallow it).
  await billing.request({
    plan: plan as BillingPlanName,
    isTest: isDevStore(session.shop),
  });

  // Unreachable in practice (request throws), but satisfies the type checker.
  return null;
};
