const assert = require("node:assert/strict");
const test = require("node:test");
const { pack } = require("../.test-dist/pack.js");

const originalAtomicsWait = Atomics.wait;

function getFormula(name) {
  const formula = pack.formulas.find((candidate) => candidate.name === name);
  assert.ok(formula, `Expected formula ${name} to exist`);
  return formula;
}

function makeTaskResponse(overrides = {}) {
  return {
    taskId: "task_123",
    sandboxId: "sb_123",
    sandboxToken: "ses_123",
    sessionId: "ses_123",
    status: "accepted",
    phase: "queued",
    phaseDetail: "Queued",
    isComplete: false,
    createdAt: 1_000,
    updatedAt: 1_000,
    completedAt: null,
    lastLogAt: null,
    result: null,
    previewUrl: null,
    previewStatus: "not-ready",
    previewHint: null,
    consoleTail: null,
    sandboxUrl: "https://middleware.example.com/sandboxes/view_123",
    logsUrl: "https://middleware.example.com/sandboxes/view_123",
    sessionUrl: "https://middleware.example.com/sandboxes/view_123",
    authUrl: null,
    errorCode: null,
    recoveryAction: "none",
    recoveryHint: null,
    retryAfterMs: null,
    error: null,
    ...overrides,
  };
}

function makeContext(handler) {
  return {
    fetcher: {
      fetch: handler,
    },
  };
}

test.afterEach(() => {
  Atomics.wait = originalAtomicsWait;
});

test("CodeTask returns the structured auth-required body instead of throwing", async () => {
  const requests = [];
  const codeTask = getFormula("CodeTask");
  const context = makeContext(async (request) => {
    requests.push(request);
    throw {
      name: "StatusCodeError",
      statusCode: 401,
      body: {
        errorCode: "auth_required",
        authUrl: "https://middleware.example.com/connector",
        error: "Website authentication is required.",
      },
    };
  });

  const result = await codeTask.execute(["Build a site"], context);

  assert.equal(requests.length, 1);
  assert.equal(new URL(requests[0].url).pathname, "/api/sessions");
  assert.equal(requests[0].disableAuthentication, undefined);
  assert.equal(result.errorCode, "auth_required");
  assert.equal(result.authUrl, "https://middleware.example.com/connector");
});

test("CodeTask returns structured failed responses for rate limits instead of throwing", async () => {
  const codeTask = getFormula("CodeTask");
  const context = makeContext(async () => {
    throw {
      name: "StatusCodeError",
      statusCode: 429,
      body: {
        error: "Too many sandbox sessions are being started right now.",
      },
    };
  });

  const result = await codeTask.execute(["Build a site"], context);

  assert.equal(result.status, "failed");
  assert.equal(result.error, "Too many sandbox sessions are being started right now.");
  assert.equal(result.taskId, "");
  assert.equal(result.sandboxToken, "");
});

test("CodeTask creates a sandbox with system auth, then polls the task without shared auth", async () => {
  Atomics.wait = () => "ok";
  const requests = [];
  const responses = [
    { body: makeTaskResponse() },
    {
      body: makeTaskResponse({
        status: "running",
        phase: "thinking",
        phaseDetail: "Claude is reasoning.",
      }),
    },
  ];
  const codeTask = getFormula("CodeTask");
  const context = makeContext(async (request) => {
    requests.push(request);
    const next = responses.shift();
    assert.ok(next, "Unexpected extra fetch");
    return next;
  });

  const result = await codeTask.execute(["Build a site"], context);

  assert.equal(requests.length, 2);
  assert.equal(new URL(requests[0].url).pathname, "/api/sessions");
  assert.equal(requests[0].disableAuthentication, undefined);
  assert.equal(new URL(requests[1].url).pathname, "/api/tasks/task_123");
  assert.equal(requests[1].disableAuthentication, true);
  assert.equal(result.status, "running");
  assert.equal(result.phase, "thinking");
  assert.equal(result.sandboxId, "sb_123");
});

test("ContinueSandbox sends the prompt and polls task status with token-scoped auth only", async () => {
  Atomics.wait = () => "ok";
  const requests = [];
  const responses = [
    {
      body: makeTaskResponse({
        taskId: "task_followup",
        sandboxToken: "ses_followup",
      }),
    },
    {
      body: makeTaskResponse({
        taskId: "task_followup",
        sandboxToken: "ses_followup",
        status: "running",
        phase: "coding",
      }),
    },
  ];
  const continueSandbox = getFormula("ContinueSandbox");
  const context = makeContext(async (request) => {
    requests.push(request);
    const next = responses.shift();
    assert.ok(next, "Unexpected extra fetch");
    return next;
  });

  const result = await continueSandbox.execute(
    ["ses_followup", "Add authentication"],
    context
  );

  assert.equal(new URL(requests[0].url).pathname, "/api/sessions/ses_followup/prompt");
  assert.equal(requests[0].disableAuthentication, true);
  assert.deepEqual(JSON.parse(requests[0].body), {
    prompt: "Add authentication",
  });
  assert.equal(new URL(requests[1].url).pathname, "/api/tasks/task_followup");
  assert.equal(requests[1].disableAuthentication, true);
  assert.equal(result.phase, "coding");
});

test("ContinueSandbox returns a structured busy response instead of throwing on 409", async () => {
  const continueSandbox = getFormula("ContinueSandbox");
  const context = makeContext(async () => {
    throw {
      name: "StatusCodeError",
      statusCode: 409,
      body: makeTaskResponse({
        sandboxId: "sb_busy",
        sandboxToken: "ses_busy",
        sessionId: "ses_busy",
        status: "running",
        phase: "coding",
        errorCode: "sandbox_busy",
        recoveryAction: "wait",
        recoveryHint: "Wait for the current task to finish, then retry.",
        retryAfterMs: 15000,
        error: "This sandbox is already handling another task.",
      }),
    };
  });

  const result = await continueSandbox.execute(
    ["ses_busy", "Add another feature"],
    context
  );

  assert.equal(result.errorCode, "sandbox_busy");
  assert.equal(result.recoveryAction, "wait");
  assert.equal(result.retryAfterMs, 15000);
  assert.equal(result.sandboxId, "sb_busy");
});

test("ListSandboxes returns structured auth-required results without shared auth", async () => {
  const requests = [];
  const listSandboxes = getFormula("ListSandboxes");
  const context = makeContext(async (request) => {
    requests.push(request);
    throw {
      name: "StatusCodeError",
      statusCode: 401,
      body: {
        authUrl: "https://middleware.example.com/connector",
        errorCode: "auth_required",
        error: "Need auth",
      },
    };
  });

  const result = await listSandboxes.execute([undefined, "auth", undefined], context);

  assert.equal(new URL(requests[0].url).pathname, "/api/sandboxes");
  assert.equal(requests[0].disableAuthentication, true);
  assert.equal(result.errorCode, "auth_required");
  assert.deepEqual(result.sandboxes, []);
});

test("ListTemplates defaults to claude-code when the response omits a default slug", async () => {
  const requests = [];
  const listTemplates = getFormula("ListTemplates");
  const context = makeContext(async (request) => {
    requests.push(request);
    return { body: {} };
  });

  const result = await listTemplates.execute([], context);

  assert.equal(new URL(requests[0].url).pathname, "/api/templates");
  assert.equal(requests[0].disableAuthentication, true);
  assert.equal(result.defaultTemplateSlug, "claude-code");
  assert.deepEqual(result.templates, []);
});

test("ResumeSandbox posts sandbox id + prompt without shared auth and quick-checks the task", async () => {
  Atomics.wait = () => "ok";
  const requests = [];
  const responses = [
    {
      body: makeTaskResponse({
        sandboxId: "sb_resume",
        sandboxToken: "ses_resume",
        taskId: "task_resume",
      }),
    },
    {
      body: makeTaskResponse({
        sandboxId: "sb_resume",
        sandboxToken: "ses_resume",
        taskId: "task_resume",
        status: "running",
        phase: "coding",
      }),
    },
  ];
  const resumeSandbox = getFormula("ResumeSandbox");
  const context = makeContext(async (request) => {
    requests.push(request);
    const next = responses.shift();
    assert.ok(next, "Unexpected extra fetch");
    return next;
  });

  const result = await resumeSandbox.execute(
    ["sb_resume", "Ship the fix", "alpha beta gamma"],
    context
  );

  assert.equal(new URL(requests[0].url).pathname, "/api/sandboxes/resume");
  assert.equal(requests[0].disableAuthentication, true);
  assert.deepEqual(JSON.parse(requests[0].body), {
    sandboxId: "sb_resume",
    prompt: "Ship the fix",
    authCode: "alpha beta gamma",
  });
  assert.equal(new URL(requests[1].url).pathname, "/api/tasks/task_resume");
  assert.equal(result.sandboxId, "sb_resume");
  assert.equal(result.phase, "coding");
});

test("CheckTask returns structured task_not_found results instead of throwing on 404", async () => {
  const checkTask = getFormula("CheckTask");
  const context = makeContext(async () => {
    throw {
      name: "StatusCodeError",
      statusCode: 404,
      body: makeTaskResponse({
        taskId: "task_missing",
        sandboxId: "sb_missing",
        sandboxToken: "ses_missing",
        sessionId: "ses_missing",
        status: "failed",
        phase: "failed",
        isComplete: true,
        errorCode: "task_not_found",
        recoveryAction: "check_sandbox",
        recoveryHint: "Check the sandbox status or send another prompt.",
        error: "Task task_missing is no longer present in this sandbox.",
      }),
    };
  });

  const result = await checkTask.execute(["task_missing"], context);

  assert.equal(result.errorCode, "task_not_found");
  assert.equal(result.recoveryAction, "check_sandbox");
  assert.match(result.error ?? "", /task_missing/);
});

test("token-scoped read formulas all disable shared authentication", async () => {
  const statusRequests = [];
  const getSandboxStatus = getFormula("GetSandboxStatus");
  const readSandboxFile = getFormula("ReadSandboxFile");
  const getSandboxPreview = getFormula("GetSandboxPreview");
  const stopSandbox = getFormula("StopSandbox");
  const checkTask = getFormula("CheckTask");
  const context = makeContext(async (request) => {
    statusRequests.push(request);

    const pathname = new URL(request.url).pathname;
    if (pathname.endsWith("/status")) {
      return { body: makeTaskResponse({ status: "running" }) };
    }
    if (pathname.endsWith("/file")) {
      return { body: { content: "console.log('hello');" } };
    }
    if (pathname.endsWith("/preview")) {
      return { body: { url: "https://preview.example.com" } };
    }
    if (pathname.endsWith("/stop")) {
      return { body: { message: "Sandbox ended." } };
    }
    return { body: makeTaskResponse({ status: "running" }) };
  });

  const status = await getSandboxStatus.execute(["ses_123"], context);
  const file = await readSandboxFile.execute(["ses_123", "src/index.ts"], context);
  const preview = await getSandboxPreview.execute(["ses_123", undefined], context);
  const stopped = await stopSandbox.execute(["ses_123"], context);
  const task = await checkTask.execute(["task_123"], context);

  assert.equal(status.Status ?? status.status, "running");
  assert.equal(file, "console.log('hello');");
  assert.equal(preview, "https://preview.example.com");
  assert.equal(stopped, "Sandbox ended.");
  assert.equal(task.Status ?? task.status, "running");

  for (const request of statusRequests) {
    assert.equal(request.disableAuthentication, true);
  }

  assert.equal(new URL(statusRequests[0].url).pathname, "/api/sessions/ses_123/status");
  assert.equal(new URL(statusRequests[1].url).pathname, "/api/sessions/ses_123/file");
  assert.equal(new URL(statusRequests[2].url).pathname, "/api/sessions/ses_123/preview");
  assert.equal(new URL(statusRequests[3].url).pathname, "/api/sessions/ses_123/stop");
  assert.equal(new URL(statusRequests[4].url).pathname, "/api/tasks/task_123");
});
