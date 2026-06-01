import type { MetaFunction } from "@remix-run/node";

export const meta: MetaFunction = () => [
  { title: "SKUward — Privacy Policy" },
  {
    name: "description",
    content: "How SKUward collects, uses, and protects data.",
  },
];

const LAST_UPDATED = "June 2, 2026";

const wrap: React.CSSProperties = {
  maxWidth: 760,
  margin: "0 auto",
  padding: "48px 24px 96px",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  color: "#1a1a1a",
  lineHeight: 1.6,
};
const h1: React.CSSProperties = { fontSize: 32, marginBottom: 4 };
const h2: React.CSSProperties = { fontSize: 20, marginTop: 36, marginBottom: 8 };
const muted: React.CSSProperties = { color: "#666", fontSize: 14 };

export default function PrivacyPolicy() {
  return (
    <main style={wrap}>
      <h1 style={h1}>Privacy Policy</h1>
      <p style={muted}>Last updated: {LAST_UPDATED}</p>

      <p style={{ marginTop: 24 }}>
        SKUward (&quot;the App&quot;, &quot;we&quot;, &quot;us&quot;) provides
        purchase order and inventory management tools for Shopify merchants.
        This Privacy Policy explains what data the App accesses, how it is used,
        and the choices available to merchants. By installing or using SKUward,
        you agree to the practices described here.
      </p>

      <h2 style={h2}>1. Data we access and store</h2>
      <p>
        SKUward is a merchant-facing operational tool. To provide its features,
        the App accesses and stores the following data associated with your
        Shopify store:
      </p>
      <ul>
        <li>
          Store identifier (your <code>myshopify.com</code> domain) and the
          access token issued by Shopify when you install the App.
        </li>
        <li>
          Product and product variant information (titles, SKUs, prices) and
          inventory levels, read from your store through the Shopify Admin API.
        </li>
        <li>
          Operational records you create in the App: suppliers, purchase orders
          and their line items, reorder rules, and recorded unit costs.
        </li>
        <li>
          Your subscription plan and the associated Shopify charge identifier,
          used to provide paid features.
        </li>
      </ul>

      <h2 style={h2}>2. Data we do not collect</h2>
      <p>
        SKUward does <strong>not</strong> collect, store, or process your
        customers&apos; personal information. The App does not request access to
        customer or order personal data, and it does not place tracking on your
        storefront.
      </p>

      <h2 style={h2}>3. How we use data</h2>
      <p>
        Data is used solely to operate the App&apos;s features for you — for
        example, to display inventory, calculate margins, generate purchase
        orders, update stock levels when you receive a purchase order, and
        manage your subscription. We do not sell data, and we do not use it for
        advertising.
      </p>

      <h2 style={h2}>4. Shopify permissions</h2>
      <p>
        The App requests the following Shopify access scopes:
        <code> read_products</code>, <code>write_products</code>,
        <code> read_inventory</code>, and <code>write_inventory</code>. These
        permissions let SKUward read your catalog and inventory and update stock
        quantities when purchase orders are received. We request no more access
        than the App&apos;s features require.
      </p>

      <h2 style={h2}>5. Data retention and deletion</h2>
      <p>
        We retain your operational data for as long as the App is installed.
        When you uninstall SKUward, Shopify notifies the App, and in line with
        Shopify&apos;s privacy requirements we erase the data we hold for your
        store within the period mandated by Shopify (the App responds to the{" "}
        <code>shop/redact</code> compliance webhook, which Shopify sends
        approximately 48 hours after uninstall). Because SKUward stores no
        customer personal data, customer data requests and customer redaction
        requests contain nothing for the App to return or delete.
      </p>

      <h2 style={h2}>6. Data security</h2>
      <p>
        Data is stored in a managed database and transmitted over encrypted
        (HTTPS) connections. Incoming webhooks are verified using Shopify HMAC
        signatures. Access tokens are stored server-side and are never exposed
        to your storefront or to third parties.
      </p>

      <h2 style={h2}>7. Sub-processors</h2>
      <p>
        SKUward relies on Shopify (platform and APIs) and its hosting and
        database infrastructure provider to operate. These providers process
        data only to deliver the App&apos;s service.
      </p>

      <h2 style={h2}>8. Your rights</h2>
      <p>
        Depending on your jurisdiction, you may have rights to access, correct,
        or delete the data associated with your store. You can exercise the
        deletion right at any time by uninstalling the App, which triggers
        erasure as described in Section 5. For other requests, contact us using
        the details below.
      </p>

      <h2 style={h2}>9. Changes to this policy</h2>
      <p>
        We may update this Privacy Policy from time to time. Material changes
        will be reflected by updating the &quot;Last updated&quot; date above.
      </p>

      <h2 style={h2}>10. Contact</h2>
      <p>
        For privacy questions or data requests, contact the App developer
        through the SKUward listing on the Shopify App Store.
      </p>
    </main>
  );
}
