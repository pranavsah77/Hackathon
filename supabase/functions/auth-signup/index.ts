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

const studentSignupSchema = z.object({
  fullName: z.string().trim().min(2, "Full name must be at least 2 characters").max(100),
  identifier: z.string().trim().min(3, "Roll number or email is required").max(100),
  password: z.string().min(6, "Password must be at least 6 characters").max(100),
  phone: z.string().trim().regex(/^\+?[0-9\s-]{10,15}$/, "Valid 10-digit mobile number required"),
  residencyStatus: z.enum(["Hostler", "Day Scholar"]).default("Hostler"),
  hostel: z.string().max(100).optional(),
  department: z.string().max(100).optional(),
});

const driverSignupSchema = z.object({
  fullName: z.string().trim().min(2, "Full name must be at least 2 characters").max(100),
  driverId: z.string().trim().min(2, "Driver ID or Cart number is required").max(50),
  phone: z.string().trim().regex(/^\+?[0-9\s-]{10,15}$/, "Valid 10-digit mobile number required"),
  pin: z.string().trim().min(4, "PIN must be at least 4 digits").max(20),
});

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || 
                     req.headers.get("cf-connecting-ip") || "unknown-ip";
    const ipSignupKey = `signup:ip:${clientIp}`;

    // Rate Limiting on Signup: Max 10 signups per hour per IP network
    const { data: ipLimit } = await supabaseAdmin.rpc("check_rate_limit", {
      p_key: ipSignupKey,
      p_max_attempts: 10,
      p_lockout_minutes: 60,
    });

    if (ipLimit && !ipLimit.allowed) {
      return new Response(
        JSON.stringify({
          data: null,
          error: { code: "RATE_LIMITED", message: "Too many accounts created from this network. Please try again later." },
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const requestedRole = (body.role || "student").toLowerCase();

    // SERVER-SIDE ROLE LOCK:
    // Only 'student' or 'driver' can be signed up. Can NEVER create admin.
    if (requestedRole !== "student" && requestedRole !== "driver") {
      return new Response(
        JSON.stringify({
          data: null,
          error: { code: "INVALID_ROLE", message: "Invalid role specified for registration." },
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let cleanIdent = "";
    let cleanEmail = "";
    let finalPassword = "";
    let userMeta: Record<string, unknown> = {};

    if (requestedRole === "student") {
      const parseResult = studentSignupSchema.safeParse(body);
      if (!parseResult.success) {
        const firstErr = parseResult.error.errors[0]?.message || "Invalid input data";
        return new Response(
          JSON.stringify({
            data: null,
            error: { code: "VALIDATION_ERROR", message: firstErr },
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const data = parseResult.data;
      cleanIdent = data.identifier.toUpperCase();
      if (data.identifier.includes("@")) {
        cleanEmail = data.identifier.toLowerCase();
      } else {
        cleanEmail = `${data.identifier.toLowerCase().replace(/[^a-z0-9_-]/g, "")}@qartix.campus`;
      }
      finalPassword = data.password;

      userMeta = {
        role: "student",
        fullName: data.fullName,
        studentId: cleanIdent,
        phone: data.phone,
        hostel: data.residencyStatus === "Hostler" ? (data.hostel || "Block C - Oak Hall") : "Day Scholar",
        department: data.department || "Engineering",
        residencyStatus: data.residencyStatus,
      };
    } else {
      // Driver
      const parseResult = driverSignupSchema.safeParse(body);
      if (!parseResult.success) {
        const firstErr = parseResult.error.errors[0]?.message || "Invalid driver input";
        return new Response(
          JSON.stringify({
            data: null,
            error: { code: "VALIDATION_ERROR", message: firstErr },
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const data = parseResult.data;
      cleanIdent = data.driverId.toUpperCase();
      cleanEmail = `${cleanIdent.toLowerCase().replace(/[^a-z0-9_-]/g, "")}@driver.qartix.campus`;

      if (data.pin === "4021") {
        finalPassword = "driverPin4021";
      } else if (data.pin.length < 6) {
        finalPassword = `${data.pin}_qartix_driver`;
      } else {
        finalPassword = data.pin;
      }

      userMeta = {
        role: "driver",
        fullName: data.fullName,
        driverId: cleanIdent,
        phone: data.phone,
      };
    }

    // 1. Check Uniqueness in profiles
    const { data: existingProfile } = await supabaseAdmin
      .from("profiles")
      .select("id, login_identifier")
      .ilike("login_identifier", cleanIdent)
      .limit(1);

    if (existingProfile && existingProfile.length > 0) {
      return new Response(
        JSON.stringify({
          data: null,
          error: { code: "IDENTIFIER_EXISTS", message: `An account with identifier "${cleanIdent}" already exists. Please sign in.` },
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Create User via Admin API
    const { data: createData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: cleanEmail,
      password: finalPassword,
      email_confirm: true,
      user_metadata: userMeta,
    });

    if (createError) {
      return new Response(
        JSON.stringify({
          data: null,
          error: { code: "CREATE_USER_FAILED", message: createError.message || "Failed to create user account." },
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Record rate limit attempt
    await supabaseAdmin.rpc("record_rate_limit_attempt", {
      p_key: ipSignupKey,
      p_success: false,
      p_max_attempts: 10,
      p_lockout_minutes: 60,
    });

    const createdUser = createData.user;

    // Driver accounts are created with status pending_approval
    if (requestedRole === "driver") {
      return new Response(
        JSON.stringify({
          data: {
            user: {
              id: createdUser.id,
              email: createdUser.email,
              driverId: cleanIdent,
              fullName: userMeta.fullName,
            },
            pendingApproval: true,
            message: "Awaiting transport office approval. Your driver account is pending verification by the transport office.",
          },
          error: null,
          // Backward-compat keys:
          success: true,
          pendingApproval: true,
          message: "Awaiting transport office approval. Your driver account is pending verification by the transport office.",
          user: {
            id: createdUser.id,
            email: createdUser.email,
            driverId: cleanIdent,
            fullName: userMeta.fullName,
          },
        }),
        { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // For student, automatically sign in
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const supabaseAnon = createClient(supabaseUrl, anonKey);
    const { data: loginSession } = await supabaseAnon.auth.signInWithPassword({
      email: cleanEmail,
      password: finalPassword,
    });

    return new Response(
      JSON.stringify({
        data: {
          user: createdUser,
          profile: {
            id: createdUser.id,
            role: "student",
            full_name: userMeta.fullName,
            login_identifier: cleanIdent,
            phone: userMeta.phone,
            status: "active",
          },
          session: loginSession?.session || null,
          message: "Account created successfully.",
        },
        error: null,
        // Backward-compat keys:
        success: true,
        message: "Account created successfully.",
        session: loginSession?.session || null,
        user: createdUser,
        profile: {
          id: createdUser.id,
          role: "student",
          full_name: userMeta.fullName,
          login_identifier: cleanIdent,
          phone: userMeta.phone,
          status: "active",
        },
      }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (_err) {
    // Defense: NEVER return raw stack traces to client
    return new Response(
      JSON.stringify({
        data: null,
        error: { code: "INTERNAL_ERROR", message: "Registration failed. Please verify your details." },
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
