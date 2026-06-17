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
    return json<ActionResponse>({ step: "error", error: "CSV를 읽지 못했습니다" }, { status: 400 });
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
        { step: "error", error: "가져오기 중 오류가 발생했습니다. 다시 시도해주세요." },
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
      <Page title="가져오기 완료" backAction={{ url: "/app/purchase-orders" }}>
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Banner tone="success" title="발주 가져오기가 완료되었습니다">
                  <p>
                    {r.createdPOCount}개의 발주서와 {r.createdLineItemCount}개의 품목을
                    생성했습니다.
                  </p>
                </Banner>
                <List>
                  <List.Item>신규 공급사 {r.createdSupplierCount}개 / 기존 재사용 {r.reusedSupplierCount}개</List.Item>
                  <List.Item>반영 금액 합계: {r.includedAmountTotal.toLocaleString()}</List.Item>
                  {r.excludedLineCount > 0 && (
                    <List.Item>
                      제외된 품목 {r.excludedLineCount}개 (Shopify에 없는 SKU) — 제외 금액{" "}
                      {r.excludedAmountTotal.toLocaleString()}
                    </List.Item>
                  )}
                  {r.skippedExistingPONumbers.length > 0 && (
                    <List.Item>
                      이미 존재해 건너뛴 PO번호: {r.skippedExistingPONumbers.join(", ")}
                    </List.Item>
                  )}
                </List>
                <InlineStack align="end">
                  <Button variant="primary" url="/app/purchase-orders">
                    발주서 목록 보기
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
    <Page title="발주서 CSV 가져오기" backAction={{ url: "/app/purchase-orders" }}>
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {actionData?.step === "error" && (
              <Banner tone="critical" title="가져오기 오류">
                <p>{actionData.error}</p>
              </Banner>
            )}
            {actionData?.step === "locked" && (
              <UpgradeBanner
                resource="가져오기"
                message="CSV 가져오기는 Starter 플랜부터 사용할 수 있습니다. 미리보기로 결과를 먼저 확인하고 업그레이드하세요."
                to="/app/settings"
              />
            )}

            {/* Step 1: upload */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  1. CSV 파일 업로드
                </Text>
                <Text as="p" tone="subdued">
                  Stocky 등에서 내보낸 발주 CSV를 올리세요. 헤더(첫 행)가 포함되어야 합니다.
                  같은 PO번호의 여러 행은 하나의 발주서로 묶입니다.
                </Text>
                <DropZone accept=".csv,text/csv" type="file" allowMultiple={false} onDrop={handleDrop}>
                  {fileName ? (
                    <Box padding="400">
                      <InlineStack gap="200" blockAlign="center">
                        <Badge tone="success">선택됨</Badge>
                        <Text as="span">{fileName}</Text>
                      </InlineStack>
                    </Box>
                  ) : (
                    <DropZone.FileUpload actionTitle="파일 선택" actionHint=".csv 파일만" />
                  )}
                </DropZone>
                <InlineStack align="end">
                  <Button
                    variant="primary"
                    disabled={!csvText || busy}
                    loading={busy && !preview}
                    onClick={() => runPreview()}
                  >
                    분석하기
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>

            {/* Step 2: mapping */}
            {preview && (
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    2. 컬럼 매핑
                  </Text>
                  <Text as="p" tone="subdued">
                    각 SKUward 항목에 CSV 컬럼을 연결하세요. * 표시는 필수입니다.
                  </Text>
                  <MappingEditor
                    headers={preview.headers}
                    initialMapping={preview.mapping}
                    busy={busy}
                    onApply={(m) => runPreview(m)}
                  />
                  {missing.length > 0 && (
                    <Banner tone="warning" title="필수 항목이 매핑되지 않았습니다">
                      <p>{missing.map((f) => FIELD_LABELS[f]).join(", ")}를 연결한 뒤 다시 분석하세요.</p>
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
                    3. 미리보기
                  </Text>

                  {preview.truncated && (
                    <Banner tone="warning">
                      <p>행 수가 많아 일부만 처리됩니다(상한 적용).</p>
                    </Banner>
                  )}

                  <DataTable
                    columnContentTypes={["text", "numeric"]}
                    headings={["항목", "값"]}
                    rows={[
                      ["생성될 발주서", String(preview.summary.creatablePOCount)],
                      ["매칭된 품목", String(preview.summary.totalMatchedLines)],
                      [
                        "제외 품목 (미매칭 SKU)",
                        String(preview.summary.totalUnmatchedLines),
                      ],
                      [
                        "제외 품목 (중복 SKU·모호)",
                        String(preview.summary.totalAmbiguousLines),
                      ],
                      ["신규 생성 공급사", String(preview.summary.vendorsToEnsure.length)],
                      ["반영 금액", preview.summary.includedAmountTotal.toLocaleString()],
                      ["제외 금액", preview.summary.excludedAmountTotal.toLocaleString()],
                    ]}
                  />

                  {(preview.summary.totalUnmatchedLines > 0 ||
                    preview.summary.totalAmbiguousLines > 0) && (
                    <Banner tone="info" title="일부 품목은 제외됩니다">
                      <p>
                        Shopify 상품에 없는 SKU 또는 동일 SKU가 여러 개인 품목은 발주서에 포함되지
                        않습니다. 위 "제외 금액"으로 원본과의 차이를 확인하세요.
                      </p>
                    </Banner>
                  )}

                  {preview.rowErrors.length > 0 && (
                    <Banner tone="warning" title={`형식 오류 행 ${preview.rowErrors.length}개`}>
                      <List>
                        {preview.rowErrors.slice(0, 8).map((e) => (
                          <List.Item key={e.rowIndex}>
                            {e.rowIndex + 2}행: {e.reason}
                          </List.Item>
                        ))}
                      </List>
                    </Banner>
                  )}

                  {preview.summary.creatablePOCount === 0 ? (
                    <Banner tone="critical" title="생성할 발주서가 없습니다">
                      <p>매칭된 SKU가 없습니다. SKU 컬럼 매핑과 Shopify 상품의 SKU를 확인하세요.</p>
                    </Banner>
                  ) : !canCommit ? (
                    <UpgradeBanner
                      resource="가져오기"
                      message="결과를 확인했습니다. Starter 플랜으로 업그레이드하면 이 발주서를 한 번에 생성합니다."
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
    () => [{ label: "— 선택 안 함 —", value: "ignore" }, ...headers.map((h) => ({ label: h, value: h }))],
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
          매핑 적용 후 다시 분석
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
      발주서 생성하기
    </Button>
  );
}
