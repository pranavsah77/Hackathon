import React, { useState, useEffect } from 'react';

/**
 * Sample Initial Driver Queue
 * Modern EV cockpit shift queue with scheduled pickups and student priority requests.
 */
const INITIAL_QUEUE = [
  {
    id: 'ride-101',
    time: '08:45 AM',
    from: 'Main Gate',
    to: 'Academic Block B',
    pickupBadge: 'PICKUP IN 5 MIN',
    studentName: 'Ananya Sharma',
    studentId: 'STU-88219',
    hostel: 'Block B - Maple Hall',
    phone: '+91 98450 12345',
    status: 'Waiting', // 'Waiting' | 'Completed' | 'Skipped by Student'
  },
  {
    id: 'ride-102',
    time: '09:15 AM',
    from: 'Hostel Block C',
    to: 'Engineering Core',
    pickupBadge: 'PICKUP IN 12 MIN',
    studentName: 'Rohan Verma',
    studentId: 'STU-84920',
    hostel: 'Block C - Oak Hall',
    phone: '+91 98210 56789',
    status: 'Waiting',
  },
  {
    id: 'ride-103',
    time: '09:45 AM',
    from: 'Central Quad',
    to: 'Science Lab Concourse',
    pickupBadge: 'PICKUP IN 25 MIN',
    studentName: 'Priya Iyer',
    studentId: 'STU-91044',
    hostel: 'Block A - Pine Hall',
    phone: '+91 97110 33445',
    status: 'Skipped by Student', // Demonstrates student-skipped sync
  },
  {
    id: 'ride-104',
    time: '10:15 AM',
    from: 'Science Lab Concourse',
    to: 'Main Library & Computing',
    pickupBadge: 'PICKUP IN 38 MIN',
    studentName: 'Kabir Mehta',
    studentId: 'STU-87312',
    hostel: 'Block B - Maple Hall',
    phone: '+91 99880 77665',
    status: 'Waiting',
  },
  {
    id: 'ride-105',
    time: '10:45 AM',
    from: 'Main Library',
    to: 'Campus Health Clinic',
    pickupBadge: 'PICKUP IN 52 MIN',
    studentName: 'Aarav Patel',
    studentId: 'STU-93210',
    hostel: 'Block A - Pine Hall',
    phone: '+91 98765 43210',
    status: 'Waiting',
  },
];

/**
 * DriverInterface Component
 * Modern EV Cockpit Dashboard (Uber Driver / Tesla EV Aesthetic)
 * Glare-free, high-contrast, driver-first ergonomics.
 */
export default function DriverInterface({
  driver = { cartNumber: 'CART-04', fullName: 'Vikram Singh', id: 'DRV-402' },
  onLogout = () => {},
}) {
  // Navigation & Fleet Status
  const [activeTab, setActiveTab] = useState('active'); // 'active' | 'queue'
  const [isOnline, setIsOnline] = useState(true);

  // Responsive Screen Width Detection (>= 1024px is desktop/laptop 2-column layout)
  const [isDesktop, setIsDesktop] = useState(
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  );

  useEffect(() => {
    const handleResize = () => {
      setIsDesktop(window.innerWidth >= 1024);
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Queue State
  const [queue, setQueue] = useState(INITIAL_QUEUE);
  const [activeRideIndex, setActiveRideIndex] = useState(0);

  // 3-State Sequential Ride Action:
  // 1: 'I HAVE ARRIVED' (#38BDF8 Sky Blue)
  // 2: 'STUDENT ON BOARD — START RIDE' (#10B981 Electric Emerald)
  // 3: 'COMPLETE RIDE' (#34D399 Bright Emerald)
  const [rideStep, setRideStep] = useState(1);

  // Card slide animation state: 'idle' | 'exiting' | 'entering'
  const [cardAnimation, setCardAnimation] = useState('idle');

  // Phone Call Simulation Toast
  const [callToast, setCallToast] = useState(null);

  // Auto-dismiss phone call toast after 5 seconds
  useEffect(() => {
    if (!callToast) return;
    const timer = setTimeout(() => {
      setCallToast(null);
    }, 5000);
    return () => clearTimeout(timer);
  }, [callToast]);

  // Current Ride
  const currentRide = queue[activeRideIndex] || null;
  const isQueueFinished = !currentRide || activeRideIndex >= queue.length;
  const waitingRidesCount = queue.filter((q) => q.status === 'Waiting').length;

  // Handle Cycling Through the 3 Ride States
  const handleSequentialAction = () => {
    if (!isOnline || isQueueFinished) return;

    if (rideStep === 1) {
      // 'I HAVE ARRIVED' -> 'STUDENT ON BOARD — START RIDE'
      setRideStep(2);
    } else if (rideStep === 2) {
      // 'STUDENT ON BOARD — START RIDE' -> 'COMPLETE RIDE'
      setRideStep(3);
    } else if (rideStep === 3) {
      // 'COMPLETE RIDE' -> Mark finished & advance
      setCardAnimation('exiting');

      setTimeout(() => {
        setQueue((prevQueue) =>
          prevQueue.map((item, idx) =>
            idx === activeRideIndex ? { ...item, status: 'Completed' } : item
          )
        );

        let nextIndex = activeRideIndex + 1;
        while (nextIndex < queue.length && queue[nextIndex].status === 'Skipped by Student') {
          nextIndex++;
        }

        setActiveRideIndex(nextIndex);
        setRideStep(1);
        setCardAnimation('entering');

        setTimeout(() => {
          setCardAnimation('idle');
        }, 50);
      }, 300);
    }
  };

  // Trigger Phone Call Toast
  const handleCallStudent = (student) => {
    setCallToast({
      name: student.studentName,
      phone: student.phone,
      id: student.studentId,
    });
  };

  // Reset Demo Queue
  const handleResetQueue = () => {
    setQueue(INITIAL_QUEUE);
    setActiveRideIndex(0);
    setRideStep(1);
    setCardAnimation('idle');
  };

  // Format Cart Display Name (e.g. "CART-04")
  const cartLabel = (driver.cartNumber || 'CART-04').toUpperCase();

  // Shared Action Button Renderer (Inline on Desktop, Sticky on Mobile)
  const renderActionButton = (isStickyMobile = false) => {
    let buttonBg = '#10B981';
    let buttonTextColor = '#052E16';
    let buttonLabel = 'I HAVE ARRIVED';
    let glowShadow = '0 8px 24px rgba(56, 189, 248, 0.35)';

    if (!isOnline) {
      buttonBg = '#1E293B';
      buttonTextColor = '#94A3B8';
      buttonLabel = 'GO ONLINE TO PROCEED';
      glowShadow = 'none';
    } else if (isQueueFinished) {
      buttonBg = '#1E293B';
      buttonTextColor = '#94A3B8';
      buttonLabel = 'ALL RIDES COMPLETED';
      glowShadow = 'none';
    } else if (rideStep === 1) {
      buttonBg = '#38BDF8'; // Sky Blue
      buttonTextColor = '#082F49';
      buttonLabel = 'I HAVE ARRIVED';
      glowShadow = '0 8px 24px rgba(56, 189, 248, 0.35)';
    } else if (rideStep === 2) {
      buttonBg = '#10B981'; // Electric Emerald
      buttonTextColor = '#052E16';
      buttonLabel = 'STUDENT ON BOARD — START RIDE';
      glowShadow = '0 8px 24px rgba(16, 185, 129, 0.35)';
    } else if (rideStep === 3) {
      buttonBg = '#34D399'; // Bright Emerald
      buttonTextColor = '#052E16';
      buttonLabel = 'COMPLETE RIDE';
      glowShadow = '0 8px 24px rgba(52, 211, 153, 0.4)';
    }

    return (
      <button
        type="button"
        disabled={!isOnline || isQueueFinished}
        onClick={handleSequentialAction}
        style={{
          width: '100%',
          height: '64px',
          minHeight: '64px',
          backgroundColor: buttonBg,
          color: buttonTextColor,
          border: 'none',
          borderRadius: '16px',
          boxShadow: glowShadow,
          fontSize: '17px',
          fontWeight: 900,
          letterSpacing: '0.04em',
          cursor: !isOnline || isQueueFinished ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        onMouseDown={(e) => {
          if (isOnline && !isQueueFinished) e.currentTarget.style.transform = 'scale(0.985)';
        }}
        onMouseUp={(e) => {
          if (isOnline && !isQueueFinished) e.currentTarget.style.transform = 'scale(1)';
        }}
      >
        {/* Step Icons */}
        {rideStep === 1 && isOnline && !isQueueFinished && (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
        )}
        {rideStep === 2 && isOnline && !isQueueFinished && (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        )}
        {rideStep === 3 && isOnline && !isQueueFinished && (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}

        <span>{buttonLabel}</span>
      </button>
    );
  };

  // Shared Queue List Component
  const renderQueueList = () => (
    <div
      style={{
        backgroundColor: '#161F2C',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '20px',
        padding: '24px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.35)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          paddingBottom: '14px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: '#10B981',
              boxShadow: '0 0 8px #10B981',
            }}
          />
          <span
            style={{
              fontFamily: '"IBM Plex Mono", monospace',
              fontSize: '12px',
              fontWeight: 800,
              letterSpacing: '0.12em',
              color: '#FFFFFF',
              textTransform: 'uppercase',
            }}
          >
            TODAY'S SHIFT QUEUE
          </span>
        </div>

        <div
          style={{
            padding: '4px 10px',
            backgroundColor: 'rgba(16, 185, 129, 0.15)',
            color: '#34D399',
            borderRadius: '9999px',
            fontSize: '11px',
            fontFamily: 'monospace',
            fontWeight: 800,
            border: '1px solid rgba(16, 185, 129, 0.3)',
          }}
        >
          {waitingRidesCount} WAITING
        </div>
      </div>

      {/* Queue Items */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {queue.map((item, index) => {
          const isActive = index === activeRideIndex && item.status === 'Waiting';
          const isCompleted = item.status === 'Completed';
          const isSkipped = item.status === 'Skipped by Student';

          return (
            <div
              key={item.id}
              style={{
                backgroundColor: isActive
                  ? 'rgba(56, 189, 248, 0.08)'
                  : isCompleted
                  ? 'rgba(16, 185, 129, 0.05)'
                  : isSkipped
                  ? 'rgba(15, 23, 42, 0.4)'
                  : '#0F172A',
                border: isActive
                  ? '1.5px solid rgba(56, 189, 248, 0.4)'
                  : isCompleted
                  ? '1px solid rgba(16, 185, 129, 0.2)'
                  : '1px solid rgba(255, 255, 255, 0.06)',
                borderRadius: '14px',
                padding: '14px 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                opacity: isSkipped ? 0.4 : 1,
                transition: 'all 0.15s ease',
              }}
            >
              {/* Time & Route Info */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flex: 1, minWidth: 0 }}>
                {/* Time */}
                <div
                  style={{
                    fontFamily: '"IBM Plex Mono", monospace',
                    fontSize: '13px',
                    fontWeight: 800,
                    color: isSkipped ? '#64748B' : '#FFFFFF',
                    minWidth: '78px',
                    textDecoration: isSkipped ? 'line-through' : 'none',
                  }}
                >
                  {item.time}
                </div>

                {/* Corridor & Student */}
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: '13px',
                      fontWeight: 700,
                      color: isSkipped ? '#64748B' : '#FFFFFF',
                      textDecoration: isSkipped ? 'line-through' : 'none',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {item.from} → {item.to}
                  </div>
                  <div style={{ fontSize: '11px', fontWeight: 500, color: '#94A3B8', marginTop: '2px' }}>
                    {item.studentName}
                  </div>
                </div>
              </div>

              {/* Status Badge */}
              <div style={{ flexShrink: 0 }}>
                {isCompleted ? (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '3px 8px',
                      borderRadius: '9999px',
                      backgroundColor: 'rgba(16, 185, 129, 0.15)',
                      color: '#34D399',
                      fontSize: '11px',
                      fontWeight: 800,
                      border: '1px solid rgba(16, 185, 129, 0.25)',
                    }}
                  >
                    ✓ Done
                  </span>
                ) : isSkipped ? (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '3px 8px',
                      borderRadius: '9999px',
                      backgroundColor: 'rgba(239, 68, 68, 0.15)',
                      color: '#F87171',
                      fontSize: '11px',
                      fontWeight: 800,
                      border: '1px solid rgba(239, 68, 68, 0.25)',
                    }}
                  >
                    Skipped
                  </span>
                ) : isActive ? (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '3px 9px',
                      borderRadius: '9999px',
                      backgroundColor: 'rgba(56, 189, 248, 0.15)',
                      color: '#38BDF8',
                      fontSize: '11px',
                      fontWeight: 800,
                      border: '1px solid rgba(56, 189, 248, 0.35)',
                    }}
                  >
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#38BDF8' }} />
                    Active
                  </span>
                ) : (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '3px 8px',
                      borderRadius: '9999px',
                      backgroundColor: 'rgba(245, 158, 11, 0.12)',
                      color: '#FBBF24',
                      fontSize: '11px',
                      fontWeight: 800,
                      border: '1px solid rgba(245, 158, 11, 0.25)',
                    }}
                  >
                    Waiting
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100%',
        backgroundColor: '#0B1117',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
        color: '#FFFFFF',
        WebkitFontSmoothing: 'antialiased',
        boxSizing: 'border-box',
      }}
    >
      {/* Keyframe Animations & Responsive Rules */}
      <style>{`
        @keyframes toastSlideDown {
          0% { transform: translateY(-100%); opacity: 0; }
          100% { transform: translateY(0); opacity: 1; }
        }
        @keyframes pulseGreen {
          0% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.85); }
          100% { opacity: 1; transform: scale(1); }
        }

        .driver-max-container {
          width: 100%;
          max-width: 1200px;
          margin: 0 auto;
          box-sizing: border-box;
          padding: 20px 16px 120px 16px;
        }

        .driver-header-content {
          width: 100%;
          display: flex;
          align-items: center;
          justifyContent: space-between;
          padding: 0 16px;
          box-sizing: border-box;
        }

        @media (min-width: 768px) {
          .driver-max-container {
            padding: 28px 32px 60px 32px;
          }
          .driver-header-content {
            padding: 0 32px;
          }
        }

        @media (min-width: 1024px) {
          .driver-max-container {
            padding: 32px 40px 60px 40px;
          }
          .driver-header-content {
            padding: 0 32px;
          }
        }
      `}</style>

      {/* ======================================================= */}
      {/* 1. TOP HEADER BAR (CLEAN & FULL-WIDTH)                  */}
      {/* ======================================================= */}
      <header
        style={{
          width: '100%',
          height: '76px',
          backgroundColor: '#101824',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          position: 'sticky',
          top: 0,
          zIndex: 40,
          display: 'flex',
          alignItems: 'center',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
        }}
      >
        <div className="driver-header-content">
          {/* Far Left: Cart ID Badge with Pulsing Live Indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexShrink: 0 }}>
            <div
              style={{
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                backgroundColor: isOnline ? '#10B981' : '#64748B',
                boxShadow: isOnline ? '0 0 12px #10B981' : 'none',
                animation: isOnline ? 'pulseGreen 2s infinite ease-in-out' : 'none',
                flexShrink: 0,
              }}
            />
            <div>
              <div
                style={{
                  fontFamily: '"IBM Plex Mono", monospace',
                  fontSize: '18px',
                  fontWeight: 900,
                  letterSpacing: '0.06em',
                  color: '#FFFFFF',
                  lineHeight: 1.1,
                }}
              >
                {cartLabel}
              </div>
              <div
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  color: '#94A3B8',
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  marginTop: '2px',
                }}
              >
                CAMPUS EV COCKPIT
              </div>
            </div>
          </div>

          {/* Far Right: Online Toggle Pill and Log Out Button Group */}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
            {/* Online Toggle Switch (Min 48px Tap Height) */}
            <button
              type="button"
              onClick={() => setIsOnline(!isOnline)}
              style={{
                minHeight: '48px',
                padding: '0 20px',
                borderRadius: '9999px',
                backgroundColor: isOnline ? '#10B981' : '#1E293B',
                color: isOnline ? '#052E16' : '#94A3B8',
                border: isOnline ? '1.5px solid #34D399' : '1px solid rgba(255, 255, 255, 0.1)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontWeight: 900,
                fontSize: '13px',
                letterSpacing: '0.06em',
                boxShadow: isOnline ? '0 0 18px rgba(16, 185, 129, 0.35)' : 'none',
                transition: 'all 0.18s ease',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: isOnline ? '#052E16' : '#64748B',
                  flexShrink: 0,
                }}
              />
              <span>{isOnline ? 'ONLINE' : 'OFFLINE'}</span>
            </button>

            {/* Log Out Button (Min 48px Tap Height) */}
            <button
              type="button"
              onClick={onLogout}
              style={{
                minHeight: '48px',
                padding: '0 16px',
                backgroundColor: '#161F2C',
                color: '#94A3B8',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '12px',
                fontSize: '12px',
                fontWeight: 800,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s ease',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#FFFFFF')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#94A3B8')}
              title="Log Out of Driver Portal"
            >
              Log Out
            </button>
          </div>
        </div>
      </header>

      {/* ======================================================= */}
      {/* CALL TOAST BANNER (TRIGGERED BY CALL BUTTON)            */}
      {/* ======================================================= */}
      {Boolean(callToast) ? (
        <div
          style={{
            backgroundColor: '#161F2C',
            color: '#FFFFFF',
            borderBottom: '2px solid #10B981',
            padding: '16px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            animation: 'toastSlideDown 0.25s ease-out',
            zIndex: 35,
            boxShadow: '0 12px 30px rgba(0, 0, 0, 0.5)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                color: '#34D399',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: '11px', fontWeight: 800, color: '#38BDF8', letterSpacing: '0.08em' }}>
                CALLING PASSENGER...
              </div>
              <div style={{ fontSize: '17px', fontWeight: 800, color: '#FFFFFF' }}>{callToast.name}</div>
              <div style={{ fontFamily: 'monospace', fontSize: '12px', color: '#94A3B8' }}>
                {callToast.phone}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setCallToast(null)}
            title="End Call"
            style={{
              minHeight: '44px',
              padding: '0 18px',
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              color: '#F87171',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '10px',
              fontSize: '12px',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            End Call
          </button>
        </div>
      ) : null}

      {/* ======================================================= */}
      {/* OFFLINE STATUS WARNING BANNER                           */}
      {/* ======================================================= */}
      {!isOnline && (
        <div
          style={{
            backgroundColor: 'rgba(245, 158, 11, 0.12)',
            color: '#FBBF24',
            padding: '12px 24px',
            borderBottom: '1px solid rgba(245, 158, 11, 0.25)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontSize: '12px',
            fontWeight: 800,
            letterSpacing: '0.04em',
            justifyContent: 'center',
          }}
        >
          <span style={{ fontSize: '16px' }}>⚠️</span>
          <span>CART OFFLINE • TELEMETRY DISCONNECTED • TAP ONLINE TO RESUME</span>
        </div>
      )}

      {/* ======================================================= */}
      {/* 2. RESPONSIVE WORKSPACE CONTAINER                      */}
      {/* ======================================================= */}
      <main className="driver-max-container">
        {/* MOBILE 2-TAB NAVIGATION (VISIBLE ONLY BELOW LG: 1024PX) */}
        {!isDesktop && (
          <nav
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              backgroundColor: '#161F2C',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '14px',
              padding: '4px',
              gap: '4px',
              marginBottom: '20px',
            }}
          >
            {/* Tab 1: Current Ride */}
            <button
              type="button"
              onClick={() => setActiveTab('active')}
              style={{
                minHeight: '48px',
                backgroundColor: activeTab === 'active' ? '#1E293B' : 'transparent',
                color: activeTab === 'active' ? '#FFFFFF' : '#94A3B8',
                border: activeTab === 'active' ? '1px solid rgba(255, 255, 255, 0.1)' : 'none',
                borderRadius: '10px',
                fontSize: '13px',
                fontWeight: 800,
                letterSpacing: '0.04em',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                transition: 'all 0.15s ease',
              }}
            >
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: activeTab === 'active' ? '#38BDF8' : '#64748B',
                }}
              />
              <span>Current Ride</span>
            </button>

            {/* Tab 2: Queue */}
            <button
              type="button"
              onClick={() => setActiveTab('queue')}
              style={{
                minHeight: '48px',
                backgroundColor: activeTab === 'queue' ? '#1E293B' : 'transparent',
                color: activeTab === 'queue' ? '#FFFFFF' : '#94A3B8',
                border: activeTab === 'queue' ? '1px solid rgba(255, 255, 255, 0.1)' : 'none',
                borderRadius: '10px',
                fontSize: '13px',
                fontWeight: 800,
                letterSpacing: '0.04em',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                transition: 'all 0.15s ease',
              }}
            >
              <span>Queue ({waitingRidesCount})</span>
            </button>
          </nav>
        )}

        {/* ---------------------------------------------------- */}
        {/* DESKTOP 2-COLUMN GRID vs MOBILE SINGLE-COLUMN VIEW   */}
        {/* ---------------------------------------------------- */}
        <div
          style={{
            display: isDesktop ? 'grid' : 'flex',
            gridTemplateColumns: isDesktop ? 'repeat(12, 1fr)' : 'none',
            flexDirection: 'column',
            gap: isDesktop ? '28px' : '20px',
            alignItems: 'start',
          }}
        >
          {/* =================================================== */}
          {/* LEFT COLUMN (lg:col-span-7): ACTIVE RIDE + ACTION  */}
          {/* =================================================== */}
          {(isDesktop || activeTab === 'active') && (
            <div
              style={{
                gridColumn: isDesktop ? 'span 7' : 'auto',
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                gap: '20px',
              }}
            >
              {isQueueFinished ? (
                /* All Rides Completed Screen */
                <div
                  style={{
                    backgroundColor: '#161F2C',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '20px',
                    padding: '48px 32px',
                    textAlign: 'center',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '20px',
                    boxShadow: '0 16px 40px rgba(0, 0, 0, 0.35)',
                  }}
                >
                  <div
                    style={{
                      width: '64px',
                      height: '64px',
                      borderRadius: '50%',
                      backgroundColor: 'rgba(16, 185, 129, 0.15)',
                      color: '#34D399',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '1.5px solid rgba(16, 185, 129, 0.35)',
                    }}
                  >
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>

                  <div>
                    <div
                      style={{
                        fontFamily: '"IBM Plex Mono", monospace',
                        fontSize: '11px',
                        fontWeight: 800,
                        letterSpacing: '0.14em',
                        color: '#10B981',
                        textTransform: 'uppercase',
                      }}
                    >
                      ALL RIDES COMPLETED
                    </div>
                    <h2 style={{ fontSize: '26px', fontWeight: 900, margin: '8px 0 0 0', color: '#FFFFFF' }}>
                      Shift Queue Fully Clear
                    </h2>
                    <p style={{ fontSize: '14px', color: '#94A3B8', marginTop: '6px' }}>
                      All student priority mobility requests for this shift have been fulfilled.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleResetQueue}
                    style={{
                      minHeight: '52px',
                      width: '100%',
                      maxWidth: '320px',
                      backgroundColor: '#10B981',
                      color: '#052E16',
                      border: 'none',
                      borderRadius: '14px',
                      fontWeight: 900,
                      fontSize: '14px',
                      letterSpacing: '0.04em',
                      cursor: 'pointer',
                      marginTop: '6px',
                      boxShadow: '0 6px 20px rgba(16, 185, 129, 0.3)',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    RELOAD DEMO QUEUE
                  </button>
                </div>
              ) : (
                /* Driver-Friendly Active Ride Card (Charcoal Elevated) */
                <div
                  style={{
                    backgroundColor: '#161F2C',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '20px',
                    padding: '28px 24px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '24px',
                    boxShadow: '0 16px 40px rgba(0, 0, 0, 0.4)',
                    transform:
                      cardAnimation === 'exiting'
                        ? 'translateX(-100%)'
                        : cardAnimation === 'entering'
                        ? 'translateY(30px)'
                        : 'translate(0)',
                    opacity: cardAnimation === 'exiting' || cardAnimation === 'entering' ? 0 : 1,
                    transition:
                      cardAnimation === 'exiting'
                        ? 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease'
                        : cardAnimation === 'idle'
                        ? 'transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.35s ease'
                        : 'none',
                  }}
                >
                  {/* Top Row: ETA Pill on Left, Scheduled Time in Mono on Right */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                        backgroundColor: 'rgba(245, 158, 11, 0.15)',
                        color: '#FBBF24',
                        border: '1px solid rgba(245, 158, 11, 0.3)',
                        borderRadius: '9999px',
                        padding: '6px 14px',
                        fontFamily: '"IBM Plex Mono", monospace',
                        fontSize: '12px',
                        fontWeight: 800,
                        letterSpacing: '0.06em',
                      }}
                    >
                      <span
                        style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          backgroundColor: '#F59E0B',
                          boxShadow: '0 0 8px #F59E0B',
                        }}
                      />
                      <span>{currentRide.pickupBadge}</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: '#94A3B8', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                        SCHEDULED
                      </span>
                      <span
                        style={{
                          fontFamily: '"IBM Plex Mono", monospace',
                          fontSize: '15px',
                          fontWeight: 900,
                          color: '#FFFFFF',
                        }}
                      >
                        {currentRide.time}
                      </span>
                    </div>
                  </div>

                  {/* Visual Route Block (Zero Confusion: Glowing Green to Blue Pin) */}
                  <div
                    style={{
                      backgroundColor: '#0F172A',
                      borderRadius: '16px',
                      padding: '22px 20px',
                      border: '1px solid rgba(255, 255, 255, 0.06)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                    }}
                  >
                    {/* Stop 1: Pickup */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '22px' }}>
                        <div
                          style={{
                            width: '14px',
                            height: '14px',
                            borderRadius: '50%',
                            backgroundColor: '#10B981',
                            boxShadow: '0 0 10px #10B981',
                            marginTop: '6px',
                          }}
                        />
                        <div
                          style={{
                            width: '2px',
                            height: '40px',
                            borderLeft: '2px dashed rgba(148, 163, 184, 0.35)',
                            margin: '4px 0',
                          }}
                        />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '11px', fontWeight: 800, letterSpacing: '0.12em', color: '#10B981', textTransform: 'uppercase' }}>
                          PICKUP
                        </div>
                        <div style={{ fontSize: '26px', fontWeight: 900, color: '#FFFFFF', letterSpacing: '-0.02em', lineHeight: 1.2 }}>
                          {currentRide.from}
                        </div>
                      </div>
                    </div>

                    {/* Stop 2: Drop-off */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '22px' }}>
                        <div
                          style={{
                            width: '14px',
                            height: '14px',
                            borderRadius: '4px',
                            backgroundColor: '#38BDF8',
                            boxShadow: '0 0 10px #38BDF8',
                            marginTop: '6px',
                          }}
                        />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '11px', fontWeight: 800, letterSpacing: '0.12em', color: '#38BDF8', textTransform: 'uppercase' }}>
                          DROP-OFF
                        </div>
                        <div style={{ fontSize: '26px', fontWeight: 900, color: '#FFFFFF', letterSpacing: '-0.02em', lineHeight: 1.2 }}>
                          {currentRide.to}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Student Row: Avatar, Student Name, Student ID, Large Call Student Button */}
                  <div
                    style={{
                      backgroundColor: '#0F172A',
                      borderRadius: '16px',
                      padding: '16px 20px',
                      border: '1px solid rgba(255, 255, 255, 0.06)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '16px',
                    }}
                  >
                    {/* Left: Avatar + Details */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flex: 1, minWidth: '200px' }}>
                      <div
                        style={{
                          width: '50px',
                          height: '50px',
                          borderRadius: '50%',
                          backgroundColor: '#1E293B',
                          color: '#38BDF8',
                          border: '1.5px solid rgba(56, 189, 248, 0.35)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '18px',
                          fontWeight: 900,
                          flexShrink: 0,
                        }}
                      >
                        {currentRide.studentName
                          .split(' ')
                          .map((n) => n[0])
                          .join('')}
                      </div>

                      <div>
                        <div style={{ fontSize: '18px', fontWeight: 800, color: '#FFFFFF', lineHeight: 1.2 }}>
                          {currentRide.studentName}
                        </div>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: '#94A3B8', marginTop: '2px', fontFamily: 'monospace' }}>
                          {currentRide.studentId} • {currentRide.hostel}
                        </div>
                      </div>
                    </div>

                    {/* Right: Large Thumb-Friendly Call Student Button (Min 52px Height) */}
                    <button
                      type="button"
                      onClick={() => handleCallStudent(currentRide)}
                      style={{
                        minHeight: '52px',
                        padding: '0 22px',
                        backgroundColor: 'rgba(16, 185, 129, 0.15)',
                        color: '#34D399',
                        border: '1px solid rgba(16, 185, 129, 0.35)',
                        borderRadius: '12px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontSize: '13px',
                        fontWeight: 800,
                        letterSpacing: '0.04em',
                        flexShrink: 0,
                        transition: 'all 0.15s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'rgba(16, 185, 129, 0.25)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'rgba(16, 185, 129, 0.15)';
                      }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                      </svg>
                      <span>Call Student</span>
                    </button>
                  </div>
                </div>
              )}

              {/* DESKTOP INLINE SEQUENTIAL ACTION BUTTON (Directly underneath Active Ride card) */}
              {isDesktop && !isQueueFinished && (
                <div style={{ width: '100%' }}>
                  {renderActionButton(false)}
                </div>
              )}
            </div>
          )}

          {/* =================================================== */}
          {/* RIGHT COLUMN (lg:col-span-5): TODAY'S QUEUE         */}
          {/* =================================================== */}
          {(isDesktop || activeTab === 'queue') && (
            <div
              style={{
                gridColumn: isDesktop ? 'span 5' : 'auto',
                width: '100%',
              }}
            >
              {renderQueueList()}
            </div>
          )}
        </div>
      </main>

      {/* ======================================================= */}
      {/* 3. MOBILE STICKY ACTION BUTTON (BOTTOM ANCHORED)        */}
      {/* ======================================================= */}
      {!isDesktop && activeTab === 'active' && !isQueueFinished && (
        <div
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'center',
            padding: '12px 16px 20px 16px',
            backgroundColor: 'rgba(11, 17, 23, 0.95)',
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            zIndex: 30,
            boxSizing: 'border-box',
          }}
        >
          <div style={{ width: '100%', maxWidth: '480px' }}>
            {renderActionButton(true)}
          </div>
        </div>
      )}
    </div>
  );
}
