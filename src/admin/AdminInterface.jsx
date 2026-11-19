import React, { useState, useEffect } from 'react';
import {
  supabase,
  fetchPassRequests,
  getCertificateSignedUrl,
  reviewPassRequestAdmin,
  fetchDriversForAdmin,
  adminManageDriver,
  fetchTodayRidesForAdmin,
  adminAssignRide,
  fetchAdminAuditLogs,
  fetchCarts,
} from '../lib/supabase.js';

/**
 * AdminInterface Component (Transport Office Console)
 * Protected strictly for users with role = 'admin'.
 * 
 * Features:
 * 1. Pass requests queue: view details, view certificate via 60s signed URL, approve/reject with reviewer note.
 * 2. Driver approvals: approve/suspend driver accounts, assign EV carts.
 * 3. Today's Rides overview: view schedule, manual cart and driver dispatch assignment.
 * 4. Audit Log viewer: view audit trail with actor, action, timestamp, and metadata.
 */
export default function AdminInterface({ admin = { fullName: 'Transport Officer' }, onLogout = () => {} }) {
  const [activeTab, setActiveTab] = useState('passes'); // 'passes' | 'drivers' | 'rides' | 'audit'
  const [loading, setLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState('');

  // Tab Data States
  const [passRequests, setPassRequests] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [carts, setCarts] = useState([]);
  const [todayRides, setTodayRides] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);

  // Modal & Interactive States
  const [selectedDoc, setSelectedDoc] = useState(null); // Document signed URL preview modal
  const [docLoading, setDocLoading] = useState(false);
  const [reviewModal, setReviewModal] = useState(null); // { request, targetStatus, note }
  const [auditFilter, setAuditFilter] = useState('');

  const showNotification = (msg) => {
    setActionMsg(msg);
    setTimeout(() => setActionMsg(''), 4500);
  };

  // 1. Fetch All Admin Data
  const loadAdminData = async () => {
    setLoading(true);
    try {
      const [passesData, driversData, cartsData, ridesData, auditData] = await Promise.all([
        fetchPassRequests(),
        fetchDriversForAdmin(),
        fetchCarts(),
        fetchTodayRidesForAdmin(),
        fetchAdminAuditLogs(100),
      ]);

      if (passesData) setPassRequests(passesData);
      if (driversData) setDrivers(driversData);
      if (cartsData) setCarts(cartsData);
      if (ridesData) setTodayRides(ridesData);
      if (auditData) setAuditLogs(auditData);
    } catch (e) {
      console.error('Error loading transport office data:', e);
      showNotification('Error loading admin records: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAdminData();
  }, []);

  // 2. Open Certificate via Short-Lived Signed URL (60s Expiry)
  const handleOpenCertificate = async (req) => {
    if (!req.certificate_path) {
      alert('No certificate file path recorded for this request.');
      return;
    }

    setDocLoading(true);
    try {
      const signedUrl = await getCertificateSignedUrl(req.certificate_path, 60);
      if (!signedUrl) throw new Error('Could not generate private signed download URL.');

      setSelectedDoc({
        name: req.certificate_name || 'medical_certificate.pdf',
        url: signedUrl,
        size: req.certificate_size || 'Medical Slip',
        studentName: req.student_name,
        condition: req.medical_condition,
      });
    } catch (err) {
      alert('Error accessing private document: ' + err.message);
    } finally {
      setDocLoading(false);
    }
  };

  // 3. Pass Approval / Rejection with Reviewer Note
  const handleExecutePassReview = async () => {
    if (!reviewModal) return;
    const { request, targetStatus, note } = reviewModal;
    const reqId = request.real_id || request.id;

    try {
      await reviewPassRequestAdmin({
        requestId: reqId,
        status: targetStatus,
        reviewNote: note.trim() || (targetStatus === 'approved' ? 'Approved by Transport Office' : 'Rejected by Transport Office'),
      });

      // Update UI state
      setPassRequests((prev) =>
        prev.map((p) =>
          (p.real_id === reqId || p.id === reqId)
            ? { ...p, status: targetStatus, review_note: note, admin_notes: note }
            : p
        )
      );

      showNotification(`Pass ${request.request_code || reqId} marked as ${targetStatus.toUpperCase()}.`);
      setReviewModal(null);
      // Refresh audit logs
      fetchAdminAuditLogs(100).then((logs) => setAuditLogs(logs || []));
    } catch (err) {
      alert('Failed to review pass request: ' + err.message);
    }
  };

  // 4. Driver Account Management (Approve / Suspend / Assign Cart)
  const handleManageDriver = async (driverId, nextStatus, cartId = null) => {
    try {
      await adminManageDriver({
        driverId,
        status: nextStatus,
        cartId: cartId === '' ? null : cartId,
      });

      setDrivers((prev) =>
        prev.map((d) => {
          if (d.id === driverId) {
            return {
              ...d,
              status: nextStatus,
              details: d.details ? { ...d.details, cart_id: cartId || d.details.cart_id } : d.details,
            };
          }
          return d;
        })
      );

      showNotification(`Driver status updated to ${nextStatus.toUpperCase()}.`);
      fetchAdminAuditLogs(100).then((logs) => setAuditLogs(logs || []));
    } catch (err) {
      alert('Failed to update driver: ' + err.message);
    }
  };

  // 5. Today's Ride Manual Cart/Driver Override Assignment
  const handleAssignRide = async (rideId, cartId, driverId) => {
    try {
      await adminAssignRide({
        rideId,
        cartId: cartId || null,
        driverId: driverId || null,
      });

      setTodayRides((prev) =>
        prev.map((r) => {
          if (r.id === rideId) {
            const assignedCart = carts.find((c) => c.id === cartId);
            const assignedDriver = drivers.find((d) => d.id === driverId);
            return {
              ...r,
              cart_id: cartId,
              cart: assignedCart ? { ...assignedCart } : r.cart,
              driver_id: driverId,
              driver: assignedDriver ? { ...assignedDriver } : r.driver,
            };
          }
          return r;
        })
      );

      showNotification('Ride cart/driver assignment updated successfully.');
      fetchAdminAuditLogs(100).then((logs) => setAuditLogs(logs || []));
    } catch (err) {
      alert('Failed to assign ride: ' + err.message);
    }
  };

  // Filtered Audit Logs
  const filteredAuditLogs = auditLogs.filter((log) => {
    if (!auditFilter) return true;
    const q = auditFilter.toLowerCase();
    return (
      (log.action && log.action.toLowerCase().includes(q)) ||
      (log.actor_name && log.actor_name.toLowerCase().includes(q)) ||
      (log.entity && log.entity.toLowerCase().includes(q)) ||
      (log.entity_id && log.entity_id.toLowerCase().includes(q))
    );
  });

  const pendingPassesCount = passRequests.filter((p) => p.status === 'pending').length;
  const pendingDriversCount = drivers.filter((d) => d.status === 'pending_approval').length;

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#13161B',
        backgroundImage: 'radial-gradient(circle at 60% 25%, #242A34 0%, #13161B 80%)',
        color: '#F4F5F7',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
        paddingBottom: '80px',
      }}
    >
      {/* Toast Notification Banner */}
      {actionMsg && (
        <div
          style={{
            position: 'fixed',
            top: '84px',
            right: '24px',
            zIndex: 9999,
            background: '#1C2128',
            color: '#10B981',
            border: '1px solid #10B981',
            borderRadius: '10px',
            padding: '14px 22px',
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.6)',
            fontSize: '13px',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10B981' }} />
          <span>{actionMsg}</span>
        </div>
      )}

      {/* Header */}
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
          background: 'rgba(28, 33, 40, 0.94)',
          backdropFilter: 'blur(16px)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.12)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '8px',
              background: '#13161B',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#10B981',
              fontWeight: 900,
              fontSize: '19px',
              boxShadow: '0 0 12px rgba(16, 185, 129, 0.25)',
            }}
          >
            Q
          </div>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 800, letterSpacing: '0.03em', color: '#F4F5F7' }}>
              QARTIX TRANSPORT OFFICE
            </div>
            <div style={{ fontSize: '11px', color: '#9CA3AF' }}>
              Admin Dispatch & Fleet Verification Console (/admin)
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span
            style={{
              fontSize: '11px',
              padding: '4px 10px',
              borderRadius: '6px',
              background: 'rgba(16, 185, 129, 0.15)',
              color: '#34D399',
              border: '1px solid rgba(16, 185, 129, 0.35)',
              fontWeight: 800,
              fontFamily: 'monospace',
              letterSpacing: '0.04em',
            }}
          >
            ADMIN ROLE VERIFIED
          </span>

          <button
            type="button"
            onClick={onLogout}
            style={{
              background: 'rgba(239, 68, 68, 0.12)',
              color: '#F87171',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              padding: '8px 16px',
              borderRadius: '8px',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.2)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.12)')}
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <main style={{ maxWidth: '1360px', margin: '0 auto', padding: '32px 24px' }}>
        {/* Navigation Tabs */}
        <div
          style={{
            display: 'flex',
            gap: '12px',
            marginBottom: '28px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            paddingBottom: '14px',
            flexWrap: 'wrap',
          }}
        >
          {[
            { id: 'passes', label: `Pass Requests Queue ${pendingPassesCount > 0 ? `(${pendingPassesCount} Pending)` : ''}` },
            { id: 'drivers', label: `Driver Accounts & Approvals ${pendingDriversCount > 0 ? `(${pendingDriversCount} New)` : ''}` },
            { id: 'rides', label: `Today's Shift Rides (${todayRides.length})` },
            { id: 'audit', label: `System Audit Logs (${auditLogs.length})` },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                background: activeTab === tab.id ? '#10B981' : 'rgba(255, 255, 255, 0.05)',
                color: activeTab === tab.id ? '#04100C' : '#9CA3AF',
                border: activeTab === tab.id ? '1px solid #34D399' : '1px solid rgba(255, 255, 255, 0.08)',
                padding: '10px 20px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 800,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '80px 0', color: '#9CA3AF' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                border: '3px solid rgba(16, 185, 129, 0.2)',
                borderTopColor: '#10B981',
                animation: 'adminSpin 0.8s linear infinite',
                margin: '0 auto 16px auto',
              }}
            />
            <style>{`@keyframes adminSpin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
            <span>Syncing Transport Office databases...</span>
          </div>
        ) : null}

        {/* ======================================================== */}
        {/* TAB 1: PASS REQUESTS QUEUE                               */}
        {/* ======================================================== */}
        {!loading && activeTab === 'passes' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 800, margin: 0 }}>Medical Mobility Pass Verification Queue</h2>
                <p style={{ fontSize: '12px', color: '#9CA3AF', margin: '4px 0 0 0' }}>
                  Review submitted physician slips, verify duration and dispatch slots, approve or reject with custom notes.
                </p>
              </div>
              <button
                type="button"
                onClick={loadAdminData}
                style={{
                  background: 'rgba(255, 255, 255, 0.06)',
                  color: '#D1D5DB',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  padding: '8px 14px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                ↻ Refresh Queue
              </button>
            </div>

            {passRequests.length === 0 ? (
              <div
                style={{
                  background: '#1C2128',
                  borderRadius: '12px',
                  padding: '48px',
                  textAlign: 'center',
                  color: '#9CA3AF',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                }}
              >
                No mobility pass requests submitted yet.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {passRequests.map((req) => (
                  <div
                    key={req.id}
                    style={{
                      background: '#1C2128',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '14px',
                      padding: '22px 24px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '14px',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span style={{ fontSize: '17px', fontWeight: 800, color: '#F4F5F7' }}>
                            {req.student_name}
                          </span>
                          <span
                            style={{
                              fontSize: '11px',
                              fontFamily: 'monospace',
                              padding: '2px 8px',
                              borderRadius: '4px',
                              background: 'rgba(255,255,255,0.08)',
                              color: '#9CA3AF',
                            }}
                          >
                            {req.student_code}
                          </span>
                          <span
                            style={{
                              fontSize: '11px',
                              fontWeight: 800,
                              padding: '3px 10px',
                              borderRadius: '6px',
                              textTransform: 'uppercase',
                              background:
                                req.status === 'approved'
                                  ? 'rgba(16, 185, 129, 0.15)'
                                  : req.status === 'rejected'
                                  ? 'rgba(239, 68, 68, 0.15)'
                                  : 'rgba(245, 158, 11, 0.15)',
                              color:
                                req.status === 'approved'
                                  ? '#10B981'
                                  : req.status === 'rejected'
                                  ? '#F87171'
                                  : '#FBBF24',
                              border:
                                req.status === 'approved'
                                  ? '1px solid rgba(16, 185, 129, 0.3)'
                                  : req.status === 'rejected'
                                  ? '1px solid rgba(239, 68, 68, 0.3)'
                                  : '1px solid rgba(245, 158, 11, 0.3)',
                            }}
                          >
                            {req.status}
                          </span>
                        </div>
                        <div style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '4px' }}>
                          Phone: <strong style={{ color: '#F4F5F7' }}>{req.student_phone || req.mobile || 'N/A'}</strong> • Request Code: <strong style={{ color: '#38BDF8', fontFamily: 'monospace' }}>{req.request_code || req.id}</strong> • Submitted: {new Date(req.created_at).toLocaleDateString()}
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div style={{ display: 'flex', gap: '8px' }}>
                        {req.status !== 'approved' && (
                          <button
                            type="button"
                            onClick={() =>
                              setReviewModal({
                                request: req,
                                targetStatus: 'approved',
                                note: 'Approved by Transport Office. Pass and daily rides generated.',
                              })
                            }
                            style={{
                              background: '#10B981',
                              color: '#04100C',
                              border: 'none',
                              padding: '8px 18px',
                              borderRadius: '6px',
                              fontSize: '12px',
                              fontWeight: 800,
                              cursor: 'pointer',
                              boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)',
                            }}
                          >
                            Approve Pass
                          </button>
                        )}
                        {req.status !== 'rejected' && (
                          <button
                            type="button"
                            onClick={() =>
                              setReviewModal({
                                request: req,
                                targetStatus: 'rejected',
                                note: 'Rejected: Please provide recent certified medical slip with campus clinic stamp.',
                              })
                            }
                            style={{
                              background: 'rgba(239, 68, 68, 0.15)',
                              color: '#F87171',
                              border: '1px solid rgba(239, 68, 68, 0.3)',
                              padding: '8px 18px',
                              borderRadius: '6px',
                              fontSize: '12px',
                              fontWeight: 800,
                              cursor: 'pointer',
                            }}
                          >
                            Reject
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Route and Condition Grid */}
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                        gap: '12px',
                        background: 'rgba(0, 0, 0, 0.25)',
                        padding: '14px 18px',
                        borderRadius: '10px',
                        fontSize: '12px',
                        border: '1px solid rgba(255, 255, 255, 0.05)',
                      }}
                    >
                      <div>
                        <span style={{ color: '#9CA3AF' }}>Route: </span>
                        <strong style={{ color: '#F4F5F7' }}>{req.route || `${req.pickup} → ${req.drop_station}`}</strong>
                      </div>
                      <div>
                        <span style={{ color: '#9CA3AF' }}>Condition: </span>
                        <strong style={{ color: '#F59E0B' }}>{req.medical_condition}</strong>
                      </div>
                      <div>
                        <span style={{ color: '#9CA3AF' }}>Duration: </span>
                        <strong style={{ color: '#F4F5F7' }}>{req.duration}</strong>
                      </div>
                      <div>
                        <span style={{ color: '#9CA3AF' }}>Dispatch Slots: </span>
                        <strong style={{ color: '#38BDF8' }}>
                          {Array.isArray(req.time_slots) ? req.time_slots.join(' • ') : 'Daily Scheduled'}
                        </strong>
                      </div>
                    </div>

                    <div style={{ fontSize: '12px', color: '#D1D5DB' }}>
                      <span style={{ color: '#9CA3AF' }}>Medical Note: </span>
                      {req.reason}
                    </div>

                    {req.admin_notes && (
                      <div style={{ fontSize: '12px', color: '#FBBF24', background: 'rgba(245, 158, 11, 0.08)', padding: '8px 12px', borderRadius: '6px' }}>
                        <span>Reviewer Note: </span>
                        <strong>{req.admin_notes}</strong>
                      </div>
                    )}

                    {/* View Certificate with Short-Lived Signed URL */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '4px' }}>
                      <span style={{ fontSize: '12px', color: '#9CA3AF' }}>Medical Certificate:</span>
                      <button
                        type="button"
                        onClick={() => handleOpenCertificate(req)}
                        disabled={docLoading}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#38BDF8',
                          textDecoration: 'underline',
                          cursor: 'pointer',
                          fontSize: '12px',
                          fontWeight: 700,
                          padding: 0,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <span>📄 View Certificate via Signed URL (60s Expiry)</span>
                        {docLoading && <span style={{ fontSize: '10px', color: '#9CA3AF' }}>(generating...)</span>}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 2: DRIVER ACCOUNTS & APPROVALS                       */}
        {/* ======================================================== */}
        {!loading && activeTab === 'drivers' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 800, margin: 0 }}>Driver Approvals & Fleet Cart Assignments</h2>
                <p style={{ fontSize: '12px', color: '#9CA3AF', margin: '4px 0 0 0' }}>
                  Authorize new driver accounts from 'pending_approval' to 'active', suspend drivers, and assign dedicated EV carts.
                </p>
              </div>
              <button
                type="button"
                onClick={loadAdminData}
                style={{
                  background: 'rgba(255, 255, 255, 0.06)',
                  color: '#D1D5DB',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  padding: '8px 14px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                ↻ Refresh Drivers
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {drivers.map((drv) => {
                const isPending = drv.status === 'pending_approval';
                const isActive = drv.status === 'active';
                const isSuspended = drv.status === 'suspended';
                const assignedCartId = drv.details?.cart_id || '';

                return (
                  <div
                    key={drv.id}
                    style={{
                      background: '#1C2128',
                      border: isPending
                        ? '1px solid rgba(245, 158, 11, 0.4)'
                        : isSuspended
                        ? '1px solid rgba(239, 68, 68, 0.4)'
                        : '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '12px',
                      padding: '20px 24px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '16px',
                      boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '16px', fontWeight: 800 }}>{drv.full_name || 'Driver'}</span>
                        <span
                          style={{
                            fontSize: '11px',
                            fontFamily: 'monospace',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            background: 'rgba(255,255,255,0.08)',
                            color: '#9CA3AF',
                          }}
                        >
                          {drv.details?.driver_code || drv.login_identifier || 'DRV-OPERATOR'}
                        </span>
                        <span
                          style={{
                            fontSize: '11px',
                            padding: '3px 10px',
                            borderRadius: '6px',
                            fontWeight: 800,
                            textTransform: 'uppercase',
                            background: isActive
                              ? 'rgba(16, 185, 129, 0.15)'
                              : isPending
                              ? 'rgba(245, 158, 11, 0.15)'
                              : 'rgba(239, 68, 68, 0.15)',
                            color: isActive ? '#10B981' : isPending ? '#FBBF24' : '#F87171',
                            border: isActive
                              ? '1px solid rgba(16, 185, 129, 0.3)'
                              : isPending
                              ? '1px solid rgba(245, 158, 11, 0.3)'
                              : '1px solid rgba(239, 68, 68, 0.3)',
                          }}
                        >
                          {drv.status}
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '6px' }}>
                        Phone: <strong style={{ color: '#F4F5F7' }}>{drv.phone || 'N/A'}</strong> • Email: {drv.email} • Shift Status: {drv.details?.is_online ? '🟢 Online' : '⚪ Offline'}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                      {/* Cart Assignment Dropdown */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={{ fontSize: '11px', color: '#9CA3AF', fontWeight: 700 }}>Assign Fleet Cart:</span>
                        <select
                          value={assignedCartId}
                          onChange={(e) => handleManageDriver(drv.id, drv.status, e.target.value)}
                          style={{
                            background: '#13161B',
                            color: '#F4F5F7',
                            border: '1px solid rgba(255, 255, 255, 0.15)',
                            padding: '6px 10px',
                            borderRadius: '6px',
                            fontSize: '12px',
                            fontWeight: 600,
                          }}
                        >
                          <option value="">-- No Cart Assigned --</option>
                          {carts.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.cart_number} ({c.status})
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Status Action Buttons */}
                      <div style={{ display: 'flex', gap: '8px', alignSelf: 'flex-end' }}>
                        {!isActive && (
                          <button
                            type="button"
                            onClick={() => handleManageDriver(drv.id, 'active', assignedCartId)}
                            style={{
                              background: '#10B981',
                              color: '#04100C',
                              border: 'none',
                              padding: '8px 16px',
                              borderRadius: '6px',
                              fontSize: '12px',
                              fontWeight: 800,
                              cursor: 'pointer',
                            }}
                          >
                            Approve Account
                          </button>
                        )}

                        {isActive && (
                          <button
                            type="button"
                            onClick={() => handleManageDriver(drv.id, 'suspended', assignedCartId)}
                            style={{
                              background: 'rgba(239, 68, 68, 0.15)',
                              color: '#F87171',
                              border: '1px solid rgba(239, 68, 68, 0.3)',
                              padding: '8px 16px',
                              borderRadius: '6px',
                              fontSize: '12px',
                              fontWeight: 800,
                              cursor: 'pointer',
                            }}
                          >
                            Suspend Driver
                          </button>
                        )}

                        {isSuspended && (
                          <button
                            type="button"
                            onClick={() => handleManageDriver(drv.id, 'active', assignedCartId)}
                            style={{
                              background: 'rgba(56, 189, 248, 0.15)',
                              color: '#38BDF8',
                              border: '1px solid rgba(56, 189, 248, 0.3)',
                              padding: '8px 16px',
                              borderRadius: '6px',
                              fontSize: '12px',
                              fontWeight: 800,
                              cursor: 'pointer',
                            }}
                          >
                            Reactivate
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 3: TODAY'S RIDES OVERVIEW & MANUAL ASSIGNMENT       */}
        {/* ======================================================== */}
        {!loading && activeTab === 'rides' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 800, margin: 0 }}>Today's Scheduled & Priority Rides</h2>
                <p style={{ fontSize: '12px', color: '#9CA3AF', margin: '4px 0 0 0' }}>
                  Real-time transit overview for campus EV carts. Manually assign carts and drivers to any scheduled or extra trip.
                </p>
              </div>
              <button
                type="button"
                onClick={loadAdminData}
                style={{
                  background: 'rgba(255, 255, 255, 0.06)',
                  color: '#D1D5DB',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  padding: '8px 14px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                ↻ Refresh Rides
              </button>
            </div>

            {todayRides.length === 0 ? (
              <div
                style={{
                  background: '#1C2128',
                  borderRadius: '12px',
                  padding: '48px',
                  textAlign: 'center',
                  color: '#9CA3AF',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                }}
              >
                No rides scheduled for today.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {todayRides.map((ride) => {
                  let timeStr = '08:30 AM';
                  try {
                    timeStr = new Date(ride.scheduled_for).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
                  } catch (e) {}

                  const pickupName = ride.pickup_station?.name || 'Campus Station';
                  const dropName = ride.drop_station?.name || 'Destination Core';

                  return (
                    <div
                      key={ride.id}
                      style={{
                        background: '#1C2128',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '12px',
                        padding: '18px 22px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: '16px',
                      }}
                    >
                      <div style={{ flex: 1, minWidth: '260px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span style={{ fontSize: '15px', fontWeight: 800, color: '#38BDF8', fontFamily: 'monospace' }}>
                            {timeStr}
                          </span>
                          <span
                            style={{
                              fontSize: '11px',
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontWeight: 800,
                              textTransform: 'uppercase',
                              background:
                                ride.status === 'completed'
                                  ? 'rgba(16, 185, 129, 0.15)'
                                  : ride.status === 'in_progress' || ride.status === 'arrived'
                                  ? 'rgba(56, 189, 248, 0.15)'
                                  : ride.status === 'skipped'
                                  ? 'rgba(239, 68, 68, 0.12)'
                                  : 'rgba(245, 158, 11, 0.15)',
                              color:
                                ride.status === 'completed'
                                  ? '#10B981'
                                  : ride.status === 'in_progress' || ride.status === 'arrived'
                                  ? '#38BDF8'
                                  : ride.status === 'skipped'
                                  ? '#F87171'
                                  : '#FBBF24',
                            }}
                          >
                            {ride.status}
                          </span>
                          <span style={{ fontSize: '11px', color: '#9CA3AF', fontFamily: 'monospace' }}>
                            {ride.ride_type === 'extra' ? '⚡ EXTRA' : '📅 SCHEDULED'}
                          </span>
                        </div>
                        <div style={{ fontSize: '14px', fontWeight: 700, color: '#F4F5F7', marginTop: '6px' }}>
                          {pickupName} → {dropName}
                        </div>
                        <div style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '2px' }}>
                          Student: <strong style={{ color: '#F4F5F7' }}>{ride.student?.full_name || 'Student'}</strong> ({ride.student?.login_identifier || 'STU'}) • Phone: {ride.student?.phone || 'N/A'}
                        </div>
                      </div>

                      {/* Manual Assignment Selectors */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                        <div>
                          <label style={{ fontSize: '11px', color: '#9CA3AF', display: 'block', marginBottom: '2px', fontWeight: 700 }}>
                            Assigned Cart:
                          </label>
                          <select
                            value={ride.cart_id || ''}
                            onChange={(e) => handleAssignRide(ride.id, e.target.value, ride.driver_id)}
                            style={{
                              background: '#13161B',
                              color: '#F4F5F7',
                              border: '1px solid rgba(255, 255, 255, 0.15)',
                              padding: '6px 10px',
                              borderRadius: '6px',
                              fontSize: '12px',
                            }}
                          >
                            <option value="">-- No Cart --</option>
                            {carts.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.cart_number} ({c.status})
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label style={{ fontSize: '11px', color: '#9CA3AF', display: 'block', marginBottom: '2px', fontWeight: 700 }}>
                            Assigned Driver:
                          </label>
                          <select
                            value={ride.driver_id || ''}
                            onChange={(e) => handleAssignRide(ride.id, ride.cart_id, e.target.value)}
                            style={{
                              background: '#13161B',
                              color: '#F4F5F7',
                              border: '1px solid rgba(255, 255, 255, 0.15)',
                              padding: '6px 10px',
                              borderRadius: '6px',
                              fontSize: '12px',
                            }}
                          >
                            <option value="">-- No Driver --</option>
                            {drivers.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.full_name} ({d.login_identifier || 'DRV'})
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 4: AUDIT LOG VIEWER                                  */}
        {/* ======================================================== */}
        {!loading && activeTab === 'audit' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 800, margin: 0 }}>System Audit Trail</h2>
                <p style={{ fontSize: '12px', color: '#9CA3AF', margin: '4px 0 0 0' }}>
                  Immutable log of all administrator actions, pass reviews, driver status alterations, and ride status dispatches.
                </p>
              </div>

              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="Filter logs by action/actor..."
                  value={auditFilter}
                  onChange={(e) => setAuditFilter(e.target.value)}
                  style={{
                    background: '#13161B',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: '#F4F5F7',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    minWidth: '220px',
                  }}
                />
                <button
                  type="button"
                  onClick={loadAdminData}
                  style={{
                    background: 'rgba(255, 255, 255, 0.06)',
                    color: '#D1D5DB',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    padding: '8px 14px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  ↻ Refresh Logs
                </button>
              </div>
            </div>

            {filteredAuditLogs.length === 0 ? (
              <div
                style={{
                  background: '#1C2128',
                  borderRadius: '12px',
                  padding: '48px',
                  textAlign: 'center',
                  color: '#9CA3AF',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                }}
              >
                No audit logs found matching your filter.
              </div>
            ) : (
              <div
                style={{
                  background: '#1C2128',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '14px',
                  overflow: 'hidden',
                }}
              >
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ background: 'rgba(0, 0, 0, 0.3)', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', color: '#9CA3AF' }}>
                      <th style={{ padding: '14px 16px', fontWeight: 700 }}>Timestamp</th>
                      <th style={{ padding: '14px 16px', fontWeight: 700 }}>Action</th>
                      <th style={{ padding: '14px 16px', fontWeight: 700 }}>Actor</th>
                      <th style={{ padding: '14px 16px', fontWeight: 700 }}>Target Entity</th>
                      <th style={{ padding: '14px 16px', fontWeight: 700 }}>Metadata</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAuditLogs.map((log, idx) => {
                      let dateStr = 'Just now';
                      try {
                        dateStr = new Date(log.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'medium' });
                      } catch (e) {}

                      return (
                        <tr
                          key={log.id || idx}
                          style={{
                            borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                            background: idx % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.015)',
                          }}
                        >
                          <td style={{ padding: '12px 16px', color: '#9CA3AF', fontFamily: 'monospace' }}>
                            {dateStr}
                          </td>
                          <td style={{ padding: '12px 16px' }}>
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '3px 8px',
                                borderRadius: '4px',
                                fontSize: '11px',
                                fontWeight: 800,
                                fontFamily: 'monospace',
                                background:
                                  log.action.includes('APPROV')
                                    ? 'rgba(16, 185, 129, 0.15)'
                                    : log.action.includes('REJECT') || log.action.includes('SUSPEND')
                                    ? 'rgba(239, 68, 68, 0.15)'
                                    : 'rgba(56, 189, 248, 0.15)',
                                color:
                                  log.action.includes('APPROV')
                                    ? '#10B981'
                                    : log.action.includes('REJECT') || log.action.includes('SUSPEND')
                                    ? '#F87171'
                                    : '#38BDF8',
                              }}
                            >
                              {log.action}
                            </span>
                          </td>
                          <td style={{ padding: '12px 16px', color: '#F4F5F7' }}>
                            <strong>{log.actor_name}</strong>
                            <span style={{ fontSize: '10px', color: '#9CA3AF', display: 'block' }}>
                              ({log.actor_role})
                            </span>
                          </td>
                          <td style={{ padding: '12px 16px', color: '#D1D5DB', fontFamily: 'monospace' }}>
                            {log.entity} #{log.entity_id ? log.entity_id.slice(0, 8) : ''}
                          </td>
                          <td style={{ padding: '12px 16px', color: '#9CA3AF', fontFamily: 'monospace', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {JSON.stringify(log.metadata || {})}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Review Pass Modal (Approve or Reject with Custom Reviewer Note) */}
      {reviewModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            background: 'rgba(0, 0, 0, 0.8)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
        >
          <div
            style={{
              background: '#1C2128',
              border: reviewModal.targetStatus === 'approved' ? '1px solid rgba(16, 185, 129, 0.35)' : '1px solid rgba(239, 68, 68, 0.35)',
              borderRadius: '14px',
              maxWidth: '520px',
              width: '100%',
              padding: '28px',
              boxShadow: '0 20px 48px rgba(0, 0, 0, 0.7)',
            }}
          >
            <h3 style={{ fontSize: '18px', fontWeight: 800, margin: '0 0 12px 0' }}>
              {reviewModal.targetStatus === 'approved' ? 'Approve Mobility Pass Request' : 'Reject Mobility Pass Request'}
            </h3>
            <p style={{ fontSize: '13px', color: '#9CA3AF', margin: '0 0 18px 0', lineHeight: 1.5 }}>
              Student: <strong style={{ color: '#F4F5F7' }}>{reviewModal.request.student_name}</strong> ({reviewModal.request.student_code})
              <br />
              Condition: <strong style={{ color: '#F59E0B' }}>{reviewModal.request.medical_condition}</strong>
            </p>

            <label style={{ fontSize: '12px', fontWeight: 700, color: '#D1D5DB', display: 'block', marginBottom: '6px' }}>
              Reviewer Note (Sent to student):
            </label>
            <textarea
              rows={3}
              value={reviewModal.note}
              onChange={(e) => setReviewModal({ ...reviewModal, note: e.target.value })}
              style={{
                width: '100%',
                background: '#13161B',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#F4F5F7',
                padding: '10px 12px',
                borderRadius: '8px',
                fontSize: '13px',
                boxSizing: 'border-box',
                resize: 'vertical',
                marginBottom: '20px',
              }}
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setReviewModal(null)}
                style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  color: '#D1D5DB',
                  border: 'none',
                  padding: '10px 18px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecutePassReview}
                style={{
                  background: reviewModal.targetStatus === 'approved' ? '#10B981' : '#EF4444',
                  color: '#04100C',
                  border: 'none',
                  padding: '10px 22px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 800,
                  cursor: 'pointer',
                  boxShadow: reviewModal.targetStatus === 'approved' ? '0 4px 14px rgba(16, 185, 129, 0.4)' : '0 4px 14px rgba(239, 68, 68, 0.4)',
                }}
              >
                Confirm {reviewModal.targetStatus === 'approved' ? 'Approval' : 'Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Document Preview Modal (Using 60s Signed URL) */}
      {selectedDoc && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            background: 'rgba(0, 0, 0, 0.85)',
            backdropFilter: 'blur(10px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
        >
          <div
            style={{
              background: '#1C2128',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '14px',
              maxWidth: '620px',
              width: '100%',
              padding: '26px',
              boxShadow: '0 24px 50px rgba(0, 0, 0, 0.8)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h3 style={{ fontSize: '17px', fontWeight: 800, margin: 0 }}>Verified Medical Document</h3>
                <div style={{ fontSize: '11px', color: '#10B981', marginTop: '2px', fontFamily: 'monospace' }}>
                  PROTECTED SECURE SIGNED URL • EXPIRES IN 60 SECONDS
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDoc(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#9CA3AF',
                  fontSize: '22px',
                  cursor: 'pointer',
                }}
              >
                ×
              </button>
            </div>

            <div
              style={{
                background: '#13161B',
                borderRadius: '10px',
                padding: '24px',
                textAlign: 'center',
                marginBottom: '20px',
                border: '1px dashed rgba(255, 255, 255, 0.18)',
              }}
            >
              <div style={{ fontSize: '42px', marginBottom: '12px' }}>📑</div>
              <div style={{ fontSize: '15px', fontWeight: 700, color: '#F4F5F7' }}>{selectedDoc.name}</div>
              <div style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '4px' }}>
                Student: {selectedDoc.studentName} • Condition: {selectedDoc.condition}
              </div>

              {selectedDoc.url && (
                <div style={{ marginTop: '20px' }}>
                  <a
                    href={selectedDoc.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: 'inline-block',
                      background: '#10B981',
                      color: '#04100C',
                      padding: '10px 22px',
                      borderRadius: '8px',
                      textDecoration: 'none',
                      fontSize: '13px',
                      fontWeight: 800,
                      boxShadow: '0 4px 14px rgba(16, 185, 129, 0.35)',
                    }}
                  >
                    Open Certificate in Secure Window ↗
                  </a>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setSelectedDoc(null)}
              style={{
                width: '100%',
                background: 'rgba(255, 255, 255, 0.08)',
                color: '#F4F5F7',
                border: 'none',
                padding: '12px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Close Document Preview
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
