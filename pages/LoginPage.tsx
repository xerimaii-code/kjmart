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
            // On successful login, AuthContext will trigger a re-render in App.tsx
            if (rememberEmail) {
                setSavedEmail(email);
            } else {
                setSavedEmail(null);
            }
        } catch (err) {
            console.error(err);
            if (err instanceof Error) {
                switch ((err as any).code) {
                    case 'auth/user-not-found':
                    case 'auth/wrong-password':
                    case 'auth/invalid-credential':
                        setError('이메일 또는 비밀번호가 올바르지 않습니다.');
                        break;
                    case 'auth/invalid-email':
                        setError('유효하지 않은 이메일 형식입니다.');
                        break;
                    default:
                        setError('로그인에 실패했습니다. 다시 시도해주세요.');
                        break;
                }
            }
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="h-full w-full flex flex-col items-center justify-center bg-gray-100 p-4">
            <div className="w-full max-w-sm">
                <div className="text-center mb-10">
                    <h1 className="text-4xl font-bold text-gray-800">경진마트 발주관리</h1>
                    <p className="text-gray-500 mt-2">관리자 계정으로 로그인하세요.</p>
                </div>
                
                <form onSubmit={handleSubmit} className="bg-white shadow-2xl rounded-2xl p-8 space-y-6">
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
                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
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
                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
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
                        <p className="text-red-500 text-sm text-center bg-red-50 p-3 rounded-lg border border-red-200">
                            {error}
                        </p>
                    )}

                    <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold text-lg hover:bg-blue-700 transition shadow-lg shadow-blue-500/30 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center"
                    >
                        {isLoading ? <SpinnerIcon className="w-6 h-6" /> : '로그인'}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default LoginPage;