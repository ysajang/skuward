import { useState, useCallback, useMemo } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Select,
  Banner,
  DataTable,
  Box,
  List,
  Badge,
  DropZone,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import { getShopPlan } from "../utils/billing.server";
import { parseCsv, CsvEmptyError, CsvTooLargeError } from "../utils/csv-parse.server";
import {
  autoGuessMapping,
  missingRequiredFields,
  groupRowsIntoPOs,
  IMPORT_FIELDS,
  type ColumnMapping,
  type ImportField,
} from "../utils/csv-import";
import { matchSkusToVariants } from "../utils/shopify-inventory.server";
import { buildPreviewSummary, type PreviewSummary } from "../utils/csv-import-preview";
import { commitImport, canCommitImport, ImportGatingError } from "../utils/csv-import-commit.server";
import { UpgradeBanner } from "../components/UpgradeBanner";

const FIELD_LABELS: Record<ImportField, string> = {
  poNumber: "PO Number *",
  vendor: "Vendor / Supplier *",
  sku: "SKU *",
  title: "Product Title",
  quantity: "Quantity *",
  costPerUnit: "Unit Cost *",
  status: "Status",
  orderedAt: "Order Date",
  ignore: "— ignore —",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const plan = await getShopPlan(session.shop);
  return json({ canCommit: canCommitImport(plan), plan });
};

type ActionResponse =
  | { step: "error"; error: string }
  | {
      step: "preview";
      headers: string[];
      mapping: ColumnMapping;
      summary: PreviewSummary;
      truncated: boolean;
      rowErrors: { rowIndex: number; reason: string }[];
      // serialized inputs needed to re-run commit without re-parsing client file
      csvText: string;
      canCommit: boolean;
    }
  | {
      step: "done";
      result: {
        createdPOCount: number;
        createdLineItemCount: number;
        createdSupplierCount: number;
        reusedSupplierCount: number;
        skippedExistingPONumbers: string[];
        includedAmountTotal: number;
        excludedAmountTotal: number;
        excludedLineCount: number;
      };
    }
  | { step: "locked" };

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const csvText = String(form.get("csvText") ?? "");

  // Parse mapping from form (field -> header). Empty/"ignore" => unmapped.
  const mapping: ColumnMapping = {};
  for (const field of IMPORT_FIELDS) {
    const header = String(form.get(`map_${field}`) ?? "").trim();
    if (header && header !== "ignore") mapping[field] = header;
  }

  let parsed;
  try {
    parsed = parseCsv(csvText);
  } catch (e) {
    if (e instanceof CsvEmptyError || e instanceof CsvTooLargeError) {
      return json<ActionResponse>({ step: "error", error: e.message }, { status: 400 });
    }
    return json<ActionResponse>({ step: "error", error: "Could not read the CSV file." }, { status: 400 });
  }

  // If no mapping posted yet, auto-guess for the first preview pass.
  const effectiveMapping =
    Object.keys(mapping).length > 0 ? mapping : autoGuessMapping(parsed.headers);

  const missing = missingRequiredFields(effectiveMapping);
  if (missing.length > 0) {
    return json<ActionResponse>({
      step: "preview",
      headers: parsed.headers,
      mapping: effectiveMapping,
      summary: emptySummary(),
      truncated: parsed.truncated,
      rowErrors: [],
      csvText,
      canCommit: false,
    });
  }

  const grouped = groupRowsIntoPOs(parsed.records, effectiveMapping);
  const distinctSkus = Array.from(
    new Set(grouped.pos.flatMap((p) => p.lineItems.map((li) => li.sku))),
  );
  const matches = await matchSkusToVariants(admin, distinctSkus);
  const summary = buildPreviewSummary(grouped.pos, matches);

  const plan = await getShopPlan(shop);
  const allowed = canCommitImport(plan);

  if (intent === "commit") {
    if (!allowed) {
      return json<ActionResponse>({ step: "locked" }, { status: 402 });
    }
    try {
      const result = await commitImport(shop, summary);
      return json<ActionResponse>({ step: "done", result });
    } catch (e) {
      if (e instanceof ImportGatingError) {
        return json<ActionResponse>({ step: "locked" }, { status: 402 });
      }
      return json<ActionResponse>(
        { step: "error", error: "Something went wrong during import. Please try again." },
        { status: 500 },
      );
    }
  }

  // intent === "preview"
  return json<ActionResponse>({
    step: "preview",
    headers: parsed.headers,
    mapping: effectiveMapping,
    summary,
    truncated: parsed.truncated,
    rowErrors: grouped.rowErrors,
    csvText,
    canCommit: allowed,
  });
};

function emptySummary(): PreviewSummary {
  return {
    pos: [],
    creatablePOCount: 0,
    emptyPOCount: 0,
    totalMatchedLines: 0,
    totalUnmatchedLines: 0,
    totalAmbiguousLines: 0,
    includedAmountTotal: 0,
    excludedAmountTotal: 0,
    vendorsToEnsure: [],
  };
}

// ----------------------------------------------------------------------------
// Component
// ----------------------------------------------------------------------------

export default function ImportRoute() {
  const { canCommit } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as ActionResponse | undefined;
  const submit = useSubmit();
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  const [csvText, setCsvText] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");

  const handleDrop = useCallback((_dropped: File[], accepted: File[]) => {
    const file = accepted[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result ?? ""));
    reader.readAsText(file);
  }, []);

  const runPreview = useCallback(
    (mapping?: ColumnMapping) => {
      const fd = new FormData();
      fd.set("intent", "preview");
      fd.set("csvText", csvText);
      if (mapping) {
        for (const f of IMPORT_FIELDS) {
          if (mapping[f]) fd.set(`map_${f}`, mapping[f]!);
        }
      }
      submit(fd, { method: "post" });
    },
    [csvText, submit],
  );

  // ----- Step: done -----
  if (actionData?.step === "done") {
    const r = actionData.result;
    return (
      <Page title="Import complete" backAction={{ url: "/app/purchase-orders" }}>
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Banner tone="success" title="Purchase orders imported successfully">
                  <p>
                    Created {r.createdPOCount} purchase orders and {r.createdLineItemCount} line items.
                  </p>
                </Banner>
                <List>
                  <List.Item>New suppliers created: {r.createdSupplierCount} / existing reused: {r.reusedSupplierCount}</List.Item>
                  <List.Item>Included amount total: {r.includedAmountTotal.toLocaleString()}</List.Item>
                  {r.excludedLineCount > 0 && (
                    <List.Item>
                      Excluded line items: {r.excludedLineCount} (SKUs not found in Shopify) — excluded amount{" "}
                      {r.excludedAmountTotal.toLocaleString()}
                    </List.Item>
                  )}
                  {r.skippedExistingPONumbers.length > 0 && (
                    <List.Item>
                      Skipped existing PO numbers: {r.skippedExistingPONumbers.join(", ")}
                    </List.Item>
                  )}
                </List>
                <InlineStack align="end">
                  <Button variant="primary" url="/app/purchase-orders">
                    View purchase orders
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const preview = actionData?.step === "preview" ? actionData : undefined;
  const missing = preview ? missingRequiredFields(preview.mapping) : [];

  return (
    <Page title="Import purchase orders from CSV" backAction={{ url: "/app/purchase-orders" }}>
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {actionData?.step === "error" && (
              <Banner tone="critical" title="Import error">
                <p>{actionData.error}</p>
              </Banner>
            )}
            {actionData?.step === "locked" && (
              <UpgradeBanner
                resource="imports"
                message="CSV import is available on the Starter plan and above. Preview your results first, then upgrade to create these purchase orders."
                to="/app/settings"
              />
            )}

            {/* Step 1: upload */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  1. Upload CSV file
                </Text>
                <Text as="p" tone="subdued">
                  Upload a purchase order CSV exported from your previous inventory tool. The
                  first row must contain headers. Rows that share the same PO number are
                  grouped into a single purchase order.
                </Text>
                <DropZone accept=".csv,text/csv" type="file" allowMultiple={false} onDrop={handleDrop}>
                  {fileName ? (
                    <Box padding="400">
                      <InlineStack gap="200" blockAlign="center">
                        <Badge tone="success">Selected</Badge>
                        <Text as="span">{fileName}</Text>
                      </InlineStack>
                    </Box>
                  ) : (
                    <DropZone.FileUpload actionTitle="Select file" actionHint=".csv files only" />
                  )}
                </DropZone>
                <InlineStack align="end">
                  <Button
                    variant="primary"
                    disabled={!csvText || busy}
                    loading={busy && !preview}
                    onClick={() => runPreview()}
                  >
                    Analyze
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>

            {/* Step 2: mapping */}
            {preview && (
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    2. Column mapping
                  </Text>
                  <Text as="p" tone="subdued">
                    Map each SKUward field to a column in your CSV. Fields marked * are required.
                  </Text>
                  <MappingEditor
                    headers={preview.headers}
                    initialMapping={preview.mapping}
                    busy={busy}
                    onApply={(m) => runPreview(m)}
                  />
                  {missing.length > 0 && (
                    <Banner tone="warning" title="Required fields are not mapped">
                      <p>Map {missing.map((f) => FIELD_LABELS[f]).join(", ")}, then analyze again.</p>
                    </Banner>
                  )}
                </BlockStack>
              </Card>
            )}

            {/* Step 3: preview summary + confirm */}
            {preview && missing.length === 0 && (
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    3. Preview
                  </Text>

                  {preview.truncated && (
                    <Banner tone="warning">
                      <p>The file has many rows, so only part of it is processed (row limit applied).</p>
                    </Banner>
                  )}

                  <DataTable
                    columnContentTypes={["text", "numeric"]}
                    headings={["Item", "Value"]}
                    rows={[
                      ["Purchase orders to create", String(preview.summary.creatablePOCount)],
                      ["Matched line items", String(preview.summary.totalMatchedLines)],
                      [
                        "Excluded (SKU not found)",
                        String(preview.summary.totalUnmatchedLines),
                      ],
                      [
                        "Excluded (duplicate / ambiguous SKU)",
                        String(preview.summary.totalAmbiguousLines),
                      ],
                      ["New suppliers to create", String(preview.summary.vendorsToEnsure.length)],
                      ["Included amount", preview.summary.includedAmountTotal.toLocaleString()],
                      ["Excluded amount", preview.summary.excludedAmountTotal.toLocaleString()],
                    ]}
                  />

                  {(preview.summary.totalUnmatchedLines > 0 ||
                    preview.summary.totalAmbiguousLines > 0) && (
                    <Banner tone="info" title="Some line items will be excluded">
                      <p>
                        Line items whose SKU is not found in Shopify, or whose SKU matches more
                        than one product, are not included in the purchase orders. Use the
                        "Excluded amount" above to compare against your source file.
                      </p>
                    </Banner>
                  )}

                  {preview.rowErrors.length > 0 && (
                    <Banner tone="warning" title={`${preview.rowErrors.length} rows with formatting errors`}>
                      <List>
                        {preview.rowErrors.slice(0, 8).map((e) => (
                          <List.Item key={e.rowIndex}>
                            Row {e.rowIndex + 2}: {e.reason}
                          </List.Item>
                        ))}
                      </List>
                    </Banner>
                  )}

                  {preview.summary.creatablePOCount === 0 ? (
                    <Banner tone="critical" title="No purchase orders to create">
                      <p>No SKUs matched. Check the SKU column mapping and the SKUs on your Shopify products.</p>
                    </Banner>
                  ) : !canCommit ? (
                    <UpgradeBanner
                      resource="imports"
                      message="You've reviewed the results. Upgrade to the Starter plan to create these purchase orders in one step."
                      to="/app/settings"
                    />
                  ) : (
                    <InlineStack align="end">
                      <ConfirmButton
                        csvText={preview.csvText}
                        mapping={preview.mapping}
                        busy={busy}
                      />
                    </InlineStack>
                  )}
                </BlockStack>
              </Card>
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function MappingEditor({
  headers,
  initialMapping,
  busy,
  onApply,
}: {
  headers: string[];
  initialMapping: ColumnMapping;
  busy: boolean;
  onApply: (m: ColumnMapping) => void;
}) {
  const [mapping, setMapping] = useState<ColumnMapping>(initialMapping);

  const headerOptions = useMemo(
    () => [{ label: "— None —", value: "ignore" }, ...headers.map((h) => ({ label: h, value: h }))],
    [headers],
  );

  const setField = (field: ImportField, value: string) => {
    setMapping((prev) => {
      const next = { ...prev };
      if (value === "ignore") delete next[field];
      else next[field] = value;
      return next;
    });
  };

  return (
    <BlockStack gap="300">
      {IMPORT_FIELDS.map((field) => (
        <InlineStack key={field} gap="300" blockAlign="center">
          <Box minWidth="160px">
            <Text as="span">{FIELD_LABELS[field]}</Text>
          </Box>
          <Box minWidth="240px">
            <Select
              label=""
              labelHidden
              options={headerOptions}
              value={mapping[field] ?? "ignore"}
              onChange={(v) => setField(field, v)}
            />
          </Box>
        </InlineStack>
      ))}
      <InlineStack align="end">
        <Button disabled={busy} loading={busy} onClick={() => onApply(mapping)}>
          Apply mapping and analyze
        </Button>
      </InlineStack>
    </BlockStack>
  );
}

function ConfirmButton({
  csvText,
  mapping,
  busy,
}: {
  csvText: string;
  mapping: ColumnMapping;
  busy: boolean;
}) {
  const submit = useSubmit();
  const onConfirm = () => {
    const fd = new FormData();
    fd.set("intent", "commit");
    fd.set("csvText", csvText);
    for (const f of IMPORT_FIELDS) {
      if (mapping[f]) fd.set(`map_${f}`, mapping[f]!);
    }
    submit(fd, { method: "post" });
  };
  return (
    <Button variant="primary" tone="success" disabled={busy} loading={busy} onClick={onConfirm}>
      Create purchase orders
    </Button>
  );
}
