export function extractSupportOrderNumber(subject: string, newestInboundBody: string): string | null {
  return `${subject}\n${newestInboundBody}`.match(/#\s*(\d{3,})/)?.[1] || null;
}
