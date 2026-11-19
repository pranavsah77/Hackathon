import React, { useState } from 'react';

/**
 * AuthPage Component
 * The entry point for Qartix: Split-screen architectural transit authentication.
 * 
 * @param {Function} onAuthenticate - Callback invoked on successful login/signup: ({ role, user }) => void
 */
export default function AuthPage({ onAuthenticate = () => {} }) {
  // Role: 'student' | 'driver'
  const [role, setRole] = useState('student');
  // Mode: 'login' | 'signup'
  const [mode, setMode] = useState('login');

  // Form State
  const [formData, setFormData] = useState({
    // Common / Student
    identifier: '', // Roll No or Email
    password: '',
    fullName: '',
    residencyStatus: 'Hostler', // 'Hostler' | 'Day Scholar'
    phone: '',
    // Driver
    driverId: '',   // Cart Number or Driver ID
    pin: '',
  });

  const [errorMsg, setErrorMsg] = useState('');

  // Handle Input Change
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errorMsg) setErrorMsg('');
  };

  // Quick Demo Fill Handler
  const handleQuickDemoFill = () => {
    if (role === 'student') {
      setFormData({
        identifier: 'STU-84920',
        password: 'studentPassword123',
        fullName: 'Pranav Kumar',
        residencyStatus: 'Hostler',
        phone: '+91 98765 43210',
        driverId: '',
        pin: '',
      });
    } else {
      // Driver
      setFormData({
        identifier: '',
        password: '',
        fullName: 'Vikram Singh',
        residencyStatus: 'Hostler',
        driverId: 'CART-04',
        pin: '4021',
        phone: '+91 98765 43210',
      });
    }
    setErrorMsg('');
  };

  // Switch Role
  const handleRoleChange = (newRole) => {
    setRole(newRole);
    setErrorMsg('');
  };

  // Switch Mode
  const handleModeChange = (newMode) => {
    setMode(newMode);
    setErrorMsg('');
  };

  // Submit Handler
  const handleSubmit = (e) => {
    e.preventDefault();

    if (role === 'student') {
      const id = formData.identifier.trim();
      const pwd = formData.password.trim();
      if (!id) {
        setErrorMsg('Please enter your University Roll No. or Email.');
        return;
      }
      if (!pwd) {
        setErrorMsg('Please enter your password.');
        return;
      }
      if (mode === 'signup') {
        if (!formData.fullName.trim()) {
          setErrorMsg('Please enter your full name.');
          return;
        }
        const digits = formData.phone.replace(/\D/g, '');
        if (digits.length < 10) {
          setErrorMsg('Please enter a valid 10-digit mobile number.');
          return;
        }
      }

      onAuthenticate({
        role: 'student',
        user: {
          id: id.toUpperCase(),
          fullName: formData.fullName.trim() || 'Student User',
          residencyStatus: formData.residencyStatus || 'Hostler',
          hostelBlock: formData.residencyStatus === 'Hostler' ? 'Hostel Resident' : 'Day Scholar',
          phone: formData.phone.trim() || '+91 98765 43210',
          mode,
        },
      });
    } else {
      // Driver
      const cartOrDriver = formData.driverId.trim();
      const pin = formData.pin.trim();
      if (!cartOrDriver) {
        setErrorMsg('Please enter your Driver ID or Cart Number (e.g. CART-04).');
        return;
      }
      if (!pin) {
        setErrorMsg('Please enter your Security PIN / Password.');
        return;
      }
      if (mode === 'signup') {
        if (!formData.fullName.trim()) {
          setErrorMsg('Please enter your full name.');
          return;
        }
        const digits = formData.phone.replace(/\D/g, '');
        if (digits.length < 10) {
          setErrorMsg('Please enter a valid 10-digit mobile number.');
          return;
        }
      }

      onAuthenticate({
        role: 'driver',
        user: {
          id: cartOrDriver.toUpperCase(),
          cartNumber: cartOrDriver.toUpperCase().includes('CART') ? cartOrDriver.toUpperCase() : `CART-${cartOrDriver}`,
          fullName: formData.fullName.trim() || 'Campus Operator',
          phone: formData.phone.trim() || '+91 98765 43210',
          mode,
        },
      });
    }
  };

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
        padding: '40px 16px',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
        color: '#F4F5F7',
        boxSizing: 'border-box',
      }}
    >
      <style>{`
        input:-webkit-autofill,
        input:-webkit-autofill:hover, 
        input:-webkit-autofill:focus, 
        input:-webkit-autofill:active {
          -webkit-text-fill-color: #F4F5F7 !important;
          -webkit-box-shadow: 0 0 0px 1000px #13161B inset !important;
          transition: background-color 5000s ease-in-out 0s !important;
        }
        .qartix-auth-input {
          background-color: #13161B !important;
          color: #F4F5F7 !important;
          border: 1px solid rgba(255, 255, 255, 0.15) !important;
          transition: border-color 0.15s ease, box-shadow 0.15s ease !important;
        }
        .qartix-auth-input:focus {
          border-color: #10B981 !important;
          box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.25) !important;
          outline: none !important;
        }
      `}</style>

      {/* Centered Minimal Qartix Logo + Wordmark Directly Above Card */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          marginBottom: '24px',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            background: '#1C2128',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            boxShadow: '0 4px 14px rgba(0, 0, 0, 0.4), 2px 2px 0px #0D1013',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="8" />
            <path d="m15.5 15.5 3.5 3.5" />
            <path d="M9 12h6" />
          </svg>
        </div>
        <div>
          <div style={{ fontSize: '24px', fontWeight: 900, letterSpacing: '0.14em', lineHeight: 1.1, color: '#F4F5F7' }}>
            QARTIX
          </div>
          <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.22em', color: '#9CA3AF', textTransform: 'uppercase', marginTop: '4px' }}>
            CAMPUS EV TRANSIT
          </div>
        </div>
      </div>

      {/* Centered Clean Login / Sign Up Card */}
      <div
        style={{
          width: '100%',
          maxWidth: '460px',
          margin: '0 auto',
          background: '#1C2128',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          boxShadow: '0 16px 36px rgba(0, 0, 0, 0.5), 4px 4px 0px #0D1013',
          borderRadius: '14px',
          padding: '32px 28px',
          display: 'flex',
          flexDirection: 'column',
          gap: '22px',
          boxSizing: 'border-box',
        }}
      >
        {/* 1. Role Selector Tabs */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '4px',
            padding: '4px',
            background: '#13161B',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: '8px',
          }}
        >
          <button
            type="button"
            onClick={() => handleRoleChange('student')}
            style={{
              padding: '9px 8px',
              borderRadius: '6px',
              border: 'none',
              background: role === 'student' ? '#1C2128' : 'transparent',
              color: role === 'student' ? '#F4F5F7' : '#9CA3AF',
              boxShadow: role === 'student' ? '0 1px 4px rgba(0,0,0,0.3)' : 'none',
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.02em',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '5px',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
              <path d="M6 12v5c3 3 9 3 12 0v-5" />
            </svg>
            <span>Login as Student</span>
          </button>

          <button
            type="button"
            onClick={() => handleRoleChange('driver')}
            style={{
              padding: '9px 8px',
              borderRadius: '6px',
              border: 'none',
              background: role === 'driver' ? '#1C2128' : 'transparent',
              color: role === 'driver' ? '#F4F5F7' : '#9CA3AF',
              boxShadow: role === 'driver' ? '0 1px 4px rgba(0,0,0,0.3)' : 'none',
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.02em',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '5px',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="12" x="3" y="6" rx="2" />
              <path d="m9 18 2 3h2l2-3" />
              <circle cx="8" cy="12" r="1.5" />
              <circle cx="16" cy="12" r="1.5" />
            </svg>
            <span>Login as Driver</span>
          </button>
        </div>

        {/* 2. Mode Toggle (Log In vs Sign Up) */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', paddingBottom: '14px' }}>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 800, margin: 0, color: '#F4F5F7' }}>
              {mode === 'login' ? 'Account Authentication' : 'Create Campus Access'}
            </h2>
            <div style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '2px' }}>
              {role === 'student' ? 'Student Interface Access' : 'Fleet Operations Console'}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              type="button"
              onClick={() => handleModeChange('login')}
              style={{
                padding: '5px 10px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 700,
                border: mode === 'login' ? '1px solid rgba(255, 255, 255, 0.2)' : '1px solid transparent',
                background: mode === 'login' ? '#13161B' : 'transparent',
                color: mode === 'login' ? '#F4F5F7' : '#9CA3AF',
                cursor: 'pointer',
              }}
            >
              Log In
            </button>
            <button
              type="button"
              onClick={() => handleModeChange('signup')}
              style={{
                padding: '5px 10px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 700,
                border: mode === 'signup' ? '1px solid rgba(255, 255, 255, 0.2)' : '1px solid transparent',
                background: mode === 'signup' ? '#13161B' : 'transparent',
                color: mode === 'signup' ? '#F4F5F7' : '#9CA3AF',
                cursor: 'pointer',
              }}
            >
              Sign Up
            </button>
          </div>
        </div>

        {/* Error Message Alert */}
        {errorMsg && (
          <div
            style={{
              padding: '10px 14px',
              background: '#fef2f2',
              border: '1px solid #ef4444',
              borderRadius: '8px',
              color: '#b91c1c',
              fontSize: '12px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{errorMsg}</span>
          </div>
        )}

        {/* 3. Dynamic Form Fields */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* STUDENT FIELDS */}
          {role === 'student' && (
            <>
              {mode === 'signup' && (
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: '6px', color: '#9CA3AF' }}>
                    Full Name
                  </label>
                  <input
                    type="text"
                    name="fullName"
                    value={formData.fullName}
                    onChange={handleChange}
                    placeholder="e.g. Pranav Kumar"
                    className="qartix-auth-input"
                    style={{
                      width: '100%',
                      padding: '11px 14px',
                      borderRadius: '8px',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      fontSize: '13px',
                      background: '#13161B',
                      color: '#F4F5F7',
                      boxSizing: 'border-box',
                      outline: 'none',
                    }}
                  />
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: '6px', color: '#9CA3AF' }}>
                  University Roll No. / Email
                </label>
                <input
                  type="text"
                  name="identifier"
                  value={formData.identifier}
                  onChange={handleChange}
                  placeholder="e.g. 2024CS0842 or STU-84920"
                  className="qartix-auth-input"
                  style={{
                    width: '100%',
                    padding: '11px 14px',
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    fontSize: '13px',
                    background: '#13161B',
                    color: '#F4F5F7',
                    boxSizing: 'border-box',
                    outline: 'none',
                  }}
                />
              </div>

              {mode === 'signup' && (
                <>
                  {/* Residency Status Radio Group */}
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: '8px', color: '#9CA3AF' }}>
                      Residency Status
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      {['Hostler', 'Day Scholar'].map((status) => {
                        const isSelected = formData.residencyStatus === status;
                        return (
                          <label
                            key={status}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '10px',
                              padding: '10px 14px',
                              background: isSelected ? 'rgba(16, 185, 129, 0.12)' : '#13161B',
                              border: isSelected ? '1.5px solid #10B981' : '1px solid rgba(255, 255, 255, 0.15)',
                              borderRadius: '8px',
                              cursor: 'pointer',
                              transition: 'all 0.15s ease',
                              boxShadow: isSelected ? '0 0 12px rgba(16, 185, 129, 0.2)' : 'none',
                            }}
                          >
                            <input
                              type="radio"
                              name="residencyStatus"
                              value={status}
                              checked={isSelected}
                              onChange={handleChange}
                              style={{
                                accentColor: '#10B981',
                                cursor: 'pointer',
                                width: '15px',
                                height: '15px',
                              }}
                            />
                            <span style={{ fontSize: '13px', fontWeight: isSelected ? 700 : 500, color: isSelected ? '#F4F5F7' : '#9CA3AF' }}>
                              {status}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Mobile Number Field */}
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: '6px', color: '#9CA3AF' }}>
                      Mobile Number
                    </label>
                    <input
                      type="tel"
                      name="phone"
                      value={formData.phone}
                      onChange={handleChange}
                      placeholder="+91 98765 43210"
                      className="qartix-auth-input"
                      style={{
                        width: '100%',
                        padding: '11px 14px',
                        borderRadius: '8px',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        fontSize: '13px',
                        background: '#13161B',
                        color: '#F4F5F7',
                        boxSizing: 'border-box',
                        outline: 'none',
                      }}
                    />
                  </div>
                </>
              )}

              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: '6px', color: '#9CA3AF' }}>
                  Password
                </label>
                <input
                  type="password"
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  placeholder="••••••••••••"
                  className="qartix-auth-input"
                  style={{
                    width: '100%',
                    padding: '11px 14px',
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    fontSize: '13px',
                    background: '#13161B',
                    color: '#F4F5F7',
                    boxSizing: 'border-box',
                    outline: 'none',
                  }}
                />
              </div>
            </>
          )}

          {/* DRIVER FIELDS */}
          {role === 'driver' && (
            <>
              {mode === 'signup' && (
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: '6px', color: '#9CA3AF' }}>
                    Driver Full Name
                  </label>
                  <input
                    type="text"
                    name="fullName"
                    value={formData.fullName}
                    onChange={handleChange}
                    placeholder="e.g. Vikram Singh"
                    className="qartix-auth-input"
                    style={{
                      width: '100%',
                      padding: '11px 14px',
                      borderRadius: '8px',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      fontSize: '13px',
                      background: '#13161B',
                      color: '#F4F5F7',
                      boxSizing: 'border-box',
                      outline: 'none',
                    }}
                  />
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: '6px', color: '#9CA3AF' }}>
                  Driver ID / Cart Number
                </label>
                <input
                  type="text"
                  name="driverId"
                  value={formData.driverId}
                  onChange={handleChange}
                  placeholder="e.g. CART-04 or DRV-8821"
                  className="qartix-auth-input"
                  style={{
                    width: '100%',
                    padding: '11px 14px',
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    fontSize: '13px',
                    background: '#13161B',
                    color: '#F4F5F7',
                    boxSizing: 'border-box',
                    outline: 'none',
                  }}
                />
              </div>

              {mode === 'signup' && (
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: '6px', color: '#9CA3AF' }}>
                    Mobile Number
                  </label>
                  <input
                    type="tel"
                    name="phone"
                    value={formData.phone}
                    onChange={handleChange}
                    placeholder="+91 98765 43210"
                    className="qartix-auth-input"
                    style={{
                      width: '100%',
                      padding: '11px 14px',
                      borderRadius: '8px',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      fontSize: '13px',
                      background: '#13161B',
                      color: '#F4F5F7',
                      boxSizing: 'border-box',
                      outline: 'none',
                    }}
                  />
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: '6px', color: '#9CA3AF' }}>
                  PIN / Security Password
                </label>
                <input
                  type="password"
                  name="pin"
                  value={formData.pin}
                  onChange={handleChange}
                  placeholder="4-digit PIN or password"
                  className="qartix-auth-input"
                  style={{
                    width: '100%',
                    padding: '11px 14px',
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    fontSize: '13px',
                    background: '#13161B',
                    color: '#F4F5F7',
                    boxSizing: 'border-box',
                    outline: 'none',
                  }}
                />
              </div>
            </>
          )}

          {/* 4. Primary CTA Button in #10B981 Electric Emerald */}
          <button
            type="submit"
            style={{
              marginTop: '8px',
              width: '100%',
              padding: '13px 20px',
              background: '#10B981',
              color: '#0B1116',
              border: '1px solid #10B981',
              boxShadow: '0 4px 14px rgba(16, 185, 129, 0.25), 3px 3px 0px #0D1013',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 900,
              letterSpacing: '0.06em',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#34D399';
              e.currentTarget.style.boxShadow = '0 6px 20px rgba(16, 185, 129, 0.4), 3px 3px 0px #0D1013';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#10B981';
              e.currentTarget.style.boxShadow = '0 4px 14px rgba(16, 185, 129, 0.25), 3px 3px 0px #0D1013';
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.transform = 'translate(2px, 2px)';
              e.currentTarget.style.boxShadow = '1px 1px 0px #0D1013';
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = 'translate(0px, 0px)';
              e.currentTarget.style.boxShadow = '0 4px 14px rgba(16, 185, 129, 0.25), 3px 3px 0px #0D1013';
            }}
          >
            <span>
              {role === 'student'
                ? mode === 'login'
                  ? 'Continue as Student →'
                  : 'Create Student Account →'
                : mode === 'login'
                ? 'Continue as Driver →'
                : 'Register Driver Portal →'}
            </span>
          </button>

          {/* 5. Subtle "Quick Demo Fill" Button */}
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: '6px' }}>
            <button
              type="button"
              onClick={handleQuickDemoFill}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '7px 12px',
                background: '#13161B',
                border: '1px dashed rgba(255, 255, 255, 0.25)',
                borderRadius: '6px',
                color: '#9CA3AF',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              title="Auto-fill sample credentials for quick evaluation"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
              <span>Quick Demo Fill</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
