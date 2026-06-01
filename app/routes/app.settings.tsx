import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Banner,
  Divider,
  List,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import {
  getShopPlan,
  BILLING_PLANS,
  STARTER_PLAN,
  PRO_PLAN,
  type BillingPlanName,
} from "../utils/billing.server";
import type { PlanType } from "@prisma/client";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const plan = await getShopPlan(session.shop);
  return json({ plan });
};

const PLAN_FEATURES: Record<BillingPlanName, string[]> = {
  [STARTER_PLAN]: [
    "Unlimited purchase orders",
    "Up to 10 suppliers",
    "Unlimited reorder rules",
    "Cost & margin tracking (COGS)",
  ],
  [PRO_PLAN]: [
    "Everything in Starter",
    "Unlimited suppliers",
    "Margin reports & CSV export",
    "Priority support",
  ],
};

function planBadgeTone(plan: PlanType): "info" | "success" | "attention" {
  if (plan === "PRO") return "success";
  if (plan === "STARTER") return "attention";
  return "info";
}

function planLabel(plan: PlanType): string {
  if (plan === "STARTER") return "Starter";
  if (plan === "PRO") return "Pro";
  return "Free Plan";
}

function PlanCard({
  name,
  currentPlan,
}: {
  name: BillingPlanName;
  currentPlan: PlanType;
}) {
  const config = BILLING_PLANS[name];
  const isCurrent = currentPlan === config.planType;
  const submit = useSubmit();
  const navigation = useNavigation();
  const submitting =
    navigation.state !== "idle" &&
    navigation.formData?.get("plan") === name;

  const handleUpgrade = () => {
    // Submit within the embedded app so App Bridge attaches the session token.
    // The /app/upgrade action calls billing.request, which throws the
    // App Bridge top-level redirect to Shopify's confirmation page.
    submit({ plan: name }, { method: "post", action: "/app/upgrade" });
  };

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h3" variant="headingMd">
            {name}
          </Text>
          {isCurrent ? <Badge tone="success">Current</Badge> : null}
        </InlineStack>
        <Text as="p" variant="headingLg">
          {`$${config.amount.toFixed(2)} `}
          <Text as="span" variant="bodySm" tone="subdued">
            / month
          </Text>
        </Text>
        <List type="bullet">
          {PLAN_FEATURES[name].map((f) => (
            <List.Item key={f}>{f}</List.Item>
          ))}
        </List>
        <Button
          variant={name === PRO_PLAN ? "primary" : "secondary"}
          disabled={isCurrent || submitting}
          loading={submitting}
          onClick={handleUpgrade}
        >
          {isCurrent ? "Active" : `Upgrade to ${name}`}
        </Button>
      </BlockStack>
    </Card>
  );
}

export default function SettingsPage() {
  const { plan } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const billingError = searchParams.get("billing_error");

  return (
    <Page title="Settings">
      <Layout>
        {billingError ? (
          <Layout.Section>
            <Banner tone="critical" title="Could not start checkout">
              <p>
                Something went wrong selecting that plan. Please try again or
                contact support.
              </p>
            </Banner>
          </Layout.Section>
        ) : null}

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Current Plan
              </Text>
              <InlineStack gap="200" blockAlign="center">
                <Badge tone={planBadgeTone(plan)}>{planLabel(plan)}</Badge>
                {plan === "FREE" ? (
                  <Text as="span" variant="bodyMd" tone="subdued">
                    5 POs / month · 2 suppliers · 3 reorder rules
                  </Text>
                ) : null}
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Upgrade
            </Text>
            <Divider />
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneHalf">
          <PlanCard name={STARTER_PLAN} currentPlan={plan} />
        </Layout.Section>
        <Layout.Section variant="oneHalf">
          <PlanCard name={PRO_PLAN} currentPlan={plan} />
        </Layout.Section>
      </Layout>
    </Page>
  );
}
