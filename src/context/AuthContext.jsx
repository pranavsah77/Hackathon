import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase, loginUser, signupUser, logoutUser, getSessionProfile } from '../lib/supabase.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Sync session and profile from Supabase
  const syncSession = useCallback(async () => {
    try {
      const sessionData = await getSessionProfile();
      if (sessionData && sessionData.user && sessionData.profile) {
        const { user, profile } = sessionData;
        setCurrentUser({
          id: user.id,
          email: user.email,
          role: profile.role || 'student',
          fullName: profile.full_name || 'Campus Rider',
          phone: profile.phone || '',
          studentId: profile.login_identifier || profile.student_id || '',
          driverId: profile.login_identifier || profile.driver_id || '',
          cartNumber: profile.login_identifier?.startsWith('CART-')
            ? profile.login_identifier
            : (profile.driver_id || 'CART-04'),
          residencyStatus: profile.residency_status || 'Hostler',
          hostelBlock: profile.hostel_block || 'Hostel Resident',
          status: profile.status || 'active',
          driverApproved: profile.status === 'active' || profile.driver_approved === true,
        });
      } else {
        setCurrentUser(null);
      }
    } catch (err) {
      console.warn('AuthContext session sync error:', err);
      setCurrentUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    syncSession();

    // Listen for auth state changes (sign-in, token refresh, sign-out)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        if (session?.user) {
          await syncSession();
        }
      } else if (event === 'SIGNED_OUT') {
        setCurrentUser(null);
        setIsLoading(false);
      }
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, [syncSession]);

  const handleLogin = async (credentials) => {
    const result = await loginUser(credentials);
    if (result && result.session) {
      await syncSession();
    }
    return result;
  };

  const handleSignup = async (credentials) => {
    const result = await signupUser(credentials);
    if (result && result.session && !result.pendingApproval) {
      await syncSession();
    }
    return result;
  };

  const handleLogout = async () => {
    await logoutUser();
    setCurrentUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        setCurrentUser,
        role: currentUser?.role || null,
        status: currentUser?.status || null,
        isStudent: currentUser?.role === 'student',
        isDriver: currentUser?.role === 'driver',
        isAdmin: currentUser?.role === 'admin',
        isDriverApproved: currentUser?.role === 'driver' && currentUser?.status === 'active',
        isLoading,
        login: handleLogin,
        signup: handleSignup,
        logout: handleLogout,
        refreshSession: syncSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
