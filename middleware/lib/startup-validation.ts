import {
  assertWebsiteAuthConfigured,
  getWebsiteAuthConfigurationError,
} from "../auth";
import { assertRedisConfiguration } from "./redis";
import {
  assertTemplateConfiguration,
  listTemplateConfigurationWarnings,
} from "./templates";
import { assertSessionStartTokenConfiguration } from "./tokens";

export interface StartupValidationCheck {
  name: string;
  status: "ok" | "warn" | "error";
  detail: string;
}

export interface StartupValidationReport {
  status: "ok" | "error";
  checks: StartupValidationCheck[];
}

function requiredEnvCheck(name: string, envName: string): StartupValidationCheck {
  return process.env[envName]?.trim()
    ? {
        name,
        status: "ok",
        detail: `${envName} is configured.`,
      }
    : {
        name,
        status: "error",
        detail: `${envName} is required but not configured.`,
      };
}

function validateCheck(
  name: string,
  fn: () => void,
  okDetail: string
): StartupValidationCheck {
  try {
    fn();
    return {
      name,
      status: "ok",
      detail: okDetail,
    };
  } catch (error) {
    return {
      name,
      status: "error",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export function collectStartupValidationReport(): StartupValidationReport {
  const checks: StartupValidationCheck[] = [
    requiredEnvCheck("agent_auth", "AGENT_API_KEY"),
    requiredEnvCheck("anthropic_upstream", "ANTHROPIC_API_KEY"),
    validateCheck(
      "token_signing",
      () => assertSessionStartTokenConfiguration(),
      "Token signing secrets are configured."
    ),
    validateCheck(
      "redis",
      () => assertRedisConfiguration(),
      "Redis configuration is present."
    ),
    validateCheck(
      "website_auth",
      () => assertWebsiteAuthConfigured(),
      "Website auth configuration is complete."
    ),
    validateCheck(
      "templates",
      () => assertTemplateConfiguration(),
      "Template registry configuration is valid."
    ),
  ];

  const authIssue = getWebsiteAuthConfigurationError();
  if (authIssue && !checks.some((check) => check.name === "website_auth")) {
    checks.push({
      name: "website_auth",
      status: "error",
      detail: authIssue,
    });
  }

  for (const warning of listTemplateConfigurationWarnings()) {
    checks.push({
      name: "template_snapshot_warning",
      status: "warn",
      detail: warning,
    });
  }

  return {
    status: checks.some((check) => check.status === "error") ? "error" : "ok",
    checks,
  };
}
