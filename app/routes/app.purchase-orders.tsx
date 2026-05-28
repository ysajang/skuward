import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  IndexTable,
  Text,
  Badge,
  EmptyState,
  Filters,
  ChoiceList,
  InlineStack,
  Button,
} from "@shopify/polaris";
import { useState, useCallback } from "react";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const STATUS_BADGE_MAP: Record<string, { tone: any; label: string }> = {
  DRAFT: { tone: undefined, label: "Draft" },
  ORDERED: { tone: "info", label: "Ordered" },
  PARTIALLY_RECEIVED: { tone: "warning", label: "Partial" },
  RECEIVED: { tone: "success", label: "Received" },
  CANCELLED: { tone: "critical", label: "Cancelled" },
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const purchaseOrders = await prisma.purchaseOrder.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    include: {
      supplier: { select: { name: true } },
      _count: { select: { lineItems: true } },
    },
    take: 50,
  });

  const totalCount = await prisma.purchaseOrder.count({ where: { shop } });

  return json({ purchaseOrders, totalCount });
};

export default function PurchaseOrdersPage() {
  const { purchaseOrders, totalCount } = useLoaderData<typeof loader>();
  const [statusFilter, setStatusFilter] = useState<string[]>([]);

  const handleStatusFilterChange = useCallback(
    (value: string[]) => setStatusFilter(value),
    [],
  );

  const handleStatusFilterRemove = useCallback(
    () => setStatusFilter([]),
    [],
  );

  const filteredOrders = statusFilter.length > 0
    ? purchaseOrders.filter((po) => statusFilter.includes(po.status))
    : purchaseOrders;

  if (purchaseOrders.length === 0) {
    return (
      <Page title="Purchase Orders">
        <Layout>
          <Layout.Section>
            <InlineStack align="end">
              <Link to="/app/purchase-orders/new">
                <Button variant="primary">Create PO</Button>
              </Link>
            </InlineStack>
          </Layout.Section>
          <Layout.Section>
            <Card>
              <EmptyState
                heading="Create your first purchase order"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>
                  Track orders to your suppliers and automatically update
                  inventory when stock arrives.
                </p>
              </EmptyState>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const rowMarkup = filteredOrders.map((po, index) => {
    const badge = STATUS_BADGE_MAP[po.status] || STATUS_BADGE_MAP.DRAFT;

    return (
      <IndexTable.Row
        id={po.id}
        key={po.id}
        position={index}
      >
        <IndexTable.Cell>
          <Link to={`/app/purchase-orders/${po.id}`}>
            <Text variant="bodyMd" fontWeight="bold" as="span">
              {po.poNumber}
            </Text>
          </Link>
        </IndexTable.Cell>
        <IndexTable.Cell>{po.supplier.name}</IndexTable.Cell>
        <IndexTable.Cell>
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>
          {po._count.lineItems} item{po._count.lineItems !== 1 ? "s" : ""}
        </IndexTable.Cell>
        <IndexTable.Cell>
          {new Date(po.createdAt).toLocaleDateString()}
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  const filters = [
    {
      key: "status",
      label: "Status",
      filter: (
        <ChoiceList
          title="Status"
          titleHidden
          choices={[
            { label: "Draft", value: "DRAFT" },
            { label: "Ordered", value: "ORDERED" },
            { label: "Partially Received", value: "PARTIALLY_RECEIVED" },
            { label: "Received", value: "RECEIVED" },
            { label: "Cancelled", value: "CANCELLED" },
          ]}
          selected={statusFilter}
          onChange={handleStatusFilterChange}
          allowMultiple
        />
      ),
      shortcut: true,
    },
  ];

  const appliedFilters = statusFilter.length > 0
    ? [
        {
          key: "status",
          label: `Status: ${statusFilter
            .map((s) => STATUS_BADGE_MAP[s]?.label || s)
            .join(", ")}`,
          onRemove: handleStatusFilterRemove,
        },
      ]
    : [];

  return (
    <Page
      title="Purchase Orders"
      subtitle={`${totalCount} total`}
    >
      <Layout>
        <Layout.Section>
          <InlineStack align="end">
            <Link to="/app/purchase-orders/new">
              <Button variant="primary">Create PO</Button>
            </Link>
          </InlineStack>
        </Layout.Section>
        <Layout.Section>
          <Card padding="0">
            <IndexTable
              itemCount={filteredOrders.length}
              headings={[
                { title: "PO Number" },
                { title: "Supplier" },
                { title: "Status" },
                { title: "Items" },
                { title: "Created" },
              ]}
              selectable={false}
              filterControl={
                <Filters
                  queryValue=""
                  filters={filters}
                  appliedFilters={appliedFilters}
                  onQueryChange={() => {}}
                  onQueryClear={() => {}}
                  onClearAll={handleStatusFilterRemove}
                  queryPlaceholder="Filter purchase orders"
                  disableQueryField
                />
              }
            >
              {rowMarkup}
            </IndexTable>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
