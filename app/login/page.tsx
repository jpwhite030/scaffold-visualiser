import LoginForm from './LoginForm';

export const metadata = {
  title: 'Sign in — Scaffold Visualiser',
};

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Scaffold Visualiser</h1>
          <p className="text-gray-500 text-sm">Sign in to continue</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
