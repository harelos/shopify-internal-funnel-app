const PRODUCT_IMAGE = "https://cdn.shopify.com/s/files/1/0719/2628/4583/files/exec-332fdbbb-db88-4175-8741-ffa10584a679-removebg-preview.png?v=1787671170";

const FLOW_SLUGS = new Map([
  ["ABANDONED CHECKOUT", "abandoned_checkout"],
  ["WELCOME", "welcome"],
  ["ABANDONED CART", "abandoned_cart"],
  ["BROWSE ABANDONMENT", "browse_abandonment"],
  ["POST-PURCHASE", "post_purchase"],
  ["REPLENISHMENT / WINBACK", "replenishment"],
]);

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function personalized(value) {
  return value.replaceAll("[שם פרטי]", "{{{CUSTOMER_NAME}}}");
}

function isInternalBoundary(line) {
  return line === "IMPLEMENTATION RULES — SHOPIFY MESSAGING"
    || line === "GROWTH TEAM PRIORITY ORDER"
    || /^הערת Growth(?: Team)?:/u.test(line)
    || /^Growth Test אופציונלי:/u.test(line);
}

function marker(line) {
  const button = line.match(/^\[כפתור(?: \/ קישור)?:\s*(.+?)(?:\s*\|\s*([A-Z][A-Z0-9_]{0,60}))?\]$/u);
  if (button) return { type: "button", label: button[1], variable: button[2] ?? "CTA_URL" };
  const link = line.match(/^\[קישור:\s*(.+?)(?:\s*\|\s*([A-Z][A-Z0-9_]{0,60}))?\]$/u);
  if (link) return { type: "link", label: link[1], variable: link[2] ?? "CTA_URL" };
  if (/^\[(?:בלוק|תמונה|כאן להכניס|קישור ל-)/u.test(line)) return { type: "omit" };
  return null;
}

function approvedBody(email) {
  const lines = [];
  for (const raw of email.body) {
    const line = String(raw).trim();
    if (isInternalBoundary(line)) break;
    lines.push(line);
  }
  return lines;
}

function buttonHtml(label, variable = "CTA_URL") {
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:28px;margin-right:0;margin-bottom:20px;margin-left:0">
      <tr><td align="center">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
          <td bgcolor="#3D2817" style="background-color:#3D2817;border-radius:999px;text-align:center">
            <a href="{{{${variable}}}}" target="_blank" style="display:inline-block;padding-top:15px;padding-right:30px;padding-bottom:15px;padding-left:30px;color:#FFFFFF;text-decoration:none;font-family:Arial,'Helvetica Neue',Arial,sans-serif;font-size:16px;font-weight:700;line-height:20px;border-top-width:1px;border-right-width:1px;border-bottom-width:1px;border-left-width:1px;border-top-style:solid;border-right-style:solid;border-bottom-style:solid;border-left-style:solid;border-top-color:#3D2817;border-right-color:#3D2817;border-bottom-color:#3D2817;border-left-color:#3D2817;border-radius:999px">${escapeHtml(label)}</a>
          </td>
        </tr></table>
      </td></tr>
    </table>`;
}

function linkHtml(label, variable = "CTA_URL") {
  return `<p style="margin-top:18px;margin-right:0;margin-bottom:18px;margin-left:0;font-family:Arial,'Helvetica Neue',Arial,sans-serif;font-size:16px;line-height:28px;color:#392D26;text-align:right"><a href="{{{${variable}}}}" target="_blank" style="font-family:Arial,'Helvetica Neue',Arial,sans-serif;font-size:16px;line-height:28px;color:#6F4E37;text-decoration:underline;font-weight:700">${escapeHtml(label)}</a></p>`;
}

function dynamicProductHtml() {
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:22px;margin-right:0;margin-bottom:22px;margin-left:0;background-color:#F7F1EA;border-top-width:1px;border-right-width:1px;border-bottom-width:1px;border-left-width:1px;border-top-style:solid;border-right-style:solid;border-bottom-style:solid;border-left-style:solid;border-top-color:#E8DCCF;border-right-color:#E8DCCF;border-bottom-color:#E8DCCF;border-left-color:#E8DCCF;border-radius:14px" bgcolor="#F7F1EA">
      <tr><td style="padding-top:18px;padding-right:20px;padding-bottom:18px;padding-left:20px;font-family:Arial,'Helvetica Neue',Arial,sans-serif;text-align:right">
        <p style="margin-top:0;margin-right:0;margin-bottom:0;margin-left:0;font-family:Arial,'Helvetica Neue',Arial,sans-serif;font-size:16px;line-height:24px;font-weight:700;color:#2E2119">{{{PRODUCT_NAME}}}</p>
        <p style="margin-top:5px;margin-right:0;margin-bottom:0;margin-left:0;font-family:Arial,'Helvetica Neue',Arial,sans-serif;font-size:14px;line-height:22px;color:#6A5A50">{{{VARIANT}}} · {{{BUNDLE}}}</p>
      </td></tr>
    </table>`;
}

function paragraphHtml(line) {
  const replaced = personalized(line);
  const bullet = replaced.startsWith("•");
  const text = bullet ? replaced.slice(1).trim() : replaced;
  return `<p style="margin-top:${bullet ? "7px" : "0"};margin-right:0;margin-bottom:${bullet ? "7px" : "16px"};margin-left:0;font-family:Arial,'Helvetica Neue',Arial,sans-serif;font-size:16px;line-height:28px;color:#392D26;text-align:right;direction:rtl">${bullet ? `<span style="font-family:Arial,'Helvetica Neue',Arial,sans-serif;font-size:16px;line-height:28px;color:#B48755;font-weight:700">•</span>&nbsp;` : ""}${escapeHtml(text)}</p>`;
}

function shouldShowProductImage(email) {
  if (email.service) return false;
  const value = `${email.title} ${email.subject} ${email.cta ?? ""}`;
  return !/Reply|תמיכה|ליצור קשר|ללא כפתור|ללא מכירה/u.test(value);
}

function hasCommercialCta(email) {
  return Boolean(email.cta) && !/Reply|ללא כפתור|ללא מכירה/u.test(email.cta);
}

function renderBody(email) {
  const parts = [];
  let renderedCta = false;
  for (const line of approvedBody(email)) {
    const parsed = marker(line);
    if (parsed?.type === "button") {
      parts.push(buttonHtml(parsed.label, parsed.variable));
      renderedCta = true;
      continue;
    }
    if (parsed?.type === "link") {
      parts.push(linkHtml(parsed.label, parsed.variable));
      renderedCta = true;
      continue;
    }
    if (parsed?.type === "omit") {
      if (/בלוק דינמי|הגוון\/החבילה הקודמת/u.test(line)) parts.push(dynamicProductHtml());
      continue;
    }
    parts.push(paragraphHtml(line));
  }
  if (!renderedCta && hasCommercialCta(email)) {
    const label = email.cta.split("/")[0].trim();
    parts.push(buttonHtml(label));
  }
  return parts.join("\n");
}

function renderText(email) {
  const lines = [];
  let renderedCta = false;
  for (const line of approvedBody(email)) {
    const parsed = marker(line);
    if (parsed?.type === "button" || parsed?.type === "link") {
      lines.push(`${parsed.label}: {{{${parsed.variable}}}}`);
      renderedCta = true;
      continue;
    }
    if (parsed?.type === "omit") {
      if (/בלוק דינמי|הגוון\/החבילה הקודמת/u.test(line)) {
        lines.push("{{{PRODUCT_NAME}}} — {{{VARIANT}}} — {{{BUNDLE}}}");
      }
      continue;
    }
    lines.push(personalized(line));
  }
  if (!renderedCta && hasCommercialCta(email)) {
    lines.push(`${email.cta.split("/")[0].trim()}: {{{CTA_URL}}}`);
  }
  lines.push("", "להסרה מרשימת הדיוור: {{{RESEND_UNSUBSCRIBE_URL}}}");
  return lines.join("\n");
}

export function renderNovaHairEmail({ email, flowSlug }) {
  const image = shouldShowProductImage(email)
    ? `<tr><td align="center" style="padding-top:4px;padding-right:32px;padding-bottom:24px;padding-left:32px"><img src="${PRODUCT_IMAGE}" width="220" height="220" border="0" alt="מוצר NovaHair" style="display:block;width:220px;max-width:72%;height:auto;border-top-width:0;border-right-width:0;border-bottom-width:0;border-left-width:0" /></td></tr>`
    : "";
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>${escapeHtml(email.subject)}</title>
</head>
<body dir="rtl" style="margin-top:0;margin-right:0;margin-bottom:0;margin-left:0;padding-top:0;padding-right:0;padding-bottom:0;padding-left:0;background-color:#F5F1EC;color:#392D26;-webkit-text-size-adjust:100%;word-spacing:normal">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-family:Arial,'Helvetica Neue',Arial,sans-serif;font-size:1px;line-height:1px;mso-hide:all">${escapeHtml(email.preview || "NovaHair")}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</span>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#F5F1EC" style="width:100%;background-color:#F5F1EC">
    <tr><td align="center" style="padding-top:24px;padding-right:10px;padding-bottom:24px;padding-left:10px">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" bgcolor="#FFFFFF" style="width:100%;max-width:600px;background-color:#FFFFFF;border-top-width:1px;border-right-width:1px;border-bottom-width:1px;border-left-width:1px;border-top-style:solid;border-right-style:solid;border-bottom-style:solid;border-left-style:solid;border-top-color:#E8DED5;border-right-color:#E8DED5;border-bottom-color:#E8DED5;border-left-color:#E8DED5;border-radius:18px;overflow:hidden">
        <tr><td align="center" style="padding-top:28px;padding-right:24px;padding-bottom:14px;padding-left:24px;font-family:Arial,'Helvetica Neue',Arial,sans-serif">
          <p style="margin-top:0;margin-right:0;margin-bottom:0;margin-left:0;font-family:Arial,'Helvetica Neue',Arial,sans-serif;font-size:12px;line-height:18px;letter-spacing:3px;color:#9A744D;font-weight:700;direction:ltr">NOVAHAIR</p>
        </td></tr>
        ${image}
        <tr><td dir="rtl" style="padding-top:8px;padding-right:32px;padding-bottom:34px;padding-left:32px;text-align:right">
          <h1 style="margin-top:0;margin-right:0;margin-bottom:22px;margin-left:0;font-family:Arial,'Helvetica Neue',Arial,sans-serif;font-size:30px;line-height:38px;color:#2E2119;text-align:right;font-weight:700">${escapeHtml(email.subject)}</h1>
          ${renderBody(email)}
        </td></tr>
        <tr><td dir="rtl" bgcolor="#2E2119" style="padding-top:22px;padding-right:28px;padding-bottom:22px;padding-left:28px;background-color:#2E2119;text-align:center;font-family:Arial,'Helvetica Neue',Arial,sans-serif;color:#F7F1EA">
          <p style="margin-top:0;margin-right:0;margin-bottom:0;margin-left:0;font-family:Arial,'Helvetica Neue',Arial,sans-serif;font-size:12px;line-height:20px;color:#F7F1EA">NovaHair by TigerBrandsGlobal</p>
          <p style="margin-top:7px;margin-right:0;margin-bottom:0;margin-left:0;font-family:Arial,'Helvetica Neue',Arial,sans-serif;font-size:11px;line-height:19px;color:#D7C8BA">קיבלת את המייל בעקבות הסכמה לקבלת עדכונים.</p>
          <p style="margin-top:7px;margin-right:0;margin-bottom:0;margin-left:0;font-family:Arial,'Helvetica Neue',Arial,sans-serif;font-size:11px;line-height:19px;color:#F7F1EA"><a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="font-family:Arial,'Helvetica Neue',Arial,sans-serif;font-size:11px;line-height:19px;color:#F7F1EA;text-decoration:underline">להסרה מרשימת הדיוור</a></p>
        </td></tr>
      </table>
      <p style="margin-top:12px;margin-right:0;margin-bottom:0;margin-left:0;font-family:Arial,'Helvetica Neue',Arial,sans-serif;font-size:10px;line-height:16px;color:#8E8178">${escapeHtml(flowSlug)} · E${String(email.number).padStart(2, "0")}</p>
    </td></tr>
  </table>
</body>
</html>`;
}

export function buildTemplateManifest(source) {
  const templates = [];
  for (const flow of source.flows) {
    const flowSlug = FLOW_SLUGS.get(flow.name);
    if (!flowSlug) throw new Error(`unknown_flow:${flow.name}`);
    for (const email of flow.emails) {
      const alias = `novahair_${flowSlug}_e${String(email.number).padStart(2, "0")}`;
      templates.push({
        flow: flowSlug,
        email_number: email.number,
        alias,
        name: `NovaHair ${flow.name} E${String(email.number).padStart(2, "0")}`,
        subject: email.subject,
        preview: email.preview,
        timing: email.timing,
        purpose: email.purpose,
        html: renderNovaHairEmail({ email, flowSlug }),
        text: renderText(email),
        variables: [
          { key: "CUSTOMER_NAME", type: "string", fallback_value: "יקרה" },
          { key: "CTA_URL", type: "string" },
          { key: "PRODUCT_NAME", type: "string", fallback_value: "NovaHair by TigerBrandsGlobal" },
          { key: "VARIANT", type: "string", fallback_value: "הגוון שבחרת" },
          { key: "BUNDLE", type: "string", fallback_value: "החבילה שבחרת" },
        ],
        source_document_id: source.source.documentId,
      });
    }
  }
  return {
    generated_at: new Date().toISOString(),
    source: source.source,
    count: templates.length,
    templates,
  };
}

export function buildStandaloneTemplateManifest(source) {
  const templates = source.templates.map(template => ({
    ...template,
    html: renderNovaHairEmail({ email: template, flowSlug: source.flow_slug }),
    text: renderText(template),
  }));
  return { generated_at: new Date().toISOString(), count: templates.length, templates };
}

export { FLOW_SLUGS, PRODUCT_IMAGE, approvedBody };
