"use client";
export default function PageError({ reset }: { reset: () => void }) {
  return (
    <main className="loading">
      <section>
        <h1>Could not load Stash</h1>
        <p>Your session could not be checked. Please try again.</p>
        <button className="button primary" onClick={reset}>
          Try again
        </button>
      </section>
    </main>
  );
}
