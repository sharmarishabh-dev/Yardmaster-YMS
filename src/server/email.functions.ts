import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/* ------------------------------------------------------------------ *
 * Email delivery via Mailgun REST API.                                *
 * Requires env vars: MAILGUN_API_KEY, MAILGUN_DOMAIN, MAILGUN_FROM   *
 * ------------------------------------------------------------------ */

async function sendViaMailgun(to: string, subject: string, body: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  const API_KEY = process.env.MAILGUN_API_KEY;
  const DOMAIN = process.env.MAILGUN_DOMAIN;
  const FROM = process.env.MAILGUN_FROM || `YardMaster <noreply@${DOMAIN}>`;

  if (!API_KEY || !DOMAIN) {
    return { ok: false, error: "Mailgun not configured (missing MAILGUN_API_KEY or MAILGUN_DOMAIN)" };
  }

  try {
    const form = new URLSearchParams({
      from: FROM,
      to,
      subject,
      text: body,
    });

    const res = await fetch(`https://api.mailgun.net/v3/${DOMAIN}/messages`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`api:${API_KEY}`).toString("base64"),
      },
      body: form,
    });

    const json = (await res.json()) as { id?: string; message?: string };

    if (!res.ok) {
      return { ok: false, error: json.message ?? `Mailgun error ${res.status}` };
    }

    return { ok: true, id: json.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown Mailgun error" };
  }
}

/* ------------------------------------------------------------------ *
 * Generic send + record in email_notifications table.                 *
 * ------------------------------------------------------------------ */

const SendEmailSchema = z.object({
  to: z.string().trim().email("Invalid email address"),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
});

export const sendEmailNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => SendEmailSchema.parse(input))
  .handler(async ({ data }) => {
    const result = await sendViaMailgun(data.to, data.subject, data.body);

    // Record in DB for audit trail
    await (supabaseAdmin as any).from("email_notifications").insert({
      to_email: data.to,
      subject: data.subject,
      body: data.body,
      status: result.ok ? "sent" : "failed",
      sent_at: result.ok ? new Date().toISOString() : null,
      error_message: result.error ?? null,
      attempts: 1,
    });

    return result;
  });

/* ------------------------------------------------------------------ *
 * Specific notification builders for YardMaster operational events.   *
 * ------------------------------------------------------------------ */

/** Notify a driver about task assignment via email */
export const emailTaskAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        assignee_id: z.string().uuid(),
        task_title: z.string(),
        task_instructions: z.string().nullable().optional(),
        trailer_number: z.string().nullable().optional(),
        due_at: z.string().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("id", data.assignee_id)
      .maybeSingle();

    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(data.assignee_id);
    const email = authUser?.user?.email;
    if (!email) return { ok: false, skipped: true, reason: "no_email" };

    const name = profile?.full_name?.split(" ")[0] || "Driver";
    const trailer = data.trailer_number ? ` (Trailer ${data.trailer_number})` : "";
    const due = data.due_at ? `\nDue: ${new Date(data.due_at).toLocaleString()}` : "";
    const instructions = data.task_instructions ? `\n\nInstructions:\n${data.task_instructions}` : "";

    const subject = `YardMaster: New Task — ${data.task_title}`;
    const body = [
      `Hi ${name},`,
      ``,
      `You have been assigned a new task:`,
      ``,
      `📋 ${data.task_title}${trailer}${due}${instructions}`,
      ``,
      `Please log in to YardMaster to view details and update progress.`,
      ``,
      `— YardMaster Operations`,
    ].join("\n");

    const result = await sendViaMailgun(email, subject, body);

    await (supabaseAdmin as any).from("email_notifications").insert({
      to_email: email,
      subject,
      body,
      status: result.ok ? "sent" : "failed",
      sent_at: result.ok ? new Date().toISOString() : null,
      error_message: result.error ?? null,
      attempts: 1,
      metadata: { type: "task_assignment", task_title: data.task_title, assignee_id: data.assignee_id },
    });

    return { ok: result.ok, to: email, error: result.error };
  });

/** Notify about slot promotion (queue → assigned) via email */
export const emailQueuePromotion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        truck_id: z.string().uuid(),
        slot_code: z.string().min(1).max(64),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { data: truckData } = await supabaseAdmin
      .from("trucks")
      .select("plate, carrier, driver_name, driver_phone, trailer_number, created_by")
      .eq("id", data.truck_id)
      .maybeSingle();
    const truck = truckData as any;

    if (!truck) return { ok: false, skipped: true, reason: "truck_not_found" };

    let email: string | null = null;
    if (truck.created_by) {
      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(truck.created_by);
      email = authUser?.user?.email ?? null;
    }

    if (!email) return { ok: false, skipped: true, reason: "no_email" };

    const driverLabel = truck.driver_name ? truck.driver_name.split(" ")[0] : "Driver";
    const subject = `YardMaster: Slot Assigned — ${truck.plate} → ${data.slot_code}`;
    const body = [
      `Hi ${driverLabel},`,
      ``,
      `Your truck ${truck.plate}${truck.trailer_number ? ` (Trailer ${truck.trailer_number})` : ""} has been assigned to slot ${data.slot_code}.`,
      ``,
      `Please proceed to the assigned slot.`,
      ``,
      `Carrier: ${truck.carrier}`,
      ``,
      `— YardMaster Operations`,
    ].join("\n");

    const result = await sendViaMailgun(email, subject, body);

    await (supabaseAdmin as any).from("email_notifications").insert({
      to_email: email,
      subject,
      body,
      status: result.ok ? "sent" : "failed",
      sent_at: result.ok ? new Date().toISOString() : null,
      error_message: result.error ?? null,
      attempts: 1,
      metadata: { type: "queue_promotion", truck_id: data.truck_id, slot_code: data.slot_code },
    });

    return { ok: result.ok, to: email, error: result.error };
  });
