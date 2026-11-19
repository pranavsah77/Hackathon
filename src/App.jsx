import React, { useState, useEffect } from 'react';
import AuthPage from './auth/AuthPage.jsx';
import StudentLanding from './student/StudentLanding.jsx';
import StudentDashboard from './student/StudentDashboard.jsx';
import DriverInterface from './driver/DriverInterface.jsx';

export default function App() {
  // Authentication State: null | { role: 'student' | 'driver', id, fullName, ... }
  const [currentUser, setCurrentUser] = useState(null);
  const [studentView, setStudentView] = useState('landing'); // 'landing' | 'dashboard'
  const [welcomeToast, setWelcomeToast] = useState(null);

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
  const handleAuthenticate = ({ role, user }) => {
    setCurrentUser({
      role,
      ...user,
    });
    setStudentView('landing');

    // Craft contextual welcome message
    let message = '';
    if (role === 'student') {
      const name = user.fullName || 'Student';
      if (user.mode === 'signup') {
        message = `Welcome to Qartix, ${name}! Your student account is ready.`;
      } else {
        message = `Welcome back, ${name}! Ready for your campus ride?`;
      }
    } else if (role === 'driver') {
      const driverIdent = user.fullName || user.cartNumber || user.id || 'Operator';
      message = `Welcome, Driver ${driverIdent}! Have a safe shift.`;
    }
    setWelcomeToast(message);
  };

  // Handle Logout from any interface
  const handleLogout = () => {
    setCurrentUser(null);
    setStudentView('landing');
    setWelcomeToast(null);
  };

  // 1. Initial Screen: AuthPage
  if (!currentUser) {
    return <AuthPage onAuthenticate={handleAuthenticate} />;
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

      {/* 2. Driver Interface */}
      {currentUser.role === 'driver' && (
        <DriverInterface
          driver={currentUser}
          onLogout={handleLogout}
        />
      )}

      {/* 3. Student Interface: Pass Builder & Today's Schedule Dashboard */}
      {currentUser.role === 'student' && studentView === 'dashboard' && (
        <StudentDashboard
          student={currentUser}
          onReturnTo3D={() => setStudentView('landing')}
          onLogout={handleLogout}
        />
      )}

      {/* 4. Default Student Interface: 3D WebGL Scroll Experience */}
      {currentUser.role === 'student' && studentView === 'landing' && (
        <StudentLanding
          studentId={currentUser.id}
          onBookPass={() => setStudentView('dashboard')}
          onLogout={handleLogout}
        />
      )}
    </>
  );
}
