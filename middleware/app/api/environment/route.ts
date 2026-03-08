import { NextRequest } from "next/server";
import { getWebsiteUser } from "@/auth";
import {
  deleteUserEnvironmentVariable,
  listUserEnvironmentVariables,
  upsertUserEnvironmentVariable,
} from "@/lib/user-environment";

function authRequiredResponse() {
  return Response.json(
    { error: "Sign in with GitHub before managing environment variables." },
    { status: 401 }
  );
}

function noStoreHeaders() {
  return { "Cache-Control": "no-store" };
}

export async function GET() {
  const user = await getWebsiteUser();
  if (!user) {
    return authRequiredResponse();
  }

  try {
    const variables = await listUserEnvironmentVariables(user.id);
    return Response.json(
      { variables },
      { headers: noStoreHeaders() }
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load environment variables.",
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const user = await getWebsiteUser();
  if (!user) {
    return authRequiredResponse();
  }

  let body: {
    key?: string;
    value?: string;
    secret?: boolean;
  };
  try {
    body = (await req.json()) as {
      key?: string;
      value?: string;
      secret?: boolean;
    };
  } catch {
    return Response.json(
      { error: "Invalid JSON in request body." },
      { status: 400 }
    );
  }

  if (typeof body.key !== "string") {
    return Response.json(
      { error: "Missing or invalid 'key' field." },
      { status: 400 }
    );
  }

  if (typeof body.value !== "string") {
    return Response.json(
      { error: "Missing or invalid 'value' field." },
      { status: 400 }
    );
  }

  try {
    const variables = await upsertUserEnvironmentVariable({
      userId: user.id,
      key: body.key,
      value: body.value,
      secret: body.secret !== false,
    });
    return Response.json(
      { variables },
      { headers: noStoreHeaders() }
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to save environment variable.",
      },
      { status: 400 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const user = await getWebsiteUser();
  if (!user) {
    return authRequiredResponse();
  }

  const key = req.nextUrl.searchParams.get("key");
  if (!key) {
    return Response.json(
      { error: "Missing 'key' query parameter." },
      { status: 400 }
    );
  }

  try {
    const variables = await deleteUserEnvironmentVariable({
      userId: user.id,
      key,
    });
    return Response.json(
      { variables },
      { headers: noStoreHeaders() }
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to delete environment variable.",
      },
      { status: 400 }
    );
  }
}
