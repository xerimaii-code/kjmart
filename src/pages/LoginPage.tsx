
import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { SpinnerIcon } from '../components/Icons';
import { useLocalStorage } from '../hooks/useLocalStorage';

const LoginPage: React.FC = () => {
    const [savedEmail, setSavedEmail] = useLocalStorage<string>('savedLoginEmail', '', { deviceSpecific: true });
    const [email, setEmail] = useState(savedEmail || '');
    const [password, setPassword] = useState('');
    const [rememberEmail, setRememberEmail] = useState(!!savedEmail);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const { login } = useAuth();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setIsLoading(true);

        try {
            await login(email, password);
            if (rememberEmail) {
                setSavedEmail(email);
            } else {
                setSavedEmail(null);
            }
        } catch (err) {
            // Refined error handling for Firebase Auth errors
            let errorMessage = '로그인에 실패했습니다. 다시 시도해주세요.';
            
            if (err && typeof err === 'object' && 'code' in err) {
                const firebaseError = err as { code: string };
                
                // Log as warning for expected auth failures to avoid alarming console errors
                console.warn(`Login failed: ${firebaseError.code}`);

                switch (firebaseError.code) {
                    case 'auth/user-not-found':
                    case 'auth/wrong-password':
                    case 'auth/invalid-credential':
                        errorMessage = '이메일 또는 비밀번호가 올바르지 않습니다.';
                        setPassword(''); // Clear password on failure for security/UX
                        break;
                    case 'auth/invalid-email':
                        errorMessage = '유효하지 않은 이메일 형식입니다.';
                        break;
                    case 'auth/too-many-requests':
                        errorMessage = '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.';
                        break;
                    case 'auth/user-disabled':
                        errorMessage = '비활성화된 계정입니다. 관리자에게 문의하세요.';
                        break;
                    case 'auth/network-request-failed':
                        errorMessage = '네트워크 연결 상태를 확인해주세요.';
                        break;
                    default:
                        console.error('Unexpected login error:', err);
                }
            } else {
                console.error('Unexpected login error:', err);
            }
            setError(errorMessage);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="h-full w-full flex flex-col items-center justify-center p-4">
            <div className="w-full max-w-sm">
                <div className="text-center mb-8">
                    <h1 className="text-4xl font-extrabold text-gray-800 tracking-tight">KJ Mart</h1>
                    <p className="text-gray-500 mt-2 text-base">관리자 계정으로 로그인하세요.</p>
                </div>
                
                <form onSubmit={handleSubmit} className="bg-white shadow-xl rounded-xl p-6 sm:p-8 space-y-6 border border-gray-200">
                    <div className="space-y-4">
                        <div>
                            <label htmlFor="email" className="block text-sm font-bold text-gray-700 mb-2">
                                이메일
                            </label>
                            <input
                                id="email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                className="w-full px-4 py-2.5 border border-gray-300 bg-white rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200"
                                placeholder="admin@example.com"
                                autoComplete="email"
                            />
                        </div>
                        <div>
                            <label htmlFor="password"  className="block text-sm font-bold text-gray-700 mb-2">
                                비밀번호
                            </label>
                            <input
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                className="w-full px-4 py-2.5 border border-gray-300 bg-white rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200"
                                placeholder="••••••••"
                                autoComplete="current-password"
                            />
                        </div>
                    </div>
                    
                    <div className="flex items-center">
                        <input
                            id="remember-email"
                            name="remember-email"
                            type="checkbox"
                            checked={rememberEmail}
                            onChange={(e) => setRememberEmail(e.target.checked)}
                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <label htmlFor="remember-email" className="ml-2 block text-sm text-gray-900 select-none cursor-pointer">
                            이메일 기억하기
                        </label>
                    </div>

                    {error && (
                        <p className="text-red-600 text-sm text-center font-semibold bg-red-50 p-3 rounded-lg border border-red-200 animate-fade-in-down">
                            {error}
                        </p>
                    )}

                    <button
                        type="submit"
                        disabled={isLoading}
                        className="relative w-full bg-blue-600 text-white py-2.5 rounded-lg font-bold text-lg hover:bg-blue-700 transition shadow-md shadow-blue-500/30 disabled:bg-gray-400 disabled:shadow-none disabled:cursor-not-allowed flex items-center justify-center active:scale-95"
                    >
                        <span className={isLoading ? 'opacity-0' : 'opacity-100'}>로그인</span>
                        {isLoading && (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <SpinnerIcon className="w-6 h-6" />
                            </div>
                        )}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default LoginPage;
