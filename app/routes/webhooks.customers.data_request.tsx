import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

/**
 * GDPR: customers/data_request. A customer asked the store owner for their data.
 * SKUward stores no customer PII — only merchant operational data (suppliers,
 * POs, inventory costs) — so there is nothing to return. We acknowledge with
 * 200 as required. authenticate.webhook verifies the HMAC and returns 401 on
 * an invalid signature.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`[compliance] ${topic} for ${shop}: no customer data stored`);
  return new Response();
};
