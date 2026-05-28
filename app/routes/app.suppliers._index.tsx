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
  InlineStack,
  Button,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const suppliers = await prisma.supplier.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: { purchaseOrders: true },
      },
    },
  });

  const supplierCount = suppliers.length;

  return json({ suppliers, supplierCount });
};

export default function SuppliersPage() {
  const { suppliers, supplierCount } = useLoaderData<typeof loader>();

  if (suppliers.length === 0) {
    return (
      <Page title="Suppliers">
        <Layout>
          <Layout.Section>
            <InlineStack align="end">
              <Link to="/app/suppliers/new">
                <Button variant="primary">Add supplier</Button>
              </Link>
            </InlineStack>
          </Layout.Section>
          <Layout.Section>
            <Card>
              <EmptyState
                heading="Manage your suppliers"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>
                  Add suppliers to track lead times and link them to purchase
                  orders.
                </p>
              </EmptyState>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const rowMarkup = suppliers.map((supplier, index) => (
    <IndexTable.Row
      id={supplier.id}
      key={supplier.id}
      position={index}
    >
      <IndexTable.Cell>
        <Link to={`/app/suppliers/${supplier.id}`}>
          <Text variant="bodyMd" fontWeight="bold" as="span">
            {supplier.name}
          </Text>
        </Link>
      </IndexTable.Cell>
      <IndexTable.Cell>{supplier.email || "—"}</IndexTable.Cell>
      <IndexTable.Cell>{supplier.phone || "—"}</IndexTable.Cell>
      <IndexTable.Cell>
        <Badge>{supplier.leadTimeDays} days</Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        {supplier._count.purchaseOrders} POs
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page
      title="Suppliers"
      subtitle={`${supplierCount} supplier${supplierCount !== 1 ? "s" : ""}`}
    >
      <Layout>
        <Layout.Section>
          <InlineStack align="end">
            <Link to="/app/suppliers/new">
              <Button variant="primary">Add supplier</Button>
            </Link>
          </InlineStack>
        </Layout.Section>
        <Layout.Section>
          <Card padding="0">
            <IndexTable
              itemCount={suppliers.length}
              headings={[
                { title: "Name" },
                { title: "Email" },
                { title: "Phone" },
                { title: "Lead time" },
                { title: "POs" },
              ]}
              selectable={false}
            >
              {rowMarkup}
            </IndexTable>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
