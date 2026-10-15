import { validateSummary, type SummaryProvider } from "../apps/server/src/summary-provider.js";
// External-provider test double only. Real-provider acceptance is recorded separately.
export const verificationSummaryProvider: SummaryProvider = {
  model: "verification/provider:free",
  async preflight() {},
  async generate(snapshot,signal) {
    if (signal.aborted) throw new Error("Cancelled");
    const first=snapshot.sources[0], text=first.text.slice(0,240), quote=first.text.slice(0,120);
    return { model:"verification/provider:free", tokens:200, cost:0,
      result:validateSummary({overview:{text,sourceIds:[first.id],quote},points:[{text:"This summary refers to the saved source text.",sourceIds:[first.id],quote}]},snapshot) };
  },
};
