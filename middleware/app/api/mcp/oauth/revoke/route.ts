import { NextResponse } from "next/server";
import { revokeMcpAccessToken } from "@/lib/mcp-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const formData = await req.formData();
  const token = formData.get("token");

  if (typeof token === "string" && token.trim()) {
    await revokeMcpAccessToken(token.trim());
  }

  return new NextResponse(null, { status: 200 });
}
