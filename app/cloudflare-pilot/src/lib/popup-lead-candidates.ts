export type PopupLeadCandidate = {
  id: string;
  email: string | null;
  tags: string[];
  emailMarketingConsent: { marketingState: string } | null;
};

export function mergePopupLeadCandidates(...groups: PopupLeadCandidate[][]): PopupLeadCandidate[] {
  const candidates = new Map<string, PopupLeadCandidate>();
  for (const group of groups) {
    for (const candidate of group) candidates.set(candidate.id, candidate);
  }
  return [...candidates.values()];
}
