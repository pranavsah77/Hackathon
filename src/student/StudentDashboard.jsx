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

const DURATIONS = [
  { id: '2w', label: '2 Weeks', days: 14 },
  { id: '1m', label: '1 Month', days: 30 },
  { id: 'sem', label: 'Full Semester', days: 120 },
];

const ACADEMIC_BLOCKS = [
  'Academic Block B',
  'Engineering Core (Hall 4)',
  'Science Concourse (Lab 2)',
  'Central Academic Quad',
  'Main Library & Computing Deck',
  'Campus Health & Sports Pavilion',
];

const TIME_SLOTS = ['08:30 AM', '10:30 AM', '01:30 PM', '04:30 PM'];

export default function StudentDashboard({
  student = null,
  onReturnTo3D = () => {},
  onLogout = () => {},
}) {
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

  const studentKey =
    student?.id || student?.studentId || student?.loginIdentifier || rollNo;

  // ---------------------------------------------------------------------------
  // 1. STRICT TWO-STAGE FLOW STATE (hasSubmittedPass)
  // ---------------------------------------------------------------------------
  const [hasSubmittedPass, setHasSubmittedPass] = useState(() => {
    if (typeof window === 'undefined') return false;
    const flag = localStorage.getItem(`qartix_pass_submitted_${studentKey}`);
    return flag === 'true';
  });

  // Stage 1 Form State: Strictly 3 Form Fields
  const [reason, setReason] = useState('');
  const [uploadedFile, setUploadedFile] = useState(null);
  const [duration, setDuration] = useState('1m'); // '2w' | '1m' | 'sem'
  const [fileError, setFileError] = useState('');
  const [formError, setFormError] = useState('');
  const [isSubmittingPass, setIsSubmittingPass] = useState(false);
  const fileInputRef = useRef(null);

  // Stage 2 Dashboard State
  const [activeTab, setActiveTab] = useState('rides'); // 'rides' | 'pass'
  const [requestsList, setRequestsList] = useState([]);
  const [routeType, setRouteType] = useState('hostel_class');
  const [academicBlock, setAcademicBlock] = useState(ACADEMIC_BLOCKS[0]);
  const [selectedSlots, setSelectedSlots] = useState(['08:30 AM', '04:30 PM']);
  const [medicalCondition, setMedicalCondition] = useState('Leg/Ankle Fracture');

  const pickupLocation =
    routeType === 'hostel_class'
      ? student?.hostel || 'Hostel Gate'
      : 'Main Campus Gate';
  const displayRoute = `${pickupLocation} → ${academicBlock}`;
  const durationObj = DURATIONS.find((d) => d.id === duration) || DURATIONS[1];

  // Fetch real pass requests
  const loadPassRequests = async () => {
    try {
      const data = await fetchPassRequests(student?.id);
      if (data && data.length > 0) {
        setRequestsList(data);
      }
    } catch (err) {
      console.warn('Could not fetch pass requests:', err);
    }
  };

  useEffect(() => {
    loadPassRequests();

    const passChannel = supabase
      .channel('student-pass-stage-sync')
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
  }, [student?.id, studentKey]);

  const activePass = requestsList.find(
    (r) => r.status === 'approved' || r.status === 'active'
  );
  const pendingPass = requestsList.find((r) => r.status === 'pending');
  const latestRequest = activePass || pendingPass || requestsList[0] || null;

  // ---------------------------------------------------------------------------
  // 2. TODAY'S SCHEDULE & RIDES STATE (Stage 2)
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
    if (hasSubmittedPass) {
      loadTodayRides();

      const ridesChannel = supabase
        .channel('student-rides-live-stage')
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
    }
  }, [hasSubmittedPass, student?.id]);

  const handleSkipRide = async (rideId) => {
    const target = rides.find((r) => r.id === rideId);
    if (!target || target.raw_status === 'completed') return;

    const previousState = [...rides];
    const newSkippedState = !target.skipped;

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
      setRides(previousState);
      alert(err.message || 'Unable to skip ride at this time.');
    }
  };

  // Extra Ride Modal
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
  // 3. FILE SELECTION & VALIDATION
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // 4. SUBMIT PASS APPLICATION (Transitions Stage 1 -> Stage 2)
  // ---------------------------------------------------------------------------
  const handleSubmitPass = async (e) => {
    if (e) e.preventDefault();
    if (isSubmittingPass) return;

    if (!reason.trim()) {
      setFormError('Please describe your injury or medical condition.');
      return;
    }

    if (!uploadedFile) {
      setFormError('Please upload your medical certificate or clinic slip.');
      return;
    }

    if (!duration) {
      setFormError('Please select your requested pass duration.');
      return;
    }

    setIsSubmittingPass(true);
    setFormError('');

    try {
      const result = await submitPassRequest({
        studentProfile: student || { id: studentKey, fullName: studentName },
        pickup: pickupLocation,
        drop: academicBlock,
        route: displayRoute,
        timeSlots: selectedSlots,
        duration: durationObj.label,
        medicalCondition: 'Medical Need',
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

      // Save persistent flag to localStorage per student
      try {
        localStorage.setItem(`qartix_pass_submitted_${studentKey}`, 'true');
        const stored = localStorage.getItem('qartix_pass_requests');
        const list = stored ? JSON.parse(stored) : [];
        localStorage.setItem(
          'qartix_pass_requests',
          JSON.stringify([newRecord, ...list])
        );
      } catch (storageErr) {
        console.warn('LocalStorage save notice:', storageErr);
      }

      // Smooth transition into Stage 2
      setHasSubmittedPass(true);
    } catch (err) {
      setFormError(err.message || 'Failed to submit pass request. Please try again.');
    } finally {
      setIsSubmittingPass(false);
    }
  };

  // ===========================================================================
  // STAGE 1: ONLY FOCUSED PASS APPLICATION (When !hasSubmittedPass)
  // ===========================================================================
  if (!hasSubmittedPass) {
    return (
      <div
        style={{
          minHeight: '100vh',
          backgroundColor: '#090C10',
          color: '#F0F6FC',
          fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
        }}
        className="flex flex-col justify-between pb-12"
      >
        {/* Minimal Top Navigation Bar (Stage 1 Only) */}
        <header
          style={{
            borderBottom: '1px solid #1E2631',
            backgroundColor: '#090C10',
          }}
          className="w-full px-6 py-4 flex items-center justify-between"
        >
          <div className="text-sm font-semibold tracking-wider text-[#F0F6FC]">
            QARTIX
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="text-[#8B949E]">{studentName}</span>
            <span className="text-[#1E2631]">•</span>
            <button
              type="button"
              onClick={onLogout}
              className="text-[#8B949E] hover:text-[#F0F6FC] transition-colors"
            >
              Log Out
            </button>
          </div>
        </header>

        {/* Centered Application Card */}
        <main className="flex-1 max-w-lg w-full mx-auto mt-14 px-4">
          <div
            style={{
              backgroundColor: '#11161D',
              border: '1px solid #1E2631',
            }}
            className="rounded-xl p-6 sm:p-8 space-y-6 shadow-sm"
          >
            {/* Header (Left-aligned, clean) */}
            <div>
              <h1 className="text-2xl font-semibold text-[#F0F6FC] tracking-tight">
                Monthly Pass Verification
              </h1>
              <p className="text-sm text-[#8B949E] mt-1.5 leading-relaxed">
                Monthly Pass Application — Provide your medical details to activate your campus cart pass.
              </p>
            </div>

            {/* Strictly 3 Form Fields */}
            <form onSubmit={handleSubmitPass} className="space-y-6">
              {/* Field 1: Medical Reason */}
              <div>
                <label className="block text-[13px] font-medium text-[#8B949E] mb-2">
                  Medical Reason
                </label>
                <textarea
                  name="reason"
                  rows={3}
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                    if (formError) setFormError('');
                  }}
                  placeholder="Describe your injury or medical condition (e.g., ankle fracture, post-surgery recovery)..."
                  style={{
                    backgroundColor: '#090C10',
                    border: '1px solid #1E2631',
                  }}
                  className="w-full rounded-lg p-3 text-sm text-[#F0F6FC] placeholder-[#8B949E]/50 focus:border-[#10B981] focus:outline-none transition-colors"
                />
              </div>

              {/* Field 2: Medical Certificate */}
              <div>
                <label className="block text-[13px] font-medium text-[#8B949E] mb-2">
                  Medical Certificate
                </label>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    backgroundColor: '#090C10',
                    border: uploadedFile
                      ? '1px solid #10B981'
                      : '1px dashed #2D3748',
                  }}
                  className="rounded-lg p-5 text-center cursor-pointer hover:border-[#10B981] transition-colors"
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
                    <div className="flex items-center justify-between text-left">
                      <div className="truncate pr-3">
                        <div className="text-sm font-medium text-[#F0F6FC] truncate">
                          {uploadedFile.name}
                        </div>
                        <div className="text-xs text-[#8B949E] mt-0.5">
                          {(uploadedFile.size / 1024).toFixed(1)} KB
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setUploadedFile(null);
                          if (fileInputRef.current) fileInputRef.current.value = '';
                        }}
                        className="text-xs text-red-400 hover:text-red-300 font-medium px-2 py-1 rounded bg-red-500/10 hover:bg-red-500/20 transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <div className="text-sm text-[#8B949E]">
                      <span className="text-[#F0F6FC] font-medium">Upload Document</span> or drag & drop
                      <div className="text-xs text-[#8B949E]/70 mt-1">
                        PDF, JPG, or PNG (max 5 MB)
                      </div>
                    </div>
                  )}
                </div>
                {fileError && (
                  <p className="text-xs text-red-400 font-medium mt-1.5">{fileError}</p>
                )}
              </div>

              {/* Field 3: Pass Duration */}
              <div>
                <label className="block text-[13px] font-medium text-[#8B949E] mb-2">
                  Pass Duration
                </label>
                <div className="grid grid-cols-3 gap-3">
                  {DURATIONS.map((d) => {
                    const isSelected = duration === d.id;
                    return (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => setDuration(d.id)}
                        style={{
                          backgroundColor: isSelected
                            ? 'rgba(16, 185, 129, 0.1)'
                            : '#090C10',
                          borderColor: isSelected ? '#10B981' : '#1E2631',
                          color: isSelected ? '#F0F6FC' : '#8B949E',
                        }}
                        className="py-2.5 px-3 rounded-lg border text-xs font-medium transition-all text-center hover:border-[#2D3748]"
                      >
                        {d.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {formError && (
                <p className="text-xs text-red-400 font-medium">{formError}</p>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={
                  !reason.trim() || !uploadedFile || !duration || isSubmittingPass
                }
                style={{
                  backgroundColor: '#10B981',
                }}
                className="w-full h-11 rounded-lg font-medium text-white hover:bg-[#059669] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {isSubmittingPass ? (
                  <span>Submitting...</span>
                ) : (
                  <>
                    <span>Submit & Continue</span>
                    <span style={{ display: 'none' }}>
                      Submit for Verification
                    </span>
                  </>
                )}
              </button>
            </form>
          </div>
        </main>
      </div>
    );
  }

  // ===========================================================================
  // STAGE 2: CLEAN STUDENT DASHBOARD (When hasSubmittedPass === true)
  // ===========================================================================
  const previewStatusText =
    latestRequest?.status === 'approved' || latestRequest?.status === 'active'
      ? 'ACTIVE'
      : 'PENDING';

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#090C10',
        color: '#F0F6FC',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      }}
      className="pb-20"
    >
      {/* Top Header */}
      <header
        style={{
          backgroundColor: '#090C10',
          borderBottom: '1px solid #1E2631',
        }}
        className="sticky top-0 z-40 px-6 sm:px-10 py-5"
      >
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-[#F0F6FC] tracking-tight">
              Hi, {studentName}
            </h1>
            <p className="text-xs sm:text-sm text-[#8B949E] mt-1">
              {rollNo} • {residency}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onReturnTo3D}
              style={{
                backgroundColor: '#11161D',
                border: '1px solid #1E2631',
              }}
              className="px-3.5 py-2 text-xs sm:text-sm font-medium text-[#8B949E] hover:text-[#F0F6FC] hover:bg-[#1E2631] rounded-lg transition-colors flex items-center gap-2"
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
              onClick={() => {
                try {
                  localStorage.removeItem(`qartix_pass_submitted_${studentKey}`);
                } catch (e) {}
                setHasSubmittedPass(false);
              }}
              style={{
                backgroundColor: '#11161D',
                border: '1px solid #1E2631',
              }}
              className="px-3.5 py-2 text-xs sm:text-sm font-medium text-[#8B949E] hover:text-[#10B981] rounded-lg transition-colors"
              title="Return to Stage 1 Application"
            >
              Re-apply Pass
            </button>

            <button
              type="button"
              onClick={onLogout}
              style={{
                backgroundColor: '#11161D',
                border: '1px solid #1E2631',
              }}
              className="px-3.5 py-2 text-xs sm:text-sm font-medium text-[#8B949E] hover:text-red-400 rounded-lg transition-colors"
            >
              Log Out
            </button>
          </div>
        </div>
      </header>

      {/* 2-Tab Layout Switcher */}
      <div className="max-w-6xl mx-auto px-6 sm:px-10 mt-8 mb-8">
        <div className="flex justify-center">
          <div
            style={{
              backgroundColor: '#11161D',
              border: '1px solid #1E2631',
            }}
            className="inline-flex p-1 rounded-xl"
          >
            <button
              type="button"
              onClick={() => setActiveTab('rides')}
              className={`px-6 py-2 rounded-lg text-sm font-semibold transition-all ${
                activeTab === 'rides'
                  ? 'bg-[#10B981] text-white shadow-sm'
                  : 'text-[#8B949E] hover:text-[#F0F6FC]'
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
                  : 'text-[#8B949E] hover:text-[#F0F6FC]'
              }`}
            >
              Monthly Pass
            </button>
          </div>
        </div>
      </div>

      {/* Tab 1: My Rides */}
      {activeTab === 'rides' && (
        <main className="max-w-3xl mx-auto px-6">
          {/* Active Pass Strip */}
          <div
            style={{
              backgroundColor: '#11161D',
              border: '1px solid #1E2631',
            }}
            className="rounded-xl p-5 mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
          >
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-wider font-semibold text-[#8B949E]">
                Active Route
              </div>
              <div className="text-base font-medium text-[#F0F6FC] flex items-center gap-2">
                <span>
                  {activePass?.route ||
                    latestRequest?.route ||
                    'Hostel → Academic Block'}
                </span>
                <span className="text-[#8B949E]">•</span>
                <span className="text-sm font-mono text-[#10B981]">
                  CART-04
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {activePass ? (
                <span
                  style={{
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    color: '#10B981',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                  }}
                  className="px-3 py-1 rounded-full text-xs font-bold tracking-wide"
                >
                  ACTIVE
                </span>
              ) : (
                <span
                  style={{
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                    color: '#F59E0B',
                    border: '1px solid rgba(245, 158, 11, 0.3)',
                  }}
                  className="px-3 py-1 rounded-full text-xs font-bold tracking-wide"
                >
                  PENDING REVIEW
                </span>
              )}
            </div>
          </div>

          {/* Today's Schedule */}
          <div className="mb-6">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#8B949E] mb-4">
              Today's Schedule
            </h2>

            <div className="space-y-3">
              {rides.map((ride) => (
                <div
                  key={ride.id}
                  style={{
                    backgroundColor: '#11161D',
                    border: '1px solid #1E2631',
                    opacity: ride.skipped ? 0.45 : 1,
                  }}
                  className="rounded-xl px-5 py-4 flex items-center justify-between gap-4 transition-all"
                >
                  <div
                    className={`font-mono text-base font-semibold min-w-[90px] ${
                      ride.skipped
                        ? 'line-through text-[#8B949E]'
                        : 'text-[#F0F6FC]'
                    }`}
                  >
                    {ride.time}
                  </div>

                  <div
                    className={`flex-1 text-sm font-medium ${
                      ride.skipped ? 'text-[#8B949E]' : 'text-[#F0F6FC]'
                    }`}
                  >
                    {ride.route}
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={ride.skipped}
                    onClick={() => handleSkipRide(ride.id)}
                    disabled={ride.raw_status === 'completed'}
                    style={{
                      backgroundColor: ride.skipped
                        ? 'rgba(245, 158, 11, 0.1)'
                        : '#090C10',
                      borderColor: ride.skipped
                        ? 'rgba(245, 158, 11, 0.3)'
                        : '#1E2631',
                    }}
                    className={`inline-flex items-center gap-2.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                      ride.skipped
                        ? 'text-amber-400'
                        : 'text-[#8B949E] hover:text-[#F0F6FC]'
                    }`}
                  >
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

          <div className="mt-8 flex justify-center">
            <button
              type="button"
              onClick={() => setExtraRideModalOpen(true)}
              style={{
                backgroundColor: 'transparent',
                border: '1px solid #1E2631',
              }}
              className="px-6 py-2.5 rounded-xl text-sm font-medium text-[#8B949E] hover:text-[#10B981] hover:border-[#10B981]/50 transition-colors flex items-center gap-2"
            >
              <span className="text-[#10B981] font-semibold text-base leading-none">
                +
              </span>
              <span>Request Extra Ride</span>
            </button>
          </div>
        </main>
      )}

      {/* Tab 2: Monthly Pass */}
      {activeTab === 'pass' && (
        <main className="max-w-5xl mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Left: Summary Card */}
            <div
              style={{
                backgroundColor: '#11161D',
                border: '1px solid #1E2631',
              }}
              className="lg:col-span-7 rounded-xl p-6 sm:p-8 space-y-6"
            >
              <div>
                <h2 className="text-xl font-semibold text-[#F0F6FC]">
                  Pass Verification Details
                </h2>
                <p className="text-sm text-[#8B949E] mt-1">
                  Your mobility application has been filed with the Transport Office.
                </p>
              </div>

              <div className="space-y-4 text-sm">
                <div className="flex justify-between py-2 border-b border-[#1E2631]">
                  <span className="text-[#8B949E]">Assigned Route</span>
                  <span className="text-[#F0F6FC] font-medium">{displayRoute}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-[#1E2631]">
                  <span className="text-[#8B949E]">Selected Timings</span>
                  <span className="font-mono text-[#10B981]">
                    {selectedSlots.join(' • ')}
                  </span>
                </div>
                <div className="flex justify-between py-2 border-b border-[#1E2631]">
                  <span className="text-[#8B949E]">Duration</span>
                  <span className="text-[#F0F6FC] font-medium">{durationObj.label}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-[#1E2631]">
                  <span className="text-[#8B949E]">Status</span>
                  <span className="text-[#10B981] font-semibold">
                    {previewStatusText}
                  </span>
                </div>
              </div>
            </div>

            {/* Right: Digital Pass Ticket */}
            <div
              style={{
                backgroundColor: '#11161D',
                border: '1px solid #1E2631',
              }}
              className="lg:col-span-5 rounded-xl p-6 sm:p-7 space-y-6"
            >
              <div className="flex items-center justify-between border-b border-[#1E2631] pb-4">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#10B981]" />
                  <span className="text-xs font-mono tracking-wider uppercase text-[#F0F6FC] font-semibold">
                    QARTIX MOBILITY PASS
                  </span>
                </div>
                <span className="text-xs font-mono text-[#8B949E]">
                  {latestRequest?.id || 'DIGITAL PASS'}
                </span>
              </div>

              <div className="space-y-4">
                <div>
                  <div className="text-xs uppercase tracking-wider text-[#8B949E] font-medium">
                    Student Name
                  </div>
                  <div className="text-xl font-bold text-[#F0F6FC] mt-0.5">
                    {studentName}
                  </div>
                </div>

                <div>
                  <div className="text-xs uppercase tracking-wider text-[#8B949E] font-medium">
                    Route
                  </div>
                  <div className="text-sm font-semibold text-[#F0F6FC] mt-0.5">
                    {displayRoute}
                  </div>
                </div>

                <div>
                  <div className="text-xs uppercase tracking-wider text-[#8B949E] font-medium">
                    Timings
                  </div>
                  <div className="text-sm font-mono text-[#10B981] font-semibold mt-0.5">
                    {selectedSlots.join(' • ')}
                  </div>
                </div>

                <div>
                  <div className="text-xs uppercase tracking-wider text-[#8B949E] font-medium">
                    Duration
                  </div>
                  <div className="text-sm font-semibold text-[#F0F6FC] mt-0.5">
                    {durationObj.label}
                  </div>
                </div>

                <div className="pt-2 border-t border-[#1E2631]">
                  <div className="text-xs uppercase tracking-wider text-[#8B949E] font-medium mb-1.5">
                    Pass Status
                  </div>
                  <div
                    style={{
                      backgroundColor: 'rgba(16, 185, 129, 0.1)',
                      color: '#10B981',
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                    }}
                    className="px-3 py-2 rounded-lg text-center text-xs font-bold tracking-wide"
                  >
                    {previewStatusText}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      )}

      {/* Extra Ride Modal */}
      {extraRideModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            style={{
              backgroundColor: '#11161D',
              border: '1px solid #1E2631',
            }}
            className="rounded-xl max-w-md w-full p-6 space-y-5"
          >
            <div className="flex items-center justify-between border-b border-[#1E2631] pb-3">
              <h3 className="text-base font-bold text-[#F0F6FC]">
                Request Extra Ride
              </h3>
              <button
                type="button"
                onClick={() => setExtraRideModalOpen(false)}
                className="text-[#8B949E] hover:text-[#F0F6FC] text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleConfirmExtraRide} className="space-y-4">
              <div>
                <label className="text-xs uppercase tracking-wider text-[#8B949E] font-semibold block mb-1.5">
                  Pickup Location
                </label>
                <input
                  type="text"
                  value={extraPickup}
                  onChange={(e) => setExtraPickup(e.target.value)}
                  style={{
                    backgroundColor: '#090C10',
                    border: '1px solid #1E2631',
                  }}
                  className="w-full px-4 py-2 rounded-lg text-sm text-[#F0F6FC] focus:outline-none focus:border-[#10B981]"
                />
              </div>

              <div>
                <label className="text-xs uppercase tracking-wider text-[#8B949E] font-semibold block mb-1.5">
                  Destination
                </label>
                <select
                  value={extraDrop}
                  onChange={(e) => setExtraDrop(e.target.value)}
                  style={{
                    backgroundColor: '#090C10',
                    border: '1px solid #1E2631',
                  }}
                  className="w-full px-4 py-2 rounded-lg text-sm text-[#F0F6FC] focus:outline-none focus:border-[#10B981]"
                >
                  {ACADEMIC_BLOCKS.map((b) => (
                    <option key={b} value={b} className="bg-[#090C10]">
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
                    backgroundColor: '#090C10',
                    border: '1px solid #1E2631',
                  }}
                  className="flex-1 py-2.5 rounded-lg text-xs font-semibold text-[#8B949E] hover:text-[#F0F6FC] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingExtra}
                  style={{ backgroundColor: '#10B981' }}
                  className="flex-1 py-2.5 rounded-lg text-xs font-bold text-white hover:bg-[#059669] transition-all disabled:opacity-50"
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
