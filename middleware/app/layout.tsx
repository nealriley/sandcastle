import type { Metadata } from "next";
import { getWebsiteUser, isWebsiteAuthConfigured } from "@/auth";
import "./globals.css";
import SiteNav from "./site-nav";

export const metadata: Metadata = {
  title: "Sandcastle",
  description:
    "Sandcastle helps teams run sandboxes in the cloud with templates, live previews, Connect handoffs, and browser-first control.",
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
  const userImage = user?.image ?? null;

  return (
    <html lang="en">
      <body>
        <div className={user ? "shell shell--app" : "shell shell--public"}>
          <SiteNav
            authConfigured={authConfigured}
            isSignedIn={Boolean(user)}
            userLabel={userLabel}
            userImage={userImage}
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
