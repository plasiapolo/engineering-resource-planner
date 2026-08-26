import { describe, expect, it } from "vitest";
import { generatePlan, isSchedulableStatus } from "../../src/services/planner/planner";
import type { PlannerInput } from "../../src/services/planner/planner";
import { isWeekend, previousWorkingDayBefore, workingDaysBetween } from "../../src/services/calendar/polishCalendar";

const PROJECT = { id: "p1", deadline: "2026-12-31", budgetHours: 1000 };
const USER_A1 = { id: "a1", skill: "A" };
const USER_A2 = { id: "a2", skill: "A" };

function horizon(date: string): string {
  let d = date;
  for (let i = 0; i < 3; i += 1) d = previousWorkingDayBefore(d);
  return d;
}

function makeInput(overrides: Partial<PlannerInput> = {}): PlannerInput {
  return {
    projects: [PROJECT],
    tasks: [],
    dependencies: [],
    users: [],
    availability: {},
    lockedEntries: [],
    startDate: "2026-09-01",
    ...overrides,
  };
}

describe("isSchedulableStatus", () => {
  it("allows only open statuses", () => {
    expect(isSchedulableStatus("NOT_STARTED")).toBe(true);
    expect(isSchedulableStatus("WORK_IN_PROGRESS")).toBe(true);
    expect(isSchedulableStatus("DONE")).toBe(false);
    expect(isSchedulableStatus("ON_HOLD")).toBe(false);
  });
});

describe("generatePlan", () => {
  it("stretches a small task to finish exactly 3 working days before the deadline", () => {
    const result = generatePlan(
      makeInput({
        tasks: [{ id: "t1", projectId: "p1", requiredSkill: "A", remainingHours: 16, status: "NOT_STARTED", rowIndex: 0 }],
        users: [USER_A1],
        availability: { a1: {} },
      }),
    );
    expect(result.failures).toHaveLength(0);
    expect(result.entries.reduce((s, e) => s + e.hours, 0)).toBe(16);
    const dates = result.entries.map((e) => e.date);
    expect(dates[dates.length - 1]).toBe(horizon("2026-12-31"));
    expect(dates.every((d) => !isWeekend(d))).toBe(true);
    expect(result.entries.every((e) => e.userId === "a1")).toBe(true);
    expect(result.entries.every((e) => e.locked === false)).toBe(true);
  });

  it("keeps specialists working at least 3 hours a day", () => {
    const result = generatePlan(
      makeInput({
        tasks: [{ id: "t1", projectId: "p1", requiredSkill: "A", remainingHours: 8, status: "NOT_STARTED", rowIndex: 0 }],
        users: [USER_A1],
        availability: { a1: {} },
      }),
    );
    expect(result.failures).toHaveLength(0);
    expect(result.entries.every((e) => e.hours >= 3)).toBe(true);
    expect(result.entries.reduce((s, e) => s + e.hours, 0)).toBe(8);
    expect(result.entries[result.entries.length - 1].date).toBe(horizon("2026-12-31"));
  });

  it("splits a task across eligible specialists in parallel", () => {
    const result = generatePlan(
      makeInput({
        tasks: [{ id: "t1", projectId: "p1", requiredSkill: "A", remainingHours: 16, status: "NOT_STARTED", rowIndex: 0 }],
        users: [USER_A1, USER_A2],
        availability: { a1: {}, a2: {} },
      }),
    );
    expect(result.failures).toHaveLength(0);
    expect(result.entries.reduce((s, e) => s + e.hours, 0)).toBe(16);
    const firstDay = result.entries[0].date;
    expect(result.entries.filter((e) => e.date === firstDay).length).toBeGreaterThan(1);
    expect(result.entries.every((e) => e.hours >= 3)).toBe(true);
    expect(result.entries[result.entries.length - 1].date).toBe(horizon("2026-12-31"));
  });

  it("respects per-day availability limits within the stretched window", () => {
    const startDate = "2026-09-01";
    const deadline = "2026-09-08";
    const h = horizon(deadline);
    const days = workingDaysBetween(startDate, h);
    // Limit a1 to 4h on the very first scheduled working day of the window.
    const availability: Record<string, Record<string, number>> = { a1: { [days[0]]: 4 } };
    const result = generatePlan(
      makeInput({
        projects: [{ id: "p1", deadline, budgetHours: 1000 }],
        tasks: [{ id: "t1", projectId: "p1", requiredSkill: "A", remainingHours: 12, status: "NOT_STARTED", rowIndex: 0 }],
        users: [USER_A1],
        availability,
        startDate,
      }),
    );
    expect(result.failures).toHaveLength(0);
    const first = result.entries.find((e) => e.date === days[0]);
    if (first) expect(first.hours).toBeLessThanOrEqual(4);
    expect(result.entries.every((e) => e.hours <= 8)).toBe(true);
    expect(result.entries.reduce((s, e) => s + e.hours, 0)).toBe(12);
  });

  it("never schedules a specialist for more than their availability", () => {
    const startDate = "2026-09-01";
    const deadline = "2026-09-08";
    const h = horizon(deadline);
    const days = workingDaysBetween(startDate, h);
    const availability: Record<string, Record<string, number>> = { a1: {} };
    for (const d of days) availability.a1[d] = 5;
    const result = generatePlan(
      makeInput({
        projects: [{ id: "p1", deadline, budgetHours: 1000 }],
        tasks: [{ id: "t1", projectId: "p1", requiredSkill: "A", remainingHours: 10, status: "NOT_STARTED", rowIndex: 0 }],
        users: [USER_A1],
        availability,
        startDate,
      }),
    );
    expect(result.failures).toHaveLength(0);
    expect(result.entries.every((e) => e.hours <= 5)).toBe(true);
    expect(result.entries.reduce((s, e) => s + e.hours, 0)).toBe(10);
  });

  it("locked entries consume capacity and are never modified", () => {
    const startDate = "2026-09-01";
    const deadline = "2026-09-08";
    const h = horizon(deadline);
    const days = workingDaysBetween(startDate, h);
    const lockedDay = days[days.length - 1];
    const locked = { taskId: "t0", userId: "a1", date: lockedDay, hours: 6, locked: true };
    const result = generatePlan(
      makeInput({
        projects: [{ id: "p1", deadline, budgetHours: 1000 }],
        tasks: [{ id: "t1", projectId: "p1", requiredSkill: "A", remainingHours: 8, status: "NOT_STARTED", rowIndex: 0 }],
        users: [USER_A1],
        availability: { a1: {} },
        lockedEntries: [locked],
        startDate,
      }),
    );
    expect(result.entries).toContainEqual(locked);
    const taskEntries = result.entries.filter((e) => e.taskId === "t1");
    // The task must not exceed the specialist's free capacity (2h free on the locked day).
    expect(taskEntries.every((e) => e.hours <= 2 || e.date !== lockedDay)).toBe(true);
    // Locked 6h plus at most 8h of task work can be placed.
    expect(result.entries.reduce((s, e) => s + e.hours, 0)).toBeLessThanOrEqual(14);
  });

  it("does not plan tasks that are DONE or ON_HOLD", () => {
    const result = generatePlan(
      makeInput({
        tasks: [
          { id: "t1", projectId: "p1", requiredSkill: "A", remainingHours: 8, status: "DONE", rowIndex: 0 },
          { id: "t2", projectId: "p1", requiredSkill: "A", remainingHours: 8, status: "ON_HOLD", rowIndex: 0 },
        ],
        users: [USER_A1],
        availability: { a1: {} },
      }),
    );
    expect(result.entries).toHaveLength(0);
  });

  it("reports a failure when no specialist has the skill", () => {
    const result = generatePlan(
      makeInput({
        tasks: [{ id: "t1", projectId: "p1", requiredSkill: "Z", remainingHours: 8, status: "NOT_STARTED", rowIndex: 0 }],
        users: [USER_A1],
        availability: { a1: {} },
      }),
    );
    expect(result.entries).toHaveLength(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].reason).toContain("No specialist has skill Z");
  });

  it("reports a failure when the horizon is before the start date", () => {
    const result = generatePlan(
      makeInput({
        projects: [{ id: "p1", deadline: "2026-09-02", budgetHours: 1000 }],
        tasks: [{ id: "t1", projectId: "p1", requiredSkill: "A", remainingHours: 16, status: "NOT_STARTED", rowIndex: 0 }],
        users: [USER_A1],
        availability: { a1: {} },
        startDate: "2026-09-01",
      }),
    );
    // 3 working days before 2026-09-02 is before the start date => nothing can be scheduled.
    expect(result.entries).toHaveLength(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].taskId).toBe("t1");
  });

  it("starts rows only after lower rows finished (bottom-up)", () => {
    const result = generatePlan(
      makeInput({
        tasks: [
          { id: "r0", projectId: "p1", requiredSkill: "A", remainingHours: 8, status: "NOT_STARTED", rowIndex: 0 },
          { id: "r1", projectId: "p1", requiredSkill: "A", remainingHours: 8, status: "NOT_STARTED", rowIndex: 1 },
        ],
        users: [USER_A1],
        availability: { a1: {} },
      }),
    );
    const r0 = result.entries.find((e) => e.taskId === "r0");
    const r1 = result.entries.find((e) => e.taskId === "r1");
    expect(r0?.date).toBeDefined();
    expect(r1?.date).toBeDefined();
    expect(r0!.date < r1!.date).toBe(true);
    expect(result.entries[result.entries.length - 1].date).toBe(horizon("2026-12-31"));
  });

  it("schedules projects by earlier deadline first", () => {
    const result = generatePlan(
      makeInput({
        projects: [
          { id: "late", deadline: "2026-12-31", budgetHours: 1000 },
          { id: "early", deadline: "2026-09-10", budgetHours: 1000 },
        ],
        tasks: [
          { id: "tLate", projectId: "late", requiredSkill: "A", remainingHours: 8, status: "NOT_STARTED", rowIndex: 0 },
          { id: "tEarly", projectId: "early", requiredSkill: "A", remainingHours: 8, status: "NOT_STARTED", rowIndex: 0 },
        ],
        users: [USER_A1],
        availability: { a1: {} },
      }),
    );
    const earlyEntries = result.entries.filter((e) => e.taskId === "tEarly");
    const lateEntries = result.entries.filter((e) => e.taskId === "tLate");
    expect(earlyEntries.length).toBeGreaterThan(0);
    expect(lateEntries.length).toBeGreaterThan(0);
    expect(earlyEntries[0].date < lateEntries[0].date).toBe(true);
    expect(lateEntries[lateEntries.length - 1].date).toBe(horizon("2026-12-31"));
  });

  it("skips weekends and Polish holidays", () => {
    const startDate = "2026-10-26";
    const deadline = "2026-11-30";
    const result = generatePlan(
      makeInput({
        projects: [{ id: "p1", deadline, budgetHours: 1000 }],
        tasks: [{ id: "t1", projectId: "p1", requiredSkill: "A", remainingHours: 40, status: "NOT_STARTED", rowIndex: 0 }],
        users: [USER_A1],
        availability: { a1: {} },
        startDate,
      }),
    );
    expect(result.failures).toHaveLength(0);
    const dates = result.entries.map((e) => e.date);
    expect(dates).not.toContain("2026-11-01");
    expect(dates).not.toContain("2026-11-11");
    expect(dates.every((d) => !isWeekend(d))).toBe(true);
    expect(dates[dates.length - 1]).toBe(horizon(deadline));
  });
});