import { z } from "zod";
export const summaryClaim = z.object({ text: z.string().trim().min(1).max(700).refine(value=>!value.includes("\u0000"),"Unsupported control character"), sourceIds: z.array(z.string().regex(/^s[1-9][0-9]?$/)).min(1).max(40), quote: z.string().trim().min(12).max(300) }).strict();
export const summaryResult = z.object({ overview: summaryClaim, points: z.array(summaryClaim).min(1).max(5) }).strict();
export type SummaryResult = z.infer<typeof summaryResult>;
export type SummarySource = { id: string; label: string; text: string; page?: number };
export type SummarySnapshot = { kind: "link" | "pdf"; url?: string; sources: SummarySource[]; partial: boolean; totalCharacters: number; includedCharacters: number };
export type SavedSummary = { imported: boolean; result: SummaryResult; model: string; createdAt: string; sourceRevision: number; sourceHash: string; sources: (Omit<SummarySource, "text"> & { excerpt: string })[]; partial: boolean; stale: boolean };
export type SummaryStatus = {
 available: boolean; saved: SavedSummary | null;
 job: { id: string; state: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "unknown"; errorCode: string | null; createdAt: string } | null;
 limits: { dailyRequests: number; dailyTokenReservation: number; monthlyGlobalRequests: number; monthlySpendUsd: 0 };
 usage: { requestsToday: number; reservedTokensToday: number };
};
export const SUMMARY_LIMITS = { dailyRequests: 5, dailyTokenReservation: 300000, monthlyGlobalRequests: 1000, dailyGlobalRequests: 100, monthlySpendUsd: 0, reservationTokens: 60000 } as const;
