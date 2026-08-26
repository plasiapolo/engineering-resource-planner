import { describe, expect, it } from "vitest";
import { detectConflicts } from "../../src/services/conflicts/conflictDetection";
import type { ConflictInput } from "../../src/services/conflicts/conflictDetection";

function makeInput(overrides: Partial<ConflictInput> = {}): ConflictInput {
  return {
    projects: [],
    tasks: [],
    dependencies: [],
    users: [],
    entries: [],
    availability: {},
    today: "2026-09-01",
    ...overrides,
  };
}

function task(id: string, overrides: Record<string, unknown> = {}): any {
  return {
    id,
    projectId: "p1",
    codePart: `${id.toUpperCase()}-1`,
    requiredSkill: "A",
    estimatedHours: 8,
    remainingHours: 8,
    status: "NOT_STARTED",
    taskDeadline: null,
    rowIndex: 1,
    ...overrides,
  };
}

describe("detectConflicts", () => {
  it("reports when the project budget is exceeded", () => {
    const conflicts = detectConflicts(
      makeInput({
        projects: [{ id: "p1", name: "Z1", deadline: "2026-12-31", budgetHours: 100 }],
        tasks: [task("t1", { estimatedHours: 120, remainingHours: 120 })],
      }),
    );
    expect(conflicts.some((c) => c.type === "PROJECT_BUDGET" && c.severity === "WARNING")).toBe(true);
  });

  it("does not report budget conflict when within budget", () => {
    const conflicts = detectConflicts(
      makeInput({
        projects: [{ id: "p1", name: "Z1", deadline: "2026-12-31", budgetHours: 100 }],
        tasks: [task("t1", { estimatedHours: 80, remainingHours: 80 })],
      }),
    );
    expect(conflicts.filter((c) => c.type === "PROJECT_BUDGET")).toHaveLength(0);
  });

  it("reports an unused budget conflict when planned hours are below the budget", () => {
    const conflicts = detectConflicts(
      makeInput({
        projects: [{ id: "p1", name: "Z1", deadline: "2026-12-31", budgetHours: 100 }],
        tasks: [task("t1", { estimatedHours: 80, remainingHours: 80 })],
        entries: [{ taskId: "t1", userId: "u1", date: "2026-09-01", hours: 60 }],
      }),
    );
    expect(conflicts.some((c) => c.type === "UNUSED_BUDGET")).toBe(true);
  });

  it("does not report unused budget when the plan uses the whole budget", () => {
    const conflicts = detectConflicts(
      makeInput({
        projects: [{ id: "p1", name: "Z1", deadline: "2026-12-31", budgetHours: 100 }],
        tasks: [task("t1", { estimatedHours: 100, remainingHours: 100 })],
        entries: [{ taskId: "t1", userId: "u1", date: "2026-09-01", hours: 100 }],
      }),
    );
    expect(conflicts.filter((c) => c.type === "UNUSED_BUDGET")).toHaveLength(0);
  });

  it("reports a project schedule not satisfied warning when no specialist is assigned", () => {
    const conflicts = detectConflicts(
      makeInput({
        projects: [{ id: "p1", name: "Z1", deadline: "2026-12-31", budgetHours: 100 }],
        tasks: [task("t1", { estimatedHours: 80, remainingHours: 80 })],
        entries: [],
      }),
    );
    expect(
      conflicts.some((c) => c.type === "PROJECT_SCHEDULE_NOT_SATISFIED" && c.severity === "WARNING"),
    ).toBe(true);
  });

  it("reports project schedule not satisfied when the plan ends before 3 working days before the deadline", () => {
    const conflicts = detectConflicts(
      makeInput({
        projects: [{ id: "p1", name: "Z1", deadline: "2026-10-07", budgetHours: 100 }],
        tasks: [task("t1", { estimatedHours: 80, remainingHours: 80 })],
        entries: [{ taskId: "t1", userId: "u1", date: "2026-09-30", hours: 80 }],
      }),
    );
    expect(
      conflicts.some((c) => c.type === "PROJECT_SCHEDULE_NOT_SATISFIED"),
    ).toBe(true);
  });

  it("does not report project schedule not satisfied when the plan reaches 3 working days before the deadline", () => {
    const conflicts = detectConflicts(
      makeInput({
        projects: [{ id: "p1", name: "Z1", deadline: "2026-10-07", budgetHours: 100 }],
        tasks: [task("t1", { estimatedHours: 80, remainingHours: 80 })],
        entries: [{ taskId: "t1", userId: "u1", date: "2026-10-02", hours: 80 }],
      }),
    );
    expect(conflicts.filter((c) => c.type === "PROJECT_SCHEDULE_NOT_SATISFIED")).toHaveLength(0);
  });

  it("reports deadline risk as WARNING when there is time", () => {
    const conflicts = detectConflicts(
      makeInput({
        projects: [{ id: "p1", name: "Z1", deadline: "2026-12-31", budgetHours: 1000 }],
        tasks: [task("t1")],
      }),
    );
    const c = conflicts.find((x) => x.type === "PROJECT_DEADLINE");
    expect(c?.severity).toBe("WARNING");
  });

  it("reports deadline as CRITICAL when the deadline already passed", () => {
    const conflicts = detectConflicts(
      makeInput({
        projects: [{ id: "p1", name: "Z1", deadline: "2026-08-01", budgetHours: 1000 }],
        tasks: [task("t1")],
      }),
    );
    const c = conflicts.find((x) => x.type === "PROJECT_DEADLINE");
    expect(c?.severity).toBe("CRITICAL");
  });

  it("reports deadline as ERROR when the last entry touches the horizon", () => {
    const conflicts = detectConflicts(
      makeInput({
        projects: [{ id: "p1", name: "Z1", deadline: "2026-09-04", budgetHours: 1000 }],
        tasks: [task("t1", { estimatedHours: 16, remainingHours: 8, status: "WORK_IN_PROGRESS" })],
        entries: [
          { taskId: "t1", userId: "a1", date: "2026-09-03", hours: 8 },
          { taskId: "t1", userId: "a1", date: "2026-09-02", hours: 8 },
        ],
      }),
    );
    const c = conflicts.find((x) => x.type === "PROJECT_DEADLINE");
    expect(c?.severity).toBe("ERROR");
  });

  it("reports NO_AVAILABLE_EMPLOYEE when no specialist has the skill", () => {
    const conflicts = detectConflicts(
      makeInput({
        projects: [{ id: "p1", name: "Z1", deadline: "2026-12-31", budgetHours: 1000 }],
        tasks: [task("t1", { requiredSkill: "Z" })],
        users: [{ id: "a1", displayName: "A1", skill: "A" }],
      }),
    );
    expect(conflicts.some((c) => c.type === "NO_AVAILABLE_EMPLOYEE")).toBe(true);
  });

  it("reports NO_AVAILABLE_EMPLOYEE when specialists have no capacity", () => {
    const conflicts = detectConflicts(
      makeInput({
        projects: [{ id: "p1", name: "Z1", deadline: "2026-09-10", budgetHours: 1000 }],
        tasks: [task("t1")],
        users: [{ id: "a1", displayName: "A1", skill: "A" }],
        availability: { a1: { "2026-09-01": 0, "2026-09-02": 0, "2026-09-03": 0, "2026-09-04": 0, "2026-09-07": 0, "2026-09-08": 0, "2026-09-09": 0 } },
      }),
    );
    expect(conflicts.some((c) => c.type === "NO_AVAILABLE_EMPLOYEE")).toBe(true);
  });

  it("reports employee overload", () => {
    const conflicts = detectConflicts(
      makeInput({
        projects: [],
        tasks: [],
        users: [{ id: "a1", displayName: "A1", skill: "A" }],
        entries: [{ taskId: "t1", userId: "a1", date: "2026-09-01", hours: 10 }],
        availability: { a1: { "2026-09-01": 8 } },
      }),
    );
    expect(conflicts.some((c) => c.type === "EMPLOYEE_OVERLOAD" && c.employeeId === "a1")).toBe(true);
  });

  it("reports dependency violation when successor starts before predecessor ends", () => {
    const conflicts = detectConflicts(
      makeInput({
        projects: [{ id: "p1", name: "Z1", deadline: "2026-12-31", budgetHours: 1000 }],
        tasks: [
          task("pred", { estimatedHours: 16, remainingHours: 8, status: "WORK_IN_PROGRESS" }),
          task("succ"),
        ],
        dependencies: [{ predecessorTaskId: "pred", successorTaskId: "succ" }],
        entries: [
          { taskId: "pred", userId: "a1", date: "2026-09-02", hours: 8 },
          { taskId: "succ", userId: "a1", date: "2026-09-02", hours: 4 },
        ],
      }),
    );
    const c = conflicts.find((x) => x.type === "DEPENDENCY_VIOLATION");
    expect(c?.taskId).toBe("succ");
  });

  it("detects cyclic dependencies", () => {
    const conflicts = detectConflicts(
      makeInput({
        projects: [],
        tasks: [task("a"), task("b")],
        dependencies: [
          { predecessorTaskId: "a", successorTaskId: "b" },
          { predecessorTaskId: "b", successorTaskId: "a" },
        ],
      }),
    );
    const c = conflicts.find((x) => x.type === "DEPENDENCY_VIOLATION" && x.title === "Cyclic task dependency detected");
    expect(c).toBeDefined();
  });

  it("reports a missed task deadline", () => {
    const conflicts = detectConflicts(
      makeInput({
        projects: [],
        tasks: [task("t1", { status: "WORK_IN_PROGRESS", taskDeadline: "2026-09-01" })],
        entries: [{ taskId: "t1", userId: "a1", date: "2026-09-02", hours: 4 }],
      }),
    );
    expect(conflicts.some((c) => c.type === "TASK_DEADLINE" && c.title === "Task deadline missed")).toBe(true);
  });

  it("reports an on-hold task deadline risk", () => {
    const conflicts = detectConflicts(
      makeInput({
        projects: [],
        tasks: [task("t1", { status: "ON_HOLD" })],
      }),
    );
    expect(conflicts.some((c) => c.type === "TASK_DEADLINE" && c.title === "On-hold task deadline risk")).toBe(true);
  });

  it("does not flag completed tasks", () => {
    const conflicts = detectConflicts(
      makeInput({
        projects: [{ id: "p1", name: "Z1", deadline: "2026-09-04", budgetHours: 80 }],
        tasks: [task("t1", { estimatedHours: 80, remainingHours: 0, status: "DONE" })],
        entries: [{ taskId: "t1", userId: "u1", date: "2026-09-01", hours: 80 }],
      }),
    );
    expect(conflicts).toHaveLength(0);
  });

  it("reports row order violation when an upper row starts before a lower row ends", () => {
    const conflicts = detectConflicts(
      makeInput({
        projects: [{ id: "p1", name: "Z1", deadline: "2026-12-31", budgetHours: 1000 }],
        tasks: [
          task("lower", { rowIndex: 1, estimatedHours: 16, remainingHours: 8, status: "WORK_IN_PROGRESS" }),
          task("upper", { rowIndex: 2 }),
        ],
        entries: [
          { taskId: "lower", userId: "a1", date: "2026-09-02", hours: 8 },
          { taskId: "upper", userId: "a1", date: "2026-09-02", hours: 4 },
        ],
      }),
    );
    const c = conflicts.find((x) => x.type === "ROW_ORDER");
    expect(c?.taskId).toBe("upper");
  });

  it("does not report row order violation when the upper row starts after all lower rows end", () => {
    const conflicts = detectConflicts(
      makeInput({
        projects: [{ id: "p1", name: "Z1", deadline: "2026-12-31", budgetHours: 1000 }],
        tasks: [
          task("lower", { rowIndex: 1, status: "DONE", remainingHours: 0 }),
          task("upper", { rowIndex: 2 }),
        ],
        entries: [
          { taskId: "lower", userId: "a1", date: "2026-09-02", hours: 8 },
          { taskId: "upper", userId: "a1", date: "2026-09-03", hours: 4 },
        ],
      }),
    );
    expect(conflicts.filter((c) => c.type === "ROW_ORDER")).toHaveLength(0);
  });

  it("reports row order violation when a lower row is not fully scheduled", () => {
    const conflicts = detectConflicts(
      makeInput({
        projects: [{ id: "p1", name: "Z1", deadline: "2026-12-31", budgetHours: 1000 }],
        tasks: [
          task("lower", { rowIndex: 1, estimatedHours: 16, remainingHours: 16 }),
          task("upper", { rowIndex: 2 }),
        ],
        entries: [
          { taskId: "lower", userId: "a1", date: "2026-09-02", hours: 8 },
          { taskId: "upper", userId: "a1", date: "2026-09-03", hours: 4 },
        ],
      }),
    );
    const c = conflicts.find((x) => x.type === "ROW_ORDER");
    expect(c?.taskId).toBe("upper");
  });

  it("does not report row order violation for tasks in the same row", () => {
    const conflicts = detectConflicts(
      makeInput({
        projects: [{ id: "p1", name: "Z1", deadline: "2026-12-31", budgetHours: 1000 }],
        tasks: [task("t1", { rowIndex: 1 }), task("t2", { rowIndex: 1 })],
        entries: [
          { taskId: "t1", userId: "a1", date: "2026-09-02", hours: 8 },
          { taskId: "t2", userId: "a1", date: "2026-09-02", hours: 4 },
        ],
      }),
    );
    expect(conflicts.filter((c) => c.type === "ROW_ORDER")).toHaveLength(0);
  });
});
