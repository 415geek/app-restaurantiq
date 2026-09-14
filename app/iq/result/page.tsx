'use client';

/**
 * /iq/result?location=…&businessType=…[&monthlyRentUsd&sqft&lang]
 *
 * Parameter entry from the landing form: runs the (idempotent) free analysis
 * once and replaces itself with the canonical `/iq/result/<reportId>` URL, so
 * a refresh, back-navigation or share never re-runs analysis or creates a new
 * row. The UI lives in ResultClient and is shared with the canonical route.
 */
import { Suspense } from 'react';
import { RESULT_LOADING_COPY, ResultClient } from './ResultClient';

export default function IqResultPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center px-6">
          <p className="text-lg">{RESULT_LOADING_COPY}</p>
        </main>
      }
    >
      <ResultClient mode="query" />
    </Suspense>
  );
}
