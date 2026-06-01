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
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getVariantsPriceInfo } from "../utils/shopify-inventory.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

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

  return json({ rows });
};

function formatCurrency(n: number | null): string {
  if (n == null) return "—";
  return `$${n.toFixed(2)}`;
}

export default function CogsPage() {
  const { rows } = useLoaderData<typeof loader>();

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
