import { Banner } from "@shopify/polaris";

interface UpgradeBannerProps {
  /** What the merchant hit, e.g. "purchase order", "supplier". */
  resource: string;
  /** Short reason shown in the banner body. */
  message: string;
  /** CTA target; defaults to the plan/settings page. */
  to?: string;
  onDismiss?: () => void;
}

/**
 * Conversion-oriented limit notice: never framed as an error, always points to
 * the upgrade page. Used wherever a plan quota blocks a create action.
 */
export function UpgradeBanner({
  resource,
  message,
  to = "/app/settings",
  onDismiss,
}: UpgradeBannerProps) {
  return (
    <Banner
      tone="info"
      title={`Upgrade to add more ${resource}`}
      onDismiss={onDismiss}
      action={{ content: "View plans", url: to }}
    >
      <p>{message}</p>
    </Banner>
  );
}
