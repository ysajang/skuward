import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useActionData, useLoaderData, useSubmit, useNavigate } from "@remix-run/react";
import { useState, useCallback } from "react";
import {
  Page,
  Layout,
  Card,
  FormLayout,
  TextField,
  Button,
  Banner,
  PageActions,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { sanitizeString, isValidEmail, parseIntSafe } from "../utils/validation";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const supplierId = params.id;

  if (supplierId === "new") {
    return json({ supplier: null });
  }

  const supplier = await prisma.supplier.findFirst({
    where: { id: supplierId, shop },
  });

  if (!supplier) {
    throw new Response("Supplier not found", { status: 404 });
  }

  return json({ supplier });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "delete") {
    const supplierId = params.id;
    if (!supplierId || supplierId === "new") {
      return json({ errors: { form: "Invalid supplier" } }, { status: 400 });
    }

    // Check if supplier has POs
    const poCount = await prisma.purchaseOrder.count({
      where: { supplierId, shop },
    });

    if (poCount > 0) {
      return json(
        { errors: { form: "Cannot delete supplier with existing purchase orders" } },
        { status: 400 },
      );
    }

    await prisma.supplier.delete({ where: { id: supplierId } });
    return redirect("/app/suppliers");
  }

  // Create or update
  const name = sanitizeString(formData.get("name"), 200);
  const email = sanitizeString(formData.get("email"), 200);
  const phone = sanitizeString(formData.get("phone"), 50);
  const leadTimeDays = parseIntSafe(formData.get("leadTimeDays"), 7, 0, 365);
  const notes = sanitizeString(formData.get("notes"), 2000);

  const errors: Record<string, string> = {};

  if (!name) {
    errors.name = "Supplier name is required";
  }

  if (email && !isValidEmail(email)) {
    errors.email = "Invalid email format";
  }

  if (Object.keys(errors).length > 0) {
    return json({ errors }, { status: 400 });
  }

  const data = {
    shop,
    name,
    email: email || null,
    phone: phone || null,
    leadTimeDays,
    notes: notes || null,
  };

  const supplierId = params.id;

  if (supplierId === "new") {
    const supplier = await prisma.supplier.create({ data });
    return redirect(`/app/suppliers/${supplier.id}`);
  }

  await prisma.supplier.update({
    where: { id: supplierId },
    data,
  });

  return json({ errors: null, saved: true });
};

export default function SupplierDetailPage() {
  const { supplier } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigate = useNavigate();

  const isNew = !supplier;

  const [name, setName] = useState(supplier?.name || "");
  const [email, setEmail] = useState(supplier?.email || "");
  const [phone, setPhone] = useState(supplier?.phone || "");
  const [leadTimeDays, setLeadTimeDays] = useState(
    String(supplier?.leadTimeDays ?? 7),
  );
  const [notes, setNotes] = useState(supplier?.notes || "");

  const handleSave = useCallback(() => {
    const formData = new FormData();
    formData.append("name", name);
    formData.append("email", email);
    formData.append("phone", phone);
    formData.append("leadTimeDays", leadTimeDays);
    formData.append("notes", notes);
    formData.append("intent", "save");
    submit(formData, { method: "post" });
  }, [name, email, phone, leadTimeDays, notes, submit]);

  const handleDelete = useCallback(() => {
    if (!confirm("Are you sure you want to delete this supplier?")) return;
    const formData = new FormData();
    formData.append("intent", "delete");
    submit(formData, { method: "post" });
  }, [submit]);

  const errors = actionData?.errors || {};

  return (
    <Page
      backAction={{ onAction: () => navigate("/app/suppliers") }}
      title={isNew ? "Add supplier" : supplier.name}
    >
      <Layout>
        {errors.form && (
          <Layout.Section>
            <Banner tone="critical">{errors.form}</Banner>
          </Layout.Section>
        )}
        {actionData?.saved && (
          <Layout.Section>
            <Banner tone="success">Supplier saved successfully.</Banner>
          </Layout.Section>
        )}
        <Layout.Section>
          <Card>
            <FormLayout>
              <TextField
                label="Supplier name"
                value={name}
                onChange={setName}
                autoComplete="off"
                error={errors.name}
                requiredIndicator
              />
              <TextField
                label="Email"
                type="email"
                value={email}
                onChange={setEmail}
                autoComplete="off"
                error={errors.email}
              />
              <TextField
                label="Phone"
                value={phone}
                onChange={setPhone}
                autoComplete="off"
              />
              <TextField
                label="Lead time (days)"
                type="number"
                value={leadTimeDays}
                onChange={setLeadTimeDays}
                autoComplete="off"
                min={0}
                max={365}
              />
              <TextField
                label="Notes"
                value={notes}
                onChange={setNotes}
                autoComplete="off"
                multiline={4}
              />
            </FormLayout>
          </Card>
        </Layout.Section>
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
      </Layout>
    </Page>
  );
}
