import http from "node:http";
import nodemailer from "nodemailer";

const port = Number(process.env.PORT || 3000);
const user = process.env.NAMECHEAP_PRIVATE_EMAIL_USER || "";
const password = process.env.NAMECHEAP_PRIVATE_EMAIL_PASSWORD || "";
const serviceSecret = process.env.NOVAHAIR_EMAIL_SERVICE_SECRET || "";
const from = process.env.NOVAHAIR_EMAIL_FROM || user;

const transporter = nodemailer.createTransport({
  host: process.env.NAMECHEAP_SMTP_HOST || "mail.privateemail.com",
  port: Number(process.env.NAMECHEAP_SMTP_PORT || 465),
  secure: true,
  auth: { user, pass: password },
  connectionTimeout: 8000,
  socketTimeout: 10000,
});

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 8192) throw new Error("body_too_large");
  }
  return JSON.parse(body || "{}");
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    return json(res, user && password && serviceSecret ? 200 : 503, { ok: Boolean(user && password && serviceSecret) });
  }
  if (req.method !== "POST" || req.url !== "/send-otp") return json(res, 404, { ok: false });
  if (req.headers.authorization !== `Bearer ${serviceSecret}` || !serviceSecret) return json(res, 401, { ok: false });
  try {
    const body = await readJson(req);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{6}$/.test(code)) return json(res, 400, { ok: false });
    await transporter.sendMail({
      from: `NovaHair <${from}>`,
      to: email,
      subject: "קוד האימות שלך ל־NovaHair",
      text: `קוד האימות שלך הוא ${code}. הקוד תקף ל־10 דקות.`,
      html: `<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.6;color:#201914"><h2>קוד האימות שלך</h2><p style="font-size:30px;font-weight:700;letter-spacing:4px">${code}</p><p>הקוד תקף ל־10 דקות.</p></div>`,
    });
    return json(res, 202, { ok: true });
  } catch (error) {
    console.error("OTP email failed", error instanceof Error ? error.message : String(error));
    return json(res, 502, { ok: false });
  }
});

server.listen(port, "0.0.0.0", () => console.log(`NovaHair email service listening on ${port}`));
