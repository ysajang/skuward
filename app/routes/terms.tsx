import type { MetaFunction } from "@remix-run/node";

export const meta: MetaFunction = () => [
  { title: "SKUward — Terms of Service" },
  { name: "description", content: "Terms governing use of SKUward." },
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

export default function TermsOfService() {
  return (
    <main style={wrap}>
      <h1 style={h1}>Terms of Service</h1>
      <p style={muted}>Last updated: {LAST_UPDATED}</p>

      <p style={{ marginTop: 24 }}>
        These Terms of Service (&quot;Terms&quot;) govern your use of SKUward
        (&quot;the App&quot;), a purchase order and inventory management
        application for Shopify. By installing or using the App, you agree to
        these Terms. If you do not agree, do not install or use the App.
      </p>

      <h2 style={h2}>1. The service</h2>
      <p>
        SKUward provides tools to manage suppliers, create and receive purchase
        orders, set reorder rules, and track cost and margin information for
        your Shopify store. Features available to you depend on your
        subscription plan.
      </p>

      <h2 style={h2}>2. Subscriptions and billing</h2>
      <p>
        SKUward offers a free plan and paid plans (Starter and Pro). Paid plans
        are billed monthly through Shopify&apos;s billing system and appear on
        your Shopify invoice. By selecting a paid plan you authorize the
        recurring charge through Shopify. Charges are governed by Shopify&apos;s
        billing terms; we do not store your payment card details. You can change
        or cancel your plan at any time; uninstalling the App cancels the
        subscription. Except where required by law, charges already billed are
        non-refundable.
      </p>

      <h2 style={h2}>3. Acceptable use</h2>
      <p>
        You agree to use the App only for lawful business purposes and not to
        misuse, reverse engineer, disrupt, or attempt to gain unauthorized
        access to the App or its infrastructure.
      </p>

      <h2 style={h2}>4. Your data and responsibilities</h2>
      <p>
        You are responsible for the accuracy of the data you enter (such as
        supplier details and unit costs) and for reviewing inventory changes the
        App makes on your behalf. The App updates Shopify inventory quantities
        when you receive a purchase order; you are responsible for confirming
        those quantities before submitting.
      </p>

      <h2 style={h2}>5. Availability and accuracy</h2>
      <p>
        We work to keep the App available and accurate, but the App is provided
        on an &quot;as is&quot; and &quot;as available&quot; basis. Inventory,
        cost, and margin figures are provided for operational convenience and
        may depend on data from Shopify; you should verify critical figures
        independently. We do not warrant that the App will be uninterrupted or
        error-free.
      </p>

      <h2 style={h2}>6. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, SKUward and its developer are
        not liable for any indirect, incidental, or consequential damages, or
        for lost profits, revenue, or data, arising from your use of the App.
        Our total liability for any claim relating to the App will not exceed
        the amount you paid for the App in the three months preceding the claim.
      </p>

      <h2 style={h2}>7. Termination</h2>
      <p>
        You may stop using the App at any time by uninstalling it. We may
        suspend or terminate access if these Terms are violated. On termination,
        your data is handled as described in our{" "}
        <a href="/privacy">Privacy Policy</a>.
      </p>

      <h2 style={h2}>8. Changes to these Terms</h2>
      <p>
        We may update these Terms from time to time. Material changes will be
        reflected by updating the &quot;Last updated&quot; date above. Continued
        use of the App after changes take effect constitutes acceptance.
      </p>

      <h2 style={h2}>9. Contact</h2>
      <p>
        For questions about these Terms, contact the App developer through the
        SKUward listing on the Shopify App Store.
      </p>
    </main>
  );
}
