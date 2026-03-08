import { revokeMcpAccessToken } from "@/lib/mcp-auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const formData = await req.formData();
  const token = formData.get("token");

  if (typeof token === "string" && token.trim()) {
    await revokeMcpAccessToken(token.trim());
  }

  return new Response(null, { status: 200 });
}
