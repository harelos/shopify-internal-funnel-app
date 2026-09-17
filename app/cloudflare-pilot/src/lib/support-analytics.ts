export type SupportSendActor = "AUTOMATION_POLICY" | "OWNER_ADMIN" | "AGENT_API";

export interface SupportSendSummary {
  total: number;
  automatic: number;
  ownerApproved: number;
  agentApproved: number;
  unclassified: number;
}

function authorizationActor(payloadJson: string): { draftId: string; actor: SupportSendActor | "" } {
  try {
    const payload = JSON.parse(payloadJson || "{}");
    const actor = new Set<SupportSendActor>(["AUTOMATION_POLICY", "OWNER_ADMIN", "AGENT_API"]).has(payload.actor)
      ? payload.actor as SupportSendActor
      : "";
    return { draftId: String(payload.draftId || ""), actor };
  } catch {
    return { draftId: "", actor: "" };
  }
}

export function summarizeSupportSendAuthorizations(
  drafts: Array<{ id: string; status: string; sentAt: Date | null }>,
  evidence: Array<{ payloadJson: string }>,
  since: Date,
): SupportSendSummary {
  const actors = new Map(evidence.map(event => {
    const authorization = authorizationActor(event.payloadJson);
    return [authorization.draftId, authorization.actor] as const;
  }).filter(([draftId]) => Boolean(draftId)));
  const summary: SupportSendSummary = { total: 0, automatic: 0, ownerApproved: 0, agentApproved: 0, unclassified: 0 };
  for (const draft of drafts) {
    if (!["SENT", "BOUNCED"].includes(draft.status) || !draft.sentAt || draft.sentAt < since) continue;
    summary.total += 1;
    const actor = actors.get(draft.id);
    if (actor === "AUTOMATION_POLICY") summary.automatic += 1;
    else if (actor === "OWNER_ADMIN") summary.ownerApproved += 1;
    else if (actor === "AGENT_API") summary.agentApproved += 1;
    else summary.unclassified += 1;
  }
  return summary;
}
