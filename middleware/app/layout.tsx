import type { Metadata } from "next";
import { getWebsiteUser, isWebsiteAuthConfigured } from "@/auth";
import "./globals.css";
import SiteNav from "./site-nav";

export const metadata: Metadata = {
  title: "Sandcastle",
  description:
    "Sandcastle is the browser control plane for long-running coding sandboxes, connectors, previews, and live execution logs.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const authConfigured = isWebsiteAuthConfigured();
  const user = authConfigured ? await getWebsiteUser() : null;
  const userLabel = user
    ? `@${user.login ?? user.name ?? user.email ?? user.id}`
    : null;

  return (
    <html lang="en">
      <body>
        <div className={user ? "shell shell--app" : "shell shell--public"}>
          <SiteNav
            authConfigured={authConfigured}
            isSignedIn={Boolean(user)}
            userLabel={userLabel}
          />
          <main
            className={
              user
                ? "shell__content shell__content--app"
                : "shell__content shell__content--public"
            }
          >
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
