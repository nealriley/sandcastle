"use client";

import { useState } from "react";
import type { TemplateCatalogEntry } from "@/lib/template-service-types";
import type { UserEnvironmentVariable } from "@/lib/types";
import { summarizeTemplateRuntimes } from "@/lib/templates";
import AgentCard from "@/app/components/agent-card";
import LaunchDrawer from "@/app/components/launch-drawer";

function isLaunchable(t: TemplateCatalogEntry): boolean {
  return t.templateStatus === "active" && t.latestVersionState === "published";
}

export default function MarketplaceGrid({
  templates,
  storedEnvironment,
}: {
  templates: TemplateCatalogEntry[];
  storedEnvironment: UserEnvironmentVariable[];
}) {
  const [drawerTemplate, setDrawerTemplate] =
    useState<TemplateCatalogEntry | null>(null);

  return (
    <>
      <div className="agent-grid">
        {templates.map((template) => {
          const live = isLaunchable(template);
          return (
            <AgentCard
              key={template.slug}
              name={template.name}
              summary={template.summary}
              runtimes={summarizeTemplateRuntimes(template)}
              status={
                live
                  ? "live"
                  : template.latestVersionState === "draft"
                    ? "draft"
                    : "unavailable"
              }
              launchLabel={template.launchLabel ?? "Launch"}
              action={
                live ? (
                  <button
                    type="button"
                    className="button button--primary button--small"
                    onClick={() => setDrawerTemplate(template)}
                  >
                    {template.launchLabel ?? "Launch"}
                  </button>
                ) : (
                  <span className="table-note">{template.launchLabel}</span>
                )
              }
            />
          );
        })}
      </div>

      {drawerTemplate && (
        <LaunchDrawer
          template={drawerTemplate}
          storedEnvironment={storedEnvironment}
          onClose={() => setDrawerTemplate(null)}
        />
      )}
    </>
  );
}
