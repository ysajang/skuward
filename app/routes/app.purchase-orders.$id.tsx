import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
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
  Badge,
  ProgressBar,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  sanitizeString,
  parseIntSafe,
  parseDecimalSafe,
} from "../utils/validation";
import { generatePONumber } from "../utils/po-number";
import { adjustInventoryOnReceive } from "../utils/shopify-inventory.server";
import { getShopPlan } from "../utils/billing.server";
import { canCreatePO } from "../utils/plan-limits";
import { monthRange } from "../utils/month-range";

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
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent");

  // =============================================
  // Intent: receive (입고 처리)
  // =============================================
  if (intent === "receive") {
    const poId = params.id;
    if (!poId || poId === "new") {
      return json({ errors: { form: "Invalid PO" } }, { status: 400 });
    }

    // Parse receiving quantities from form
    const receivingDataJson = formData.get("receivingData");
    let receivingData: Array<{
      lineItemId: string;
      quantityToReceive: number;
    }> = [];

    try {
      receivingData = JSON.parse(String(receivingDataJson || "[]"));
    } catch {
      return json(
        { errors: { form: "Invalid receiving data" } },
        { status: 400 },
      );
    }

    // Validate: at least one item with quantity > 0
    const hasQuantity = receivingData.some(
      (item) => item.quantityToReceive > 0,
    );
    if (!hasQuantity) {
      return json(
        { errors: { form: "Enter at least one quantity to receive" } },
        { status: 400 },
      );
    }

    // Load PO with line items for validation
    const po = await prisma.purchaseOrder.findFirst({
      where: { id: poId, shop },
      include: { lineItems: true },
    });

    if (!po) {
      return json(
        { errors: { form: "Purchase order not found" } },
        { status: 404 },
      );
    }

    if (po.status !== "ORDERED" && po.status !== "PARTIALLY_RECEIVED") {
      return json(
        {
          errors: {
            form: `Cannot receive items for a PO with status: ${po.status}`,
          },
        },
        { status: 400 },
      );
    }

    // Validate quantities don't exceed remaining
    const validationErrors: string[] = [];
    const adjustments: Array<{
      lineItemId: string;
      variantId: string;
      deltaQuantity: number;
      newQuantityReceived: number;
    }> = [];

    for (const item of receivingData) {
      if (item.quantityToReceive <= 0) continue;

      const lineItem = po.lineItems.find((li) => li.id === item.lineItemId);
      if (!lineItem) {
        validationErrors.push(`Line item ${item.lineItemId} not found`);
        continue;
      }

      const remaining =
        lineItem.quantityOrdered - lineItem.quantityReceived;
      if (item.quantityToReceive > remaining) {
        validationErrors.push(
          `${lineItem.title}: receiving ${item.quantityToReceive} exceeds remaining ${remaining}`,
        );
        continue;
      }

      adjustments.push({
        lineItemId: lineItem.id,
        variantId: lineItem.shopifyVariantId,
        deltaQuantity: item.quantityToReceive,
        newQuantityReceived:
          lineItem.quantityReceived + item.quantityToReceive,
      });
    }

    if (validationErrors.length > 0) {
      return json(
        { errors: { form: validationErrors.join("; ") } },
        { status: 400 },
      );
    }

    // 1) Adjust Shopify inventory
    const inventoryResult = await adjustInventoryOnReceive(
      admin,
      adjustments.map((a) => ({
        variantId: a.variantId,
        deltaQuantity: a.deltaQuantity,
      })),
    );

    if (!inventoryResult.success) {
      return json(
        {
          errors: {
            form: `Shopify inventory update failed: ${inventoryResult.errors.join("; ")}`,
          },
        },
        { status: 500 },
      );
    }

    // 2) Update DB: line item quantities + PO status + cost records
    await prisma.$transaction(async (tx) => {
      for (const adj of adjustments) {
        await tx.pOLineItem.update({
          where: { id: adj.lineItemId },
          data: { quantityReceived: adj.newQuantityReceived },
        });
      }

      // Refresh line items to determine PO status
      const updatedLineItems = await tx.pOLineItem.findMany({
        where: { purchaseOrderId: poId },
      });

      const allReceived = updatedLineItems.every(
        (li) => li.quantityReceived >= li.quantityOrdered,
      );
      const someReceived = updatedLineItems.some(
        (li) => li.quantityReceived > 0,
      );

      let newStatus: "RECEIVED" | "PARTIALLY_RECEIVED" | "ORDERED";
      if (allReceived) {
        newStatus = "RECEIVED";
      } else if (someReceived) {
        newStatus = "PARTIALLY_RECEIVED";
      } else {
        newStatus = "ORDERED";
      }

      const updateData: any = { status: newStatus };
      if (newStatus === "RECEIVED") {
        updateData.receivedAt = new Date();
      }

      await tx.purchaseOrder.update({
        where: { id: poId },
        data: updateData,
      });

      // 3) Create CostRecord for each received item
      for (const adj of adjustments) {
        const lineItem = po.lineItems.find(
          (li) => li.id === adj.lineItemId,
        );
        if (!lineItem) continue;

        const costPerUnit = Number(lineItem.costPerUnit);
        if (costPerUnit > 0) {
          await tx.costRecord.create({
            data: {
              shop,
              shopifyVariantId: lineItem.shopifyVariantId,
              shopifyProductId: lineItem.shopifyProductId,
              costPerUnit: costPerUnit,
              source: "po_receiving",
            },
          });
        }
      }
    });

    return json({ errors: null, received: true });
  }

  // =============================================
  // Intent: delete
  // =============================================
  if (intent === "delete") {
    const poId = params.id;
    if (!poId || poId === "new") {
      return json({ errors: { form: "Invalid PO" } }, { status: 400 });
    }

    await prisma.purchaseOrder.delete({ where: { id: poId } });
    return redirect("/app/purchase-orders");
  }

  // =============================================
  // Intent: updateStatus
  // =============================================
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

  // =============================================
  // Intent: save (create/update PO)
  // =============================================
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
    // Plan gating: enforce monthly PO quota at creation time only. Existing POs
    // are always viewable/editable even if a downgrade puts the shop over limit.
    const plan = await getShopPlan(shop);
    const { start, end } = monthRange();
    const poThisMonth = await prisma.purchaseOrder.count({
      where: { shop, createdAt: { gte: start, lt: end } },
    });
    if (!canCreatePO(plan, poThisMonth)) {
      // Not an error — redirect to the list with an upgrade prompt (conversion).
      return redirect("/app/purchase-orders?limit=po");
    }

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
  const navigation = useNavigation();

  const isNew = !purchaseOrder;
  const isDraft = !purchaseOrder || purchaseOrder.status === "DRAFT";
  const isReceivable =
    purchaseOrder?.status === "ORDERED" ||
    purchaseOrder?.status === "PARTIALLY_RECEIVED";
  const isSubmitting = navigation.state === "submitting";

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

  // Receiving state: track how many to receive per line item
  const [receivingQtys, setReceivingQtys] = useState<Record<string, number>>(
    () => {
      const initial: Record<string, number> = {};
      if (isReceivable) {
        for (const li of existingLineItems as any[]) {
          const remaining = li.quantityOrdered - li.quantityReceived;
          initial[li.id] = remaining; // Default to remaining qty
        }
      }
      return initial;
    },
  );

  const [showReceivingForm, setShowReceivingForm] = useState(false);

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
              variantTitle:
                variant.title === "Default Title" ? "" : variant.title,
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

  const handleReceive = useCallback(() => {
    const receivingData = Object.entries(receivingQtys)
      .filter(([_, qty]) => qty > 0)
      .map(([lineItemId, quantityToReceive]) => ({
        lineItemId,
        quantityToReceive,
      }));

    const formData = new FormData();
    formData.append("intent", "receive");
    formData.append("receivingData", JSON.stringify(receivingData));
    submit(formData, { method: "post" });
  }, [receivingQtys, submit]);

  const updateReceivingQty = useCallback(
    (lineItemId: string, value: number) => {
      setReceivingQtys((prev) => ({ ...prev, [lineItemId]: value }));
    },
    [],
  );

  const fillAllRemaining = useCallback(() => {
    const updated: Record<string, number> = {};
    for (const li of existingLineItems as any[]) {
      updated[li.id] = li.quantityOrdered - li.quantityReceived;
    }
    setReceivingQtys(updated);
  }, [existingLineItems]);

  const clearAllReceiving = useCallback(() => {
    const updated: Record<string, number> = {};
    for (const li of existingLineItems as any[]) {
      updated[li.id] = 0;
    }
    setReceivingQtys(updated);
  }, [existingLineItems]);

  const totalCost = lineItems.reduce(
    (sum, item) => sum + item.quantity * item.costPerUnit,
    0,
  );

  const errors = (actionData as any)?.errors || {};

  // Status badge tone mapping
  const statusBadge = (status: string) => {
    switch (status) {
      case "DRAFT":
        return <Badge>Draft</Badge>;
      case "ORDERED":
        return <Badge tone="info">Ordered</Badge>;
      case "PARTIALLY_RECEIVED":
        return <Badge tone="warning">Partially Received</Badge>;
      case "RECEIVED":
        return <Badge tone="success">Received</Badge>;
      case "CANCELLED":
        return <Badge tone="critical">Cancelled</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  return (
    <Page
      backAction={{ url: "/app/purchase-orders" }}
      title={isNew ? "Create Purchase Order" : purchaseOrder.poNumber}
      titleMetadata={purchaseOrder ? statusBadge(purchaseOrder.status) : undefined}
    >
      <Layout>
        {errors.form && (
          <Layout.Section>
            <Banner tone="critical">{errors.form}</Banner>
          </Layout.Section>
        )}
        {(actionData as any)?.saved && (
          <Layout.Section>
            <Banner tone="success">Purchase order saved.</Banner>
          </Layout.Section>
        )}
        {(actionData as any)?.received && (
          <Layout.Section>
            <Banner tone="success">
              Items received successfully! Shopify inventory has been updated.
            </Banner>
          </Layout.Section>
        )}

        {/* Status Actions */}
        {purchaseOrder && purchaseOrder.status !== "CANCELLED" && (
          <Layout.Section>
            <Card>
              <InlineStack gap="300" blockAlign="center">
                {purchaseOrder.status === "DRAFT" && (
                  <Button
                    onClick={() => handleStatusChange("ORDERED")}
                    loading={isSubmitting}
                  >
                    Mark as Ordered
                  </Button>
                )}
                {isReceivable && !showReceivingForm && (
                  <Button
                    variant="primary"
                    onClick={() => setShowReceivingForm(true)}
                  >
                    Receive Items
                  </Button>
                )}
                {isReceivable && showReceivingForm && (
                  <Button
                    onClick={() => setShowReceivingForm(false)}
                  >
                    Cancel Receiving
                  </Button>
                )}
                {purchaseOrder.status !== "RECEIVED" && (
                  <Button
                    tone="critical"
                    onClick={() => handleStatusChange("CANCELLED")}
                    loading={isSubmitting}
                  >
                    Cancel PO
                  </Button>
                )}
              </InlineStack>
            </Card>
          </Layout.Section>
        )}

        {/* ============================================ */}
        {/* Receiving Form — shown when "Receive Items" clicked */}
        {/* ============================================ */}
        {isReceivable && showReceivingForm && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Receive Inventory
                  </Text>
                  <InlineStack gap="200">
                    <Button size="slim" onClick={fillAllRemaining}>
                      Fill all remaining
                    </Button>
                    <Button size="slim" onClick={clearAllReceiving}>
                      Clear all
                    </Button>
                  </InlineStack>
                </InlineStack>

                <DataTable
                  columnContentTypes={[
                    "text",
                    "text",
                    "numeric",
                    "numeric",
                    "numeric",
                    "numeric",
                  ]}
                  headings={[
                    "Product",
                    "SKU",
                    "Ordered",
                    "Already Received",
                    "Remaining",
                    "Receive Now",
                  ]}
                  rows={(existingLineItems as any[]).map((li) => {
                    const remaining =
                      li.quantityOrdered - li.quantityReceived;
                    const currentQty = receivingQtys[li.id] || 0;
                    return [
                      `${li.title}${li.variantTitle ? ` - ${li.variantTitle}` : ""}`,
                      li.sku || "—",
                      String(li.quantityOrdered),
                      String(li.quantityReceived),
                      String(remaining),
                      remaining > 0 ? (
                        <TextField
                          label=""
                          labelHidden
                          type="number"
                          value={String(currentQty)}
                          onChange={(val) => {
                            const parsed = parseInt(val) || 0;
                            const clamped = Math.min(
                              Math.max(0, parsed),
                              remaining,
                            );
                            updateReceivingQty(li.id, clamped);
                          }}
                          autoComplete="off"
                          min={0}
                          max={remaining}
                        />
                      ) : (
                        <Badge tone="success">Complete</Badge>
                      ),
                    ];
                  })}
                />

                <InlineStack align="end">
                  <Button
                    variant="primary"
                    onClick={handleReceive}
                    loading={isSubmitting}
                    disabled={
                      !Object.values(receivingQtys).some((q) => q > 0)
                    }
                  >
                    Confirm & Update Shopify Inventory
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* ============================================ */}
        {/* Receiving Progress (for ORDERED/PARTIALLY_RECEIVED) */}
        {/* ============================================ */}
        {purchaseOrder &&
          (purchaseOrder.status === "ORDERED" ||
            purchaseOrder.status === "PARTIALLY_RECEIVED" ||
            purchaseOrder.status === "RECEIVED") && (
            <Layout.Section>
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Receiving Progress
                  </Text>
                  {(existingLineItems as any[]).map((li) => {
                    const progress =
                      li.quantityOrdered > 0
                        ? Math.round(
                            (li.quantityReceived / li.quantityOrdered) * 100,
                          )
                        : 0;
                    return (
                      <BlockStack key={li.id} gap="100">
                        <InlineStack align="space-between">
                          <Text as="span" variant="bodyMd">
                            {li.title}
                            {li.variantTitle ? ` - ${li.variantTitle}` : ""}
                          </Text>
                          <Text as="span" variant="bodyMd" tone="subdued">
                            {li.quantityReceived} / {li.quantityOrdered}
                          </Text>
                        </InlineStack>
                        <ProgressBar
                          progress={progress}
                          tone={progress >= 100 ? "success" : "highlight"}
                          size="small"
                        />
                      </BlockStack>
                    );
                  })}
                </BlockStack>
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
                  <Button onClick={handleAddProducts}>Add products</Button>
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
                  totals={[
                    "",
                    "",
                    "",
                    "Total",
                    `$${totalCost.toFixed(2)}`,
                    "",
                  ]}
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
                loading: isSubmitting,
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
