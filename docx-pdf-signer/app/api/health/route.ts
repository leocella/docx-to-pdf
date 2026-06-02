import { gotenbergHealthy } from "@/lib/gotenberg";
import { signerHealthy } from "@/lib/signer-client";

export const runtime = "nodejs";

export async function GET() {
  const [gotenberg, signer] = await Promise.all([gotenbergHealthy(), signerHealthy()]);
  const ok = gotenberg && signer;
  return Response.json({ status: ok ? "ok" : "degraded", services: { gotenberg, signer } }, { status: ok ? 200 : 503 });
}
