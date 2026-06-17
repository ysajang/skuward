import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { authenticate } from "../shopify.server";
import { syncShopPlan } from "../utils/billing.server";
import { isDevStore } from "../utils/billing-plans";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);

  // Reconcile local ShopPlan with Shopify's source of truth on every app load.
  // Cancellations/declines fall back to FREE automatically. Failures here must
  // not break app load, so we swallow and keep the last-known plan.
  try {
    // SDK billing context's generic plan typing doesn't structurally match our
    // minimal BillingLike; cast at this single boundary. syncShopPlan only calls
    // .check and is runtime-verified.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await syncShopPlan(billing as any, session.shop, isDevStore(session.shop));
  } catch (error) {
    console.error("[billing] syncShopPlan failed:", error);
  }

  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">
          Dashboard
        </Link>
        <Link to="/app/purchase-orders">Purchase Orders</Link>
        <Link to="/app/import">Import CSV</Link>
        <Link to="/app/suppliers">Suppliers</Link>
        <Link to="/app/reorder-rules">Reorder Rules</Link>
        <Link to="/app/cogs">Cost & Margins</Link>
        <Link to="/app/settings">Settings</Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
