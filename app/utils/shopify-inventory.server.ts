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
