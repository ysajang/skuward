import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  useActionData,
  useLoaderData,
  useSubmit,
  useNavigation,
} from "@remix-run/react";
import { useState, useCallback } from "react";
import {
  Page,
  Layout,
  Card,
  EmptyState,
  Text,
  Button,
  IndexTable,
  TextField,
  Badge,
  BlockStack,
  InlineStack,
  Banner,
  Box,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { parseIntSafe } from "../utils/validation";
import { getVariantsCurrentStock } from "../utils/shopify-inventory.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const rules = await prisma.reorderRule.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
  });

  // Fetch current stock for all variants in the rules
  const variantIds = rules.map((r) => r.shopifyVariantId);
  const stockMap = await getVariantsCurrentStock(admin, variantIds);

  // Annotate each rule with current stock + below-threshold flag
  const rulesWithStock = rules.map((r) => {
    const currentStock = stockMap[r.shopifyVariantId];
    const hasStock = typeof currentStock === "number";
    return {
      id: r.id,
      shopifyVariantId: r.shopifyVariantId,
      shopifyProductId: r.shopifyProductId,
      title: r.title,
      variantTitle: r.variantTitle,
      sku: r.sku,
      reorderPoint: r.reorderPoint,
      reorderQty: r.reorderQty,
      currentStock: hasStock ? currentStock : null,
      belowThreshold: hasStock ? currentStock <= r.reorderPoint : false,
    };
  });

  return json({ rules: rulesWithStock });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent");

  // Delete a rule
  if (intent === "delete") {
    const id = String(formData.get("id") || "");
    if (!id) {
      return json({ errors: { form: "Invalid rule" } }, { status: 400 });
    }
    await prisma.reorderRule.deleteMany({ where: { id, shop } });
    return json({ errors: null, saved: true });
  }

  // Add new rules from selected variants
  if (intent === "addRules") {
    let variants: Array<{
      shopifyVariantId: string;
      shopifyProductId: string;
      title: string;
      variantTitle: string;
      sku: string;
    }> = [];

    try {
      variants = JSON.parse(String(formData.get("variants") || "[]"));
    } catch {
      return json(
        { errors: { form: "Invalid variant data" } },
        { status: 400 },
      );
    }

    if (variants.length === 0) {
      return json(
        { errors: { form: "No products selected" } },
        { status: 400 },
      );
    }

    // Upsert each — skip if a rule already exists for that variant
    for (const v of variants) {
      await prisma.reorderRule.upsert({
        where: {
          shop_shopifyVariantId: {
            shop,
            shopifyVariantId: v.shopifyVariantId,
          },
        },
        update: {
          title: v.title,
          variantTitle: v.variantTitle || null,
          sku: v.sku || null,
        },
        create: {
          shop,
          shopifyVariantId: v.shopifyVariantId,
          shopifyProductId: v.shopifyProductId,
          title: v.title,
          variantTitle: v.variantTitle || null,
          sku: v.sku || null,
          reorderPoint: 0,
          reorderQty: null,
        },
      });
    }

    return json({ errors: null, saved: true });
  }

  // Update reorderPoint / reorderQty for a rule
  if (intent === "updateRule") {
    const id = String(formData.get("id") || "");
    const reorderPoint = parseIntSafe(formData.get("reorderPoint"), 0, 0);
    const reorderQtyRaw = formData.get("reorderQty");
    const reorderQty =
      reorderQtyRaw && String(reorderQtyRaw).trim() !== ""
        ? parseIntSafe(reorderQtyRaw, 0, 0)
        : null;

    if (!id) {
      return json({ errors: { form: "Invalid rule" } }, { status: 400 });
    }

    await prisma.reorderRule.updateMany({
      where: { id, shop },
      data: { reorderPoint, reorderQty },
    });

    return json({ errors: null, saved: true });
  }

  return json({ errors: { form: "Unknown action" } }, { status: 400 });
};

export default function ReorderRulesPage() {
  const { rules } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const shopify = useAppBridge();

  const isSubmitting = navigation.state === "submitting";

  // Local editable state for reorderPoint / reorderQty per rule id
  const [edits, setEdits] = useState<
    Record<string, { reorderPoint: string; reorderQty: string }>
  >(() => {
    const initial: Record<string, { reorderPoint: string; reorderQty: string }> =
      {};
    for (const r of rules) {
      initial[r.id] = {
        reorderPoint: String(r.reorderPoint),
        reorderQty: r.reorderQty != null ? String(r.reorderQty) : "",
      };
    }
    return initial;
  });

  const handleAddProducts = useCallback(async () => {
    try {
      const selection = await shopify.resourcePicker({
        type: "product",
        multiple: true,
        action: "select",
      });

      if (!selection || selection.length === 0) return;

      const variants: any[] = [];
      for (const product of selection) {
        for (const variant of product.variants) {
          variants.push({
            shopifyVariantId: String(variant.id),
            shopifyProductId: String(product.id),
            title: product.title,
            variantTitle:
              variant.title === "Default Title" ? "" : variant.title,
            sku: variant.sku || "",
          });
        }
      }

      const formData = new FormData();
      formData.append("intent", "addRules");
      formData.append("variants", JSON.stringify(variants));
      submit(formData, { method: "post" });
    } catch {
      // cancelled
    }
  }, [shopify, submit]);

  const handleSaveRule = useCallback(
    (id: string) => {
      const edit = edits[id];
      if (!edit) return;
      const formData = new FormData();
      formData.append("intent", "updateRule");
      formData.append("id", id);
      formData.append("reorderPoint", edit.reorderPoint || "0");
      formData.append("reorderQty", edit.reorderQty || "");
      submit(formData, { method: "post" });
    },
    [edits, submit],
  );

  const handleDeleteRule = useCallback(
    (id: string) => {
      const formData = new FormData();
      formData.append("intent", "delete");
      formData.append("id", id);
      submit(formData, { method: "post" });
    },
    [submit],
  );

  const updateEdit = useCallback(
    (id: string, field: "reorderPoint" | "reorderQty", value: string) => {
      setEdits((prev) => ({
        ...prev,
        [id]: { ...prev[id], [field]: value },
      }));
    },
    [],
  );

  const errors = (actionData as any)?.errors || {};
  const lowStockCount = rules.filter((r) => r.belowThreshold).length;

  return (
    <Page
      title="Reorder Rules"
      subtitle="Set minimum stock levels and get alerted when inventory runs low"
      primaryAction={
        rules.length > 0
          ? {
              content: "Add products",
              onAction: handleAddProducts,
            }
          : undefined
      }
    >
      <Layout>
        {errors.form && (
          <Layout.Section>
            <Banner tone="critical">{errors.form}</Banner>
          </Layout.Section>
        )}

        {/* Low stock summary banner */}
        {lowStockCount > 0 && (
          <Layout.Section>
            <Banner tone="warning" title={`${lowStockCount} item(s) need reordering`}>
              <p>
                These products are at or below their reorder point. Consider
                creating a purchase order.
              </p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card padding="0">
            {rules.length === 0 ? (
              <Box padding="400">
                <EmptyState
                  heading="Set up reorder alerts"
                  action={{
                    content: "Add products",
                    onAction: handleAddProducts,
                  }}
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>
                    Select products and set minimum stock levels. SKUward will
                    flag items when their Shopify inventory drops to or below
                    the threshold.
                  </p>
                </EmptyState>
              </Box>
            ) : (
              <IndexTable
                itemCount={rules.length}
                selectable={false}
                headings={[
                  { title: "Product" },
                  { title: "SKU" },
                  { title: "Current stock" },
                  { title: "Reorder point" },
                  { title: "Reorder qty" },
                  { title: "Status" },
                  { title: "" },
                ]}
              >
                {rules.map((rule, index) => {
                  const edit = edits[rule.id] || {
                    reorderPoint: String(rule.reorderPoint),
                    reorderQty: rule.reorderQty != null ? String(rule.reorderQty) : "",
                  };
                  const dirty =
                    edit.reorderPoint !== String(rule.reorderPoint) ||
                    edit.reorderQty !==
                      (rule.reorderQty != null ? String(rule.reorderQty) : "");

                  return (
                    <IndexTable.Row id={rule.id} key={rule.id} position={index}>
                      <IndexTable.Cell>
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          {rule.title}
                          {rule.variantTitle ? ` - ${rule.variantTitle}` : ""}
                        </Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>{rule.sku || "—"}</IndexTable.Cell>
                      <IndexTable.Cell>
                        {rule.currentStock != null ? (
                          <Text
                            as="span"
                            tone={rule.belowThreshold ? "critical" : undefined}
                            fontWeight={rule.belowThreshold ? "bold" : undefined}
                          >
                            {rule.currentStock}
                          </Text>
                        ) : (
                          <Text as="span" tone="subdued">
                            N/A
                          </Text>
                        )}
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Box width="90px">
                          <TextField
                            label=""
                            labelHidden
                            type="number"
                            value={edit.reorderPoint}
                            onChange={(val) =>
                              updateEdit(rule.id, "reorderPoint", val)
                            }
                            autoComplete="off"
                            min={0}
                          />
                        </Box>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Box width="90px">
                          <TextField
                            label=""
                            labelHidden
                            type="number"
                            value={edit.reorderQty}
                            onChange={(val) =>
                              updateEdit(rule.id, "reorderQty", val)
                            }
                            autoComplete="off"
                            min={0}
                            placeholder="—"
                          />
                        </Box>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        {rule.currentStock == null ? (
                          <Badge>Untracked</Badge>
                        ) : rule.belowThreshold ? (
                          <Badge tone="critical">Reorder</Badge>
                        ) : (
                          <Badge tone="success">OK</Badge>
                        )}
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <InlineStack gap="200">
                          <Button
                            size="slim"
                            variant="primary"
                            disabled={!dirty}
                            loading={isSubmitting}
                            onClick={() => handleSaveRule(rule.id)}
                          >
                            Save
                          </Button>
                          <Button
                            size="slim"
                            tone="critical"
                            variant="plain"
                            onClick={() => handleDeleteRule(rule.id)}
                          >
                            Remove
                          </Button>
                        </InlineStack>
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
