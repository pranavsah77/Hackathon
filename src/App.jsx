import React, { useState, useEffect } from 'react';
import AuthPage from './auth/AuthPage.jsx';
import StudentLanding from './student/StudentLanding.jsx';
import StudentDashboard from './student/StudentDashboard.jsx';
import DriverInterface from './driver/DriverInterface.jsx';
import AdminInterface from './admin/AdminInterface.jsx';
import { useAuth } from './context/AuthContext.jsx';

export default function App() {
  const { currentUser, role, status, isDriverApproved, isLoading, logout, refreshSession } = useAuth();
  const [studentView, setStudentView] = useState('landing'); // 'landing' | 'dashboard'
  const [welcomeToast, setWelcomeToast] = useState(null);
  const [currentPath, setCurrentPath] = useState(() => {
    return typeof window !== 'undefined' ? window.location.pathname : '/';
  });

  // Track browser history / URL path changes (e.g. back/forward button or pushState)
  useEffect(() => {
    const handleLocationChange = () => {
      setCurrentPath(window.location.pathname);
    };
    window.addEventListener('popstate', handleLocationChange);
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, []);

  const navigateTo = (path) => {
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', path);
      setCurrentPath(path);
    }
  };

  // Sync address bar to /admin if user is an admin
  useEffect(() => {
    if (role === 'admin' && typeof window !== 'undefined' && window.location.pathname !== '/admin') {
      window.history.replaceState({}, '', '/admin');
      setCurrentPath('/admin');
    }
  }, [role]);

  // Auto-dismiss welcome toast after 4 seconds
  useEffect(() => {
    if (welcomeToast) {
      const timer = setTimeout(() => {
        setWelcomeToast(null);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [welcomeToast]);

  // Handle successful login/signup from AuthPage
  const handleAuthenticate = ({ role: authRole, user }) => {
    setStudentView('landing');
    refreshSession();

    // Craft contextual welcome message
    let message = '';
    if (authRole === 'admin') {
      message = `Welcome to Transport Office Admin Console, ${user?.fullName || 'Admin'}!`;
    } else if (authRole === 'student') {
      const name = user?.fullName || 'Student';
      if (user?.mode === 'signup') {
        message = `Welcome to Qartix, ${name}! Your student account is ready.`;
      } else {
        message = `Welcome back, ${name}! Ready for your campus ride?`;
      }
    } else if (authRole === 'driver') {
      const driverIdent = user?.fullName || user?.cartNumber || user?.driverId || 'Operator';
      message = `Welcome, Driver ${driverIdent}! Have a safe shift.`;
    }
    setWelcomeToast(message);
  };

  // Handle Logout from any interface
  const handleLogout = async () => {
    try {
      await logout();
    } catch (e) {
      console.warn('Logout error:', e);
    }
    setStudentView('landing');
    setWelcomeToast(null);
  };

  // Session restoration loading spinner
  if (isLoading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          width: '100%',
          backgroundColor: '#13161B',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#F4F5F7',
          fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
        }}
      >
        <div
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            border: '3px solid rgba(16, 185, 129, 0.2)',
            borderTopColor: '#10B981',
            animation: 'qartixSpin 0.8s linear infinite',
          }}
        />
        <style>{`@keyframes qartixSpin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // 1. Initial Screen: AuthPage if no authenticated user
  if (!currentUser) {
    return <AuthPage onAuthenticate={handleAuthenticate} />;
  }

  // 2. Pending Driver Approval Protection Screen
  if (role === 'driver' && (!isDriverApproved && status === 'pending_approval')) {
    return (
      <div
        style={{
          minHeight: '100vh',
          width: '100%',
          backgroundColor: '#13161B',
          backgroundImage: 'radial-gradient(circle at 50% 35%, #242A34 0%, #13161B 75%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          color: '#F4F5F7',
          fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            maxWidth: '460px',
            width: '100%',
            backgroundColor: '#1C2128',
            border: '1px solid rgba(245, 158, 11, 0.4)',
            borderRadius: '16px',
            padding: '36px 28px',
            boxShadow: '0 16px 40px rgba(0, 0, 0, 0.6)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <div
            style={{
              width: '60px',
              height: '60px',
              borderRadius: '50%',
              backgroundColor: 'rgba(245, 158, 11, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '18px',
              border: '1px solid #F59E0B',
            }}
          >
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#FCD34D', margin: '0 0 10px 0' }}>
            Awaiting Transport Office Approval
          </h2>
          <p style={{ fontSize: '13px', color: '#9CA3AF', lineHeight: 1.55, margin: '0 0 24px 0' }}>
            Your driver account (<strong style={{ color: '#F4F5F7' }}>{currentUser.cartNumber || currentUser.driverId}</strong>) has been registered and is pending verification by the campus transport office. Driver Cockpit access will be unlocked once approved.
          </p>
          <button
            type="button"
            onClick={handleLogout}
            style={{
              padding: '10px 24px',
              borderRadius: '8px',
              backgroundColor: '#13161B',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              color: '#F4F5F7',
              fontSize: '13px',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            Log Out & Return
          </button>
        </div>
      </div>
    );
  }

  // 3. Admin Area Protection Screen (If visiting /admin as non-admin)
  const isAdminRoute = currentPath === '/admin' || currentPath.startsWith('/admin');
  if (isAdminRoute && role !== 'admin') {
    return (
      <div
        style={{
          minHeight: '100vh',
          width: '100%',
          backgroundColor: '#13161B',
          backgroundImage: 'radial-gradient(circle at 50% 35%, #242A34 0%, #13161B 75%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          color: '#F4F5F7',
          fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            maxWidth: '500px',
            width: '100%',
            backgroundColor: '#1C2128',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            borderRadius: '16px',
            padding: '40px 32px',
            boxShadow: '0 20px 48px rgba(0, 0, 0, 0.7)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '20px',
              border: '1px solid #EF4444',
            }}
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>

          <div
            style={{
              fontSize: '11px',
              fontWeight: 800,
              fontFamily: '"IBM Plex Mono", monospace',
              color: '#EF4444',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              padding: '4px 10px',
              borderRadius: '6px',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              marginBottom: '12px',
              letterSpacing: '0.08em',
            }}
          >
            403 • ACCESS RESTRICTED
          </div>

          <h2 style={{ fontSize: '20px', fontWeight: 800, color: '#F4F5F7', margin: '0 0 10px 0' }}>
            Transport Office Access Only
          </h2>

          <p style={{ fontSize: '13px', color: '#9CA3AF', lineHeight: 1.6, margin: '0 0 20px 0' }}>
            The <strong style={{ color: '#F4F5F7' }}>/admin</strong> console is restricted to university fleet administrators. Your current session is authenticated as <strong style={{ color: '#F4F5F7' }}>{currentUser.fullName || currentUser.email || currentUser.loginIdentifier}</strong> with role <span style={{ color: '#10B981', fontWeight: 700 }}>{String(role || 'STUDENT').toUpperCase()}</span>.
          </p>

          <div
            style={{
              width: '100%',
              backgroundColor: '#13161B',
              borderRadius: '8px',
              padding: '14px 16px',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              fontSize: '12px',
              color: '#9CA3AF',
              marginBottom: '24px',
              textAlign: 'left',
              lineHeight: 1.5,
            }}
          >
            <div style={{ color: '#F4F5F7', fontWeight: 600, marginBottom: '4px' }}>Administrative Role Required</div>
            <div>Only verified Transport Office accounts promoted in Supabase can access pass approvals, driver fleet verification, and dispatch overrides.</div>
          </div>

          <div style={{ display: 'flex', gap: '12px', width: '100%' }}>
            <button
              type="button"
              onClick={() => navigateTo('/')}
              style={{
                flex: 1,
                padding: '11px 16px',
                borderRadius: '8px',
                backgroundColor: '#10B981',
                border: 'none',
                color: '#04100C',
                fontSize: '13px',
                fontWeight: 800,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              Return to Dashboard
            </button>
            <button
              type="button"
              onClick={handleLogout}
              style={{
                padding: '11px 18px',
                borderRadius: '8px',
                backgroundColor: '#13161B',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#F4F5F7',
                fontSize: '13px',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @keyframes qartixSlideDown {
          0% {
            transform: translate(-50%, -24px);
            opacity: 0;
          }
          100% {
            transform: translate(-50%, 0);
            opacity: 1;
          }
        }
      `}</style>

      {/* Sleek Auto-Dismissing Welcome Toast / Banner */}
      {Boolean(welcomeToast) && typeof welcomeToast === 'string' && welcomeToast.trim().length > 0 ? (
        <div
          id="qartix-welcome-toast"
          style={{
            position: 'fixed',
            top: '84px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            backgroundColor: '#1C2128',
            color: '#F4F5F7',
            padding: '12px 18px',
            borderRadius: '10px',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            borderLeft: '4px solid #10B981',
            boxShadow: '0 12px 28px rgba(0, 0, 0, 0.5), 0 4px 12px rgba(16, 185, 129, 0.15)',
            animation: 'qartixSlideDown 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards',
            maxWidth: '92vw',
            fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: '#10B981',
                boxShadow: '0 0 10px #10B981',
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: '13px', fontWeight: 600, letterSpacing: '0.01em', color: '#F4F5F7' }}>
              {welcomeToast}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setWelcomeToast(null)}
            style={{
              width: '24px',
              height: '24px',
              minWidth: '24px',
              minHeight: '24px',
              borderRadius: '50%',
              backgroundColor: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              color: '#9CA3AF',
              cursor: 'pointer',
              fontSize: '15px',
              fontWeight: 700,
              lineHeight: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              transition: 'all 0.15s ease',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.16)';
              e.currentTarget.style.color = '#FFFFFF';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)';
              e.currentTarget.style.color = '#9CA3AF';
            }}
            aria-label="Close notification"
            title="Close"
          >
            ×
          </button>
        </div>
      ) : null}

      {/* 3. Protected View: Admin Console (Role: admin) */}
      {role === 'admin' && (
        <AdminInterface
          admin={currentUser}
          onLogout={handleLogout}
        />
      )}

      {/* 4. Protected View: Driver Cockpit (Role: driver, Status: active) */}
      {role === 'driver' && isDriverApproved && (
        <DriverInterface
          driver={currentUser}
          onLogout={handleLogout}
        />
      )}

      {/* 5. Protected View: Student Pass Builder & Schedule Dashboard (Role: student) */}
      {role === 'student' && studentView === 'dashboard' && (
        <StudentDashboard
          student={currentUser}
          onReturnTo3D={() => setStudentView('landing')}
          onLogout={handleLogout}
        />
      )}

      {/* 6. Protected View: Student 3D Landing Experience (Role: student) */}
      {role === 'student' && studentView === 'landing' && (
        <StudentLanding
          studentId={currentUser.studentId || currentUser.loginIdentifier || currentUser.id}
          student={currentUser}
          onBookPass={() => setStudentView('dashboard')}
          onLogout={handleLogout}
        />
      )}
    </>
  );
}
