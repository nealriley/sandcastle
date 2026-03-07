import { redirect } from "next/navigation";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ viewToken: string }>;
}) {
  const { viewToken } = await params;
  redirect(`/sandboxes/${encodeURIComponent(viewToken)}`);
}
