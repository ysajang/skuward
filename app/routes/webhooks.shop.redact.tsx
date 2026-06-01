import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { redactShopData } from "../utils/compliance.server";

/**
 * GDPR: shop/redact. Fired ~48h after a shop uninstalls SKUward. We erase all
 * data we hold for that shop (suppliers, POs + line items, reorder rules, cost
 * records, plan, sessions). HMAC verified by authenticate.webhook (401 invalid).
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  await redactShopData(shop);

  console.log(`[compliance] ${topic} for ${shop}: shop data erased`);
  return new Response();
};
