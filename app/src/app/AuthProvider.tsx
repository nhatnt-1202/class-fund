import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { friendlyError, isConfigured, supabase } from '@/lib/supabase';
import type { Profile } from '@/types/db';

interface AuthCtx {
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  configured: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, fullName: string) => Promise<void>;
  signOut: () => Promise<void>;
  sendReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({} as AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  const loadProfile = useCallback(async (uid: string | undefined) => {
    if (!uid) {
      setProfile(null);
      return;
    }
    const { data, error } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
    if (error) {
      console.error('Không tải được thông tin tài khoản:', error.message);
      setProfile(null);
      return;
    }
    setProfile((data as Profile | null) ?? null);
  }, []);

  useEffect(() => {
    if (!isConfigured) {
      setLoading(false);
      return;
    }
    let alive = true;
    void supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      setSession(data.session);
      await loadProfile(data.session?.user.id);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      void loadProfile(s?.user.id);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(friendlyError(error));
    // Ghi vết đăng nhập vào audit log (và cập nhật last_sign_in_at) — lỗi ở đây
    // không được cản người dùng vào app.
    const { error: logErr } = await supabase.rpc('log_event', {
      p_action: 'LOGIN',
      p_summary: `${email.trim()} đã đăng nhập`,
      p_meta: null,
    });
    if (logErr) console.warn('Không ghi được log đăng nhập:', logErr.message);
  }, []);

  const signUp = useCallback(async (email: string, password: string, fullName: string) => {
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: fullName.trim() } },
    });
    if (error) throw new Error(friendlyError(error));
  }, []);

  const signOut = useCallback(async () => {
    await supabase.rpc('log_event', { p_action: 'LOGOUT', p_summary: 'Đã đăng xuất', p_meta: null });
    await supabase.auth.signOut();
    setProfile(null);
  }, []);

  const sendReset = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) throw new Error(friendlyError(error));
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new Error(friendlyError(error));
  }, []);

  const value = useMemo<AuthCtx>(() => ({
    loading, session, profile, configured: isConfigured,
    signIn, signUp, signOut, sendReset, updatePassword,
    refreshProfile: () => loadProfile(session?.user.id),
  }), [loading, session, profile, signIn, signUp, signOut, sendReset, updatePassword, loadProfile]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
