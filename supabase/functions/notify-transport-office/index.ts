import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const ALLOWED_ORIGINS = [
  "https://qartix-hackathon.vercel.app",
  "http://localhost:5173",
  "http://localhost:3000",
  "http://localhost:4173",
  "http://127.0.0.1:5173",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const isAllowed = ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".vercel.app");
  return {
    "Access-Control-Allow-Origin": isAllowed ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const notifySchema = z.object({
  requestCode: z.string().trim().min(3).max(50),
  studentName: z.string().trim().min(1).max(100),
  studentIdent: z.string().trim().min(2).max(50),
  medicalCondition: z.string().trim().min(1).max(100),
  reason: z.string().trim().max(1000).optional().default(""),
});

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    // 1. JWT Authentication Verification
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({
          data: null,
          error: { code: "UNAUTHORIZED", message: "Valid authorization header is required." },
        }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const supabaseClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({
          data: null,
          error: { code: "INVALID_TOKEN", message: "Invalid or expired session token." },
        }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Zod Payload Validation
    const body = await req.json().catch(() => ({}));
    const parseResult = notifySchema.safeParse(body);

    if (!parseResult.success) {
      const msg = parseResult.error.errors[0]?.message || "Invalid notification payload.";
      return new Response(
        JSON.stringify({
          data: null,
          error: { code: "VALIDATION_ERROR", message: msg },
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { requestCode, studentName, studentIdent, medicalCondition, reason } = parseResult.data;

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const transportOfficeEmail = Deno.env.get("TRANSPORT_OFFICE_EMAIL") || "transport@qartix.campus";

    let emailSent = false;
    let provider = "none";

    if (resendApiKey) {
      provider = "resend";
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${resendApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "Qartix Transit <notifications@qartix.campus>",
            to: [transportOfficeEmail],
            subject: `[Qartix Pass Request] New Mobility Application: ${requestCode} (${studentIdent})`,
            html: `
              <h2>New Campus Mobility Pass Request</h2>
              <p><strong>Request Code:</strong> ${requestCode}</p>
              <p><strong>Student:</strong> ${studentName} (${studentIdent})</p>
              <p><strong>Medical Condition:</strong> ${medicalCondition}</p>
              <p><strong>Reason:</strong> ${reason}</p>
              <p>Please review and verify the medical certificate in the Transport Office Admin Console.</p>
            `,
          }),
        });
        emailSent = res.ok;
      } catch (_e) {
        emailSent = false;
      }
    }

    const resultMessage = emailSent
      ? `Transport office notified via email to ${transportOfficeEmail}`
      : "Transport office notified in-app (Email provider not configured; set RESEND_API_KEY to enable automated email delivery)";

    return new Response(
      JSON.stringify({
        data: {
          success: true,
          emailConfigured: Boolean(resendApiKey),
          emailSent,
          provider,
          message: resultMessage,
        },
        error: null,
        // Backward-compat keys:
        success: true,
        emailConfigured: Boolean(resendApiKey),
        emailSent,
        provider,
        message: resultMessage,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (_err) {
    // Defense: NEVER return raw stack traces or internal errors to client
    return new Response(
      JSON.stringify({
        data: null,
        error: { code: "INTERNAL_ERROR", message: "Failed to dispatch transport office notification." },
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
