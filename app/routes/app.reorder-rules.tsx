import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  EmptyState,
  Text,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return json({});
};

export default function ReorderRulesPage() {
  return (
    <Page title="Reorder Rules">
      <Layout>
        <Layout.Section>
          <Card>
            <EmptyState
              heading="Reorder alerts coming in Week 2"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>
                Set minimum stock levels for each variant and get notified
                when inventory drops below the threshold.
              </p>
            </EmptyState>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
