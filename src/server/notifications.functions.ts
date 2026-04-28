import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import fs from "fs";
import path from "path";

const InputSchema = z.object({
  truck_id: z.string().uuid(),
  slot_code: z.string().min(1).max(64),
});

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\+[1-9]\d{6,14}$/.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return `+${digits}`;
}

export const notifyQueuePromotion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    try {
      // Brute-force read .env to bypass process caching
      let ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
      let AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
      let TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;
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
          if (fromMatch) TWILIO_FROM_NUMBER = fromMatch[1].trim();
        }
      } catch (envErr) {
        console.warn("Failed to manually read .env:", envErr);
      }

      if (!ACCOUNT_SID) return { ok: false, skipped: true, reason: "missing_twilio_account_sid" };
      if (!AUTH_TOKEN) return { ok: false, skipped: true, reason: "missing_twilio_auth_token" };
      if (!TWILIO_FROM_NUMBER) return { ok: false, skipped: true, reason: "missing_twilio_from_number" };

      const { data: truckData, error } = await supabaseAdmin
        .from("trucks")
        .select("plate, carrier, driver_name, driver_phone, trailer_number")
        .eq("id", data.truck_id)
        .maybeSingle();

      const truck = truckData as any;

      if (error) {
        console.error("DB error fetching truck:", error);
        return { ok: false, skipped: true, reason: `db_error:${error.message}` };
      }
      if (!truck) {
        console.warn("Truck not found:", data.truck_id);
        return { ok: false, skipped: true, reason: "truck_not_found" };
      }

      let to = normalizePhone(truck.driver_phone);
      if (!to) {
        console.warn("No valid driver phone:", truck.driver_phone);
        return { ok: false, skipped: true, reason: "no_driver_phone" };
      }

      const driverLabel = truck.driver_name ? truck.driver_name.split(" ")[0] : "Driver";
      const trailerLabel = truck.trailer_number ? ` (Trailer ${truck.trailer_number})` : "";
      let body =
        `Hi ${driverLabel}, your truck ${truck.plate}${trailerLabel} has been assigned slot ${data.slot_code}. ` +
        `Please proceed to the assigned slot. — ${truck.carrier}`;

      const overrideTo = process.env.TWILIO_VERIFIED_TO_NUMBER;
      if (overrideTo) {
        console.log("Twilio override active. Rerouting to:", overrideTo);
        to = overrideTo;
        body = `[TEST] ${body}`;
      }

      console.log("Sending Twilio SMS to:", to);
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
            From: TWILIO_FROM_NUMBER,
            Body: body.slice(0, 480),
          }),
        },
      );

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error("Twilio API error:", res.status, payload);
        return { ok: false, skipped: false, reason: `twilio_${res.status}`, details: payload };
      }

      console.log("Twilio SMS sent successfully. SID:", payload.sid);
      return { ok: true, sid: (payload as { sid?: string }).sid ?? null, to };
    } catch (err) {
      console.error("Unexpected error in notifyQueuePromotion:", err);
      return { ok: false, skipped: false, reason: err instanceof Error ? err.message : "unknown_server_error" };
    }
  });
