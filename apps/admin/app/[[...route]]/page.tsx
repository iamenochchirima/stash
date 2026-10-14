import { Suspense } from "react";
import { AdminClient } from "../admin-client";
export default async function Page({ params }: { params: Promise<{ route?: string[] }> }) {
  const { route = [] } = await params;
  return <Suspense fallback={<main className="auth-page"><p role="status">Loading…</p></main>}><AdminClient route={route} /></Suspense>;
}
