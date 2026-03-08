import assert from "node:assert/strict";
import test from "node:test";
import { getConnector, listConnectors } from "../lib/connectors.js";

test("connector registry exposes SHGO and MCP", () => {
  const connectors = listConnectors();

  assert.deepEqual(
    connectors.map((connector) => connector.slug),
    ["shgo", "mcp"]
  );
  assert.equal(getConnector("shgo")?.detailPath, "/connect/shgo");
  assert.equal(getConnector("mcp")?.detailPath, "/connect/mcp");
  assert.equal(getConnector("missing"), null);
});
