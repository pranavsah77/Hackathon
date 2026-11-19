import React, { useState, useRef, useEffect } from 'react';
import {
  fetchPassRequests,
  createPassRequest,
  submitPassRequest,
  getCertificateSignedUrl,
  fetchRides,
  updateRideStatus,
  createExtraRide,
  skipRide,
  requestExtraRide,
  fetchCarts,
  computeEtaMinutes,
  supabase,
} from '../lib/supabase.js';

/**
 * Available Locations for Route Dropdowns
 */
const PICKUP_LOCATIONS = [
  'Block C - Oak Hall (Hostel)',
  'Block A - Pine Hall (Hostel)',
  'Block B - Maple Hall (Hostel)',
  'Main Campus Gate (North)',
  'South Residence Plaza',
];

const DROP_LOCATIONS = [
  'Engineering Core (Hall 4)',
  'Science Concourse (Lab 2)',
  'Central Academic Quad',
  'Main Library & Computing Deck',
  'Campus Health & Sports Pavilion',
];

const TIME_SLOTS = ['08:30 AM', '10:30 AM', '01:30 PM', '04:30 PM'];

const DURATIONS = [
  { id: '2w', label: '2 Weeks', days: 14 },
  { id: '1m', label: '1 Month', days: 30 },
  { id: 'sem', label: 'Full Semester', days: 120 },
];

/**
 * Medical Conditions / Injury Types for Verification
 */
const MEDICAL_CONDITIONS = [
  'Leg/Ankle Fracture',
  'Ligament Tear / Sprain',
  'Post-Surgery Recovery',
  'Chronic Mobility Condition',
  'Other',
];

/**
 * Realistic Initial Seed Requests for localStorage
 */
const SEED_REQUESTS = [
  {
    id: 'REQ-8492',
    studentName: 'Pranav Kumar',
    studentId: 'STU-84920',
    residencyType: 'Hostler (Block C)',
    mobile: '+91 98765 43210',
    route: 'Block C - Oak Hall (Hostel) → Engineering Core (Hall 4)',
    pickup: 'Block C - Oak Hall (Hostel)',
    drop: 'Engineering Core (Hall 4)',
    timeSlots: ['08:30 AM', '04:30 PM'],
    duration: '1 Month',
    medicalCondition: 'Leg/Ankle Fracture',
    reason: 'Fractured right fibula with plaster cast; unable to walk long distances between hostel and campus lecture halls.',
    certificateName: 'orthopedic_clinic_referral.pdf',
    certificatePreview: null,
    certificateSize: '412 KB',
    status: 'active', // 'active'
    submittedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
    submittedTime: 'Today 09:30 AM',
  },
  {
    id: 'REQ-9102',
    studentName: 'Aarav Sharma',
    studentId: 'STU-77210',
    residencyType: 'Hostler (Block B)',
    mobile: '+91 98450 11223',
    route: 'Block B - Maple Hall (Hostel) → Engineering Core (Hall 4)',
    pickup: 'Block B - Maple Hall (Hostel)',
    drop: 'Engineering Core (Hall 4)',
    timeSlots: ['08:30 AM', '04:30 PM'],
    duration: '1 Month',
    medicalCondition: 'Leg/Ankle Fracture',
    reason: 'Left tibia hairline fracture in cast, doctor advised complete non-weight bearing for 4 weeks.',
    certificateName: 'clinic_discharge_aarav.pdf',
    certificatePreview: null,
    certificateSize: '340 KB',
    status: 'active',
    submittedAt: new Date(Date.now() - 3600000 * 4).toISOString(),
    submittedTime: 'Today 07:15 AM',
  },
  {
    id: 'REQ-9088',
    studentName: 'Neha Patel',
    studentId: 'STU-82194',
    residencyType: 'Day Scholar',
    mobile: '+91 97110 55667',
    route: 'Main Campus Gate (North) → Science Concourse (Lab 2)',
    pickup: 'Main Campus Gate (North)',
    drop: 'Science Concourse (Lab 2)',
    timeSlots: ['10:30 AM', '01:30 PM'],
    duration: '2 Weeks',
    medicalCondition: 'Ligament Tear / Sprain',
    reason: 'Grade 2 ACL sprain from campus athletics, using walking crutches for class commute.',
    certificateName: 'orthopedic_prescription.jpg',
    certificatePreview: null,
    certificateSize: '1.2 MB',
    status: 'active',
    submittedAt: new Date(Date.now() - 3600000 * 6).toISOString(),
    submittedTime: 'Today 05:40 AM',
  },
];

/**
 * Retrieve shared pass requests from localStorage, seeding if empty
 */
function getStoredRequests() {
  if (typeof window === 'undefined') return SEED_REQUESTS;
  try {
    const raw = localStorage.getItem('qartix_pass_requests');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
    localStorage.setItem('qartix_pass_requests', JSON.stringify(SEED_REQUESTS));
    return SEED_REQUESTS;
  } catch (e) {
    return SEED_REQUESTS;
  }
}

/**
 * StudentDashboard Component
 * Features an Interactive Monthly Pass Builder with Medical Verification requirement,
 * live ticket preview, and Today's Live Ride schedule.
 */
export default function StudentDashboard({
  student = { id: 'STU-84920', fullName: 'Pranav Kumar', hostelBlock: 'Block-C Oak Hall' },
  onReturnTo3D = () => {},
  onLogout = () => {},
}) {
  const currentStudentId = student?.studentId || student?.loginIdentifier || student?.id || 'STU-84920';

  // -----------------------------------------------------------
  // 1. SHARED PASS REQUESTS & SYNC STATE
  // -----------------------------------------------------------
  const [requestsList, setRequestsList] = useState([]);

  // Fetch real pass requests from Supabase
  useEffect(() => {
    let isMounted = true;
    fetchPassRequests(student?.id)
      .then((data) => {
        if (!isMounted) return;
        if (data && data.length > 0) {
          const mapped = data.map((d) => ({
            id: d.id,
            request_code: d.request_code || d.id,
            studentName: d.student_name,
            studentId: d.student_code || d.student_id,
            student_id: d.student?.id || d.student_id,
            residencyType: d.residency_type,
            mobile: d.mobile,
            route: d.route,
            pickup: d.pickup,
            drop_station: d.drop_station,
            drop: d.drop_station,
            timeSlots: d.time_slots || ['08:30 AM', '04:30 PM'],
            duration: d.duration,
            medicalCondition: d.medical_condition,
            reason: d.reason,
            certificateName: d.certificate_name,
            certificateUrl: d.certificate_url,
            certificateSize: d.certificate_size,
            certificate_path: d.certificate_path,
            status: d.status,
            qr_token: d.status === 'approved' ? d.qr_token : null,
            qrToken: d.status === 'approved' ? d.qr_token : null,
            starts_on: d.starts_on,
            expires_on: d.expires_on,
            adminNotes: d.review_note || '',
            submittedAt: d.created_at,
            submittedTime: d.created_at ? 'Today ' + new Date(d.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Today',
          }));
          setRequestsList(mapped);
        } else {
          const stored = getStoredRequests().filter(
            (r) => r.studentId && currentStudentId && r.studentId.toUpperCase() === currentStudentId.toUpperCase()
          );
          setRequestsList(stored);
        }
      })
      .catch((err) => console.warn('Supabase fetchPassRequests warning:', err));

    return () => {
      isMounted = false;
    };
  }, [student?.id, currentStudentId]);

  // Filter requests for active student
  const studentRequests = requestsList.filter((r) => {
    const ident = r.student_code || r.studentId || r.student_id;
    return (
      (ident && currentStudentId && ident.toString().toUpperCase() === currentStudentId.toString().toUpperCase()) ||
      (student?.id && (r.student_id === student.id || r.student?.id === student.id))
    );
  });

  // Find latest request for the active student
  const currentRequest = studentRequests.length > 0 ? studentRequests[0] : null;

  // Pass status driven strictly by real data:
  const passStatus = currentRequest ? currentRequest.status : null;
  const isApproved = passStatus === 'approved' || passStatus === 'active';
  const isPending = passStatus === 'pending';
  const isRejected = passStatus === 'rejected';
  const isExpired = passStatus === 'expired';

  // -----------------------------------------------------------
  // 2. PASS BUILDER & MEDICAL FORM STATE
  // -----------------------------------------------------------
  const [routeType, setRouteType] = useState('hostel_class'); // 'hostel_class' | 'gate_class'
  const [pickup, setPickup] = useState(currentRequest?.pickup || PICKUP_LOCATIONS[0]);
  const [drop, setDrop] = useState(currentRequest?.drop || DROP_LOCATIONS[0]);
  const [selectedSlots, setSelectedSlots] = useState(currentRequest?.timeSlots || ['08:30 AM', '04:30 PM']);
  const [duration, setDuration] = useState('1m');

  // Medical Verification Form Fields
  const [medicalCondition, setMedicalCondition] = useState(
    currentRequest?.medicalCondition || MEDICAL_CONDITIONS[0]
  );
  const [customCondition, setCustomCondition] = useState('');
  const [reason, setReason] = useState(
    currentRequest?.reason || 'Unable to walk from hostel to academic block due to cast on right leg.'
  );
  const [medicalSlip, setMedicalSlip] = useState(
    currentRequest
      ? {
          name: currentRequest.certificateName || 'orthopedic_clinic_referral.pdf',
          size: currentRequest.certificateSize || '412 KB',
          timestamp: currentRequest.submittedTime || 'Today 09:30 AM',
        }
      : null
  );
  const [certificatePreview, setCertificatePreview] = useState(
    currentRequest?.certificatePreview || null
  );

  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [formError, setFormError] = useState('');
  const [submitSuccessMsg, setSubmitSuccessMsg] = useState('');
  const [isSubmittingPass, setIsSubmittingPass] = useState(false);
  const [rollKey, setRollKey] = useState(0); // Trigger vertical roll transition
  const fileInputRef = useRef(null);

  // Trigger vertical roll animation on input change
  const triggerRoll = () => {
    setRollKey((prev) => prev + 1);
  };

  const handleRouteTypeToggle = (type) => {
    setRouteType(type);
    if (type === 'hostel_class') {
      setPickup(PICKUP_LOCATIONS[0]);
      setDrop(DROP_LOCATIONS[0]);
    } else {
      setPickup('Main Campus Gate (North)');
      setDrop('Central Academic Quad');
    }
    triggerRoll();
  };

  const toggleSlot = (slot) => {
    setSelectedSlots((prev) => {
      const exists = prev.includes(slot);
      const next = exists ? prev.filter((s) => s !== slot) : [...prev, slot];
      return next.length > 0 ? next : [slot];
    });
    triggerRoll();
  };

  const handleDurationSelect = (durId) => {
    setDuration(durId);
    triggerRoll();
  };

  const [uploadedFileObject, setUploadedFileObject] = useState(null);



  const handleFileUpload = (file) => {
    if (!file) return;
    setUploadedFileObject(file);

    // Check if image for preview
    if (file.type && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setCertificatePreview(e.target.result);
      };
      reader.readAsDataURL(file);
    } else {
      setCertificatePreview(null);
    }

    setMedicalSlip({
      name: file.name,
      size: `${(file.size / 1024).toFixed(1)} KB`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });
    if (formError) setFormError('');
    triggerRoll();
  };

  const durationObj = DURATIONS.find((d) => d.id === duration) || DURATIONS[1];

  // Submit for Verification
  const handleSubmitVerification = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (isSubmittingPass) return;

    if (!medicalCondition) {
      setFormError('Please select your medical condition or injury type.');
      return;
    }
    if (!reason.trim()) {
      setFormError('Please specify the reason for your monthly mobility pass.');
      return;
    }
    if (!uploadedFileObject && !medicalSlip) {
      setFormError('Please upload a valid medical certificate or clinic slip (.pdf, .jpg, .png).');
      return;
    }

    const finalCondition =
      medicalCondition === 'Other' && customCondition.trim() ? customCondition.trim() : medicalCondition;

    setIsSubmittingPass(true);
    setFormError('');

    try {
      const result = await submitPassRequest({
        studentProfile: student,
        pickup,
        drop,
        route: `${pickup} → ${drop}`,
        timeSlots: selectedSlots,
        duration: durationObj.label,
        medicalCondition: finalCondition,
        reason: reason.trim(),
        certificateFile: uploadedFileObject,
        certificateName: medicalSlip ? medicalSlip.name : 'medical_doc.pdf',
        certificateSize: medicalSlip ? medicalSlip.size : '450 KB',
      });

      const newRecord = {
        id: result.request_code || result.id,
        request_code: result.request_code || result.id,
        studentName: student.fullName || 'Student User',
        studentId: currentStudentId,
        student_id: student.id,
        residencyType: student.residencyStatus || student.hostelBlock || 'Hostler',
        mobile: student.phone || '+91 98765 43210',
        route: `${pickup} → ${drop}`,
        pickup,
        drop,
        drop_station: drop,
        timeSlots: selectedSlots,
        duration: durationObj.label,
        medicalCondition: finalCondition,
        reason: reason.trim(),
        certificateName: medicalSlip ? medicalSlip.name : 'medical_doc.pdf',
        certificatePreview: certificatePreview || null,
        certificateSize: medicalSlip ? medicalSlip.size : '450 KB',
        certificate_path: result.certificate_path,
        status: 'pending',
        qr_token: null,
        qrToken: null,
        submittedAt: new Date().toISOString(),
        submittedTime: 'Today ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setRequestsList((prev) => [newRecord, ...prev.filter((r) => r.id !== newRecord.id)]);
      setSubmitSuccessMsg(`Pass application ${newRecord.request_code} filed! Status: PENDING Transport Office review.`);
      triggerRoll();
      setTimeout(() => setSubmitSuccessMsg(''), 8000);
    } catch (err) {
      setFormError(err.message || 'Failed to submit pass request. Please verify your details.');
    } finally {
      setIsSubmittingPass(false);
    }
  };

  // -----------------------------------------------------------
  // 3. TODAY'S SCHEDULE & RIDES STATE
  // -----------------------------------------------------------
  const [rides, setRides] = useState([
    {
      id: 'ride-1',
      time: '08:30 AM',
      route: 'Block C - Oak Hall → Engineering Core',
      status: 'APPROACHING • 4 MINS',
      skipped: false,
    },
    {
      id: 'ride-2',
      time: '01:30 PM',
      route: 'Engineering Core → Central Academic Quad',
      status: 'SCHEDULED',
      skipped: false,
    },
    {
      id: 'ride-3',
      time: '04:30 PM',
      route: 'Main Library Deck → Block C - Oak Hall',
      status: 'SCHEDULED',
      skipped: false,
    },
  ]);

  // Live Cart Telemetry State
  const [liveCart, setLiveCart] = useState({
    cartNumber: 'CART #04',
    etaMinutes: 4,
    speedKmh: 14,
    currentStation: 'Science Concourse Station',
    routeLabel: 'ROUTE 01 ACTIVE',
    progressPercent: 68,
    originStation: 'Departed Central Quad',
    pickupStation: 'Science Concourse Station',
    destinationStation: 'Destination Core',
  });
  const [activeCartId, setActiveCartId] = useState(null);
  const activeNextRideRef = useRef(null);

  // Sync Today's Scheduled Rides from Supabase with Realtime Subscription
  const loadTodayRides = () => {
    fetchRides({ today: true, studentId: student?.id })
      .then((ridesData) => {
        if (!ridesData || ridesData.length === 0) return;
        const mapped = ridesData.map((r) => ({
          id: r.id,
          time: r.scheduled_time || '08:30 AM',
          route: r.route || `${r.pickup} → ${r.drop_station}`,
          status: r.status_label || (r.skipped ? 'SKIPPED' : 'SCHEDULED'),
          raw_status: r.raw_status || r.status,
          skipped: r.skipped || r.raw_status === 'skipped',
          cart_id: r.cart_id,
          cart_number: r.cart?.cart_number || 'CART-04',
          pickup_station: r.pickup_station,
          drop_station: r.drop_station,
          pickup_name: r.pickup,
          drop_name: r.drop_station,
        }));
        setRides(mapped);

        // Find student's next upcoming ride
        const nextRide = mapped.find(
          (r) => ['approaching', 'arrived', 'in_progress', 'scheduled'].includes(r.raw_status) && !r.skipped
        );

        if (nextRide) {
          activeNextRideRef.current = nextRide;
          if (nextRide.cart_id && nextRide.cart_id !== activeCartId) {
            setActiveCartId(nextRide.cart_id);
          }
          const cartNumFormatted = nextRide.cart_number ? nextRide.cart_number.replace('-', ' #') : 'CART #04';
          setLiveCart((prev) => ({
            ...prev,
            cartNumber: cartNumFormatted,
            currentStation: nextRide.pickup_name || prev.currentStation,
            routeLabel: `${nextRide.route || 'ROUTE 01 ACTIVE'} • LIVE`,
            pickupStation: nextRide.pickup_name || 'Pickup Station',
            destinationStation: nextRide.drop_name || 'Destination Core',
          }));
        }
      })
      .catch((err) => console.warn('Supabase fetchRides warning:', err));
  };

  useEffect(() => {
    loadTodayRides();

    // Supabase Realtime Channel: Listen for Ride status updates & dispatches
    const channel = supabase
      .channel('student-rides-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rides' },
        () => {
          loadTodayRides();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [student?.id]);

  // Live Tracker: Subscribes via Supabase Realtime to the cart for student's next ride only
  // Computes dynamic ETA from cart distance to pickup station and cart speed
  useEffect(() => {
    if (!activeCartId) {
      // Fallback initial fleet cart fetch if student has no assigned active ride yet
      fetchCarts()
        .then((carts) => {
          if (!carts || carts.length === 0) return;
          const c = carts.find((x) => x.status === 'online') || carts[0];
          if (c) {
            setLiveCart((prev) => ({
              ...prev,
              cartNumber: c.cart_number ? c.cart_number.replace('-', ' #') : 'CART #04',
              etaMinutes: c.eta_minutes || 4,
              speedKmh: c.speed_kmh || 14,
            }));
          }
        })
        .catch(() => {});
      return;
    }

    // Fetch initial cart snapshot
    supabase
      .from('carts')
      .select('*')
      .eq('id', activeCartId)
      .single()
      .then(({ data: cartData }) => {
        if (!cartData) return;
        const nextRide = activeNextRideRef.current;
        const pickupCoords =
          nextRide?.pickup_station?.lat && nextRide?.pickup_station?.lng
            ? { lat: nextRide.pickup_station.lat, lng: nextRide.pickup_station.lng }
            : { lat: 12.9735, lng: 77.5960 };
        const cartCoords = { lat: cartData.lat, lng: cartData.lng };
        const speed = cartData.speed_kmh || 14;
        const eta = computeEtaMinutes(cartCoords, pickupCoords, speed);
        const progress = eta <= 1 ? 94 : eta <= 3 ? 75 : eta <= 5 ? 58 : 35;

        setLiveCart((prev) => ({
          ...prev,
          cartNumber: cartData.cart_number ? cartData.cart_number.replace('-', ' #') : prev.cartNumber,
          etaMinutes: eta,
          speedKmh: speed,
          progressPercent: progress,
        }));
      });

    // Realtime channel subscribed strictly to this student's next cart
    const cartChannel = supabase
      .channel(`cart-tracking-${activeCartId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'carts',
          filter: `id=eq.${activeCartId}`,
        },
        (payload) => {
          const updatedCart = payload.new;
          if (!updatedCart) return;

          const nextRide = activeNextRideRef.current;
          const pickupCoords =
            nextRide?.pickup_station?.lat && nextRide?.pickup_station?.lng
              ? { lat: nextRide.pickup_station.lat, lng: nextRide.pickup_station.lng }
              : { lat: 12.9735, lng: 77.5960 };
          const cartCoords = { lat: updatedCart.lat, lng: updatedCart.lng };
          const speed = updatedCart.speed_kmh || 14;
          const eta = computeEtaMinutes(cartCoords, pickupCoords, speed);
          const progress = eta <= 1 ? 95 : eta <= 3 ? 75 : eta <= 5 ? 58 : 35;

          setLiveCart((prev) => ({
            ...prev,
            cartNumber: updatedCart.cart_number ? updatedCart.cart_number.replace('-', ' #') : prev.cartNumber,
            etaMinutes: eta,
            speedKmh: speed,
            progressPercent: progress,
          }));
        }
      )
      .subscribe();

    // Clean up channel subscription on unmount
    return () => {
      supabase.removeChannel(cartChannel);
    };
  }, [activeCartId]);

  const [extraRideModalOpen, setExtraRideModalOpen] = useState(false);
  const [extraDestination, setExtraDestination] = useState('Campus Health & Sports Pavilion');
  const [extraConfirmed, setExtraConfirmed] = useState(false);

  // Optimistic Skip Today with Rollback
  const handleSkipRide = async (rideId) => {
    const target = rides.find((r) => r.id === rideId);
    if (!target || target.skipped || target.raw_status === 'completed') return;

    // Snapshot previous state for rollback
    const prevRides = [...rides];

    // Optimistic UI update
    setRides((prev) =>
      prev.map((r) =>
        r.id === rideId
          ? { ...r, skipped: true, status: 'SKIPPED', raw_status: 'skipped' }
          : r
      )
    );

    try {
      await skipRide(rideId);
    } catch (err) {
      // Rollback on failure
      setRides(prevRides);
      alert(err.message || 'Unable to skip ride. 15-minute notice requirement not met.');
    }
  };

  const handleRequestExtraRide = async () => {
    setExtraConfirmed(true);
    try {
      const res = await requestExtraRide({
        pickup: pickup || 'Science Concourse Station',
        drop: extraDestination || 'Campus Health & Sports Pavilion',
        requestedTime: new Date().toISOString(),
      });

      const newRide = res?.ride;
      const statusBadge = res?.cart_assigned ? 'PRIORITY DISPATCH • 5 MINS' : 'REQUESTED • QUEUED';

      setRides((prev) => [
        {
          id: newRide?.id || `ride-extra-${Date.now()}`,
          time: 'IMMEDIATE',
          route: `${pickup || 'Current Station'} → ${extraDestination}`,
          status: statusBadge,
          raw_status: 'requested',
          skipped: false,
        },
        ...prev,
      ]);

      setTimeout(() => {
        setExtraConfirmed(false);
        setExtraRideModalOpen(false);
      }, 700);
    } catch (err) {
      setExtraConfirmed(false);
      alert(err.message || 'Failed to request extra ride.');
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#13161B',
        backgroundImage: 'radial-gradient(circle at 60% 45%, #242A34 0%, #13161B 70%)',
        color: '#F4F5F7',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
        paddingBottom: '80px',
      }}
    >
      {/* Inline Keyframe Styles for Vertical Roll & Stamp Slam */}
      <style>{`
        @keyframes verticalRoll {
          0% {
            transform: translateY(-12px) scale(0.98);
            opacity: 0.35;
          }
          100% {
            transform: translateY(0px) scale(1);
            opacity: 1;
          }
        }
        @keyframes stampSlam {
          0% {
            transform: scale(2.4) rotate(-18deg);
            opacity: 0;
          }
          60% {
            transform: scale(0.92) rotate(-3deg);
            opacity: 1;
          }
          100% {
            transform: scale(1) rotate(-4deg);
            opacity: 1;
          }
        }
        @keyframes pulseTrack {
          0% { width: 62%; }
          50% { width: 75%; }
          100% { width: 62%; }
        }
      `}</style>

      {/* -------------------------------------------------------- */}
      {/* TOP NAVIGATION BAR IN DARK SLATE                         */}
      {/* -------------------------------------------------------- */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          height: '68px',
          padding: '0 32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'rgba(28, 33, 40, 0.88)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.12)',
        }}
      >
        {/* Brand & Student Badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }} onClick={onReturnTo3D}>
            <div
              style={{
                width: '34px',
                height: '34px',
                borderRadius: '8px',
                background: '#13161B',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '2px 2px 0px #0D1013',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F4F5F7" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="8" />
                <path d="m15.5 15.5 3.5 3.5" />
                <path d="M9 12h6" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: '15px', fontWeight: 900, letterSpacing: '0.1em', lineHeight: 1.1, color: '#F4F5F7' }}>QARTIX</div>
              <div style={{ fontSize: '9px', fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.14em' }}>STUDENT PORTAL</div>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 14px',
              background: '#13161B',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              boxShadow: '2px 2px 0px #0D1013',
              borderRadius: '8px',
              fontSize: '11px',
              fontWeight: 700,
            }}
          >
            <span
              style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                background: isApproved ? '#10B981' : isPending ? '#F59E0B' : '#EF4444',
                boxShadow: isApproved ? '0 0 6px #10B981' : isPending ? '0 0 6px #F59E0B' : '0 0 6px #EF4444',
              }}
            />
            <span style={{ color: '#9CA3AF' }}>ID:</span>
            <span style={{ fontFamily: 'monospace', fontWeight: 800, color: '#F4F5F7' }}>{currentStudentId}</span>
          </div>
        </div>

        {/* View Switchers & Log Out */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            type="button"
            onClick={onReturnTo3D}
            style={{
              padding: '8px 16px',
              background: '#1C2128',
              color: '#F4F5F7',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              boxShadow: '2px 2px 0px #0D1013',
              borderRadius: '8px',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.15s ease',
            }}
          >
            <span>← 3D Cart Experience</span>
          </button>

          <button
            type="button"
            style={{
              padding: '8px 16px',
              background: '#10B981',
              color: '#0B1116',
              border: '1px solid #10B981',
              boxShadow: '0 4px 14px rgba(16, 185, 129, 0.25), 2px 2px 0px #0D1013',
              borderRadius: '8px',
              fontSize: '11px',
              fontWeight: 900,
              cursor: 'default',
            }}
          >
            Pass & Rides
          </button>

          <button
            type="button"
            onClick={onLogout}
            style={{
              padding: '8px 14px',
              background: 'transparent',
              color: '#9CA3AF',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '8px',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            Log Out
          </button>
        </div>
      </header>

      {/* -------------------------------------------------------- */}
      {/* MAIN CONTAINER                                           */}
      {/* -------------------------------------------------------- */}
      <main style={{ maxWidth: '1200px', margin: '36px auto', padding: '0 24px', display: 'flex', flexDirection: 'column', gap: '36px' }}>
        
        {/* ======================================================= */}
        {/* SECTION 2: LIVE RIDE & TODAY'S SCHEDULE (TOP DECK)     */}
        {/* ======================================================= */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* STATUS NOTIFICATION BANNER */}
          <div
            style={{
              background: isApproved
                ? 'rgba(16, 185, 129, 0.08)'
                : isPending
                ? 'rgba(245, 158, 11, 0.08)'
                : isRejected
                ? 'rgba(239, 68, 68, 0.08)'
                : 'rgba(28, 33, 40, 0.5)',
              border: isApproved
                ? '1px solid rgba(16, 185, 129, 0.3)'
                : isPending
                ? '1px solid rgba(245, 158, 11, 0.3)'
                : isRejected
                ? '1px solid rgba(239, 68, 68, 0.3)'
                : '1px solid rgba(255, 255, 255, 0.1)',
              borderLeft: isApproved
                ? '5px solid #10B981'
                : isPending
                ? '5px solid #F59E0B'
                : isRejected
                ? '5px solid #EF4444'
                : '5px solid #6B7280',
              boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25)',
              borderRadius: '12px',
              padding: '18px 24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    background: isApproved
                      ? 'rgba(16, 185, 129, 0.15)'
                      : isPending
                      ? 'rgba(245, 158, 11, 0.15)'
                      : isRejected
                      ? 'rgba(239, 68, 68, 0.15)'
                      : 'rgba(255, 255, 255, 0.05)',
                    border: isApproved
                      ? '1px solid #10B981'
                      : isPending
                      ? '1px solid #F59E0B'
                      : isRejected
                      ? '1px solid #EF4444'
                      : '1px solid #6B7280',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: isApproved ? '#10B981' : isPending ? '#F59E0B' : isRejected ? '#EF4444' : '#9CA3AF',
                    flexShrink: 0,
                  }}
                >
                  {isApproved ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  ) : isPending ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                  ) : isRejected ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="15" y1="9" x2="9" y2="15" />
                      <line x1="9" y1="9" x2="15" y2="15" />
                    </svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                  )}
                </div>

                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h3 style={{ fontSize: '15px', fontWeight: 800, margin: 0, color: '#F4F5F7' }}>
                      {isApproved
                        ? `Monthly Pass Active • Medical Record Verified (${currentRequest?.request_code || currentRequest?.id})`
                        : isPending
                        ? `Pass Application Pending Review (${currentRequest?.request_code || currentRequest?.id})`
                        : isRejected
                        ? `Pass Application Rejected (${currentRequest?.request_code || currentRequest?.id})`
                        : 'No Active Mobility Pass'}
                    </h3>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '10px',
                        fontWeight: 900,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        background: isApproved
                          ? 'rgba(16, 185, 129, 0.2)'
                          : isPending
                          ? 'rgba(245, 158, 11, 0.2)'
                          : isRejected
                          ? 'rgba(239, 68, 68, 0.2)'
                          : 'rgba(255, 255, 255, 0.08)',
                        color: isApproved ? '#10B981' : isPending ? '#F59E0B' : isRejected ? '#EF4444' : '#9CA3AF',
                        border: isApproved
                          ? '1px solid rgba(16, 185, 129, 0.4)'
                          : isPending
                          ? '1px solid rgba(245, 158, 11, 0.4)'
                          : isRejected
                          ? '1px solid rgba(239, 68, 68, 0.4)'
                          : '1px solid rgba(255, 255, 255, 0.15)',
                      }}
                    >
                      {isApproved ? 'ACTIVE' : isPending ? 'PENDING' : isRejected ? 'REJECTED' : 'UNFILED'}
                    </span>
                  </div>

                  <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#9CA3AF', lineHeight: 1.4 }}>
                    {isApproved
                      ? 'Your campus medical mobility pass is active and authorized for priority boarding. Scheduled rides and live cart tracking are unlocked.'
                      : isPending
                      ? 'Your pass application and uploaded medical certificate have been filed with the campus transport office. Status: PENDING review by campus fleet administrators.'
                      : isRejected
                      ? (currentRequest?.adminNotes || 'Your pass request was rejected. Please review administrator notes or submit updated clinic documentation.')
                      : 'Submit your medical details and clinic document below to activate your electric cart pass.'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Top Status Card: Cart #04 • 4 Mins Away */}
          <div
            style={{
              position: 'relative',
              background: '#1C2128',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              boxShadow: '4px 4px 0px #0D1013',
              borderRadius: '12px',
              padding: '24px 28px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              overflow: 'hidden',
            }}
          >

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span
                  style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    background: '#10B981',
                    boxShadow: '0 0 10px #10B981',
                  }}
                />
                <h2 style={{ fontSize: '20px', fontWeight: 900, margin: 0, letterSpacing: '0.04em', color: '#F4F5F7' }}>
                  {liveCart.cartNumber} • {liveCart.etaMinutes} MINS AWAY
                </h2>
                <span
                  style={{
                    padding: '3px 8px',
                    background: '#13161B',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    borderRadius: '4px',
                    fontSize: '10px',
                    fontWeight: 800,
                    fontFamily: 'monospace',
                    color: '#F4F5F7',
                  }}
                >
                  {liveCart.routeLabel}
                </span>
              </div>

              <div style={{ fontSize: '12px', fontWeight: 600, color: '#9CA3AF' }}>
                Approaching: <strong style={{ color: '#F4F5F7' }}>{liveCart.currentStation}</strong> • Speed: <strong style={{ color: '#F4F5F7' }}>{liveCart.speedKmh} km/h</strong>
              </div>
            </div>

            {/* Horizontal Transit Progress Bar */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div
                style={{
                  width: '100%',
                  height: '14px',
                  background: '#13161B',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  borderRadius: '7px',
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    background: '#242A34',
                    borderRight: '2px solid #10B981',
                    borderRadius: '5px',
                    animation: isApproved ? 'pulseTrack 4s ease-in-out infinite' : 'none',
                    width: isApproved ? `${liveCart.progressPercent || 68}%` : '20%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    paddingRight: '4px',
                  }}
                >
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10B981' }} />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: 700, color: '#9CA3AF' }}>
                <span>{liveCart.originStation || 'Departed Central Quad'}</span>
                <span style={{ color: '#10B981' }}>● En Route to {liveCart.pickupStation || 'Pickup'}</span>
                <span>{liveCart.destinationStation || 'Destination Core'}</span>
              </div>
            </div>
          </div>

          {/* Today's Scheduled Rides List */}
          <div
            style={{
              position: 'relative',
              background: '#1C2128',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              boxShadow: '4px 4px 0px #0D1013',
              borderRadius: '12px',
              padding: '24px 28px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <h3 style={{ fontSize: '16px', fontWeight: 900, margin: 0, color: '#F4F5F7' }}>Today's Scheduled Rides</h3>
                </div>
                <div style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '2px' }}>
                  Automatic dispatch reservations linked to your active campus pass
                </div>
              </div>

              <button
                type="button"
                onClick={() => setExtraRideModalOpen(true)}
                style={{
                  padding: '9px 18px',
                  background: '#10B981',
                  color: '#0B1116',
                  border: '1px solid #10B981',
                  boxShadow: '0 4px 14px rgba(16, 185, 129, 0.25), 3px 3px 0px #0D1013',
                  borderRadius: '8px',
                  fontSize: '11px',
                  fontWeight: 900,
                  letterSpacing: '0.04em',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all 0.15s ease',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14" />
                  <path d="M5 12h14" />
                </svg>
                <span>Request Extra Ride</span>
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {rides.map((r) => (
                <div
                  key={r.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '14px 20px',
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    background: '#13161B',
                    opacity: r.skipped ? 0.45 : 1.0,
                    transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                    {/* Timestamp with strikethrough animation when skipped */}
                    <div
                      style={{
                        fontSize: '15px',
                        fontWeight: 800,
                        fontFamily: 'monospace',
                        color: '#F4F5F7',
                        minWidth: '90px',
                        textDecoration: r.skipped ? 'line-through' : 'none',
                        textDecorationColor: '#10B981',
                        textDecorationThickness: '2px',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      {r.time}
                    </div>

                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: '#F4F5F7' }}>
                        {r.route}
                      </div>
                      <div
                        style={{
                          fontSize: '11px',
                          fontWeight: 600,
                          color: r.skipped ? '#9CA3AF' : '#10B981',
                          marginTop: '2px',
                        }}
                      >
                        {r.skipped ? '● SKIPPED FOR TODAY' : r.status}
                      </div>
                    </div>
                  </div>

                  {/* Skip Today Button with Optimistic UI & Rollback */}
                  <button
                    type="button"
                    onClick={() => handleSkipRide(r.id)}
                    disabled={r.skipped || r.raw_status === 'completed'}
                    style={{
                      padding: '6px 14px',
                      borderRadius: '6px',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      background: r.skipped ? 'rgba(239, 68, 68, 0.12)' : '#1C2128',
                      color: r.skipped ? '#EF4444' : '#FFFFFF',
                      boxShadow: r.skipped ? 'none' : '2px 2px 0px #0D1013',
                      fontSize: '11px',
                      fontWeight: 800,
                      cursor: r.skipped || r.raw_status === 'completed' ? 'not-allowed' : 'pointer',
                      opacity: r.skipped || r.raw_status === 'completed' ? 0.7 : 1,
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {r.skipped ? '● Skipped for Today' : r.raw_status === 'completed' ? 'Completed' : 'Skip Today'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ======================================================= */}
        {/* SECTION 1: INTERACTIVE MONTHLY PASS BUILDER             */}
        {/* ======================================================= */}
        <section id="pass-builder-section">
          <div style={{ marginBottom: '16px' }}>
            <span style={{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.12em', color: '#10B981', textTransform: 'uppercase' }}>
              STEP 1 • MEDICAL MOBILITY VERIFICATION
            </span>
            <h2 style={{ fontSize: '24px', fontWeight: 900, margin: '4px 0 0 0', letterSpacing: '-0.01em', color: '#F4F5F7' }}>
              Interactive Monthly Pass Builder
            </h2>
            <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#9CA3AF' }}>
              Submit your medical details and certificate for campus mobility verification to activate your monthly electric cart pass.
            </p>
          </div>

          {/* Split Card: Left Medical Verification Form / Right Live Digital Boarding Pass */}
          <div
            style={{
              background: '#1C2128',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              boxShadow: '4px 4px 0px #0D1013',
              borderRadius: '12px',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
              overflow: 'hidden',
            }}
          >
            {/* ---------------------------------------------------- */}
            {/* LEFT: MEDICAL VERIFICATION FORM                      */}
            {/* ---------------------------------------------------- */}
            <form
              onSubmit={handleSubmitVerification}
              style={{
                padding: '32px',
                borderRight: '1px solid rgba(255, 255, 255, 0.12)',
                display: 'flex',
                flexDirection: 'column',
                gap: '22px',
                background: '#1C2128',
              }}
            >
              {/* Medical Notice Pill */}
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: '8px',
                  background: 'rgba(16, 185, 129, 0.08)',
                  border: '1px solid rgba(16, 185, 129, 0.25)',
                  fontSize: '11px',
                  color: '#A7F3D0',
                  lineHeight: 1.4,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <span style={{ fontSize: '14px' }}>📋</span>
                <span>
                  <strong>Campus Policy:</strong> Monthly passes are prioritized for students with medical injuries, post-surgery recovery, or chronic mobility needs.
                </span>
              </div>

              {/* 1. Medical Condition / Injury Type */}
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '6px', color: '#9CA3AF' }}>
                  Medical Condition / Injury Type <span style={{ color: '#10B981' }}>*</span>
                </label>
                <select
                  value={medicalCondition}
                  onChange={(e) => {
                    setMedicalCondition(e.target.value);
                    triggerRoll();
                  }}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    fontSize: '12px',
                    fontWeight: 600,
                    background: '#13161B',
                    color: '#F4F5F7',
                    outline: 'none',
                  }}
                >
                  {MEDICAL_CONDITIONS.map((cond) => (
                    <option key={cond} value={cond} style={{ background: '#13161B', color: '#F4F5F7' }}>
                      {cond}
                    </option>
                  ))}
                </select>

                {medicalCondition === 'Other' && (
                  <input
                    type="text"
                    placeholder="Specify condition / mobility injury..."
                    value={customCondition}
                    onChange={(e) => {
                      setCustomCondition(e.target.value);
                      triggerRoll();
                    }}
                    style={{
                      marginTop: '8px',
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      fontSize: '12px',
                      background: '#13161B',
                      color: '#F4F5F7',
                      outline: 'none',
                    }}
                  />
                )}
              </div>

              {/* 2. Reason for Monthly Pass Textarea */}
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '6px', color: '#9CA3AF' }}>
                  Reason for Monthly Pass Request <span style={{ color: '#10B981' }}>*</span>
                </label>
                <textarea
                  rows={3}
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                    triggerRoll();
                  }}
                  placeholder="Unable to walk from hostel to academic block due to cast on right leg..."
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    fontSize: '12px',
                    background: '#13161B',
                    color: '#F4F5F7',
                    resize: 'vertical',
                    outline: 'none',
                    lineHeight: 1.4,
                  }}
                />
                <span style={{ fontSize: '10px', color: '#9CA3AF', marginTop: '2px', display: 'block' }}>
                  Describe your mobility restrictions and commute challenges across campus.
                </span>
              </div>

              {/* 3. Medical Certificate Upload with Drag & Drop + Image Thumbnail */}
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '6px', color: '#9CA3AF' }}>
                  Upload Medical Certificate / Clinic Slip <span style={{ color: '#10B981' }}>*</span>
                </label>
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDraggingFile(true);
                  }}
                  onDragLeave={() => setIsDraggingFile(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDraggingFile(false);
                    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                      handleFileUpload(e.dataTransfer.files[0]);
                    }
                  }}
                  onClick={() => fileInputRef.current && fileInputRef.current.click()}
                  style={{
                    border: isDraggingFile ? '2px dashed #10B981' : '1.5px dashed rgba(255, 255, 255, 0.25)',
                    background: isDraggingFile ? 'rgba(16, 185, 129, 0.1)' : medicalSlip ? 'rgba(16, 185, 129, 0.06)' : '#13161B',
                    borderRadius: '8px',
                    padding: '14px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    style={{ display: 'none' }}
                    accept=".pdf,.jpg,.jpeg,.png,image/*"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        handleFileUpload(e.target.files[0]);
                      }
                    }}
                  />
                  {medicalSlip ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ color: '#10B981', fontWeight: 900, fontSize: '13px' }}>✓ Attached:</span>
                        <span style={{ fontSize: '12px', fontWeight: 700, fontFamily: 'monospace', color: '#F4F5F7' }}>{medicalSlip.name}</span>
                        <span style={{ fontSize: '10px', color: '#9CA3AF' }}>({medicalSlip.size})</span>
                      </div>
                      {certificatePreview && (
                        <div style={{ marginTop: '4px' }}>
                          <img
                            src={certificatePreview}
                            alt="Certificate Preview"
                            style={{
                              maxHeight: '60px',
                              borderRadius: '4px',
                              border: '1px solid rgba(255, 255, 255, 0.2)',
                              objectFit: 'contain',
                            }}
                          />
                        </div>
                      )}
                      <span style={{ fontSize: '10px', color: '#10B981', textDecoration: 'underline' }}>
                        Click to change or replace file
                      </span>
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: '#F4F5F7' }}>
                        Drop doctor slip / OPD prescription (.pdf, .jpg, .png), or <span style={{ color: '#10B981', textDecoration: 'underline' }}>browse</span>
                      </div>
                      <div style={{ fontSize: '10px', color: '#9CA3AF', marginTop: '4px' }}>
                        Required for campus mobility verification
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 4. Route Trajectory Template Toggle */}
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '8px', color: '#9CA3AF' }}>
                  Route Trajectory Template
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', padding: '4px', background: '#13161B', border: '1px solid rgba(255, 255, 255, 0.12)', borderRadius: '8px' }}>
                  <button
                    type="button"
                    onClick={() => handleRouteTypeToggle('hostel_class')}
                    style={{
                      padding: '8px 12px',
                      borderRadius: '6px',
                      border: 'none',
                      background: routeType === 'hostel_class' ? '#1C2128' : 'transparent',
                      color: routeType === 'hostel_class' ? '#F4F5F7' : '#9CA3AF',
                      boxShadow: routeType === 'hostel_class' ? '0 1px 4px rgba(0,0,0,0.3)' : 'none',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    Hostel → Class
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRouteTypeToggle('gate_class')}
                    style={{
                      padding: '8px 12px',
                      borderRadius: '6px',
                      border: 'none',
                      background: routeType === 'gate_class' ? '#1C2128' : 'transparent',
                      color: routeType === 'gate_class' ? '#F4F5F7' : '#9CA3AF',
                      boxShadow: routeType === 'gate_class' ? '0 1px 4px rgba(0,0,0,0.3)' : 'none',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    Main Gate → Class
                  </button>
                </div>
              </div>

              {/* 5. Pickup & Drop Selectors */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '6px', color: '#9CA3AF' }}>
                    Pickup Station
                  </label>
                  <select
                    value={pickup}
                    onChange={(e) => {
                      setPickup(e.target.value);
                      triggerRoll();
                    }}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      fontSize: '12px',
                      fontWeight: 600,
                      background: '#13161B',
                      color: '#F4F5F7',
                      outline: 'none',
                    }}
                  >
                    {PICKUP_LOCATIONS.map((loc) => (
                      <option key={loc} value={loc} style={{ background: '#13161B', color: '#F4F5F7' }}>
                        {loc}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '6px', color: '#9CA3AF' }}>
                    Drop Station
                  </label>
                  <select
                    value={drop}
                    onChange={(e) => {
                      setDrop(e.target.value);
                      triggerRoll();
                    }}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      fontSize: '12px',
                      fontWeight: 600,
                      background: '#13161B',
                      color: '#F4F5F7',
                      outline: 'none',
                    }}
                  >
                    {DROP_LOCATIONS.map((loc) => (
                      <option key={loc} value={loc} style={{ background: '#13161B', color: '#F4F5F7' }}>
                        {loc}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 6. Time-Slot Pill Chips */}
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '8px', color: '#9CA3AF' }}>
                  Daily Scheduled Time Slots
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {TIME_SLOTS.map((slot) => {
                    const isSelected = selectedSlots.includes(slot);
                    return (
                      <button
                        key={slot}
                        type="button"
                        onClick={() => toggleSlot(slot)}
                        style={{
                          padding: '7px 14px',
                          borderRadius: '20px',
                          border: isSelected ? '1px solid #10B981' : '1px solid rgba(255, 255, 255, 0.12)',
                          background: isSelected ? '#10B981' : '#13161B',
                          color: isSelected ? '#0B1116' : '#9CA3AF',
                          boxShadow: isSelected ? '0 2px 8px rgba(16, 185, 129, 0.3), 2px 2px 0px #0D1013' : 'none',
                          fontSize: '11px',
                          fontWeight: isSelected ? 900 : 700,
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {slot}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 7. Duration Selector */}
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '8px', color: '#9CA3AF' }}>
                  Pass Validity Duration
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                  {DURATIONS.map((dur) => {
                    const isSelected = duration === dur.id;
                    return (
                      <button
                        key={dur.id}
                        type="button"
                        onClick={() => handleDurationSelect(dur.id)}
                        style={{
                          padding: '10px 8px',
                          borderRadius: '8px',
                          border: isSelected ? '1px solid #10B981' : '1px solid rgba(255, 255, 255, 0.12)',
                          background: isSelected ? '#13161B' : '#1C2128',
                          boxShadow: isSelected ? '2px 2px 0px #10B981' : 'none',
                          color: isSelected ? '#F4F5F7' : '#9CA3AF',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: '2px',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <span style={{ fontSize: '12px', fontWeight: 800 }}>{dur.label}</span>
                        <span style={{ fontSize: '9px', fontWeight: 600, color: '#9CA3AF' }}>{dur.days} Days Access</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Validation Error Message */}
              {formError && (
                <div
                  style={{
                    padding: '10px 14px',
                    background: 'rgba(239, 68, 68, 0.12)',
                    border: '1px solid #EF4444',
                    borderRadius: '8px',
                    color: '#F87171',
                    fontSize: '12px',
                    fontWeight: 700,
                  }}
                >
                  ⚠️ {formError}
                </div>
              )}

              {/* Success Message */}
              {submitSuccessMsg && (
                <div
                  style={{
                    padding: '10px 14px',
                    background: 'rgba(16, 185, 129, 0.12)',
                    border: '1px solid #10B981',
                    borderRadius: '8px',
                    color: '#6EE7B7',
                    fontSize: '12px',
                    fontWeight: 700,
                  }}
                >
                  ✓ {submitSuccessMsg}
                </div>
              )}

              {/* Submit for Verification Button */}
              <button
                type="submit"
                disabled={isSubmittingPass || isPending}
                style={{
                  marginTop: '8px',
                  padding: '14px 20px',
                  background: isPending ? 'rgba(245, 158, 11, 0.15)' : isSubmittingPass ? '#059669' : '#10B981',
                  color: isPending ? '#FBBF24' : '#0B1116',
                  border: isPending ? '1px solid #F59E0B' : '1px solid #10B981',
                  boxShadow: isPending ? 'none' : '0 4px 16px rgba(16, 185, 129, 0.3), 3px 3px 0px #0D1013',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 900,
                  letterSpacing: '0.04em',
                  cursor: isPending || isSubmittingPass ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  transition: 'all 0.15s ease',
                  opacity: isPending || isSubmittingPass ? 0.85 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!isPending && !isSubmittingPass) {
                    e.currentTarget.style.background = '#34D399';
                    e.currentTarget.style.boxShadow = '0 6px 20px rgba(16, 185, 129, 0.45), 3px 3px 0px #0D1013';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isPending && !isSubmittingPass) {
                    e.currentTarget.style.background = '#10B981';
                    e.currentTarget.style.boxShadow = '0 4px 16px rgba(16, 185, 129, 0.3), 3px 3px 0px #0D1013';
                  }
                }}
              >
                <span>
                  {isSubmittingPass
                    ? 'Validating & Uploading...'
                    : isPending
                    ? `Pass Application Under Review (${currentRequest?.request_code || currentRequest?.id})`
                    : isApproved
                    ? 'Pass Active • Submit New Renewal Request'
                    : 'Submit for Verification →'}
                </span>
              </button>

              {/* Medical Privacy & Consent Notice */}
              <div
                style={{
                  fontSize: '11px',
                  color: '#9CA3AF',
                  lineHeight: 1.45,
                  padding: '10px 12px',
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '6px',
                  marginTop: '10px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px',
                }}
              >
                <span style={{ color: '#10B981', fontSize: '13px', lineHeight: 1 }}>🔒</span>
                <div>
                  <strong style={{ color: '#E5E7EB' }}>Privacy & Data Minimization Notice:</strong> By submitting, you consent to the Campus Health Clinic and Transport Office reviewing your medical referral solely to verify mobility accommodation eligibility. Documents are stored in an encrypted private bucket with 60-second signed URLs and automatically purged 30 days after pass expiration.
                </div>
              </div>
            </form>

            {/* ---------------------------------------------------- */}
            {/* RIGHT: LIVE DIGITAL BOARDING PASS                    */}
            {/* ---------------------------------------------------- */}
            <div
              style={{
                padding: '36px 32px',
                background: '#13161B',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {/* Ticket Shape with Semicircle Side Notches */}
              <div
                key={rollKey}
                style={{
                  width: '100%',
                  maxWidth: '380px',
                  background: '#1C2128',
                  border: '1.5px solid rgba(255, 255, 255, 0.2)',
                  boxShadow: '4px 4px 0px #0D1013',
                  borderRadius: '16px',
                  position: 'relative',
                  overflow: 'hidden',
                  animation: 'verticalRoll 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
                  fontFamily: '"IBM Plex Mono", monospace, monospace',
                }}
              >
                {/* Semicircle Side Notches */}
                <div
                  style={{
                    position: 'absolute',
                    top: '68%',
                    left: '-12px',
                    width: '22px',
                    height: '22px',
                    borderRadius: '50%',
                    background: '#13161B',
                    border: '1.5px solid rgba(255, 255, 255, 0.2)',
                    zIndex: 10,
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    top: '68%',
                    right: '-12px',
                    width: '22px',
                    height: '22px',
                    borderRadius: '50%',
                    background: '#13161B',
                    border: '1.5px solid rgba(255, 255, 255, 0.2)',
                    zIndex: 10,
                  }}
                />

                {/* Ticket Top Header with Live Pass Status Badge */}
                <div
                  style={{
                    padding: '16px 20px',
                    background: '#13161B',
                    color: '#F4F5F7',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.12)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: isApproved ? '#10B981' : isPending ? '#F59E0B' : '#EF4444',
                        boxShadow: isApproved
                          ? '0 0 8px #10B981'
                          : isPending
                          ? '0 0 8px #F59E0B'
                          : '0 0 8px #EF4444',
                      }}
                    />
                    <span style={{ fontSize: '13px', fontWeight: 800, letterSpacing: '0.1em' }}>QARTIX PASS</span>
                  </div>

                  <span
                    style={{
                      padding: '3px 8px',
                      borderRadius: '4px',
                      fontSize: '9px',
                      fontWeight: 800,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      background: isApproved
                        ? 'rgba(16, 185, 129, 0.2)'
                        : isPending
                        ? 'rgba(245, 158, 11, 0.2)'
                        : isRejected
                        ? 'rgba(239, 68, 68, 0.2)'
                        : 'rgba(255, 255, 255, 0.08)',
                      color: isApproved ? '#10B981' : isPending ? '#F59E0B' : isRejected ? '#EF4444' : '#9CA3AF',
                      border: isApproved
                        ? '1px solid rgba(16, 185, 129, 0.4)'
                        : isPending
                        ? '1px solid rgba(245, 158, 11, 0.4)'
                        : isRejected
                        ? '1px solid rgba(239, 68, 68, 0.4)'
                        : '1px solid rgba(255, 255, 255, 0.15)',
                    }}
                  >
                    {isApproved
                      ? 'PASS ACTIVE • VERIFIED'
                      : isPending
                      ? 'PENDING VERIFICATION • TRANSPORT OFFICE REVIEW'
                      : isRejected
                      ? 'APPLICATION REJECTED'
                      : 'BUILD YOUR PASS'}
                  </span>
                </div>

                {/* Ticket Body: IBM Plex Mono Route Metadata & Stamp */}
                <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', position: 'relative' }}>
                  {/* Status-Aligned Ink Stamp Slam Animation */}
                  {currentRequest && (
                    <div
                      key={`stamp-${rollKey}`}
                      style={{
                        position: 'absolute',
                        top: '42%',
                        left: '50%',
                        transform: 'translate(-50%, -50%) rotate(-4deg)',
                        border: isApproved
                          ? '3px double #10B981'
                          : isPending
                          ? '3px double #F59E0B'
                          : '3px double #EF4444',
                        borderRadius: '8px',
                        padding: '6px 14px',
                        color: isApproved ? '#10B981' : isPending ? '#F59E0B' : '#EF4444',
                        textAlign: 'center',
                        zIndex: 20,
                        background: 'rgba(28, 33, 40, 0.95)',
                        boxShadow: isApproved
                          ? '0 4px 16px rgba(16, 185, 129, 0.4)'
                          : isPending
                          ? '0 4px 16px rgba(245, 158, 11, 0.35)'
                          : '0 4px 16px rgba(239, 68, 68, 0.4)',
                        animation: 'stampSlam 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards',
                        pointerEvents: 'none',
                      }}
                    >
                      <div style={{ fontSize: '12px', fontWeight: 900, letterSpacing: '0.1em' }}>
                        {isApproved
                          ? 'PASS APPROVED • VERIFIED'
                          : isPending
                          ? 'PASS SUBMITTED • UNDER REVIEW'
                          : 'APPLICATION REJECTED'}
                      </div>
                      <div style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.08em' }}>
                        {isApproved
                          ? 'TRANSPORT OFFICE AUTHORIZED • ACTIVE ACCESS'
                          : isPending
                          ? 'TRANSPORT OFFICE NOTIFIED • VERIFICATION PENDING'
                          : currentRequest.adminNotes
                          ? `REASON: ${currentRequest.adminNotes}`
                          : 'CRITERIA NOT MET'}
                      </div>
                    </div>
                  )}

                  {/* Route Trajectory */}
                  <div>
                    <div style={{ fontSize: '10px', color: '#9CA3AF', fontWeight: 700, textTransform: 'uppercase' }}>
                      ROUTE TRAJECTORY
                    </div>
                    <div style={{ fontSize: '13px', fontWeight: 800, color: '#F4F5F7', marginTop: '2px', lineHeight: 1.3 }}>
                      {pickup}
                    </div>
                    <div style={{ fontSize: '11px', fontWeight: 800, color: '#10B981', margin: '2px 0' }}>
                      ↓ VIA CAMPUS ELECTRIC LOOP
                    </div>
                    <div style={{ fontSize: '13px', fontWeight: 800, color: '#F4F5F7', lineHeight: 1.3 }}>
                      {drop}
                    </div>
                  </div>

                  {/* Student & Pass IDs */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', paddingTop: '8px', borderTop: '1px dashed rgba(255, 255, 255, 0.15)' }}>
                    <div>
                      <div style={{ fontSize: '9px', color: '#9CA3AF', fontWeight: 700 }}>STUDENT</div>
                      <div style={{ fontSize: '12px', fontWeight: 800, color: '#F4F5F7' }}>{student.fullName || 'Pranav Kumar'}</div>
                      <div style={{ fontSize: '10px', color: '#9CA3AF' }}>{currentStudentId}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '9px', color: '#9CA3AF', fontWeight: 700 }}>VALIDITY</div>
                      <div style={{ fontSize: '12px', fontWeight: 800, color: '#F4F5F7' }}>{durationObj.label}</div>
                      <div style={{ fontSize: '10px', color: '#9CA3AF' }}>{durationObj.days} Days</div>
                    </div>
                  </div>

                  {/* Medical Condition & Attachment Summary */}
                  <div style={{ paddingTop: '8px', borderTop: '1px dashed rgba(255, 255, 255, 0.15)' }}>
                    <div style={{ fontSize: '9px', color: '#9CA3AF', fontWeight: 700, marginBottom: '2px' }}>
                      MEDICAL VERIFICATION DETAILS
                    </div>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: '#F4F5F7' }}>
                      ● {medicalCondition === 'Other' && customCondition ? customCondition : medicalCondition}
                    </div>
                    <div style={{ fontSize: '10px', color: '#9CA3AF', marginTop: '2px', fontStyle: 'italic', lineHeight: 1.3 }}>
                      "{reason.length > 60 ? reason.slice(0, 60) + '...' : reason}"
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', fontSize: '10px', color: '#10B981' }}>
                      <span>📎 Doc:</span>
                      <span style={{ fontFamily: 'monospace', color: '#F4F5F7' }}>{medicalSlip ? medicalSlip.name : 'clinic_slip.pdf'}</span>
                    </div>
                  </div>

                  {/* Scheduled Slots */}
                  <div style={{ paddingTop: '8px', borderTop: '1px dashed rgba(255, 255, 255, 0.15)' }}>
                    <div style={{ fontSize: '9px', color: '#9CA3AF', fontWeight: 700, marginBottom: '4px' }}>
                      AUTHORIZED DISPATCH WINDOWS
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                      {selectedSlots.map((s) => (
                        <span key={s} style={{ padding: '2px 6px', background: '#13161B', border: '1px solid rgba(255, 255, 255, 0.12)', color: '#F4F5F7', borderRadius: '4px', fontSize: '10px', fontWeight: 800 }}>
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Perforation Line */}
                <div style={{ borderTop: '2px dashed rgba(255, 255, 255, 0.2)', margin: '0 12px' }} />

                {/* Ticket Stub: QR Code & Verification State */}
                <div
                  style={{
                    padding: '20px 24px',
                    background: '#13161B',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '9px', color: '#9CA3AF', fontWeight: 700 }}>DIGITAL PASS TOKEN</div>
                    <div
                      style={{
                        fontSize: '12px',
                        fontWeight: 800,
                        color: isApproved ? '#F4F5F7' : isPending ? '#F59E0B' : '#9CA3AF',
                        fontFamily: 'monospace',
                        letterSpacing: '0.02em',
                      }}
                    >
                      {isApproved
                        ? (currentRequest?.qr_token || currentRequest?.qrToken || 'QARTIX-ACTIVE')
                        : isPending
                        ? 'TOKEN GENERATES ON APPROVAL'
                        : 'NO ACTIVE TOKEN'}
                    </div>
                    <div
                      style={{
                        fontSize: '9px',
                        color: isApproved ? '#10B981' : isPending ? '#F59E0B' : '#9CA3AF',
                        fontWeight: 700,
                        marginTop: '2px',
                      }}
                    >
                      {isApproved
                        ? '● TAP OR SCAN AT BOARDING'
                        : isPending
                        ? '⏳ AWAITING VERIFICATION'
                        : '○ INACTIVE'}
                    </div>
                  </div>

                  {/* Geometric QR Code SVG Placeholder */}
                  <div
                    style={{
                      width: '64px',
                      height: '64px',
                      background: '#FFFFFF',
                      border: isApproved ? '1.5px solid #10B981' : '1.5px solid #4B5563',
                      borderRadius: '6px',
                      padding: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: isApproved ? 1 : 0.35,
                      filter: isApproved ? 'none' : 'grayscale(1)',
                    }}
                    title={isApproved ? 'Scan to board' : 'Pass QR token generated upon approval'}
                  >
                    <svg width="52" height="52" viewBox="0 0 24 24" fill="#16181A">
                      <rect x="2" y="2" width="6" height="6" />
                      <rect x="16" y="2" width="6" height="6" />
                      <rect x="2" y="16" width="6" height="6" />
                      <rect x="4" y="4" width="2" height="2" fill="#FFFFFF" />
                      <rect x="18" y="4" width="2" height="2" fill="#FFFFFF" />
                      <rect x="4" y="18" width="2" height="2" fill="#FFFFFF" />
                      <rect x="10" y="2" width="4" height="2" />
                      <rect x="10" y="6" width="2" height="4" />
                      <rect x="14" y="10" width="4" height="2" />
                      <rect x="10" y="14" width="4" height="4" />
                      <rect x="18" y="14" width="4" height="2" />
                      <rect x="16" y="18" width="6" height="4" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ---------------------------------------------------- */}
          {/* STUDENT PASS REQUEST HISTORY & STATUS                */}
          {/* ---------------------------------------------------- */}
          {studentRequests.length > 0 && (
            <div
              style={{
                marginTop: '24px',
                background: '#1C2128',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                boxShadow: '4px 4px 0px #0D1013',
                borderRadius: '12px',
                padding: '24px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
                <div>
                  <h3 style={{ fontSize: '16px', fontWeight: 800, margin: 0, color: '#F4F5F7' }}>
                    My Pass Applications & Verification History
                  </h3>
                  <p style={{ margin: '3px 0 0 0', fontSize: '12px', color: '#9CA3AF' }}>
                    Real-time status updates from the campus transport office.
                  </p>
                </div>
                <span
                  style={{
                    padding: '4px 10px',
                    borderRadius: '6px',
                    background: '#13161B',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    fontSize: '11px',
                    color: '#9CA3AF',
                    fontWeight: 700,
                  }}
                >
                  {studentRequests.length} {studentRequests.length === 1 ? 'Application' : 'Applications'}
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {studentRequests.map((req) => {
                  const reqStatus = req.status || 'pending';
                  const isApp = reqStatus === 'approved' || reqStatus === 'active';
                  const isPend = reqStatus === 'pending';

                  return (
                    <div
                      key={req.id || req.request_code}
                      style={{
                        padding: '14px 18px',
                        background: '#13161B',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: '8px',
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '12px',
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontFamily: 'monospace', fontWeight: 800, color: '#10B981', fontSize: '13px' }}>
                            {req.request_code || req.id}
                          </span>
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontSize: '10px',
                              fontWeight: 800,
                              textTransform: 'uppercase',
                              background: isApp
                                ? 'rgba(16, 185, 129, 0.15)'
                                : isPend
                                ? 'rgba(245, 158, 11, 0.15)'
                                : 'rgba(239, 68, 68, 0.15)',
                              color: isApp ? '#10B981' : isPend ? '#FBBF24' : '#F87171',
                              border: isApp
                                ? '1px solid rgba(16, 185, 129, 0.3)'
                                : isPend
                                ? '1px solid rgba(245, 158, 11, 0.3)'
                                : '1px solid rgba(239, 68, 68, 0.3)',
                            }}
                          >
                            {reqStatus}
                          </span>
                        </div>
                        <div style={{ fontSize: '12px', color: '#F4F5F7', fontWeight: 600 }}>
                          {req.route || `${req.pickup} → ${req.drop_station || req.drop}`}
                        </div>
                        <div style={{ fontSize: '11px', color: '#9CA3AF' }}>
                          Condition: <strong style={{ color: '#D1D5DB' }}>{req.medical_condition || req.medicalCondition}</strong> • Duration: {req.duration}
                        </div>
                        {req.admin_notes || req.adminNotes || req.review_note ? (
                          <div style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '2px' }}>
                            Office Remarks: <span style={{ color: isApp ? '#A7F3D0' : isPend ? '#FDE68A' : '#FECACA', fontStyle: 'italic' }}>"{req.admin_notes || req.adminNotes || req.review_note}"</span>
                          </div>
                        ) : null}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {req.starts_on && req.expires_on && (
                          <div style={{ textAlign: 'right', fontSize: '10px', color: '#9CA3AF' }}>
                            <div>Valid: {req.starts_on}</div>
                            <div>Until: {req.expires_on}</div>
                          </div>
                        )}
                        {req.certificate_path && (
                          <button
                            type="button"
                            onClick={async () => {
                              const url = await getCertificateSignedUrl(req.certificate_path);
                              if (url) window.open(url, '_blank');
                            }}
                            style={{
                              padding: '6px 12px',
                              background: '#1C2128',
                              border: '1px solid rgba(255, 255, 255, 0.15)',
                              borderRadius: '6px',
                              color: '#F4F5F7',
                              fontSize: '11px',
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            View Document
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      </main>

      {/* -------------------------------------------------------- */}
      {/* EXTRA RIDE MODAL                                         */}
      {/* -------------------------------------------------------- */}
      {Boolean(extraRideModalOpen) ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            background: 'rgba(22, 24, 26, 0.65)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '480px',
              background: '#1C2128',
              border: '1.5px solid rgba(255, 255, 255, 0.2)',
              boxShadow: '6px 6px 0px #0D1013',
              borderRadius: '12px',
              padding: '28px',
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px' }}>
              <div>
                <span style={{ fontSize: '10px', fontWeight: 900, padding: '3px 8px', background: '#10B981', color: '#0B1116', borderRadius: '4px' }}>
                  PRIORITY DISPATCH
                </span>
                <h3 style={{ fontSize: '20px', fontWeight: 900, margin: '8px 0 4px 0', color: '#F4F5F7' }}>
                  Request On-Demand Extra Ride
                </h3>
                <p style={{ fontSize: '12px', color: '#9CA3AF', margin: 0, lineHeight: 1.5 }}>
                  For urgent campus clinic visits, unscheduled lab assignments, or accessibility transport.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setExtraRideModalOpen(false)}
                style={{
                  width: '28px',
                  height: '28px',
                  minWidth: '28px',
                  minHeight: '28px',
                  borderRadius: '50%',
                  background: '#13161B',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  color: '#9CA3AF',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '16px',
                  lineHeight: 1,
                  padding: 0,
                  transition: 'all 0.15s ease',
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = '#FFFFFF';
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = '#9CA3AF';
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)';
                }}
                title="Close"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', marginBottom: '6px', color: '#9CA3AF' }}>
                Urgent Destination
              </label>
              <select
                value={extraDestination}
                onChange={(e) => setExtraDestination(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  fontSize: '13px',
                  fontWeight: 600,
                  background: '#13161B',
                  color: '#F4F5F7',
                }}
              >
                <option value="Campus Health Clinic (Urgent)">Campus Health Clinic (Urgent)</option>
                <option value="Advanced Sciences Research Lab">Advanced Sciences Research Lab</option>
                <option value="Main Campus Exit Gate">Main Campus Exit Gate</option>
                <option value="Central Administration Building">Central Administration Building</option>
              </select>
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '10px' }}>
              <button
                type="button"
                onClick={() => setExtraRideModalOpen(false)}
                title="Close modal"
                style={{
                  padding: '10px 16px',
                  background: '#13161B',
                  color: '#9CA3AF',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  borderRadius: '8px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleRequestExtraRide}
                disabled={extraConfirmed}
                style={{
                  padding: '10px 20px',
                  background: extraConfirmed ? '#2E6F5E' : '#10B981',
                  color: extraConfirmed ? '#FFFFFF' : '#0B1116',
                  border: extraConfirmed ? '1px solid #2E6F5E' : '1px solid #10B981',
                  boxShadow: '0 4px 14px rgba(16, 185, 129, 0.25), 3px 3px 0px #0D1013',
                  borderRadius: '8px',
                  fontSize: '12px',
                  fontWeight: 900,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  if (!extraConfirmed) {
                    e.currentTarget.style.background = '#34D399';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!extraConfirmed) {
                    e.currentTarget.style.background = '#10B981';
                  }
                }}
              >
                {extraConfirmed ? 'Dispatched!' : 'Dispatch Nearest Cart →'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
