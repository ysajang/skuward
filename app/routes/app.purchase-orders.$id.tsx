import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  useActionData,
  useLoaderData,
  useSubmit,
} from "@remix-run/react";
import { useState, useCallback } from "react";
import {
  Page,
  Layout,
  Card,
  FormLayout,
  TextField,
  Select,
  Button,
  Banner,
  PageActions,
  DataTable,
  Text,
  BlockStack,
  InlineStack,
  Divider,
  Box,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { sanitizeString, parseIntSafe, parseDecimalSafe } from "../utils/validation";
import { generatePONumber } from "../utils/po-number";

interface LineItemDraft {
  shopifyVariantId: string;
  shopifyProductId: string;
  title: string;
  variantTitle: string;
  sku: string;
  quantity: number;
  costPerUnit: number;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const poId = params.id;

  const suppliers = await prisma.supplier.findMany({
    where: { shop },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  if (poId === "new") {
    return json({
      purchaseOrder: null,
      suppliers,
      lineItems: [],
    });
  }

  const purchaseOrder = await prisma.purchaseOrder.findFirst({
    where: { id: poId, shop },
    include: {
      supplier: { select: { id: true, name: true } },
      lineItems: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!purchaseOrder) {
    throw new Response("Purchase order not found", { status: 404 });
  }

  return json({
    purchaseOrder,
    suppliers,
    lineItems: purchaseOrder.lineItems,
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent");

  // Delete PO
  if (intent === "delete") {
    const poId = params.id;
    if (!poId || poId === "new") {
      return json({ errors: { form: "Invalid PO" } }, { status: 400 });
    }

    await prisma.purchaseOrder.delete({ where: { id: poId } });
    return redirect("/app/purchase-orders");
  }

  // Update status
  if (intent === "updateStatus") {
    const poId = params.id;
    const newStatus = formData.get("status") as string;

    if (!poId || poId === "new") {
      return json({ errors: { form: "Invalid PO" } }, { status: 400 });
    }

    const validStatuses = [
      "DRAFT",
      "ORDERED",
      "PARTIALLY_RECEIVED",
      "RECEIVED",
      "CANCELLED",
    ];
    if (!validStatuses.includes(newStatus)) {
      return json({ errors: { form: "Invalid status" } }, { status: 400 });
    }

    const updateData: any = { status: newStatus };
    if (newStatus === "ORDERED") {
      updateData.orderedAt = new Date();
    } else if (newStatus === "RECEIVED") {
      updateData.receivedAt = new Date();
    }

    await prisma.purchaseOrder.update({
      where: { id: poId },
      data: updateData,
    });

    return json({ errors: null, saved: true });
  }

  // Create or update PO
  const supplierId = sanitizeString(formData.get("supplierId"), 100);
  const notes = sanitizeString(formData.get("notes"), 2000);
  const expectedAt = formData.get("expectedAt")
    ? new Date(String(formData.get("expectedAt")))
    : null;

  const lineItemsJson = formData.get("lineItems");
  let lineItems: LineItemDraft[] = [];
  try {
    lineItems = JSON.parse(String(lineItemsJson || "[]"));
  } catch {
    return json(
      { errors: { form: "Invalid line items data" } },
      { status: 400 },
    );
  }

  const errors: Record<string, string> = {};

  if (!supplierId) {
    errors.supplierId = "Please select a supplier";
  }

  if (lineItems.length === 0) {
    errors.lineItems = "Add at least one product";
  }

  if (Object.keys(errors).length > 0) {
    return json({ errors }, { status: 400 });
  }

  const poId = params.id;

  if (poId === "new") {
    const poNumber = generatePONumber();

    const po = await prisma.purchaseOrder.create({
      data: {
        shop,
        poNumber,
        supplierId,
        notes: notes || null,
        expectedAt,
        lineItems: {
          create: lineItems.map((item) => ({
            shopifyVariantId: item.shopifyVariantId,
            shopifyProductId: item.shopifyProductId,
            title: item.title,
            variantTitle: item.variantTitle || null,
            sku: item.sku || null,
            quantityOrdered: parseIntSafe(item.quantity, 1, 1),
            costPerUnit: parseDecimalSafe(item.costPerUnit, 0),
          })),
        },
      },
    });

    return redirect(`/app/purchase-orders/${po.id}`);
  }

  // Update existing PO
  await prisma.$transaction(async (tx) => {
    await tx.purchaseOrder.update({
      where: { id: poId },
      data: {
        supplierId,
        notes: notes || null,
        expectedAt,
      },
    });

    // Replace line items
    await tx.pOLineItem.deleteMany({ where: { purchaseOrderId: poId } });

    await tx.pOLineItem.createMany({
      data: lineItems.map((item) => ({
        purchaseOrderId: poId!,
        shopifyVariantId: item.shopifyVariantId,
        shopifyProductId: item.shopifyProductId,
        title: item.title,
        variantTitle: item.variantTitle || null,
        sku: item.sku || null,
        quantityOrdered: parseIntSafe(item.quantity, 1, 1),
        costPerUnit: parseDecimalSafe(item.costPerUnit, 0),
      })),
    });
  });

  return json({ errors: null, saved: true });
};

export default function PurchaseOrderDetailPage() {
  const { purchaseOrder, suppliers, lineItems: existingLineItems } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();

  const isNew = !purchaseOrder;
  const isDraft = !purchaseOrder || purchaseOrder.status === "DRAFT";

  const [supplierId, setSupplierId] = useState(
    purchaseOrder?.supplierId || "",
  );
  const [notes, setNotes] = useState(purchaseOrder?.notes || "");
  const [expectedAt, setExpectedAt] = useState(
    purchaseOrder?.expectedAt
      ? new Date(purchaseOrder.expectedAt).toISOString().split("T")[0]
      : "",
  );
  const [lineItems, setLineItems] = useState<LineItemDraft[]>(
    existingLineItems.map((li: any) => ({
      shopifyVariantId: li.shopifyVariantId,
      shopifyProductId: li.shopifyProductId,
      title: li.title,
      variantTitle: li.variantTitle || "",
      sku: li.sku || "",
      quantity: li.quantityOrdered,
      costPerUnit: parseFloat(li.costPerUnit),
    })),
  );

  const shopify = useAppBridge();

  const supplierOptions = [
    { label: "Select a supplier", value: "" },
    ...suppliers.map((s: any) => ({ label: s.name, value: s.id })),
  ];

  const handleAddProducts = useCallback(async () => {
    try {
      const selection = await shopify.resourcePicker({
        type: "product",
        multiple: true,
        selectionIds: [],
        action: "select",
      });

      if (!selection || selection.length === 0) return;

      const newItems: LineItemDraft[] = [];

      for (const product of selection) {
        for (const variant of product.variants) {
          const exists = lineItems.some(
            (li) => li.shopifyVariantId === String(variant.id),
          );
          if (!exists) {
            newItems.push({
              shopifyVariantId: String(variant.id),
              shopifyProductId: String(product.id),
              title: product.title,
              variantTitle: variant.title === "Default Title" ? "" : variant.title,
              sku: variant.sku || "",
              quantity: 1,
              costPerUnit: 0,
            });
          }
        }
      }

      setLineItems((prev) => [...prev, ...newItems]);
    } catch {
      // User cancelled the picker
    }
  }, [shopify, lineItems]);

  const updateLineItem = useCallback(
    (index: number, field: keyof LineItemDraft, value: string | number) => {
      setLineItems((prev) => {
        const updated = [...prev];
        updated[index] = { ...updated[index], [field]: value };
        return updated;
      });
    },
    [],
  );

  const removeLineItem = useCallback((index: number) => {
    setLineItems((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSave = useCallback(() => {
    const formData = new FormData();
    formData.append("intent", "save");
    formData.append("supplierId", supplierId);
    formData.append("notes", notes);
    formData.append("expectedAt", expectedAt);
    formData.append("lineItems", JSON.stringify(lineItems));
    submit(formData, { method: "post" });
  }, [supplierId, notes, expectedAt, lineItems, submit]);

  const handleStatusChange = useCallback(
    (newStatus: string) => {
      const formData = new FormData();
      formData.append("intent", "updateStatus");
      formData.append("status", newStatus);
      submit(formData, { method: "post" });
    },
    [submit],
  );

  const handleDelete = useCallback(() => {
    if (!confirm("Are you sure you want to delete this purchase order?"))
      return;
    const formData = new FormData();
    formData.append("intent", "delete");
    submit(formData, { method: "post" });
  }, [submit]);

  const totalCost = lineItems.reduce(
    (sum, item) => sum + item.quantity * item.costPerUnit,
    0,
  );

  const errors = actionData?.errors || {};

  return (
    <Page
      backAction={{ url: "/app/purchase-orders" }}
      title={isNew ? "Create Purchase Order" : purchaseOrder.poNumber}
      subtitle={
        purchaseOrder
          ? `Status: ${purchaseOrder.status.replace("_", " ")}`
          : undefined
      }
    >
      <Layout>
        {errors.form && (
          <Layout.Section>
            <Banner tone="critical">{errors.form}</Banner>
          </Layout.Section>
        )}
        {actionData?.saved && (
          <Layout.Section>
            <Banner tone="success">Purchase order saved.</Banner>
          </Layout.Section>
        )}

        {/* Status Actions */}
        {purchaseOrder && purchaseOrder.status !== "CANCELLED" && (
          <Layout.Section>
            <Card>
              <InlineStack gap="300">
                {purchaseOrder.status === "DRAFT" && (
                  <Button onClick={() => handleStatusChange("ORDERED")}>
                    Mark as Ordered
                  </Button>
                )}
                {(purchaseOrder.status === "ORDERED" ||
                  purchaseOrder.status === "PARTIALLY_RECEIVED") && (
                  <Button onClick={() => handleStatusChange("RECEIVED")}>
                    Mark as Received
                  </Button>
                )}
                {purchaseOrder.status !== "RECEIVED" && (
                  <Button
                    tone="critical"
                    onClick={() => handleStatusChange("CANCELLED")}
                  >
                    Cancel
                  </Button>
                )}
              </InlineStack>
            </Card>
          </Layout.Section>
        )}

        {/* Main Form */}
        <Layout.Section>
          <Card>
            <FormLayout>
              <Select
                label="Supplier"
                options={supplierOptions}
                value={supplierId}
                onChange={setSupplierId}
                error={errors.supplierId}
                disabled={!isDraft}
              />
              <TextField
                label="Expected delivery date"
                type="date"
                value={expectedAt}
                onChange={setExpectedAt}
                autoComplete="off"
              />
              <TextField
                label="Notes"
                value={notes}
                onChange={setNotes}
                autoComplete="off"
                multiline={3}
              />
            </FormLayout>
          </Card>
        </Layout.Section>

        {/* Line Items */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">
                  Products
                </Text>
                {isDraft && (
                  <Button onClick={handleAddProducts}>
                    Add products
                  </Button>
                )}
              </InlineStack>

              {errors.lineItems && (
                <Banner tone="critical">{errors.lineItems}</Banner>
              )}

              {lineItems.length > 0 && (
                <DataTable
                  columnContentTypes={[
                    "text",
                    "text",
                    "numeric",
                    "numeric",
                    "numeric",
                    "text",
                  ]}
                  headings={[
                    "Product",
                    "SKU",
                    "Qty",
                    "Cost/unit",
                    "Total",
                    "",
                  ]}
                  rows={lineItems.map((item, index) => [
                    `${item.title}${item.variantTitle ? ` - ${item.variantTitle}` : ""}`,
                    item.sku || "—",
                    isDraft ? (
                      <TextField
                        label=""
                        labelHidden
                        type="number"
                        value={String(item.quantity)}
                        onChange={(val) =>
                          updateLineItem(
                            index,
                            "quantity",
                            Math.max(1, parseInt(val) || 1),
                          )
                        }
                        autoComplete="off"
                        min={1}
                      />
                    ) : (
                      String(item.quantity)
                    ),
                    isDraft ? (
                      <TextField
                        label=""
                        labelHidden
                        type="number"
                        value={String(item.costPerUnit)}
                        onChange={(val) =>
                          updateLineItem(
                            index,
                            "costPerUnit",
                            parseFloat(val) || 0,
                          )
                        }
                        autoComplete="off"
                        min={0}
                        step={0.01}
                      />
                    ) : (
                      `$${item.costPerUnit.toFixed(2)}`
                    ),
                    `$${(item.quantity * item.costPerUnit).toFixed(2)}`,
                    isDraft ? (
                      <Button
                        tone="critical"
                        variant="plain"
                        onClick={() => removeLineItem(index)}
                      >
                        Remove
                      </Button>
                    ) : (
                      ""
                    ),
                  ])}
                  totals={["", "", "", "Total", `$${totalCost.toFixed(2)}`, ""]}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {isDraft && (
          <Layout.Section>
            <PageActions
              primaryAction={{
                content: "Save",
                onAction: handleSave,
              }}
              secondaryActions={
                isNew
                  ? []
                  : [
                      {
                        content: "Delete",
                        destructive: true,
                        onAction: handleDelete,
                      },
                    ]
              }
            />
          </Layout.Section>
        )}
      </Layout>

    </Page>
  );
}
