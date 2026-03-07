import { collectStartupValidationReport } from "@/lib/startup-validation";

export async function GET() {
  const report = collectStartupValidationReport();
  return Response.json(
    {
      status: report.status,
      timestamp: new Date().toISOString(),
      checks: report.checks,
    },
    {
      status: report.status === "ok" ? 200 : 500,
      headers: { "Cache-Control": "no-store" },
    }
  );
}
