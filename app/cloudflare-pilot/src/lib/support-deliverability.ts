type DnsJsonAnswer = { data?: string; type?: number };
type DnsJsonResponse = { Answer?: DnsJsonAnswer[]; Status?: number };

export type DeliverabilityCheckStatus = "PASS" | "WARN" | "FAIL";

export interface DeliverabilityCheck {
  key: "MX" | "SPF" | "DKIM" | "DMARC";
  label: string;
  status: DeliverabilityCheckStatus;
  detail: string;
}

function normalizeTxt(value: string): string {
  return value.replace(/^"|"$/g, "").replace(/"\s+"/g, "").trim();
}

function records(response: DnsJsonResponse): string[] {
  return (response.Answer || []).map(answer => normalizeTxt(String(answer.data || ""))).filter(Boolean);
}

export function assessSupportEmailDns(input: {
  mx: string[];
  apexTxt: string[];
  dmarcTxt: string[];
  defaultDkimTxt: string[];
  privateEmailDkimTxt: string[];
}): { status: "HEALTHY" | "NEEDS_ATTENTION"; checks: DeliverabilityCheck[]; summary: string } {
  const mxConfigured = input.mx.some(value => /mx[12]\.privateemail\.com/i.test(value));
  const spfRecords = input.apexTxt.filter(value => /^v=spf1\b/i.test(value));
  const spfConfigured = spfRecords.some(value => /include:spf\.privateemail\.com/i.test(value));
  const multipleSpf = spfRecords.length > 1;
  const dkimConfigured = [...input.defaultDkimTxt, ...input.privateEmailDkimTxt].some(value => /^v=dkim1\b/i.test(value));
  const dmarcRecord = input.dmarcTxt.find(value => /^v=dmarc1\b/i.test(value));

  const checks: DeliverabilityCheck[] = [
    {
      key: "MX",
      label: "Receiving mail",
      status: mxConfigured ? "PASS" : "FAIL",
      detail: mxConfigured ? "Namecheap Private Email MX is active." : "Namecheap Private Email MX records were not found.",
    },
    {
      key: "SPF",
      label: "Sender authorization",
      status: spfConfigured && !multipleSpf ? "PASS" : "FAIL",
      detail: multipleSpf
        ? "Multiple SPF records were found; they must be consolidated into one record."
        : spfConfigured
          ? "Namecheap is authorized to send for this domain."
          : "SPF does not currently authorize Namecheap. This can cause replies to be rejected or sent to spam.",
    },
    {
      key: "DKIM",
      label: "Message signature",
      status: dkimConfigured ? "PASS" : "FAIL",
      detail: dkimConfigured ? "A Private Email DKIM signature is published." : "A Private Email DKIM record was not found.",
    },
    {
      key: "DMARC",
      label: "Domain policy",
      status: dmarcRecord ? (/\bp=(?:quarantine|reject)\b/i.test(dmarcRecord) ? "PASS" : "WARN") : "WARN",
      detail: dmarcRecord
        ? (/\bp=none\b/i.test(dmarcRecord) ? "DMARC is monitoring only (p=none)." : "DMARC enforcement is active.")
        : "A DMARC policy was not found.",
    },
  ];
  const status = checks.some(check => check.status === "FAIL") ? "NEEDS_ATTENTION" : "HEALTHY";
  return {
    status,
    checks,
    summary: status === "HEALTHY"
      ? "Core email authentication is configured."
      : "Email authentication needs attention before delivery can be considered reliable.",
  };
}

async function queryDns(name: string, type: "MX" | "TXT"): Promise<string[]> {
  const url = new URL("https://cloudflare-dns.com/dns-query");
  url.searchParams.set("name", name);
  url.searchParams.set("type", type);
  const response = await fetch(url, { headers: { Accept: "application/dns-json" } });
  if (!response.ok) throw new Error(`DNS check failed with HTTP ${response.status}.`);
  return records(await response.json() as DnsJsonResponse);
}

export async function inspectSupportEmailDomain(domain: string) {
  const normalizedDomain = domain.trim().toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(normalizedDomain)) {
    throw new Error("A valid support email domain is required.");
  }
  const [mx, apexTxt, dmarcTxt, defaultDkimTxt, privateEmailDkimTxt] = await Promise.all([
    queryDns(normalizedDomain, "MX"),
    queryDns(normalizedDomain, "TXT"),
    queryDns(`_dmarc.${normalizedDomain}`, "TXT"),
    queryDns(`default._domainkey.${normalizedDomain}`, "TXT"),
    queryDns(`privateemail._domainkey.${normalizedDomain}`, "TXT"),
  ]);
  return {
    domain: normalizedDomain,
    checkedAt: new Date().toISOString(),
    ...assessSupportEmailDns({ mx, apexTxt, dmarcTxt, defaultDkimTxt, privateEmailDkimTxt }),
  };
}
