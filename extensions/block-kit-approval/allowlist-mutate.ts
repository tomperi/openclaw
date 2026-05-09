export type ApproveResult = {
  ok: boolean;
  error?: string;
};

export async function approveRequest(_params: {
  reqId: string;
  accountId: string;
}): Promise<ApproveResult> {
  throw new Error("approveRequest: not implemented (step 6)");
}
