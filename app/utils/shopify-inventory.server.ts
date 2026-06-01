/**
 * Shopify Inventory GraphQL utilities
 * Handles inventory adjustments when receiving PO line items
 */

interface VariantInventoryInfo {
  inventoryItemId: string;
  locationId: string;
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

  return {
    inventoryItemId: inventoryItem.id,
    locationId: firstLevel.location.id,
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
): Promise<AdjustmentResult> {
  const errors: string[] = [];

  // Build changes array — get inventoryItemId + locationId per variant
  const changes: Array<{
    delta: number;
    inventoryItemId: string;
    locationId: string;
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

    changes.push({
      delta: adj.deltaQuantity,
      inventoryItemId: info.inventoryItemId,
      locationId: info.locationId,
    });
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
      mutation InventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!) {
        inventoryAdjustQuantities(input: $input) {
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
