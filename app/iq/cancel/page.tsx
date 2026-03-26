import Link from 'next/link';

export default function IqCancelPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h1 className="mb-4 text-3xl font-bold">Checkout canceled</h1>
        <p className="mb-8 text-white/70">Your payment was not completed.</p>
        <Link href="/iq" className="text-emerald-400 underline">
          Back to analyzer
        </Link>
      </div>
    </main>
  );
}
