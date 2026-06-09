import LoginForm from './LoginForm';

export const metadata = {
  title: 'Sign in — Scaffold Visualiser',
};

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Scaffold Visualiser" className="mx-auto w-full max-w-[240px] mb-4" />
          <p className="text-gray-500 text-sm">Sign in to continue</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
