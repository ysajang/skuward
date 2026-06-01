import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import { authenticate } from "../shopify.server";
import {
  PAID_PLAN_NAMES,
  type BillingPlanName,
  buildReturnUrl,
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

  const returnUrl = buildReturnUrl(
    session.shop,
    process.env.SHOPIFY_APP_HANDLE,
  );

  // billing.request returns Promise<never>: it throws the redirect to Shopify's
  // confirmation page itself. Do NOT wrap in try/catch (would swallow the
  // redirect). On approval Shopify sends the merchant to returnUrl, re-running
  // the /app loader which syncs ShopPlan from the now-active subscription.
  await billing.request({
    plan: plan as BillingPlanName,
    isTest: isDevStore(session.shop),
    returnUrl,
  });

  // Unreachable in practice (request throws), but satisfies the type checker.
  return null;
};
