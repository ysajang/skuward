import type { SkuMatch, SkuMatchMap } from "./csv-import-preview";
/**
 * Shopify Inventory GraphQL utilities
 * Handles inventory adjustments when receiving PO line items
 */

interface VariantInventoryInfo {
  inventoryItemId: string;
  locationId: string;
  /** Current "available" quantity at the location; null if untracked. */
  currentAvailable: number | null;
}

interface AdjustmentResult {
  success: boolean;
  errors: string[];
}

/**
 * Ensure the variantGid has the full Shopify GID prefix
 * Resource picker may return numeric IDs or full GIDs
 */
function ensureVariantGid(variantId: string): string {
  if (variantId.startsWith("gid://")) return variantId;
  return `gid://shopify/ProductVariant/${variantId}`;
}

/**
 * Get inventoryItemId AND locationId for a variant in a single query
 * by traversing variant -> inventoryItem -> inventoryLevels -> location
 *
 * This avoids needing the root `locations` query (which requires read_locations scope)
 */
async function getVariantInventoryInfo(
  admin: any,
  variantGid: string,
): Promise<VariantInventoryInfo | null> {
  const response = await admin.graphql(
    `#graphql
    query GetVariantInventory($id: ID!) {
      productVariant(id: $id) {
        inventoryItem {
          id
          inventoryLevels(first: 1) {
            edges {
              node {
                location {
                  id
                }
                quantities(names: ["available"]) {
                  name
                  quantity
                }
              }
            }
          }
        }
      }
    }`,
    { variables: { id: variantGid } },
  );

  const data = await response.json();
  const inventoryItem = data?.data?.productVariant?.inventoryItem;
  if (!inventoryItem?.id) return null;

  const firstLevel = inventoryItem.inventoryLevels?.edges?.[0]?.node;
  if (!firstLevel?.location?.id) return null;

  const availableEntry = (firstLevel.quantities ?? []).find(
    (q: { name: string; quantity: number }) => q.name === "available",
  );
  const currentAvailable =
    typeof availableEntry?.quantity === "number" ? availableEntry.quantity : null;

  return {
    inventoryItemId: inventoryItem.id,
    locationId: firstLevel.location.id,
    currentAvailable,
  };
}

/**
 * Get the selling price (and title/sku metadata) for a list of variants.
 * Returns a map of variantId -> { price, title, variantTitle, sku }.
 *
 * Batched via GraphQL aliases (50 per request).
 */
export async function getVariantsPriceInfo(
  admin: any,
  variantIds: string[],
): Promise<
  Record<
    string,
    { price: number; title: string; variantTitle: string; sku: string }
  >
> {
  const result: Record<
    string,
    { price: number; title: string; variantTitle: string; sku: string }
  > = {};
  if (variantIds.length === 0) return result;

  const CHUNK_SIZE = 50;
  const chunks: string[][] = [];
  for (let i = 0; i < variantIds.length; i += CHUNK_SIZE) {
    chunks.push(variantIds.slice(i, i + CHUNK_SIZE));
  }

  for (const chunk of chunks) {
    const aliasMap: Record<string, string> = {};
    const fields = chunk
      .map((variantId, idx) => {
        const alias = `v${idx}`;
        aliasMap[alias] = variantId;
        const gid = ensureVariantGid(variantId);
        return `${alias}: productVariant(id: "${gid}") {
          price
          title
          sku
          product { title }
        }`;
      })
      .join("\n");

    const query = `#graphql
      query GetVariantsPrice {
        ${fields}
      }`;

    try {
      const response = await admin.graphql(query);
      const data = await response.json();
      const root = data?.data || {};

      for (const [alias, variantId] of Object.entries(aliasMap)) {
        const v = root[alias];
        if (!v) continue;
        const price = parseFloat(v.price);
        result[variantId] = {
          price: isNaN(price) ? 0 : price,
          title: v.product?.title || "",
          variantTitle: v.title === "Default Title" ? "" : v.title || "",
          sku: v.sku || "",
        };
      }
    } catch {
      // skip chunk on error
    }
  }

  return result;
}

/**
 * Get current available stock (summed across all locations) for a list of variants.
 * Returns a map of variantGid -> available quantity (number).
 *
 * Uses GraphQL aliases to batch multiple variants into a single request.
 * Variants whose inventory isn't tracked return null (excluded from the map).
 */
export async function getVariantsCurrentStock(
  admin: any,
  variantIds: string[],
): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  if (variantIds.length === 0) return result;

  // Shopify caps query complexity; batch in chunks of 50 variants
  const CHUNK_SIZE = 50;
  const chunks: string[][] = [];
  for (let i = 0; i < variantIds.length; i += CHUNK_SIZE) {
    chunks.push(variantIds.slice(i, i + CHUNK_SIZE));
  }

  for (const chunk of chunks) {
    // Build aliased query: v0: productVariant(id: "...") { ... }
    const aliasMap: Record<string, string> = {}; // alias -> original variantId
    const fields = chunk
      .map((variantId, idx) => {
        const alias = `v${idx}`;
        aliasMap[alias] = variantId;
        const gid = ensureVariantGid(variantId);
        return `${alias}: productVariant(id: "${gid}") {
          inventoryItem {
            tracked
            inventoryLevels(first: 20) {
              edges {
                node {
                  quantities(names: ["available"]) {
                    name
                    quantity
                  }
                }
              }
            }
          }
        }`;
      })
      .join("\n");

    const query = `#graphql
      query GetVariantsStock {
        ${fields}
      }`;

    try {
      const response = await admin.graphql(query);
      const data = await response.json();
      const root = data?.data || {};

      for (const [alias, variantId] of Object.entries(aliasMap)) {
        const variant = root[alias];
        const invItem = variant?.inventoryItem;
        if (!invItem) continue;

        // If not tracked, skip (no meaningful stock number)
        if (invItem.tracked === false) continue;

        const edges = invItem.inventoryLevels?.edges || [];
        let total = 0;
        for (const edge of edges) {
          const quantities = edge?.node?.quantities || [];
          const availableEntry = quantities.find(
            (q: any) => q.name === "available",
          );
          if (availableEntry && typeof availableEntry.quantity === "number") {
            total += availableEntry.quantity;
          }
        }
        result[variantId] = total;
      }
    } catch {
      // On error for a chunk, skip — caller treats missing entries as "unknown"
    }
  }

  return result;
}

/**
 * Adjust inventory quantities in Shopify for received PO items
 *
 * Uses inventoryAdjustQuantities mutation with delta (increment)
 * reason: "received" for PO receiving
 */
export async function adjustInventoryOnReceive(
  admin: any,
  adjustments: Array<{
    variantId: string;
    deltaQuantity: number;
  }>,
  idempotencyKey: string,
): Promise<AdjustmentResult> {
  const errors: string[] = [];

  // Build changes array — get inventoryItemId + locationId per variant
  const changes: Array<{
    delta: number;
    inventoryItemId: string;
    locationId: string;
    changeFromQuantity?: number;
  }> = [];

  for (const adj of adjustments) {
    if (adj.deltaQuantity <= 0) continue;

    const variantGid = ensureVariantGid(adj.variantId);
    const info = await getVariantInventoryInfo(admin, variantGid);

    if (!info) {
      errors.push(
        `Could not find inventory info for variant ${adj.variantId}`,
      );
      continue;
    }

    const change: {
      delta: number;
      inventoryItemId: string;
      locationId: string;
      changeFromQuantity?: number;
    } = {
      delta: adj.deltaQuantity,
      inventoryItemId: info.inventoryItemId,
      locationId: info.locationId,
    };
    // API 2026-04+ requires the expected current quantity for optimistic
    // concurrency. Only set it when the item is actually tracked.
    if (info.currentAvailable !== null) {
      change.changeFromQuantity = info.currentAvailable;
    }
    changes.push(change);
  }

  if (changes.length === 0) {
    if (errors.length > 0) {
      return { success: false, errors };
    }
    return { success: true, errors: [] };
  }

  // Execute the inventory adjustment
  try {
    const response = await admin.graphql(
      `#graphql
      mutation InventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!, $idempotencyKey: String!) {
        inventoryAdjustQuantities(input: $input) @idempotent(key: $idempotencyKey) {
          userErrors {
            field
            message
          }
          inventoryAdjustmentGroup {
            createdAt
            reason
            changes {
              name
              delta
            }
          }
        }
      }`,
      {
        variables: {
          input: {
            reason: "received",
            name: "available",
            referenceDocumentUri: "logistics://skuward/po-receiving",
            changes,
          },
          idempotencyKey,
        },
      },
    );

    const data = await response.json();
    const userErrors =
      data?.data?.inventoryAdjustQuantities?.userErrors || [];

    if (userErrors.length > 0) {
      for (const err of userErrors) {
        errors.push(`${err.field}: ${err.message}`);
      }
      return { success: false, errors };
    }

    return { success: true, errors };
  } catch (err: any) {
    return {
      success: false,
      errors: [`Shopify API error: ${err.message || "Unknown error"}`],
    };
  }
}

// ----------------------------------------------------------------------------
// SKU -> variant matching (for CSV PO import)
// ----------------------------------------------------------------------------


/** Escape a SKU value for use inside a Shopify search query string literal. */
function escapeSkuForQuery(sku: string): string {
  // wrap in single quotes; escape backslash and single quote
  return `'${sku.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/**
 * Look up Shopify variants by SKU for a list of distinct SKUs.
 * Returns a map sku -> SkuMatch:
 *   - matched   : exactly one variant has this SKU
 *   - unmatched : no variant
 *   - ambiguous : 2+ variants share this SKU (Shopify does not enforce uniqueness)
 *
 * Batches SKUs into OR queries to avoid per-SKU round trips and rate limits.
 * Paginates within each batch in case many variants match.
 */
export async function matchSkusToVariants(
  admin: any,
  skus: string[],
): Promise<SkuMatchMap> {
  const result: SkuMatchMap = {};
  const distinct = Array.from(new Set(skus.filter((s) => s && s.trim() !== "")));
  if (distinct.length === 0) return result;

  // count variants found per sku across the whole run
  const counts: Record<string, { variantId: string; productId: string; n: number }> = {};
  for (const s of distinct) counts[s] = { variantId: "", productId: "", n: 0 };

  const BATCH = 40; // SKUs per OR-query (keeps query cost in check)
  for (let i = 0; i < distinct.length; i += BATCH) {
    const batch = distinct.slice(i, i + BATCH);
    const queryStr = batch.map((s) => `sku:${escapeSkuForQuery(s)}`).join(" OR ");

    let cursor: string | null = null;
    // paginate this batch's matches
    for (let page = 0; page < 25; page++) {
      const response: any = await admin.graphql(
        `#graphql
        query MatchSkus($q: String!, $after: String) {
          productVariants(first: 250, query: $q, after: $after) {
            edges {
              cursor
              node {
                id
                sku
                product { id }
              }
            }
            pageInfo { hasNextPage }
          }
        }`,
        { variables: { q: queryStr, after: cursor } },
      );

      const data = await response.json();
      const conn = data?.data?.productVariants;
      const edges = conn?.edges || [];

      for (const edge of edges) {
        const node = edge?.node;
        const sku = node?.sku;
        if (!sku || !(sku in counts)) continue; // ignore partial/fuzzy hits
        const entry = counts[sku];
        entry.n += 1;
        if (entry.n === 1) {
          entry.variantId = node.id;
          entry.productId = node.product?.id || "";
        }
      }

      if (conn?.pageInfo?.hasNextPage) {
        cursor = edges[edges.length - 1]?.cursor || null;
        if (!cursor) break;
      } else {
        break;
      }
    }
  }

  for (const s of distinct) {
    const c = counts[s];
    let match: SkuMatch;
    if (c.n === 0) match = { kind: "unmatched" };
    else if (c.n === 1) match = { kind: "matched", variantId: c.variantId, productId: c.productId };
    else match = { kind: "ambiguous", count: c.n };
    result[s] = match;
  }

  return result;
}
