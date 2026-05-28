/**
 * Shopify Inventory GraphQL utilities
 * Handles inventory adjustments when receiving PO line items
 */

interface InventoryItemInfo {
  inventoryItemId: string;
  locationId: string;
}

interface AdjustmentResult {
  success: boolean;
  errors: string[];
}

/**
 * Get inventoryItemId for a variant by querying Shopify GraphQL
 */
export async function getInventoryItemId(
  admin: any,
  variantGid: string,
): Promise<string | null> {
  const response = await admin.graphql(
    `#graphql
    query GetVariantInventoryItem($id: ID!) {
      productVariant(id: $id) {
        inventoryItem {
          id
        }
      }
    }`,
    { variables: { id: variantGid } },
  );

  const data = await response.json();
  return data?.data?.productVariant?.inventoryItem?.id || null;
}

/**
 * Get the shop's primary location ID
 */
export async function getShopPrimaryLocationId(
  admin: any,
): Promise<string | null> {
  const response = await admin.graphql(
    `#graphql
    query GetLocations {
      locations(first: 1, includeLegacy: true, includeInactive: false) {
        edges {
          node {
            id
            name
            isActive
            isPrimary
          }
        }
      }
    }`,
  );

  const data = await response.json();
  const locations = data?.data?.locations?.edges || [];

  // Return primary location or first active location
  const primary = locations.find((e: any) => e.node.isPrimary);
  if (primary) return primary.node.id;

  return locations.length > 0 ? locations[0].node.id : null;
}

/**
 * Ensure the variantGid has the full Shopify GID prefix
 * Resource picker may return numeric IDs or full GIDs
 */
export function ensureVariantGid(variantId: string): string {
  if (variantId.startsWith("gid://")) return variantId;
  return `gid://shopify/ProductVariant/${variantId}`;
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

  // Get the primary location
  const locationId = await getShopPrimaryLocationId(admin);
  if (!locationId) {
    return { success: false, errors: ["Could not find shop location"] };
  }

  // Build changes array — we need inventoryItemId for each variant
  const changes: Array<{
    delta: number;
    inventoryItemId: string;
    locationId: string;
  }> = [];

  for (const adj of adjustments) {
    if (adj.deltaQuantity <= 0) continue;

    const variantGid = ensureVariantGid(adj.variantId);
    const inventoryItemId = await getInventoryItemId(admin, variantGid);

    if (!inventoryItemId) {
      errors.push(
        `Could not find inventory item for variant ${adj.variantId}`,
      );
      continue;
    }

    changes.push({
      delta: adj.deltaQuantity,
      inventoryItemId,
      locationId,
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
