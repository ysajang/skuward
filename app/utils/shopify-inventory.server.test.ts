import { describe, it, expect, vi } from "vitest";
import { matchSkusToVariants } from "./shopify-inventory.server";

/**
 * Build a mock `admin` whose graphql() returns variants for given SKUs.
 * variantsBySku: sku -> array of {id, productId} (length>1 => ambiguous).
 */
function mockAdmin(variantsBySku: Record<string, Array<{ id: string; productId: string }>>) {
  return {
    graphql: vi.fn(async (_query: string, opts?: any) => {
      const q: string = opts?.variables?.q || "";
      // crude parse: collect skus referenced in the query (sku:'X'), un-escaping \' and \\
      const skuMatches = [...q.matchAll(/sku:'((?:\\.|[^'\\])*)'/g)].map((m) =>
        m[1].replace(/\\(['\\])/g, "$1"),
      );
      const edges: any[] = [];
      for (const sku of skuMatches) {
        const variants = variantsBySku[sku] || [];
        for (const v of variants) {
          edges.push({
            cursor: `c_${v.id}`,
            node: { id: v.id, sku, product: { id: v.productId } },
          });
        }
      }
      return {
        json: async () => ({
          data: {
            productVariants: { edges, pageInfo: { hasNextPage: false } },
          },
        }),
      };
    }),
  };
}

describe("matchSkusToVariants", () => {
  it("classifies matched / unmatched / ambiguous", async () => {
    const admin = mockAdmin({
      A1: [{ id: "gid://shopify/ProductVariant/1", productId: "gid://shopify/Product/10" }],
      A3: [
        { id: "gid://shopify/ProductVariant/3", productId: "gid://shopify/Product/30" },
        { id: "gid://shopify/ProductVariant/4", productId: "gid://shopify/Product/40" },
      ],
      // A2 absent => unmatched
    });

    const res = await matchSkusToVariants(admin, ["A1", "A2", "A3"]);

    expect(res.A1).toEqual({
      kind: "matched",
      variantId: "gid://shopify/ProductVariant/1",
      productId: "gid://shopify/Product/10",
    });
    expect(res.A2).toEqual({ kind: "unmatched" });
    expect(res.A3).toEqual({ kind: "ambiguous", count: 2 });
  });

  it("dedupes skus and ignores empty", async () => {
    const admin = mockAdmin({
      X: [{ id: "v", productId: "p" }],
    });
    const res = await matchSkusToVariants(admin, ["X", "X", "", "  "]);
    expect(Object.keys(res)).toEqual(["X"]);
    // graphql called once (single batch, single page)
    expect(admin.graphql).toHaveBeenCalledTimes(1);
  });

  it("returns empty for empty input without calling graphql", async () => {
    const admin = mockAdmin({});
    const res = await matchSkusToVariants(admin, []);
    expect(res).toEqual({});
    expect(admin.graphql).not.toHaveBeenCalled();
  });

  it("escapes single quotes in sku safely", async () => {
    const admin = mockAdmin({ "O'Brien": [{ id: "v", productId: "p" }] });
    const res = await matchSkusToVariants(admin, ["O'Brien"]);
    expect(res["O'Brien"].kind).toBe("matched");
  });
});
