import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { auth, isFirebaseInitialized, FirebaseUser } from '../services/dbService';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';

// 관리자 이메일 목록 (이곳을 수정하여 실제 관리자 이메일로 변경하세요)
const ADMIN_EMAILS = ['xerimaii@gmail.com'];

interface AuthContextType {
    user: FirebaseUser | null;
    loading: boolean;
    isAdmin: boolean;
    login: (email: string, pass: string) => Promise<void>;
    logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<FirebaseUser | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Use the eagerly initialized auth object. If it's null, initialization failed.
        if (!isFirebaseInitialized || !auth) {
            console.warn("Auth service not available. Skipping auth state listener.");
            setLoading(false);
            return;
        }
        try {
            const unsubscribe = onAuthStateChanged(auth, (user) => {
                setUser(user);
                setLoading(false);
            });
            return unsubscribe;
        } catch (error) {
            console.error("Auth listener setup failed:", error);
            setLoading(false);
        }
    }, []);

    const login = async (email: string, pass: string) => {
        if (!auth) {
            throw new Error("인증 서비스를 사용할 수 없습니다. Firebase 설정을 확인하세요.");
        }
        await signInWithEmailAndPassword(auth, email, pass);
    };

    const logout = async () => {
        if (!auth) {
            // Silently fail, as user is already effectively logged out if auth isn't available.
            return;
        }
        try {
            await signOut(auth);
        } catch (error) {
            console.error("Logout failed:", error);
        }
    };
    
    // Check if the user's email is in the admin list (case-insensitive).
    const isAdmin = user?.email ? ADMIN_EMAILS.map(email => email.toLowerCase()).includes(user.email.toLowerCase()) : false;

    const value = {
        user,
        loading,
        isAdmin,
        login,
        logout,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};