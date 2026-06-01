import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

/**
 * GDPR: customers/redact. A store owner asked to delete a customer's data.
 * SKUward stores no customer PII, so there is nothing to redact. Acknowledge
 * with 200. HMAC is verified by authenticate.webhook (401 on invalid).
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`[compliance] ${topic} for ${shop}: no customer data to redact`);
  return new Response();
};
