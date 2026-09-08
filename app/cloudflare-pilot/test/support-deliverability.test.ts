import assert from "node:assert/strict";
import test from "node:test";
import { assessSupportEmailDns } from "../src/lib/support-deliverability.js";

test("email delivery is healthy when Private Email authentication is complete", () => {
  const report = assessSupportEmailDns({
    mx: ["10 mx1.privateemail.com.", "10 mx2.privateemail.com."],
    apexTxt: ["v=spf1 include:spf.privateemail.com ~all"],
    dmarcTxt: ["v=DMARC1; p=reject;"],
    defaultDkimTxt: ["v=DKIM1; k=rsa; p=abc"],
    privateEmailDkimTxt: [],
  });
  assert.equal(report.status, "HEALTHY");
  assert.deepEqual(report.checks.map(check => check.status), ["PASS", "PASS", "PASS", "PASS"]);
});

test("missing SPF is a delivery failure even when MX and DKIM exist", () => {
  const report = assessSupportEmailDns({
    mx: ["10 mx1.privateemail.com."],
    apexTxt: [],
    dmarcTxt: ["v=DMARC1; p=none;"],
    defaultDkimTxt: ["v=DKIM1; k=rsa; p=abc"],
    privateEmailDkimTxt: [],
  });
  assert.equal(report.status, "NEEDS_ATTENTION");
  assert.equal(report.checks.find(check => check.key === "SPF")?.status, "FAIL");
  assert.equal(report.checks.find(check => check.key === "DMARC")?.status, "WARN");
});

test("multiple SPF records are rejected instead of presented as healthy", () => {
  const report = assessSupportEmailDns({
    mx: ["10 mx1.privateemail.com."],
    apexTxt: ["v=spf1 include:spf.privateemail.com ~all", "v=spf1 include:_spf.example.com ~all"],
    dmarcTxt: [],
    defaultDkimTxt: [],
    privateEmailDkimTxt: ["v=DKIM1; k=rsa; p=abc"],
  });
  const spf = report.checks.find(check => check.key === "SPF");
  assert.equal(spf?.status, "FAIL");
  assert.match(spf?.detail || "", /consolidated/i);
});
