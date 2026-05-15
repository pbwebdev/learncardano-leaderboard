import { describe, expect, it, vi } from "vitest";

const insertedValues: Array<Record<string, unknown>> = [];

vi.mock("@/db/client", () => ({
  getDb: () => ({
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        insertedValues.push(v);
        return Promise.resolve();
      },
    }),
  }),
}));

vi.mock("@/db/schema", () => ({
  auditLog: { __table: "audit_log" },
}));

import { logChange } from "./audit";

describe("audit: logChange", () => {
  it("writes the supplied fields and stringifies non-string old/new values", async () => {
    insertedValues.length = 0;
    await logChange({
      userId: "stake1u9_admin",
      entityType: "submission",
      entityId: "sub-1",
      field: "status",
      oldValue: "pending",
      newValue: "verified",
    });
    expect(insertedValues).toHaveLength(1);
    expect(insertedValues[0]).toMatchObject({
      userId: "stake1u9_admin",
      entityType: "submission",
      entityId: "sub-1",
      field: "status",
      oldValue: "pending",
      newValue: "verified",
    });
  });

  it("JSON-stringifies object values, preserves null", async () => {
    insertedValues.length = 0;
    await logChange({
      userId: "stake1u9_admin",
      entityType: "task",
      entityId: "task-7",
      field: "config",
      oldValue: null,
      newValue: { poolId: "pool1abc", minAdaIn: 100 },
    });
    expect(insertedValues[0].oldValue).toBeNull();
    expect(insertedValues[0].newValue).toBe('{"poolId":"pool1abc","minAdaIn":100}');
  });
});
