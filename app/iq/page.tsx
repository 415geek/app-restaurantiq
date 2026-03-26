'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function IqLandingPage() {
  const [location, setLocation] = useState('');
  const [businessType, setBusinessType] = useState('');
  const router = useRouter();

  function handleSubmit() {
    if (!location.trim()) return;
    const params = new URLSearchParams({ location, businessType });
    router.push(`/iq/result?${params.toString()}`);
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-2xl text-center">
        <div className="mb-6 inline-flex rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70">
          RestaurantIQ · Location check
        </div>
        <h1 className="mb-4 text-4xl font-bold tracking-tight text-white md:text-6xl">Should You Open a Restaurant Here?</h1>
        <p className="mb-10 text-lg text-white/70 md:text-xl">AI will tell you before you lose $300,000</p>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-2xl md:p-6">
          <div className="space-y-4">
            <input
              type="text"
              placeholder="Enter restaurant address..."
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full rounded-xl bg-white px-4 py-4 text-black outline-none"
            />
            <input
              type="text"
              placeholder="Business type (optional) e.g. Hong Kong Cafe"
              value={businessType}
              onChange={(e) => setBusinessType(e.target.value)}
              className="w-full rounded-xl bg-white px-4 py-4 text-black outline-none"
            />
            <button
              type="button"
              onClick={handleSubmit}
              className="w-full rounded-xl bg-emerald-400 px-6 py-4 font-semibold text-black transition hover:bg-emerald-300"
            >
              Analyze Location
            </button>
          </div>
        </div>
        <p className="mt-6 text-sm text-white/40">One decision can save you six figures.</p>
      </div>
    </main>
  );
}
