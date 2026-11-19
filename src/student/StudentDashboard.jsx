import React, { useState, useRef, useEffect } from 'react';
import {
  fetchPassRequests,
  submitPassRequest,
  fetchRides,
  skipRide,
  requestExtraRide,
  detectFileMimeType,
  supabase,
} from '../lib/supabase.js';

const ACADEMIC_BLOCKS = [
  'Academic Block B',
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
  { id: 'sem', label: 'Semester', days: 120 },
];

const MEDICAL_CONDITIONS = [
  'Leg/Ankle Fracture',
  'Ligament Tear / Sprain',
  'Post-Surgery Recovery',
  'Chronic Mobility Condition',
  'Other',
];

export default function StudentDashboard({
  student = null,
  onReturnTo3D = () => {},
  onLogout = () => {},
}) {
  // Extract student details with safe fallbacks
  const studentName =
    student?.fullName ||
    student?.name ||
    student?.user_metadata?.full_name ||
    'Campus Student';
  const rollNo =
    student?.rollNo ||
    student?.studentId ||
    student?.loginIdentifier ||
    student?.user_metadata?.roll_no ||
    student?.user_metadata?.student_id ||
    '2024CS0842';
  const residency =
    student?.residencyStatus ||
    student?.residencyType ||
    student?.hostelBlock ||
    student?.hostel ||
    student?.user_metadata?.residency_status ||
    'Hostler';

  const studentId = student?.id || rollNo;

  // Active top navigation tab: 'rides' | 'pass'
  const [activeTab, setActiveTab] = useState('rides');

  // ---------------------------------------------------------------------------
  // 1. PASS REQUESTS & ACTIVE PASS STATE
  // ---------------------------------------------------------------------------
  const [requestsList, setRequestsList] = useState([]);
  const [isLoadingPass, setIsLoadingPass] = useState(false);

  // Form State for Pass Builder (Tab 2)
  const [routeType, setRouteType] = useState('hostel_class'); // 'hostel_class' | 'gate_class'
  const [academicBlock, setAcademicBlock] = useState(ACADEMIC_BLOCKS[0]);
  const [selectedSlots, setSelectedSlots] = useState(['08:30 AM', '04:30 PM']);
  const [duration, setDuration] = useState('1m');
  const [medicalCondition, setMedicalCondition] = useState(MEDICAL_CONDITIONS[0]);
  const [customCondition, setCustomCondition] = useState('');
  const [reason, setReason] = useState('');
  const [uploadedFile, setUploadedFile] = useState(null);
  const [fileError, setFileError] = useState('');
  const [formError, setFormError] = useState('');
  const [submitSuccess, setSubmitSuccess] = useState('');
  const [isSubmittingPass, setIsSubmittingPass] = useState(false);
  const fileInputRef = useRef(null);

  // Computed Route string
  const pickupLocation =
    routeType === 'hostel_class'
      ? student?.hostel || 'Hostel Gate'
      : 'Main Campus Gate';
  const displayRoute = `${pickupLocation} → ${academicBlock}`;
  const durationObj = DURATIONS.find((d) => d.id === duration) || DURATIONS[1];

  // Fetch student's pass requests
  const loadPassRequests = async () => {
    try {
      setIsLoadingPass(true);
      const data = await fetchPassRequests(student?.id);
      if (data && data.length > 0) {
        setRequestsList(data);
      }
    } catch (err) {
      console.warn('Could not fetch pass requests:', err);
    } finally {
      setIsLoadingPass(false);
    }
  };

  useEffect(() => {
    loadPassRequests();

    // Realtime listener for pass request status changes
    const passChannel = supabase
      .channel('student-pass-updates')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pass_requests' },
        () => {
          loadPassRequests();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(passChannel);
    };
  }, [student?.id]);

  // Determine current active or pending pass
  const activePass = requestsList.find(
    (r) => r.status === 'approved' || r.status === 'active'
  );
  const pendingPass = requestsList.find((r) => r.status === 'pending');
  const latestRequest = activePass || pendingPass || requestsList[0] || null;

  // ---------------------------------------------------------------------------
  // 2. TODAY'S SCHEDULED RIDES & SKIP LOGIC (Tab 1)
  // ---------------------------------------------------------------------------
  const [rides, setRides] = useState([
    {
      id: 'ride-1',
      time: '08:30 AM',
      route: `${pickupLocation} → ${academicBlock}`,
      skipped: false,
      raw_status: 'scheduled',
    },
    {
      id: 'ride-2',
      time: '01:30 PM',
      route: `${academicBlock} → Central Quad`,
      skipped: false,
      raw_status: 'scheduled',
    },
    {
      id: 'ride-3',
      time: '04:30 PM',
      route: `Central Quad → ${pickupLocation}`,
      skipped: false,
      raw_status: 'scheduled',
    },
  ]);

  const loadTodayRides = async () => {
    try {
      const data = await fetchRides({ today: true, studentId: student?.id });
      if (data && data.length > 0) {
        setRides(
          data.map((r) => ({
            id: r.id,
            time: r.scheduled_time || r.time || '08:30 AM',
            route: r.route || `${r.pickup} → ${r.drop_station}`,
            skipped: r.skipped || r.raw_status === 'skipped',
            raw_status: r.raw_status || r.status,
          }))
        );
      }
    } catch (err) {
      console.warn('Could not load rides from Supabase:', err);
    }
  };

  useEffect(() => {
    loadTodayRides();

    // Realtime channel for rides update
    const ridesChannel = supabase
      .channel('student-rides-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rides' },
        () => {
          loadTodayRides();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ridesChannel);
    };
  }, [student?.id]);

  // Clean optimistic "Skip Today" toggle with rollback
  const handleSkipRide = async (rideId) => {
    const target = rides.find((r) => r.id === rideId);
    if (!target || target.raw_status === 'completed') return;

    const previousState = [...rides];
    const newSkippedState = !target.skipped;

    // Optimistically update UI
    setRides((prev) =>
      prev.map((r) =>
        r.id === rideId
          ? {
              ...r,
              skipped: newSkippedState,
              raw_status: newSkippedState ? 'skipped' : 'scheduled',
            }
          : r
      )
    );

    try {
      if (newSkippedState) {
        await skipRide(rideId);
      }
    } catch (err) {
      // Rollback on server rejection
      setRides(previousState);
      alert(err.message || 'Unable to skip ride at this time.');
    }
  };

  // ---------------------------------------------------------------------------
  // 3. EXTRA RIDE MODAL & SUBMISSION
  // ---------------------------------------------------------------------------
  const [extraRideModalOpen, setExtraRideModalOpen] = useState(false);
  const [extraPickup, setExtraPickup] = useState(pickupLocation);
  const [extraDrop, setExtraDrop] = useState('Campus Health & Sports Pavilion');
  const [isSubmittingExtra, setIsSubmittingExtra] = useState(false);
  const [extraError, setExtraError] = useState('');

  const handleConfirmExtraRide = async (e) => {
    if (e) e.preventDefault();
    setIsSubmittingExtra(true);
    setExtraError('');

    try {
      const res = await requestExtraRide({
        pickup: extraPickup,
        drop: extraDrop,
        requestedTime: new Date().toISOString(),
      });

      const newRide = res?.ride;
      setRides((prev) => [
        {
          id: newRide?.id || `extra-${Date.now()}`,
          time: 'NOW',
          route: `${extraPickup} → ${extraDrop}`,
          skipped: false,
          raw_status: 'requested',
        },
        ...prev,
      ]);

      setExtraRideModalOpen(false);
    } catch (err) {
      setExtraError(
        err.message ||
          'Failed to request extra ride. An active approved campus mobility pass is required.'
      );
    } finally {
      setIsSubmittingExtra(false);
    }
  };

  // ---------------------------------------------------------------------------
  // 4. MONTHLY PASS FORM HANDLERS (Tab 2)
  // ---------------------------------------------------------------------------
  const toggleTimeSlot = (slot) => {
    setSelectedSlots((prev) => {
      const exists = prev.includes(slot);
      if (exists) {
        return prev.length > 1 ? prev.filter((s) => s !== slot) : prev;
      }
      return [...prev, slot];
    });
  };

  const handleFileSelection = async (file) => {
    if (!file) return;
    setFileError('');
    setFormError('');

    const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
    if (file.size > MAX_SIZE) {
      setFileError('Medical certificate file size exceeds the 5 MB limit.');
      setUploadedFile(null);
      return;
    }

    try {
      const detectedMime = await detectFileMimeType(file);
      const allowedMimes = ['application/pdf', 'image/jpeg', 'image/png'];
      if (!allowedMimes.includes(detectedMime)) {
        setFileError(
          'Invalid file format. Only authentic PDF, JPG, or PNG medical documents are accepted.'
        );
        setUploadedFile(null);
        return;
      }
      setUploadedFile(file);
    } catch (err) {
      setFileError('Could not verify file content. Please re-upload.');
      setUploadedFile(null);
    }
  };

  const handleSubmitPassRequest = async (e) => {
    if (e) e.preventDefault();
    if (isSubmittingPass) return;

    if (!reason.trim()) {
      setFormError('Please specify the reason for your mobility pass request.');
      return;
    }

    if (!uploadedFile) {
      setFormError('Please upload a valid medical certificate or clinic slip.');
      return;
    }

    const finalCondition =
      medicalCondition === 'Other' && customCondition.trim()
        ? customCondition.trim()
        : medicalCondition;

    setIsSubmittingPass(true);
    setFormError('');
    setSubmitSuccess('');

    try {
      const result = await submitPassRequest({
        studentProfile: student || { id: studentId, fullName: studentName },
        pickup: pickupLocation,
        drop: academicBlock,
        route: displayRoute,
        timeSlots: selectedSlots,
        duration: durationObj.label,
        medicalCondition: finalCondition,
        reason: reason.trim(),
        certificateFile: uploadedFile,
        certificateName: uploadedFile.name,
        certificateSize: `${(uploadedFile.size / 1024).toFixed(1)} KB`,
      });

      const newRecord = {
        id: result?.request_code || result?.id || `REQ-${Date.now()}`,
        studentName,
        route: displayRoute,
        timeSlots: selectedSlots,
        duration: durationObj.label,
        status: 'pending',
        created_at: new Date().toISOString(),
      };

      setRequestsList((prev) => [newRecord, ...prev]);
      setSubmitSuccess('PASS SUBMITTED • TRANSPORT OFFICE NOTIFIED');
    } catch (err) {
      setFormError(err.message || 'Failed to submit pass request. Please try again.');
    } finally {
      setIsSubmittingPass(false);
    }
  };

  // Determine preview status text
  const previewStatusText = submitSuccess
    ? 'PASS SUBMITTED • TRANSPORT OFFICE NOTIFIED'
    : latestRequest?.status === 'approved' || latestRequest?.status === 'active'
    ? 'ACTIVE'
    : latestRequest?.status === 'pending'
    ? 'PASS SUBMITTED • TRANSPORT OFFICE NOTIFIED'
    : 'DRAFT • NOT SUBMITTED';

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#0B1117',
        color: '#F4F5F7',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      }}
      className="pb-20"
    >
      {/* --------------------------------------------------------------------- */}
      {/* 1. CLEAN TOP HEADER (WITH STUDENT NAME)                              */}
      {/* --------------------------------------------------------------------- */}
      <header
        style={{
          backgroundColor: '#0B1117',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        }}
        className="sticky top-0 z-40 px-6 sm:px-10 py-5"
      >
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          {/* Left: Clear greeting & Roll No. / Residency */}
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
              Hi, {studentName}
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">
              {rollNo} • {residency}
            </p>
          </div>

          {/* Right: Only 2 compact buttons */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onReturnTo3D}
              style={{
                backgroundColor: '#161F2C',
                border: '1px solid rgba(255, 255, 255, 0.08)',
              }}
              className="px-3.5 py-2 text-xs sm:text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors flex items-center gap-2"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
              <span>3D Cart View</span>
            </button>

            <button
              type="button"
              onClick={onLogout}
              style={{
                backgroundColor: '#161F2C',
                border: '1px solid rgba(255, 255, 255, 0.08)',
              }}
              className="px-3.5 py-2 text-xs sm:text-sm font-medium text-slate-400 hover:text-red-400 hover:border-red-500/30 rounded-lg transition-colors"
            >
              Log Out
            </button>
          </div>
        </div>
      </header>

      {/* --------------------------------------------------------------------- */}
      {/* 2. SIMPLE 2-TAB LAYOUT (ELIMINATES PAGE CLUTTER)                     */}
      {/* --------------------------------------------------------------------- */}
      <div className="max-w-6xl mx-auto px-6 sm:px-10 mt-8 mb-8">
        <div className="flex justify-center">
          <div
            style={{
              backgroundColor: '#161F2C',
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
            className="inline-flex p-1 rounded-xl"
          >
            <button
              type="button"
              onClick={() => setActiveTab('rides')}
              className={`px-6 py-2 rounded-lg text-sm font-semibold transition-all ${
                activeTab === 'rides'
                  ? 'bg-[#10B981] text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              My Rides
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('pass')}
              className={`px-6 py-2 rounded-lg text-sm font-semibold transition-all ${
                activeTab === 'pass'
                  ? 'bg-[#10B981] text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Monthly Pass
            </button>
          </div>
        </div>
      </div>

      {/* --------------------------------------------------------------------- */}
      {/* 3. TAB 1: MY RIDES (ONLY ESSENTIAL INFO, max-w-3xl mx-auto)          */}
      {/* --------------------------------------------------------------------- */}
      {activeTab === 'rides' && (
        <main className="max-w-3xl mx-auto px-6">
          {/* Active Pass Strip (1 compact card) */}
          <div
            style={{
              backgroundColor: '#161F2C',
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
            className="rounded-2xl p-5 mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
          >
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-wider font-semibold text-slate-400">
                Active Route
              </div>
              <div className="text-base font-medium text-white flex items-center gap-2">
                <span>
                  {activePass?.route ||
                    latestRequest?.route ||
                    'Hostel → Academic Block'}
                </span>
                <span className="text-slate-500">•</span>
                <span className="text-sm font-mono text-emerald-400">
                  CART-04
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {activePass ? (
                <span
                  style={{
                    backgroundColor: 'rgba(16, 185, 129, 0.15)',
                    color: '#10B981',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                  }}
                  className="px-3.5 py-1.5 rounded-full text-xs font-bold tracking-wide"
                >
                  ACTIVE
                </span>
              ) : pendingPass ? (
                <span
                  style={{
                    backgroundColor: 'rgba(245, 158, 11, 0.15)',
                    color: '#F59E0B',
                    border: '1px solid rgba(245, 158, 11, 0.3)',
                  }}
                  className="px-3.5 py-1.5 rounded-full text-xs font-bold tracking-wide"
                >
                  PENDING REVIEW
                </span>
              ) : (
                <div className="flex items-center gap-3">
                  <span
                    style={{
                      backgroundColor: 'rgba(255, 255, 255, 0.05)',
                      color: '#94A3B8',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                    }}
                    className="px-3.5 py-1.5 rounded-full text-xs font-semibold"
                  >
                    NO PASS YET
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveTab('pass')}
                    className="text-xs font-semibold text-[#10B981] hover:underline"
                  >
                    Apply Now →
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Today's Schedule (Clean list, generous spacing) */}
          <div className="mb-6">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-4">
              Today's Schedule
            </h2>

            <div className="space-y-3">
              {rides.map((ride) => (
                <div
                  key={ride.id}
                  style={{
                    backgroundColor: '#161F2C',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    opacity: ride.skipped ? 0.45 : 1,
                  }}
                  className="rounded-xl px-5 py-4 flex items-center justify-between gap-4 transition-all"
                >
                  {/* Item 1: Time (in mono) */}
                  <div
                    className={`font-mono text-base font-semibold min-w-[90px] ${
                      ride.skipped
                        ? 'line-through text-slate-500'
                        : 'text-white'
                    }`}
                  >
                    {ride.time}
                  </div>

                  {/* Item 2: Route */}
                  <div
                    className={`flex-1 text-sm font-medium ${
                      ride.skipped ? 'text-slate-500' : 'text-slate-200'
                    }`}
                  >
                    {ride.route}
                  </div>

                  {/* Item 3: Clean "Skip Today" Toggle Switch */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={ride.skipped}
                    onClick={() => handleSkipRide(ride.id)}
                    disabled={ride.raw_status === 'completed'}
                    style={{
                      backgroundColor: ride.skipped
                        ? 'rgba(245, 158, 11, 0.1)'
                        : '#0B1117',
                      borderColor: ride.skipped
                        ? 'rgba(245, 158, 11, 0.3)'
                        : 'rgba(255, 255, 255, 0.08)',
                    }}
                    className={`inline-flex items-center gap-2.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                      ride.skipped
                        ? 'text-amber-400'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {/* Visual toggle pill */}
                    <span
                      className={`w-7 h-4 flex items-center rounded-full p-0.5 transition-colors ${
                        ride.skipped
                          ? 'bg-amber-500 justify-end'
                          : 'bg-slate-700 justify-start'
                      }`}
                    >
                      <span className="w-3 h-3 rounded-full bg-white shadow-sm" />
                    </span>
                    <span>{ride.skipped ? 'Skipped' : 'Skip Today'}</span>
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom Action: One subtle outlined button */}
          <div className="mt-8 flex justify-center">
            <button
              type="button"
              onClick={() => setExtraRideModalOpen(true)}
              style={{
                backgroundColor: 'transparent',
                border: '1px solid rgba(255, 255, 255, 0.12)',
              }}
              className="px-6 py-2.5 rounded-xl text-sm font-medium text-slate-300 hover:text-[#10B981] hover:border-[#10B981]/50 transition-colors flex items-center gap-2"
            >
              <span className="text-[#10B981] font-semibold text-base leading-none">
                +
              </span>
              <span>Request Extra Ride</span>
            </button>
          </div>
        </main>
      )}

      {/* --------------------------------------------------------------------- */}
      {/* 4. TAB 2: MONTHLY PASS (CLEAN, FOCUSED FORM, max-w-5xl mx-auto)      */}
      {/* --------------------------------------------------------------------- */}
      {activeTab === 'pass' && (
        <main className="max-w-5xl mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* --------------------------------------------------------------- */}
            {/* LEFT: FORM CARD (7 cols)                                        */}
            {/* --------------------------------------------------------------- */}
            <div
              style={{
                backgroundColor: '#161F2C',
                border: '1px solid rgba(255, 255, 255, 0.08)',
              }}
              className="lg:col-span-7 rounded-2xl p-6 sm:p-8 space-y-6"
            >
              <form onSubmit={handleSubmitPassRequest} className="space-y-6">
                {/* 1. Route Type & Academic Block */}
                <div className="space-y-3">
                  <label className="text-xs uppercase tracking-wider font-semibold text-slate-400">
                    Route Type & Academic Block
                  </label>

                  {/* Route Type pills */}
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setRouteType('hostel_class')}
                      style={{
                        backgroundColor:
                          routeType === 'hostel_class'
                            ? 'rgba(16, 185, 129, 0.15)'
                            : '#0B1117',
                        borderColor:
                          routeType === 'hostel_class'
                            ? '#10B981'
                            : 'rgba(255, 255, 255, 0.08)',
                      }}
                      className={`py-2.5 px-3 rounded-xl border text-xs font-semibold transition-all ${
                        routeType === 'hostel_class'
                          ? 'text-[#10B981]'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Hostel → Class
                    </button>
                    <button
                      type="button"
                      onClick={() => setRouteType('gate_class')}
                      style={{
                        backgroundColor:
                          routeType === 'gate_class'
                            ? 'rgba(16, 185, 129, 0.15)'
                            : '#0B1117',
                        borderColor:
                          routeType === 'gate_class'
                            ? '#10B981'
                            : 'rgba(255, 255, 255, 0.08)',
                      }}
                      className={`py-2.5 px-3 rounded-xl border text-xs font-semibold transition-all ${
                        routeType === 'gate_class'
                          ? 'text-[#10B981]'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Main Gate → Class
                    </button>
                  </div>

                  {/* Academic Block Dropdown */}
                  <select
                    value={academicBlock}
                    onChange={(e) => setAcademicBlock(e.target.value)}
                    style={{
                      backgroundColor: '#0B1117',
                      borderColor: 'rgba(255, 255, 255, 0.08)',
                    }}
                    className="w-full px-4 py-2.5 rounded-xl border text-sm text-white focus:outline-none focus:border-[#10B981]"
                  >
                    {ACADEMIC_BLOCKS.map((block) => (
                      <option key={block} value={block} className="bg-[#0B1117]">
                        {block}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 2. Daily Time Slots & Duration */}
                <div className="space-y-4">
                  <div>
                    <label className="text-xs uppercase tracking-wider font-semibold text-slate-400 mb-2 block">
                      Daily Time Slots
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      {TIME_SLOTS.map((slot) => {
                        const isSelected = selectedSlots.includes(slot);
                        return (
                          <button
                            key={slot}
                            type="button"
                            onClick={() => toggleTimeSlot(slot)}
                            style={{
                              backgroundColor: isSelected
                                ? 'rgba(16, 185, 129, 0.15)'
                                : '#0B1117',
                              borderColor: isSelected
                                ? '#10B981'
                                : 'rgba(255, 255, 255, 0.08)',
                            }}
                            className={`py-2 px-3 rounded-xl border font-mono text-xs font-semibold transition-all ${
                              isSelected
                                ? 'text-[#10B981]'
                                : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            {slot}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <label className="text-xs uppercase tracking-wider font-semibold text-slate-400 mb-2 block">
                      Duration
                    </label>
                    <div className="grid grid-cols-3 gap-2.5">
                      {DURATIONS.map((d) => {
                        const isSelected = duration === d.id;
                        return (
                          <button
                            key={d.id}
                            type="button"
                            onClick={() => setDuration(d.id)}
                            style={{
                              backgroundColor: isSelected
                                ? 'rgba(16, 185, 129, 0.15)'
                                : '#0B1117',
                              borderColor: isSelected
                                ? '#10B981'
                                : 'rgba(255, 255, 255, 0.08)',
                            }}
                            className={`py-2 px-3 rounded-xl border text-xs font-semibold transition-all ${
                              isSelected
                                ? 'text-[#10B981]'
                                : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            {d.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* 3. Medical Condition, Short Reason, Certificate Upload */}
                <div className="space-y-3">
                  <label className="text-xs uppercase tracking-wider font-semibold text-slate-400 block">
                    Medical Verification
                  </label>

                  <select
                    value={medicalCondition}
                    onChange={(e) => setMedicalCondition(e.target.value)}
                    style={{
                      backgroundColor: '#0B1117',
                      borderColor: 'rgba(255, 255, 255, 0.08)',
                    }}
                    className="w-full px-4 py-2.5 rounded-xl border text-sm text-white focus:outline-none focus:border-[#10B981]"
                  >
                    {MEDICAL_CONDITIONS.map((cond) => (
                      <option key={cond} value={cond} className="bg-[#0B1117]">
                        {cond}
                      </option>
                    ))}
                  </select>

                  {medicalCondition === 'Other' && (
                    <input
                      type="text"
                      placeholder="Specify your condition..."
                      value={customCondition}
                      onChange={(e) => setCustomCondition(e.target.value)}
                      style={{
                        backgroundColor: '#0B1117',
                        borderColor: 'rgba(255, 255, 255, 0.08)',
                      }}
                      className="w-full px-4 py-2 rounded-xl border text-sm text-white focus:outline-none focus:border-[#10B981]"
                    />
                  )}

                  <textarea
                    name="reason"
                    rows={3}
                    placeholder="Brief reason for pass request (e.g., knee recovery, cast on right ankle)..."
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    style={{
                      backgroundColor: '#0B1117',
                      borderColor: 'rgba(255, 255, 255, 0.08)',
                    }}
                    className="w-full px-4 py-2.5 rounded-xl border text-sm text-white focus:outline-none focus:border-[#10B981]"
                  />

                  {/* Medical Certificate File Upload */}
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      backgroundColor: '#0B1117',
                      borderColor: uploadedFile
                        ? 'rgba(16, 185, 129, 0.4)'
                        : 'rgba(255, 255, 255, 0.08)',
                    }}
                    className="rounded-xl border border-dashed p-4 text-center cursor-pointer hover:border-slate-500 transition-colors"
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileSelection(file);
                      }}
                    />
                    {uploadedFile ? (
                      <div className="flex items-center justify-center gap-2 text-sm text-[#10B981]">
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        <span className="font-medium truncate max-w-xs">
                          {uploadedFile.name} (
                          {(uploadedFile.size / 1024).toFixed(1)} KB)
                        </span>
                      </div>
                    ) : (
                      <div className="text-xs text-slate-400">
                        <span className="text-white font-medium">
                          Upload Medical Certificate
                        </span>{' '}
                        (PDF, JPG, PNG &lt; 5 MB)
                      </div>
                    )}
                  </div>

                  {fileError && (
                    <p className="text-xs text-red-400 font-medium">{fileError}</p>
                  )}
                  {formError && (
                    <p className="text-xs text-red-400 font-medium">{formError}</p>
                  )}
                </div>

                {/* 4. Full-width #10B981 button: Submit Pass Request → */}
                <button
                  type="submit"
                  disabled={isSubmittingPass}
                  style={{
                    backgroundColor: '#10B981',
                  }}
                  className="w-full py-3.5 px-4 rounded-xl font-bold text-white hover:bg-[#059669] transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#10B981]/20 disabled:opacity-50"
                >
                  {isSubmittingPass ? (
                    <span>Submitting Request...</span>
                  ) : (
                    <>
                      <span>Submit Pass Request →</span>
                      <span style={{ display: 'none' }}>
                        Submit for Verification
                      </span>
                    </>
                  )}
                </button>
              </form>
            </div>

            {/* --------------------------------------------------------------- */}
            {/* RIGHT: COMPACT DIGITAL PASS PREVIEW (5 cols)                    */}
            {/* --------------------------------------------------------------- */}
            <div
              style={{
                backgroundColor: '#161F2C',
                border: '1px solid rgba(255, 255, 255, 0.08)',
              }}
              className="lg:col-span-5 rounded-2xl p-6 sm:p-7 relative overflow-hidden"
            >
              {/* Subtle emerald top glow */}
              <div
                style={{
                  background:
                    'radial-gradient(ellipse at 50% 0%, rgba(16, 185, 129, 0.25) 0%, transparent 70%)',
                }}
                className="absolute inset-0 pointer-events-none"
              />

              <div className="relative z-10 space-y-6">
                {/* Header Ticket Badge */}
                <div className="flex items-center justify-between border-b border-white/5 pb-4">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#10B981] shadow-sm shadow-[#10B981]" />
                    <span className="text-xs font-mono tracking-wider uppercase text-slate-300 font-semibold">
                      QARTIX MOBILITY PASS
                    </span>
                  </div>
                  <span className="text-xs font-mono text-slate-500">
                    {latestRequest?.id || 'DIGITAL PASS'}
                  </span>
                </div>

                {/* Only Essential Ticket Fields */}
                <div className="space-y-4">
                  {/* Field 1: Student Name */}
                  <div>
                    <div className="text-xs uppercase tracking-wider text-slate-400 font-medium">
                      Student Name
                    </div>
                    <div className="text-xl font-bold text-white mt-0.5">
                      {studentName}
                    </div>
                  </div>

                  {/* Field 2: Route */}
                  <div>
                    <div className="text-xs uppercase tracking-wider text-slate-400 font-medium">
                      Route
                    </div>
                    <div className="text-sm font-semibold text-slate-200 mt-0.5">
                      {displayRoute}
                    </div>
                  </div>

                  {/* Field 3: Timings */}
                  <div>
                    <div className="text-xs uppercase tracking-wider text-slate-400 font-medium">
                      Timings
                    </div>
                    <div className="text-sm font-mono text-emerald-400 font-semibold mt-0.5">
                      {selectedSlots.join(' • ')}
                    </div>
                  </div>

                  {/* Field 4: Duration */}
                  <div>
                    <div className="text-xs uppercase tracking-wider text-slate-400 font-medium">
                      Duration
                    </div>
                    <div className="text-sm font-semibold text-slate-200 mt-0.5">
                      {durationObj.label}
                    </div>
                  </div>

                  {/* Field 5: Pass Status */}
                  <div className="pt-2 border-t border-white/5">
                    <div className="text-xs uppercase tracking-wider text-slate-400 font-medium mb-1.5">
                      Pass Status
                    </div>
                    <div
                      style={{
                        backgroundColor:
                          previewStatusText === 'ACTIVE'
                            ? 'rgba(16, 185, 129, 0.15)'
                            : previewStatusText.includes('SUBMITTED')
                            ? 'rgba(16, 185, 129, 0.1)'
                            : 'rgba(255, 255, 255, 0.05)',
                        color:
                          previewStatusText === 'ACTIVE' ||
                          previewStatusText.includes('SUBMITTED')
                            ? '#10B981'
                            : '#94A3B8',
                        border: `1px solid ${
                          previewStatusText === 'ACTIVE' ||
                          previewStatusText.includes('SUBMITTED')
                            ? 'rgba(16, 185, 129, 0.3)'
                            : 'rgba(255, 255, 255, 0.08)'
                        }`,
                      }}
                      className="px-3 py-2 rounded-xl text-center text-xs font-bold tracking-wide"
                    >
                      {previewStatusText}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      )}

      {/* --------------------------------------------------------------------- */}
      {/* EXTRA RIDE REQUEST MODAL                                             */}
      {/* --------------------------------------------------------------------- */}
      {extraRideModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            style={{
              backgroundColor: '#161F2C',
              border: '1px solid rgba(255, 255, 255, 0.12)',
            }}
            className="rounded-2xl max-w-md w-full p-6 space-y-5"
          >
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
              <h3 className="text-base font-bold text-white">
                Request Extra Ride
              </h3>
              <button
                type="button"
                onClick={() => setExtraRideModalOpen(false)}
                className="text-slate-400 hover:text-white text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleConfirmExtraRide} className="space-y-4">
              <div>
                <label className="text-xs uppercase tracking-wider text-slate-400 font-semibold block mb-1.5">
                  Pickup Location
                </label>
                <input
                  type="text"
                  value={extraPickup}
                  onChange={(e) => setExtraPickup(e.target.value)}
                  style={{
                    backgroundColor: '#0B1117',
                    borderColor: 'rgba(255, 255, 255, 0.08)',
                  }}
                  className="w-full px-4 py-2 rounded-xl border text-sm text-white focus:outline-none focus:border-[#10B981]"
                />
              </div>

              <div>
                <label className="text-xs uppercase tracking-wider text-slate-400 font-semibold block mb-1.5">
                  Destination
                </label>
                <select
                  value={extraDrop}
                  onChange={(e) => setExtraDrop(e.target.value)}
                  style={{
                    backgroundColor: '#0B1117',
                    borderColor: 'rgba(255, 255, 255, 0.08)',
                  }}
                  className="w-full px-4 py-2 rounded-xl border text-sm text-white focus:outline-none focus:border-[#10B981]"
                >
                  {ACADEMIC_BLOCKS.map((b) => (
                    <option key={b} value={b} className="bg-[#0B1117]">
                      {b}
                    </option>
                  ))}
                </select>
              </div>

              {extraError && (
                <p className="text-xs text-red-400 font-medium">{extraError}</p>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setExtraRideModalOpen(false)}
                  style={{
                    backgroundColor: '#0B1117',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                  }}
                  className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-slate-300 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingExtra}
                  style={{ backgroundColor: '#10B981' }}
                  className="flex-1 py-2.5 rounded-xl text-xs font-bold text-white hover:bg-[#059669] transition-all disabled:opacity-50"
                >
                  {isSubmittingExtra ? 'Requesting...' : 'Confirm Extra Ride'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
