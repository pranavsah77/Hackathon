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

const loginSchema = z.object({
  role: z.enum(["student", "driver", "admin"]).default("student"),
  identifier: z.string().trim().max(100).optional(),
  driverId: z.string().trim().max(100).optional(),
  password: z.string().max(100).optional(),
  pin: z.string().max(20).optional(),
  syncDemoPasswords: z.boolean().optional(),
});

const GENERIC_AUTH_ERROR = "Invalid credentials. Please verify your details and password.";

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const supabaseAnon = createClient(supabaseUrl, anonKey);

    const body = await req.json().catch(() => ({}));
    const parseResult = loginSchema.safeParse(body);

    if (!parseResult.success) {
      return new Response(
        JSON.stringify({
          data: null,
          error: { code: "VALIDATION_ERROR", message: "Invalid request payload format." },
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { role, identifier, password = "", driverId, pin = "", syncDemoPasswords } = parseResult.data;

    // Maintenance action to sync demo credentials if requested
    if (syncDemoPasswords === true) {
      await supabaseAdmin.auth.admin.updateUserById("11111111-1111-1111-1111-111111111111", { password: "studentPassword123" });
      await supabaseAdmin.auth.admin.updateUserById("22222222-2222-2222-2222-222222222222", { password: "driverPin4021" });
      await supabaseAdmin.auth.admin.updateUserById("33333333-3333-3333-3333-333333333333", { password: "adminPassword123" });
      return new Response(
        JSON.stringify({ data: { synced: true }, error: null }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || 
                     req.headers.get("cf-connecting-ip") || "unknown-ip";

    const cleanRole = role.toLowerCase();
    const rawIdentifier = (cleanRole === "driver" ? (driverId || identifier) : identifier || "").trim();

    if (!rawIdentifier) {
      return new Response(
        JSON.stringify({
          data: null,
          error: {
            code: "IDENTIFIER_REQUIRED",
            message: cleanRole === "driver" ? "Driver ID or Cart number is required." : "Roll number or email is required."
          },
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ipKey = `ip:${clientIp}`;
    const identKey = `ident:${rawIdentifier.toLowerCase()}`;

    // 1. Rate Limiting Checks
    const { data: ipLimit } = await supabaseAdmin.rpc("check_rate_limit", { p_key: ipKey, p_max_attempts: 15, p_lockout_minutes: 5 });
    if (ipLimit && !ipLimit.allowed) {
      return new Response(
        JSON.stringify({
          data: null,
          error: { code: "RATE_LIMITED", message: "Too many login attempts from this network. Please wait a few minutes." },
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: identLimit } = await supabaseAdmin.rpc("check_rate_limit", { p_key: identKey, p_max_attempts: 5, p_lockout_minutes: 15 });
    if (identLimit && !identLimit.allowed) {
      return new Response(
        JSON.stringify({
          data: null,
          error: { code: "ACCOUNT_LOCKED", message: "Too many failed attempts. Account temporarily locked for 15 minutes." },
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Resolve Identifier to Email
    let userEmail = "";
    let profile = null;

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, role, full_name, login_identifier, phone, status")
      .ilike("login_identifier", rawIdentifier)
      .limit(1);

    if (profiles && profiles.length > 0) {
      profile = profiles[0];
      const { data: userData } = await supabaseAdmin.auth.admin.getUserById(profile.id);
      if (userData?.user?.email) {
        userEmail = userData.user.email;
      }
    }

    if (!userEmail && rawIdentifier.includes("@")) {
      userEmail = rawIdentifier.toLowerCase();
      const { data: pList } = await supabaseAdmin
        .from("profiles")
        .select("id, role, full_name, login_identifier, phone, status")
        .limit(20);
      for (const p of (pList || [])) {
        const { data: u } = await supabaseAdmin.auth.admin.getUserById(p.id);
        if (u?.user?.email?.toLowerCase() === userEmail) {
          profile = p;
          break;
        }
      }
    }

    if (!userEmail) {
      if (cleanRole === "driver") {
        userEmail = `${rawIdentifier.toLowerCase().replace(/[^a-z0-9_-]/g, "")}@driver.qartix.campus`;
      } else {
        userEmail = `${rawIdentifier.toLowerCase().replace(/[^a-z0-9_-]/g, "")}@qartix.campus`;
      }
    }

    // 3. Password / PIN handling
    let finalPassword = password;
    if (cleanRole === "driver") {
      const inputPin = (pin || password).trim();
      if (!inputPin) {
        return new Response(
          JSON.stringify({
            data: null,
            error: { code: "PIN_REQUIRED", message: "PIN is required." },
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (inputPin === "4021") {
        finalPassword = "driverPin4021";
      } else if (inputPin.length < 6) {
        finalPassword = `${inputPin}_qartix_driver`;
      } else {
        finalPassword = inputPin;
      }
    }

    // 4. Check Driver Approval Status BEFORE granting session
    if (profile && profile.role === "driver" && profile.status === "pending_approval") {
      return new Response(
        JSON.stringify({
          data: null,
          pendingApproval: true,
          error: {
            code: "APPROVAL_PENDING",
            message: "Awaiting transport office approval. Your driver account is pending verification by the transport office.",
          },
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. Authenticate via Supabase Auth
    const { data: authData, error: authError } = await supabaseAnon.auth.signInWithPassword({
      email: userEmail,
      password: finalPassword,
    });

    if (authError || !authData?.session) {
      await supabaseAdmin.rpc("record_rate_limit_attempt", { p_key: ipKey, p_success: false, p_max_attempts: 15, p_lockout_minutes: 5 });
      await supabaseAdmin.rpc("record_rate_limit_attempt", { p_key: identKey, p_success: false, p_max_attempts: 5, p_lockout_minutes: 15 });

      return new Response(
        JSON.stringify({
          data: null,
          error: { code: "INVALID_CREDENTIALS", message: GENERIC_AUTH_ERROR },
        }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 6. Reset rate limits on success
    await supabaseAdmin.rpc("record_rate_limit_attempt", { p_key: ipKey, p_success: true });
    await supabaseAdmin.rpc("record_rate_limit_attempt", { p_key: identKey, p_success: true });

    if (!profile && authData.user) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, role, full_name, login_identifier, phone, status")
        .eq("id", authData.user.id)
        .single();
      profile = profs;
    }

    // Verify role matches requested tab
    if (profile && profile.role !== cleanRole && profile.role !== "admin") {
      return new Response(
        JSON.stringify({
          data: null,
          error: {
            code: "ROLE_MISMATCH",
            message: `This account is registered as a ${profile.role}. Please use the ${profile.role} tab.`,
          },
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        data: {
          session: authData.session,
          user: authData.user,
          profile,
        },
        error: null,
        // Backward-compatibility keys for existing callers:
        session: authData.session,
        user: authData.user,
        profile,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (_err) {
    // Defense: NEVER return raw stack traces or internal errors to client
    return new Response(
      JSON.stringify({
        data: null,
        error: { code: "INTERNAL_ERROR", message: GENERIC_AUTH_ERROR },
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
