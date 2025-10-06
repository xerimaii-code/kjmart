import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, User } from 'firebase/auth';
import { initDB } from '../services/dbService';

// 관리자 이메일 (이곳을 수정하여 실제 관리자 이메일로 변경하세요)
const ADMIN_EMAIL = 'xerimaii@gmail.com';

interface AuthContextType {
    user: User | null;
    loading: boolean;
    isAdmin: boolean;
    login: (email: string, pass: string) => Promise<void>;
    logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const initialize = async () => {
            await initDB();
            const auth = getAuth();
            const unsubscribe = onAuthStateChanged(auth, (user) => {
                setUser(user);
                setLoading(false);
            });
            return unsubscribe;
        };
        
        const unsubscribePromise = initialize();

        return () => {
            unsubscribePromise.then(unsubscribe => unsubscribe && unsubscribe());
        };
    }, []);

    const login = async (email: string, pass: string) => {
        const auth = getAuth();
        await signInWithEmailAndPassword(auth, email, pass);
    };

    const logout = async () => {
        const auth = getAuth();
        await signOut(auth);
    };
    
    const isAdmin = user?.email === ADMIN_EMAIL;

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
