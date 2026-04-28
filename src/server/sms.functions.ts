import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import fs from "fs";
import path from "path";

const SendSmsSchema = z.object({
  to: z
    .string()
    .trim()
    .min(7)
    .max(20)
    .regex(/^\+?[0-9 ()-]+$/, "Invalid phone number"),
  body: z.string().trim().min(1).max(480),
});

function normalizePhone(raw: string): string {
  const trimmed = raw.replace(/[^0-9+]/g, "");
  if (trimmed.startsWith("+")) return trimmed;
  return `+${trimmed}`;
}

export const sendDriverSms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => SendSmsSchema.parse(input))
  .handler(async ({ data }) => {
    let ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
    let AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
    let FROM = process.env.TWILIO_FROM_NUMBER;
    const VERIFIED_TO = process.env.TWILIO_VERIFIED_TO_NUMBER;

    try {
      const envPath = path.resolve(process.cwd(), ".env");
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, "utf8");
        const sidMatch = envContent.match(/^TWILIO_ACCOUNT_SID=["']?([^"'\n\r]+)["']?$/m);
        const tokenMatch = envContent.match(/^TWILIO_AUTH_TOKEN=["']?([^"'\n\r]+)["']?$/m);
        const fromMatch = envContent.match(/^TWILIO_FROM_NUMBER=["']?([^"'\n\r]+)["']?$/m);
        
        if (sidMatch) ACCOUNT_SID = sidMatch[1].trim();
        if (tokenMatch) AUTH_TOKEN = tokenMatch[1].trim();
        if (fromMatch) FROM = fromMatch[1].trim();
      }
    } catch (e) {
      console.error("Failed to read .env in sendDriverSms:", e);
    }

    if (!ACCOUNT_SID || !AUTH_TOKEN || !FROM) {
      return {
        ok: false,
        error: "SMS not configured (missing Twilio credentials)",
      };
    }

    let to = normalizePhone(data.to);
    let body = data.body;

    if (VERIFIED_TO) {
      to = VERIFIED_TO;
      body = `[TEST] ${body}`;
    }

    try {
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization:
              "Basic " +
              Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString("base64"),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            To: to,
            From: FROM,
            Body: body,
          }),
        },
      );
      const json = (await res.json()) as { sid?: string; message?: string };
      if (!res.ok) {
        return {
          ok: false,
          error: json.message ?? `Twilio error ${res.status}`,
        };
      }
      return { ok: true, sid: json.sid };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown SMS error";
      return { ok: false, error: msg };
    }
  });
