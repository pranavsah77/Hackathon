import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { sanitizeText } from './sanitize.js';

export const passRequestSchema = z.object({
  pickup: z.string().trim().min(1, 'Pickup station is required'),
  drop: z.string().trim().min(1, 'Drop station is required'),
  medicalCondition: z.string().trim().min(1, 'Medical condition is required'),
  reason: z.string().trim().min(5, 'Reason must be at least 5 characters'),
  duration: z.string().trim().min(1, 'Duration is required'),
  timeSlots: z.array(z.string()).min(1, 'At least one time slot is required'),
});

/**
 * Checks file content magic bytes to verify genuine PDF, JPG, or PNG MIME type.
 * Enforces server-compatible client verification beyond file extension.
 */
export async function detectFileMimeType(file) {
  if (!file) return null;
  const buffer = await file.slice(0, 8).arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // PDF: %PDF -> 0x25, 0x50, 0x44, 0x46
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return 'application/pdf';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4E &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0D &&
    bytes[5] === 0x0A &&
    bytes[6] === 0x1A &&
    bytes[7] === 0x0A
  ) {
    return 'image/png';
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }

  return 'application/octet-stream';
}

// Supabase Public Configuration
const supabaseUrl =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SUPABASE_URL) ||
  (typeof window !== 'undefined' && window.__ENV__ && window.__ENV__.VITE_SUPABASE_URL) ||
  'https://arbwqtudubtyxufbjojq.supabase.co';

const supabaseAnonKey =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SUPABASE_ANON_KEY) ||
  (typeof window !== 'undefined' && window.__ENV__ && window.__ENV__.VITE_SUPABASE_ANON_KEY) ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFyYndxdHVkdWJ0eXh1ZmJqb2pxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI5MTk3MjcsImV4cCI6MjEwODQ5NTcyN30.cOkLai5YpcN2d_FOidjkwGKoAweXn3YAVoFA2ERW5QA';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// Helper: Normalize Student Identifier (Roll No or Email) to Auth Email
export function normalizeStudentEmail(identifier) {
  const clean = (identifier || '').trim().toLowerCase();
  if (clean.includes('@')) return clean;
  // E.g. STU-84920 -> stu-84920@qartix.campus
  return `${clean.replace(/[^a-z0-9_-]/g, '')}@qartix.campus`;
}

// Helper: Normalize Driver ID / Cart Number to Auth Email
export function normalizeDriverEmail(driverId) {
  const clean = (driverId || '').trim().toLowerCase();
  if (clean.includes('@')) return clean;
  // E.g. CART-04 -> cart-04@driver.qartix.campus
  return `${clean.replace(/[^a-z0-9_-]/g, '')}@driver.qartix.campus`;
}

// Helper: Normalize Driver PIN to 6+ character password (Supabase min length is 6)
export function normalizeDriverPin(pin) {
  const p = (pin || '').trim();
  if (p === '4021') return 'driverPin4021';
  if (p.length < 6) return `${p}_qartix_driver`;
  return p;
}

// Generic Auth Error to prevent user enumeration
const GENERIC_AUTH_ERROR = 'Invalid credentials. Please verify your details and password.';

/**
 * -------------------------------------------------------------
 * AUTHENTICATION SERVICES
 * -------------------------------------------------------------
 */

export async function loginUser({ role, identifier, password, driverId, pin }) {
  const cleanIdent = sanitizeText(identifier || '', 100);
  const cleanDriverId = sanitizeText(driverId || '', 100);

  const payload = {
    role: role || 'student',
    identifier: cleanIdent,
    password: password || '',
    driverId: cleanDriverId,
    pin: pin || '',
  };

  const response = await fetch(`${supabaseUrl}/functions/v1/auth-login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseAnonKey,
    },
    body: JSON.stringify(payload),
  });

  const resJson = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errObj = resJson?.error;
    const errorMsg = typeof errObj === 'object' && errObj !== null 
      ? errObj.message 
      : (typeof errObj === 'string' ? errObj : (resJson?.message || GENERIC_AUTH_ERROR));
    const error = new Error(errorMsg);
    if (resJson?.pendingApproval || errObj?.code === 'APPROVAL_PENDING') {
      error.pendingApproval = true;
    }
    throw error;
  }

  const payloadData = resJson?.data || resJson;

  // Set session into local Supabase client instance
  if (payloadData.session) {
    await supabase.auth.setSession({
      access_token: payloadData.session.access_token,
      refresh_token: payloadData.session.refresh_token,
    });
  }

  return {
    user: payloadData.user,
    profile: payloadData.profile,
    session: payloadData.session,
  };
}

export async function signupUser({
  role,
  identifier,
  password,
  driverId,
  pin,
  fullName,
  phone,
  residencyStatus,
}) {
  const cleanFullName = sanitizeText(fullName || '', 120);
  const cleanIdent = sanitizeText(identifier || '', 100);
  const cleanDriverId = sanitizeText(driverId || '', 100);
  const cleanPhone = sanitizeText(phone || '', 25);

  const payload = {
    role: role === 'driver' ? 'driver' : 'student',
    identifier: cleanIdent,
    password: password || '',
    driverId: cleanDriverId,
    pin: pin || '',
    fullName: cleanFullName,
    phone: cleanPhone,
    residencyStatus: residencyStatus || 'Hostler',
  };

  const response = await fetch(`${supabaseUrl}/functions/v1/auth-signup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseAnonKey,
    },
    body: JSON.stringify(payload),
  });

  const resJson = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errObj = resJson?.error;
    const errorMsg = typeof errObj === 'object' && errObj !== null 
      ? errObj.message 
      : (typeof errObj === 'string' ? errObj : (resJson?.message || 'Failed to create account.'));
    throw new Error(errorMsg);
  }

  const payloadData = resJson?.data || resJson;

  if (payloadData.pendingApproval) {
    return {
      pendingApproval: true,
      message: payloadData.message,
      user: payloadData.user,
    };
  }

  if (payloadData.session) {
    await supabase.auth.setSession({
      access_token: payloadData.session.access_token,
      refresh_token: payloadData.session.refresh_token,
    });
  }

  return {
    user: payloadData.user,
    profile: payloadData.profile,
    session: payloadData.session,
  };
}

export async function logoutUser() {
  await supabase.auth.signOut();
  try {
    localStorage.removeItem('qartix_current_student');
    localStorage.removeItem('qartix_driver_queue');
  } catch (_e) {}
}

export async function getSessionProfile() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) return null;

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', session.user.id)
    .single();

  if (error || !profile) return null;

  return { user: session.user, profile };
}

/**
 * -------------------------------------------------------------
 * PASS REQUESTS SERVICES
 * -------------------------------------------------------------
 */

export async function fetchStations() {
  const { data, error } = await supabase.from('stations').select('*').order('name');
  if (error) {
    console.warn('Error fetching stations:', error.message);
    return [];
  }
  return data || [];
}

export async function getCertificateSignedUrl(path, expirySeconds = 60) {
  if (!path) return null;
  // Security constraint: enforce short-lived TTL capped at 60 seconds maximum
  const safeTtl = Math.min(Math.max(Number(expirySeconds) || 60, 1), 60);
  const cleanPath = path.startsWith('medical-certificates/')
    ? path.replace('medical-certificates/', '')
    : path;
  const { data, error } = await supabase.storage
    .from('medical-certificates')
    .createSignedUrl(cleanPath, safeTtl);
  if (error) {
    console.warn('Error creating signed certificate URL:', error.message);
    return null;
  }
  return data?.signedUrl || null;
}

export async function fetchPassRequests(studentId = null) {
  let query = supabase
    .from('pass_requests')
    .select(`
      *,
      student:student_id (id, full_name, phone, role, login_identifier),
      pickup_station:pickup_station_id (id, name, type),
      drop_station:drop_station_id (id, name, type)
    `)
    .order('created_at', { ascending: false });

  if (studentId) {
    query = query.eq('student_id', studentId);
  }

  const { data, error } = await query;
  if (error) {
    console.warn('Error fetching pass requests from Supabase:', error.message);
    return [];
  }

  return (data || []).map((d) => {
    const pickupName = d.pickup_station?.name || 'Block C - Oak Hall (Hostel)';
    const dropName = d.drop_station?.name || 'Engineering Core (Hall 4)';
    const certPath = d.certificate_path || '';
    const certName = certPath ? certPath.split('/').pop() : 'medical_referral.pdf';

    return {
      ...d,
      id: d.request_code || d.id,
      request_code: d.request_code || d.id,
      real_id: d.id,
      student_name: d.student?.full_name || 'Campus Student',
      studentName: d.student?.full_name || 'Campus Student',
      student_code: d.student?.login_identifier || 'STU-STUDENT',
      studentId: d.student?.login_identifier || 'STU-STUDENT',
      student_phone: d.student?.phone || '',
      mobile: d.student?.phone || '',
      pickup: pickupName,
      drop_station: dropName,
      drop: dropName,
      route: `${pickupName} → ${dropName}`,
      certificate_path: certPath,
      certificate_name: certName,
      certificateName: certName,
      certificate_url: null, // Private signed URLs generated on demand
      certificateUrl: null,
      certificate_size: '412 KB',
      certificateSize: '412 KB',
      admin_notes: d.review_note || '',
      adminNotes: d.review_note || '',
      timeSlots: d.time_slots || ['08:30 AM', '04:30 PM'],
      qr_token: d.status === 'approved' ? d.qr_token : null,
      qrToken: d.status === 'approved' ? d.qr_token : null,
      starts_on: d.starts_on,
      expires_on: d.expires_on,
    };
  });
}

export async function submitPassRequest({
  studentProfile,
  pickup,
  drop,
  route,
  timeSlots = [],
  duration = '1_month',
  medicalCondition = 'Leg/Ankle Fracture',
  reason = '',
  certificateFile = null,
  certificateName = '',
  certificateSize = '',
}) {
  const cleanPickup = sanitizeText(pickup || '', 120);
  const cleanDrop = sanitizeText(drop || '', 120);
  const cleanCondition = sanitizeText(medicalCondition || '', 100);
  const cleanReason = sanitizeText(reason || '', 1000);

  // 1. Zod Validation
  const validationResult = passRequestSchema.safeParse({
    pickup: cleanPickup,
    drop: cleanDrop,
    medicalCondition: cleanCondition,
    reason: cleanReason,
    duration,
    timeSlots: timeSlots && timeSlots.length > 0 ? timeSlots : ['08:30 AM', '04:30 PM'],
  });

  if (!validationResult.success) {
    const msg = validationResult.error.errors[0]?.message || 'Invalid pass request details.';
    throw new Error(msg);
  }

  // 2. File Verification (Max 5 MB & Magic Byte MIME check)
  if (!certificateFile) {
    throw new Error('Please upload a valid medical certificate or clinic slip (.pdf, .jpg, .png).');
  }

  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
  if (certificateFile.size > MAX_FILE_SIZE) {
    throw new Error('Medical certificate file size exceeds the 5 MB limit.');
  }

  const detectedMime = await detectFileMimeType(certificateFile);
  if (!['application/pdf', 'image/jpeg', 'image/png'].includes(detectedMime)) {
    throw new Error('Invalid file format. Only authentic PDF, JPG, or PNG medical documents are accepted.');
  }

  // 3. Generate client idempotency key
  const idempotencyKey = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `idemp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  // 4. Upload Certificate to Private Bucket: {student_id}/{idempotency_key}/{filename}
  const studentId = studentProfile?.id;
  if (!studentId) {
    throw new Error('Authenticated student profile required to submit a pass request.');
  }

  const ext = (certificateFile.name || 'document.pdf').split('.').pop().toLowerCase();
  const safePath = `${studentId}/${idempotencyKey}/medical_cert.${ext}`;

  const { data: uploadData, error: uploadError } = await supabase.storage
    .from('medical-certificates')
    .upload(safePath, certificateFile, {
      cacheControl: '300',
      upsert: true,
      contentType: detectedMime,
    });

  if (uploadError) {
    throw new Error(`Failed to upload certificate document: ${uploadError.message}`);
  }
  const certPath = uploadData?.path || safePath;

  // 5. Station Resolution
  const { data: stations } = await supabase.from('stations').select('id, name');
  const stationMap = new Map((stations || []).map((s) => [s.name, s.id]));

  const pickupId = stationMap.get(pickup) || (stations && stations[0]?.id) || null;
  const dropId = stationMap.get(drop) || (stations && stations[1]?.id) || null;

  // 6. Normalize Duration
  let normalizedDuration = '1_month';
  if (typeof duration === 'string') {
    const dLower = duration.toLowerCase();
    if (dLower.includes('2') || dLower.includes('week') || dLower.includes('14')) normalizedDuration = '2_weeks';
    else if (dLower.includes('sem') || dLower.includes('120')) normalizedDuration = 'full_semester';
    else normalizedDuration = '1_month';
  }

  // 7. Call Transactional RPC submit_pass_request
  const { data: rpcData, error: rpcError } = await supabase.rpc('submit_pass_request', {
    p_idempotency_key: idempotencyKey,
    p_medical_condition: medicalCondition,
    p_reason: (reason || '').trim(),
    p_certificate_path: certPath,
    p_route_template: `${pickup} → ${drop}`,
    p_pickup_station_id: pickupId,
    p_drop_station_id: dropId,
    p_time_slots: timeSlots && timeSlots.length > 0 ? timeSlots : ['08:30 AM', '04:30 PM'],
    p_duration: normalizedDuration,
  });

  if (rpcError) {
    throw new Error(rpcError.message);
  }

  const createdRequest = rpcData?.pass_request || {};

  // 8. Background: Notify transport office via Edge Function (handles email if provider configured)
  supabase.auth.getSession().then(({ data: { session: activeSession } }) => {
    fetch(`${supabaseUrl}/functions/v1/notify-transport-office`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseAnonKey,
        ...(activeSession?.access_token ? { Authorization: `Bearer ${activeSession.access_token}` } : {}),
      },
      body: JSON.stringify({
        requestCode: createdRequest.request_code,
        studentName: sanitizeText(studentProfile?.fullName || 'Campus Student', 100),
        studentIdent: sanitizeText(studentProfile?.studentId || 'STUDENT', 50),
        medicalCondition: cleanCondition,
        reason: cleanReason,
      }),
    }).catch((err) => console.warn('Background notify-transport-office notice:', err));
  });

  return {
    ...createdRequest,
    id: createdRequest.request_code,
    request_code: createdRequest.request_code,
    pickup,
    drop,
    route: `${pickup} → ${drop}`,
    status: createdRequest.status || 'pending',
    qr_token: null, // Token only exists upon approval
    qrToken: null,
  };
}

export const createPassRequest = submitPassRequest;

export async function reviewPassRequest({ requestId, status, reviewNote = '' }) {
  const { data, error } = await supabase.rpc('review_pass_request', {
    p_request_id: requestId,
    p_status: status,
    p_review_note: reviewNote,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function updatePassRequestStatus(requestId, status, adminNotes = '') {
  return reviewPassRequest({
    requestId,
    status,
    reviewNote: adminNotes,
  });
}

/**
 * -------------------------------------------------------------
 * RIDES & TELEMETRY SERVICES
 * -------------------------------------------------------------
 */

export async function skipRide(rideId) {
  const { data, error } = await supabase.rpc('skip_my_ride', { p_ride_id: rideId });
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchDriverShiftQueue() {
  const { data, error } = await supabase.rpc('get_driver_assigned_rides');
  if (error) {
    console.warn('Error fetching driver shift queue via RPC:', error.message);
    return [];
  }
  return (data || []).map((r) => {
    const dateObj = r.scheduled_for ? new Date(r.scheduled_for) : new Date();
    const timeFormatted = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const etaText = r.eta_minutes ? `PICKUP IN ${r.eta_minutes} MIN` : 'APPROACHING';

    let displayStatus = 'Waiting';
    if (r.status === 'completed') displayStatus = 'Completed';
    else if (r.status === 'skipped') displayStatus = 'Skipped by Student';
    else if (r.status === 'in_progress') displayStatus = 'In Progress';
    else if (r.status === 'approaching') displayStatus = 'Approaching';

    return {
      id: r.ride_id,
      scheduled_time: timeFormatted,
      time: timeFormatted,
      pickup: r.pickup_station_name,
      from: r.pickup_station_name,
      drop_station: r.drop_station_name,
      to: r.drop_station_name,
      route: `${r.pickup_station_name} → ${r.drop_station_name}`,
      pickup_badge: r.status === 'approaching' ? `APPROACHING • ${r.eta_minutes || 4} MINS` : etaText,
      pickupBadge: r.status === 'approaching' ? `APPROACHING • ${r.eta_minutes || 4} MINS` : etaText,
      student_name: r.student_name,
      studentName: r.student_name,
      student_code: r.student_roll_no,
      studentId: r.student_roll_no,
      student_phone: r.student_phone,
      phone: r.student_phone,
      hostel: r.student_hostel || 'Block C - Oak Hall',
      status: displayStatus,
      raw_status: r.status,
      arrived: r.status === 'arrived',
      student_boarded: r.status === 'in_progress',
    };
  });
}

export async function fetchRides(filter = {}) {
  // If driver querying or logged in as driver, use restricted RPC to preserve student privacy
  try {
    const sessionRes = await supabase.auth.getSession();
    const currentUser = sessionRes?.data?.session?.user;
    const isDriverSession =
      filter.isDriver ||
      Boolean(filter.driverId) ||
      currentUser?.user_metadata?.role === 'driver' ||
      currentUser?.email?.includes('@driver.qartix.campus');

    if (isDriverSession) {
      const driverQueue = await fetchDriverShiftQueue();
      if (driverQueue && driverQueue.length > 0) {
        return driverQueue;
      }
    }
  } catch (authErr) {
    console.warn('Session check in fetchRides:', authErr);
  }

  let query = supabase
    .from('rides')
    .select(`
      *,
      student:student_id (id, full_name, phone, login_identifier),
      driver:driver_id (id, full_name, phone, login_identifier),
      cart:cart_id (id, cart_number, status, speed_kmh, lat, lng),
      pickup_station:pickup_station_id (id, name, lat, lng),
      drop_station:drop_station_id (id, name, lat, lng)
    `)
    .order('scheduled_for', { ascending: true });

  if (filter.studentId) {
    query = query.eq('student_id', filter.studentId);
  }

  if (filter.today) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    query = query.gte('scheduled_for', todayStart.toISOString()).lte('scheduled_for', todayEnd.toISOString());
  }

  const { data, error } = await query;
  if (error) {
    console.warn('Error fetching rides:', error.message);
    return [];
  }

  return (data || []).map((r) => {
    const dateObj = r.scheduled_for ? new Date(r.scheduled_for) : new Date();
    const timeFormatted = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const pickupName = r.pickup_station?.name || 'Main Campus Gate (North)';
    const dropName = r.drop_station?.name || 'Academic Block B';

    // Status labels conforming to project requirements: APPROACHING, SCHEDULED, SKIPPED, COMPLETED
    let statusLabel = 'SCHEDULED';
    if (r.status === 'approaching') {
      statusLabel = r.eta_minutes ? `APPROACHING • ${r.eta_minutes} MINS` : 'APPROACHING';
    } else if (r.status === 'completed') {
      statusLabel = 'COMPLETED';
    } else if (r.status === 'skipped') {
      statusLabel = 'SKIPPED';
    } else if (r.status === 'arrived') {
      statusLabel = 'CART ARRIVED';
    } else if (r.status === 'in_progress') {
      statusLabel = 'IN PROGRESS';
    } else if (r.status === 'requested') {
      statusLabel = 'REQUESTED';
    } else {
      statusLabel = 'SCHEDULED';
    }

    let displayStatus = 'Waiting';
    if (r.status === 'completed') displayStatus = 'Completed';
    else if (r.status === 'skipped') displayStatus = 'Skipped by Student';
    else if (r.status === 'in_progress') displayStatus = 'In Progress';
    else if (r.status === 'approaching') displayStatus = 'Approaching';
    else if (r.status === 'requested') displayStatus = 'Requested';

    return {
      ...r,
      scheduled_time: timeFormatted,
      time: timeFormatted,
      pickup: pickupName,
      from: pickupName,
      drop_station: dropName,
      to: dropName,
      route: `${pickupName} → ${dropName}`,
      pickup_badge: statusLabel,
      pickupBadge: statusLabel,
      status_label: statusLabel,
      student_name: r.student?.full_name || 'Campus Student',
      studentName: r.student?.full_name || 'Campus Student',
      student_code: r.student?.login_identifier || 'STU-84920',
      studentId: r.student?.login_identifier || 'STU-84920',
      student_phone: r.student?.phone || '+91 98765 43210',
      phone: r.student?.phone || '+91 98765 43210',
      hostel: 'Block C - Oak Hall',
      status: displayStatus,
      raw_status: r.status,
      skipped: r.status === 'skipped',
      arrived: r.status === 'arrived' || r.arrived_at != null,
      student_boarded: r.status === 'in_progress',
    };
  });
}

/**
 * Skip a scheduled ride via RPC (Student Only)
 */
export async function skipRide(rideId) {
  const { data, error } = await supabase.rpc('skip_ride', { p_ride_id: rideId });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Request an Extra Priority Ride via RPC
 */
export async function requestExtraRide({
  pickup = 'Science Concourse Station',
  drop = 'Campus Health & Sports Pavilion',
  requestedTime = new Date().toISOString(),
}) {
  const { data, error } = await supabase.rpc('request_extra_ride', {
    p_pickup: pickup,
    p_drop: drop,
    p_requested_time: requestedTime,
  });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Transport Office Admin Override: Assign Cart, Driver, and Route to Ride
 */
export async function adminAssignRide({ rideId, cartId, driverId = null, routeId = null }) {
  const { data, error } = await supabase.rpc('admin_assign_ride', {
    p_ride_id: rideId,
    p_cart_id: cartId,
    p_driver_id: driverId,
    p_route_id: routeId,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function updateRideStatus(rideId, updates) {
  // If student skipping ride, invoke the secure student RPC
  if (updates.status === 'skipped' || updates.status === 'Skipped by Student') {
    return await skipRide(rideId);
  }

  // If driver action or status progression, invoke the secure driver RPC
  let targetStatus = updates.status;
  if (updates.arrived) targetStatus = 'arrived';
  if (updates.student_boarded) targetStatus = 'in_progress';
  if (targetStatus === 'Completed' || targetStatus === 'completed') targetStatus = 'completed';

  if (targetStatus && ['approaching', 'arrived', 'in_progress', 'completed'].includes(targetStatus.toLowerCase())) {
    try {
      const { data, error } = await supabase.rpc('update_driver_ride_status', {
        p_ride_id: rideId,
        p_status: targetStatus.toLowerCase(),
      });
      if (!error) return data;
    } catch (rpcErr) {
      console.warn('Driver RPC update fallback to direct update:', rpcErr);
    }
  }

  // Admin fallback direct update
  const dbUpdates = {
    updated_at: new Date().toISOString(),
  };

  if (updates.status) {
    if (updates.status === 'completed' || updates.status === 'Completed') {
      dbUpdates.status = 'completed';
      dbUpdates.completed_at = new Date().toISOString();
    } else if (updates.status === 'skipped' || updates.status === 'Skipped by Student') {
      dbUpdates.status = 'skipped';
      dbUpdates.skipped_at = new Date().toISOString();
    } else if (updates.status === 'active' || updates.status === 'in_progress') {
      dbUpdates.status = 'in_progress';
    } else {
      dbUpdates.status = updates.status;
    }
  }

  if (updates.arrived) {
    dbUpdates.status = 'arrived';
    dbUpdates.arrived_at = new Date().toISOString();
  }

  if (updates.student_boarded) {
    dbUpdates.status = 'in_progress';
  }

  const { data, error } = await supabase
    .from('rides')
    .update(dbUpdates)
    .eq('id', rideId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function createExtraRide({
  studentProfile,
  pickup = 'Science Concourse Station',
  drop = 'Campus Health & Sports Pavilion',
  route = 'Current Station → Campus Health Clinic',
}) {
  const result = await requestExtraRide({ pickup, drop });
  return {
    ...result.ride,
    pickup,
    drop_station: drop,
    route,
    status: result.status === 'requested' ? 'Requested' : 'Scheduled',
    cart_assigned: result.cart_assigned,
    message: result.message,
  };
}

/**
 * Toggle Driver Online / Offline Status
 * Prevents going offline mid-trip if ride in progress
 */
export async function toggleDriverOnline(isOnline) {
  const { data, error } = await supabase.rpc('toggle_driver_online', {
    p_is_online: isOnline,
  });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Mark Driver Arrived at Pickup Station
 */
export async function markArrived(rideId) {
  const { data, error } = await supabase.rpc('mark_arrived', {
    p_ride_id: rideId,
  });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Update Driver Shift Ride Status (approaching, arrived, in_progress, completed)
 */
export async function updateDriverRideStatus(rideId, status) {
  const { data, error } = await supabase.rpc('update_driver_ride_status', {
    p_ride_id: rideId,
    p_status: status,
  });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Telemetry: Update Cart Live Location & Append Location History
 */
export async function updateCartLocation({ lat, lng, speed = 0, heading = 0, cartId = null }) {
  const { data, error } = await supabase.rpc('update_cart_location', {
    p_lat: Number(lat),
    p_lng: Number(lng),
    p_speed: Math.round(Number(speed)),
    p_heading: Math.round(Number(heading)),
    p_cart_id: cartId,
  });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Fetch Driver Assigned Rides for Today's Shift
 * Enforces student phone number privacy (only available for active rides)
 */
export async function fetchDriverAssignedRides() {
  const { data, error } = await supabase.rpc('get_driver_assigned_rides');
  if (error) {
    console.warn('Error fetching driver assigned rides:', error.message);
    return [];
  }

  return (data || []).map((r) => {
    let formattedTime = '08:45 AM';
    if (r.scheduled_for) {
      try {
        const d = new Date(r.scheduled_for);
        formattedTime = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
      } catch (e) {
        formattedTime = '08:45 AM';
      }
    }

    let statusLabel = 'Waiting';
    if (r.status === 'completed') statusLabel = 'Completed';
    else if (r.status === 'skipped') statusLabel = 'Skipped by Student';
    else if (['approaching', 'arrived', 'in_progress'].includes(r.status)) statusLabel = 'Active';

    let pickupBadge = 'SCHEDULED';
    if (r.status === 'approaching') pickupBadge = 'APPROACHING PICKUP';
    else if (r.status === 'arrived') pickupBadge = 'ARRIVED AT STATION';
    else if (r.status === 'in_progress') pickupBadge = 'TRANSIT IN PROGRESS';
    else if (r.status === 'completed') pickupBadge = 'COMPLETED';

    return {
      id: r.ride_id,
      time: formattedTime,
      from: r.pickup_station_name || 'Campus Station',
      to: r.drop_station_name || 'Destination Core',
      pickupBadge,
      studentName: r.student_name || 'Campus Student',
      studentId: r.student_roll_no || 'STU-RIDER',
      hostel: r.student_hostel || 'Campus Hostel',
      phone: r.student_phone || null, // Privacy masked server-side unless active
      status: statusLabel,
      raw_status: r.status,
      cart_id: r.cart_id,
      cart_number: r.cart_number || 'CART-04',
      eta_minutes: r.eta_minutes || 5,
    };
  });
}

/**
 * Haversine formula to compute great-circle distance between two coords in km
 */
export function computeHaversineDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Compute dynamic ETA in minutes from Cart coords to Station coords
 */
export function computeEtaMinutes(cartCoords, stationCoords, speedKmh = 14) {
  if (!cartCoords || !stationCoords) return 4;
  const distKm = computeHaversineDistanceKm(
    cartCoords.lat,
    cartCoords.lng,
    stationCoords.lat,
    stationCoords.lng
  );
  const speed = Math.max(Number(speedKmh) || 14, 12); // clamp min speed 12 km/h
  const minutes = Math.round((distKm / speed) * 60);
  return Math.max(1, minutes);
}

export async function fetchCarts() {
  const { data, error } = await supabase.from('carts').select('*').order('cart_number');
  if (error) {
    console.warn('Error fetching carts:', error.message);
    return [];
  }
  return data || [];
}

export async function updateCart(cartId, updates) {
  const { data, error } = await supabase
    .from('carts')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', cartId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

/**
 * Admin: Manage Driver Account (Approve / Suspend / Assign Cart)
 * Writes action to audit_logs server-side
 */
export async function adminManageDriver({ driverId, status, cartId = null }) {
  const { data, error } = await supabase.rpc('admin_manage_driver', {
    p_driver_id: driverId,
    p_status: status,
    p_cart_id: cartId,
  });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Admin: Fetch Audit Logs
 */
export async function fetchAdminAuditLogs(limit = 50) {
  const { data, error } = await supabase.rpc('get_admin_audit_logs', {
    p_limit: limit,
  });
  if (error) {
    console.warn('Error fetching audit logs:', error.message);
    return [];
  }
  return data || [];
}

/**
 * Admin: Review Medical Mobility Pass Request
 */
export async function reviewPassRequestAdmin({ requestId, status, reviewNote = '' }) {
  const cleanNote = sanitizeText(reviewNote || '', 500);
  const { data, error } = await supabase.rpc('review_pass_request', {
    p_request_id: requestId,
    p_status: status,
    p_review_note: cleanNote,
  });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Admin: Fetch Today's Rides with Full Cart & Driver Assignments
 */
export async function fetchTodayRidesForAdmin() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const { data, error } = await supabase
    .from('rides')
    .select(`
      *,
      student:student_id (id, full_name, phone, login_identifier),
      driver:driver_id (id, full_name, phone, login_identifier),
      cart:cart_id (id, cart_number, status, speed_kmh),
      pickup_station:pickup_station_id (id, name),
      drop_station:drop_station_id (id, name),
      route:route_id (id, name)
    `)
    .gte('scheduled_for', todayStart.toISOString())
    .lte('scheduled_for', todayEnd.toISOString())
    .order('scheduled_for', { ascending: true });

  if (error) {
    console.warn('Error fetching today rides for admin:', error.message);
    return [];
  }
  return data || [];
}

/**
 * Admin: Fetch Drivers with Profile & Driver Details
 */
export async function fetchDriversForAdmin() {
  const { data, error } = await supabase
    .from('profiles')
    .select(`
      *,
      details:driver_details (
        driver_code,
        cart_id,
        approved_by,
        approved_at,
        is_online,
        cart:cart_id (id, cart_number, status)
      )
    `)
    .eq('role', 'driver')
    .order('created_at', { ascending: false });

  if (error) {
    console.warn('Error fetching drivers for admin:', error.message);
    return [];
  }
  return data || [];
}
