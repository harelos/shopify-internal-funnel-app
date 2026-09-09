import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "react-email";

export interface NovaHairLifecycleEmailProps {
  subject: string;
  preview: string;
  paragraphs: string[];
  ctaLabel?: string;
  ctaUrl?: string;
  showProduct?: boolean;
}

const productImage = "https://cdn.shopify.com/s/files/1/0719/2628/4583/files/exec-332fdbbb-db88-4175-8741-ffa10584a679-removebg-preview.png?v=1787671170";

/**
 * React Email source component for the NovaHair lifecycle system. The checked-in
 * HTML files are deterministic build artifacts so provisioning never renders at
 * send time and never depends on a browser.
 */
export function NovaHairLifecycleEmail({
  subject,
  preview,
  paragraphs,
  ctaLabel,
  ctaUrl,
  showProduct = true,
}: NovaHairLifecycleEmailProps) {
  return (
    <Html lang="he" dir="rtl">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ margin: 0, backgroundColor: "#F5F1EC", direction: "rtl" }}>
        <Container style={{ width: "600px", maxWidth: "100%", margin: "24px auto", backgroundColor: "#FFFFFF", border: "1px solid #E8DED5", borderRadius: "18px", overflow: "hidden" }}>
          <Section style={{ padding: "28px 24px 14px", textAlign: "center" }}>
            <Text style={{ margin: 0, color: "#9A744D", fontWeight: 700, letterSpacing: "3px", direction: "ltr" }}>NOVAHAIR</Text>
          </Section>
          {showProduct ? <Img src={productImage} width="220" alt="NovaHair" style={{ margin: "4px auto 24px", maxWidth: "72%" }} /> : null}
          <Section dir="rtl" style={{ padding: "8px 46px 34px", textAlign: "right" }}>
            <Heading as="h1" style={{ color: "#2E2119", fontSize: "32px", lineHeight: 1.25, textAlign: "right" }}>{subject}</Heading>
            {paragraphs.map((paragraph, index) => <Text key={index} style={{ color: "#392D26", fontSize: "16px", lineHeight: 1.75, textAlign: "right" }}>{paragraph}</Text>)}
            {ctaLabel && ctaUrl ? <Button href={ctaUrl} style={{ display: "block", width: "fit-content", margin: "28px auto 20px", padding: "15px 30px", borderRadius: "999px", backgroundColor: "#3D2817", color: "#FFFFFF", fontWeight: 700 }}>{ctaLabel}</Button> : null}
          </Section>
          <Section dir="rtl" style={{ padding: "22px 28px", backgroundColor: "#2E2119", color: "#F7F1EA", textAlign: "center" }}>
            <Text style={{ margin: 0, fontSize: "12px" }}>NovaHair by TigerBrandsGlobal</Text>
            <Link href="{{{RESEND_UNSUBSCRIBE_URL}}}" style={{ color: "#F7F1EA", fontSize: "11px", textDecoration: "underline" }}>להסרה מרשימת הדיוור</Link>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default NovaHairLifecycleEmail;
