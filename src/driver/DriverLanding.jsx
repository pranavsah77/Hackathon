import React, { useState } from 'react';

/**
 * DriverLanding Component
 * High-precision fleet operations console for Qartix campus electric shuttles.
 */
export default function DriverLanding({
  driver = { id: 'CART-04', fullName: 'Vikram Singh', cartNumber: 'CART-04' },
  onLogout = () => {},
}) {
  const [isOnDuty, setIsOnDuty] = useState(true);
  const [currentStopIndex, setCurrentStopIndex] = useState(0);
  const [passengers, setPassengers] = useState([
    { id: 'STU-84920', name: 'Pranav Kumar', stop: 'Central Quad', dest: 'Science Core', status: 'Boarded' },
    { id: 'STU-92144', name: 'Ananya Sharma', stop: 'Central Quad', dest: 'North Dorms', status: 'Boarded' },
    { id: 'STU-73012', name: 'Rohan Verma', stop: 'Science Core', dest: 'Main Library', status: 'Waiting' },
    { id: 'STU-55091', name: 'Kavya Nair', stop: 'Science Core', dest: 'Central Quad', status: 'Waiting' },
  ]);

  const STOPS = [
    { code: '01', name: 'Central Quad', eta: 'NOW' },
    { code: '02', name: 'Science Core', eta: '2 MIN' },
    { code: '03', name: 'Main Library', eta: '5 MIN' },
    { code: '04', name: 'North Dorms', eta: '8 MIN' },
  ];

  const handleNextStop = () => {
    setCurrentStopIndex((prev) => (prev + 1) % STOPS.length);
  };

  const handleBoardPassenger = (stuId) => {
    setPassengers((prev) =>
      prev.map((p) => (p.id === stuId ? { ...p, status: 'Boarded' } : p))
    );
  };

  const currentStop = STOPS[currentStopIndex];
  const nextStop = STOPS[(currentStopIndex + 1) % STOPS.length];
  const boardedCount = passengers.filter((p) => p.status === 'Boarded').length;

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#F6F5F0',
        backgroundImage: 'radial-gradient(rgba(22, 24, 26, 0.12) 1.2px, transparent 1.2px)',
        backgroundSize: '24px 24px',
        color: '#16181A',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Top Fixed Operations Bar */}
      <header
        style={{
          height: '68px',
          padding: '0 32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'rgba(246, 245, 240, 0.92)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderBottom: '1px solid #16181A',
          boxShadow: '0 2px 0px rgba(22, 24, 26, 0.05)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '34px',
                height: '34px',
                borderRadius: '8px',
                background: '#16181A',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F6F5F0" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="8" />
                <path d="m15.5 15.5 3.5 3.5" />
                <path d="M9 12h6" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: '15px', fontWeight: 800, letterSpacing: '0.1em' }}>QARTIX DRIVER</div>
              <div style={{ fontSize: '9px', fontWeight: 700, color: '#64748b', letterSpacing: '0.14em' }}>FLEET CONSOLE</div>
            </div>
          </div>

          {/* Cart & Driver Identifier Badge */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 14px',
              background: '#FFFFFF',
              border: '1px solid #16181A',
              boxShadow: '2px 2px 0px #16181A',
              borderRadius: '8px',
              fontSize: '11px',
              fontWeight: 700,
            }}
          >
            <span style={{ color: '#E85028', fontFamily: 'monospace', fontWeight: 900 }}>{driver.cartNumber || 'CART-04'}</span>
            <span style={{ color: '#9ca3af' }}>•</span>
            <span style={{ color: '#16181A' }}>{driver.fullName || 'Operator'}</span>
          </div>
        </div>

        {/* Right Status Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* On Duty Status Toggle */}
          <button
            type="button"
            onClick={() => setIsOnDuty(!isOnDuty)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '7px 14px',
              background: isOnDuty ? '#10b981' : '#f3f4f6',
              color: isOnDuty ? '#FFFFFF' : '#4b5563',
              border: '1px solid #16181A',
              boxShadow: '2px 2px 0px #16181A',
              borderRadius: '8px',
              fontSize: '11px',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            <span
              style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                background: isOnDuty ? '#FFFFFF' : '#9ca3af',
              }}
            />
            <span>{isOnDuty ? 'ON DUTY' : 'OFF DUTY'}</span>
          </button>

          {/* Log Out */}
          <button
            type="button"
            onClick={onLogout}
            style={{
              padding: '7px 14px',
              background: '#FFFFFF',
              color: '#16181A',
              border: '1px solid #16181A',
              boxShadow: '2px 2px 0px #16181A',
              borderRadius: '8px',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            LOG OUT
          </button>
        </div>
      </header>

      {/* Main Console Workspace */}
      <main style={{ maxWidth: '1200px', margin: '36px auto', padding: '0 24px', display: 'flex', flexDirection: 'column', gap: '28px' }}>
        {/* Telemetry Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
          {/* Card 1: Speed */}
          <div style={{ background: '#FFFFFF', border: '1px solid #16181A', boxShadow: '3px 3px 0px #16181A', borderRadius: '10px', padding: '20px' }}>
            <div style={{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.1em', color: '#64748b', textTransform: 'uppercase' }}>Vehicle Speed</div>
            <div style={{ fontSize: '32px', fontWeight: 900, fontFamily: 'monospace', margin: '8px 0 4px 0', color: '#16181A' }}>
              14 <span style={{ fontSize: '14px', fontWeight: 600, color: '#64748b' }}>KM/H</span>
            </div>
            <div style={{ fontSize: '10px', fontWeight: 700, color: '#059669' }}>● Campus Governed (15 max)</div>
          </div>

          {/* Card 2: Battery */}
          <div style={{ background: '#FFFFFF', border: '1px solid #16181A', boxShadow: '3px 3px 0px #16181A', borderRadius: '10px', padding: '20px' }}>
            <div style={{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.1em', color: '#64748b', textTransform: 'uppercase' }}>Battery Pack</div>
            <div style={{ fontSize: '32px', fontWeight: 900, fontFamily: 'monospace', margin: '8px 0 4px 0', color: '#16181A' }}>
              94% <span style={{ fontSize: '14px', fontWeight: 600, color: '#64748b' }}>SOC</span>
            </div>
            <div style={{ fontSize: '10px', fontWeight: 700, color: '#0284c7' }}>● 48V Titanium Skateboard • 62 km Range</div>
          </div>

          {/* Card 3: Seating Occupancy */}
          <div style={{ background: '#FFFFFF', border: '1px solid #16181A', boxShadow: '3px 3px 0px #16181A', borderRadius: '10px', padding: '20px' }}>
            <div style={{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.1em', color: '#64748b', textTransform: 'uppercase' }}>Seat Capacity</div>
            <div style={{ fontSize: '32px', fontWeight: 900, fontFamily: 'monospace', margin: '8px 0 4px 0', color: '#16181A' }}>
              {boardedCount} / 4 <span style={{ fontSize: '14px', fontWeight: 600, color: '#64748b' }}>SEATS</span>
            </div>
            <div style={{ fontSize: '10px', fontWeight: 700, color: boardedCount === 4 ? '#b91c1c' : '#E85028' }}>
              {4 - boardedCount} seat{4 - boardedCount === 1 ? '' : 's'} available
            </div>
          </div>

          {/* Card 4: Current Stop & Departure */}
          <div style={{ background: '#FFFFFF', border: '1px solid #16181A', boxShadow: '3px 3px 0px #16181A', borderRadius: '10px', padding: '20px' }}>
            <div style={{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.1em', color: '#64748b', textTransform: 'uppercase' }}>Next Waypoint</div>
            <div style={{ fontSize: '18px', fontWeight: 900, margin: '8px 0 4px 0', color: '#16181A' }}>
              {nextStop.name}
            </div>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#E85028' }}>ETA: {nextStop.eta}</div>
          </div>
        </div>

        {/* Route Progress & Dispatch Actions */}
        <div style={{ background: '#FFFFFF', border: '1px solid #16181A', boxShadow: '4px 4px 0px #16181A', borderRadius: '12px', padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
            <div>
              <h2 style={{ fontSize: '18px', fontWeight: 800, margin: 0 }}>Route 01: Academic Ring Dispatch</h2>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                Currently stationed at <strong>{currentStop.name}</strong>
              </div>
            </div>

            <button
              type="button"
              onClick={handleNextStop}
              style={{
                padding: '10px 20px',
                background: '#E85028',
                color: '#FFFFFF',
                border: '1px solid #16181A',
                boxShadow: '3px 3px 0px #16181A',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              Advance to Next Stop →
            </button>
          </div>

          {/* Stop Nodes Progression */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
            {STOPS.map((st, i) => {
              const isCurrent = i === currentStopIndex;
              const isPast = i < currentStopIndex;
              return (
                <div
                  key={st.code}
                  style={{
                    padding: '16px',
                    borderRadius: '8px',
                    border: '1px solid #16181A',
                    background: isCurrent ? '#16181A' : isPast ? '#e2e8f0' : '#F6F5F0',
                    color: isCurrent ? '#FFFFFF' : '#16181A',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 800, fontFamily: 'monospace' }}>STOP {st.code}</span>
                    <span style={{ fontSize: '10px', fontWeight: 700, opacity: 0.8 }}>{st.eta}</span>
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 700 }}>{st.name}</div>
                  <div style={{ fontSize: '10px', marginTop: '6px', opacity: 0.75 }}>
                    {isCurrent ? '● Current Station' : isPast ? '✓ Completed' : 'En Route'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Passenger Queue & Verification */}
        <div style={{ background: '#FFFFFF', border: '1px solid #16181A', boxShadow: '4px 4px 0px #16181A', borderRadius: '12px', padding: '24px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 800, margin: '0 0 16px 0' }}>Student Transit Pass Manifest</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {passengers.map((p) => (
              <div
                key={p.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 18px',
                  border: '1px solid #16181A',
                  borderRadius: '8px',
                  background: p.status === 'Boarded' ? '#f0fdf4' : '#FFFFFF',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <div style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '12px', color: '#16181A' }}>
                    {p.id}
                  </div>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 700 }}>{p.name}</div>
                    <div style={{ fontSize: '11px', color: '#64748b' }}>
                      From {p.stop} → {p.dest}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span
                    style={{
                      padding: '4px 10px',
                      borderRadius: '6px',
                      fontSize: '10px',
                      fontWeight: 800,
                      background: p.status === 'Boarded' ? '#dcfce7' : '#fef3c7',
                      color: p.status === 'Boarded' ? '#166534' : '#92400e',
                    }}
                  >
                    {p.status}
                  </span>

                  {p.status === 'Waiting' && (
                    <button
                      type="button"
                      onClick={() => handleBoardPassenger(p.id)}
                      style={{
                        padding: '6px 12px',
                        background: '#16181A',
                        color: '#FFFFFF',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      Scan / Board
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
