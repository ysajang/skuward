import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineGrid,
  Box,
  Button,
  Banner,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [supplierCount, totalPOs, draftPOs, orderedPOs, reorderRuleCount] =
    await Promise.all([
      prisma.supplier.count({ where: { shop } }),
      prisma.purchaseOrder.count({ where: { shop } }),
      prisma.purchaseOrder.count({ where: { shop, status: "DRAFT" } }),
      prisma.purchaseOrder.count({ where: { shop, status: "ORDERED" } }),
      prisma.reorderRule.count({ where: { shop } }),
    ]);

  const recentPOs = await prisma.purchaseOrder.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: 5,
    include: { supplier: { select: { name: true } } },
  });

  return json({
    supplierCount,
    totalPOs,
    draftPOs,
    orderedPOs,
    reorderRuleCount,
    recentPOs,
  });
};

export default function DashboardPage() {
  const {
    supplierCount,
    totalPOs,
    draftPOs,
    orderedPOs,
    reorderRuleCount,
    recentPOs,
  } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <Page title="SKUward Dashboard">
      <Layout>
        <Layout.Section>
          <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
            <Card>
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd" tone="subdued">
                  Total POs
                </Text>
                <Text as="p" variant="headingXl">
                  {totalPOs}
                </Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd" tone="subdued">
                  Draft POs
                </Text>
                <Text as="p" variant="headingXl">
                  {draftPOs}
                </Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd" tone="subdued">
                  Ordered (awaiting)
                </Text>
                <Text as="p" variant="headingXl">
                  {orderedPOs}
                </Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd" tone="subdued">
                  Suppliers
                </Text>
                <Text as="p" variant="headingXl">
                  {supplierCount}
                </Text>
              </BlockStack>
            </Card>
          </InlineGrid>
        </Layout.Section>

        {supplierCount === 0 && (
          <Layout.Section>
            <Banner
              title="Get started"
              action={{
                content: "Add your first supplier",
                onAction: () => navigate("/app/suppliers/new"),
              }}
              tone="info"
            >
              <p>
                Add a supplier first, then create purchase orders to track
                incoming inventory.
              </p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Recent Purchase Orders
              </Text>
              {recentPOs.length === 0 ? (
                <Text as="p" tone="subdued">
                  No purchase orders yet.
                </Text>
              ) : (
                <BlockStack gap="300">
                  {recentPOs.map((po: any) => (
                    <Box key={po.id}>
                      <Button
                        variant="plain"
                        onClick={() =>
                          navigate(`/app/purchase-orders/${po.id}`)
                        }
                      >
                        {po.poNumber}
                      </Button>
                      {" — "}
                      {po.supplier.name} · {po.status.replace("_", " ")} ·{" "}
                      {new Date(po.createdAt).toLocaleDateString()}
                    </Box>
                  ))}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Quick Actions
              </Text>
              <Button
                variant="primary"
                fullWidth
                onClick={() => navigate("/app/purchase-orders/new")}
              >
                Create Purchase Order
              </Button>
              <Button fullWidth onClick={() => navigate("/app/suppliers/new")}>
                Add Supplier
              </Button>
              <Button fullWidth onClick={() => navigate("/app/reorder-rules")}>
                Manage Reorder Rules
              </Button>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
