export const APPROVED_REPLY =
  "You've been approved by the operator. Please send your original message again.";

export const DENIED_REPLY = "Sorry, I'm not available to you right now.";

export const NOT_AUTHORIZED_EPHEMERAL = "Only the operator can resolve this approval.";

export function ownerCardHeader(): string {
  return "🦞 New user wants to talk to Archi";
}

export function ownerCardResolved(
  decision: "approved" | "denied",
  operatorName: string,
  ts: Date,
): string {
  const icon = decision === "approved" ? "✅" : "❌";
  const verb = decision === "approved" ? "Approved" : "Denied";
  const time = ts.toISOString().slice(11, 16);
  return `${icon} ${verb} by ${operatorName} at ${time}`;
}
