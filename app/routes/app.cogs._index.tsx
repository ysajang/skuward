import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  EmptyState,
  Text,
  IndexTable,
  Badge,
  Box,
  Banner,
  BlockStack,
  InlineStack,
  List,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getVariantsPriceInfo } from "../utils/shopify-inventory.server";
import { getShopPlan } from "../utils/billing.server";
import { canAccessCOGS } from "../utils/plan-limits";
import { UpgradeBanner } from "../components/UpgradeBanner";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  // Plan gating: COGS is a paid feature. For locked (Free) shops, skip the
  // cost/price computation entirely (avoids unnecessary Shopify API calls) and
  // return a locked flag — the page shows a value preview + upgrade CTA.
  const plan = await getShopPlan(shop);
  if (!canAccessCOGS(plan)) {
    return json({ locked: true as const, rows: [] });
  }

  // Get the latest cost record per variant.
  // Fetch recent records ordered by createdAt desc, then dedupe by variant.
  const costRecords = await prisma.costRecord.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  // Keep only the most recent cost per variant
  const latestCostByVariant = new Map<
    string,
    { shopifyVariantId: string; shopifyProductId: string; costPerUnit: number }
  >();
  for (const rec of costRecords) {
    if (!latestCostByVariant.has(rec.shopifyVariantId)) {
      latestCostByVariant.set(rec.shopifyVariantId, {
        shopifyVariantId: rec.shopifyVariantId,
        shopifyProductId: rec.shopifyProductId,
        costPerUnit: parseFloat(rec.costPerUnit as unknown as string),
      });
    }
  }

  const variantIds = Array.from(latestCostByVariant.keys());
  const priceInfo = await getVariantsPriceInfo(admin, variantIds);

  const rows = variantIds.map((variantId) => {
    const cost = latestCostByVariant.get(variantId)!;
    const info = priceInfo[variantId];
    const price = info?.price ?? null;
    const costPerUnit = cost.costPerUnit;

    let margin: number | null = null;
    let marginPct: number | null = null;
    if (price != null && price > 0) {
      margin = price - costPerUnit;
      marginPct = (margin / price) * 100;
    }

    return {
      shopifyVariantId: variantId,
      title: info?.title || "(unknown product)",
      variantTitle: info?.variantTitle || "",
      sku: info?.sku || "",
      costPerUnit,
      price,
      margin,
      marginPct,
    };
  });

  // Sort by margin pct ascending (worst margins first — most actionable)
  rows.sort((a, b) => {
    if (a.marginPct == null) return 1;
    if (b.marginPct == null) return -1;
    return a.marginPct - b.marginPct;
  });

  return json({ locked: false as const, rows });
};

function formatCurrency(n: number | null): string {
  if (n == null) return "—";
  return `$${n.toFixed(2)}`;
}

export default function CogsPage() {
  const data = useLoaderData<typeof loader>();

  if (data.locked) {
    return (
      <Page
        title="Cost & Margins"
        subtitle="Track cost of goods, selling price, and profit margin per product"
      >
        <Layout>
          <Layout.Section>
            <UpgradeBanner
              resource="cost & margin tracking"
              message="Cost & Margins is available on Starter and Pro. Upgrade to see your cost per unit, selling price, and profit margin for every product — recorded automatically when you receive purchase orders."
            />
          </Layout.Section>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  What you'll unlock
                </Text>
                <List type="bullet">
                  <List.Item>
                    Cost per unit recorded automatically on every PO receipt
                  </List.Item>
                  <List.Item>
                    Selling price pulled live from your Shopify catalog
                  </List.Item>
                  <List.Item>
                    Profit margin and margin % per product, worst margins first
                  </List.Item>
                  <List.Item>
                    Alerts for products selling below a healthy margin
                  </List.Item>
                </List>
                <Box
                  background="bg-surface-secondary"
                  padding="400"
                  borderRadius="200"
                >
                  <BlockStack gap="200">
                    <Text as="span" variant="bodySm" tone="subdued">
                      Preview
                    </Text>
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodyMd" fontWeight="semibold">
                        Example product
                      </Text>
                      <Badge tone="success">42%</Badge>
                    </InlineStack>
                    <Text as="span" variant="bodySm" tone="subdued">
                      Cost $5.80 · Price $9.99 · Margin $4.19
                    </Text>
                  </BlockStack>
                </Box>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const { rows } = data;

  const lowMarginCount = rows.filter(
    (r) => r.marginPct != null && r.marginPct < 20,
  ).length;

  return (
    <Page
      title="Cost & Margins"
      subtitle="Cost is recorded automatically when you receive purchase orders"
    >
      <Layout>
        {lowMarginCount > 0 && (
          <Layout.Section>
            <Banner tone="warning" title={`${lowMarginCount} product(s) with margin below 20%`}>
              <p>Review pricing or supplier costs for these items.</p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card padding="0">
            {rows.length === 0 ? (
              <Box padding="400">
                <EmptyState
                  heading="No cost data yet"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>
                    Cost records are created automatically when you receive
                    purchase order items with a cost per unit. Receive a PO to
                    start tracking margins.
                  </p>
                </EmptyState>
              </Box>
            ) : (
              <IndexTable
                itemCount={rows.length}
                selectable={false}
                headings={[
                  { title: "Product" },
                  { title: "SKU" },
                  { title: "Cost/unit" },
                  { title: "Selling price" },
                  { title: "Margin" },
                  { title: "Margin %" },
                ]}
              >
                {rows.map((row, index) => {
                  const lowMargin =
                    row.marginPct != null && row.marginPct < 20;
                  const negMargin =
                    row.margin != null && row.margin < 0;
                  return (
                    <IndexTable.Row
                      id={row.shopifyVariantId}
                      key={row.shopifyVariantId}
                      position={index}
                    >
                      <IndexTable.Cell>
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          {row.title}
                          {row.variantTitle ? ` - ${row.variantTitle}` : ""}
                        </Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>{row.sku || "—"}</IndexTable.Cell>
                      <IndexTable.Cell>
                        {formatCurrency(row.costPerUnit)}
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        {formatCurrency(row.price)}
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Text
                          as="span"
                          tone={negMargin ? "critical" : undefined}
                        >
                          {formatCurrency(row.margin)}
                        </Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        {row.marginPct == null ? (
                          <Text as="span" tone="subdued">
                            —
                          </Text>
                        ) : negMargin ? (
                          <Badge tone="critical">
                            {`${row.marginPct.toFixed(0)}%`}
                          </Badge>
                        ) : lowMargin ? (
                          <Badge tone="warning">
                            {`${row.marginPct.toFixed(0)}%`}
                          </Badge>
                        ) : (
                          <Badge tone="success">
                            {`${row.marginPct.toFixed(0)}%`}
                          </Badge>
                        )}
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  );
                })}
              </IndexTable>
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
