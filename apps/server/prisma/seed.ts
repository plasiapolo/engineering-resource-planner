import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";
import type { Role, SkillType, TaskStatus } from "@prisma/client";
import {
  addWorkingDays,
  isWorkingDay,
  nextWorkingDayAfter,
  toDate,
  warsawToday,
} from "../src/services/calendar/polishCalendar";
import { buildTaskCode } from "../src/services/storage/logic";
import { StorageService } from "../src/services/storage/storageService";

export const SEED_PASSWORD_SUFFIX = "-Erp-2026!";

export interface SeedUserSpec {
  login: string;
  displayName: string;
  role: Role;
  skill: SkillType | null;
}

export const SEED_USERS: SeedUserSpec[] = [
  { login: "pm", displayName: "Project Manager", role: "PROJECT_MANAGER", skill: null },
  { login: "a1", displayName: "Specialist A1", role: "SPECIALIST", skill: "A" },
  { login: "a2", displayName: "Specialist A2", role: "SPECIALIST", skill: "A" },
  { login: "b1", displayName: "Specialist B1", role: "SPECIALIST", skill: "B" },
  { login: "e1", displayName: "Specialist E1", role: "SPECIALIST", skill: "E" },
  { login: "c1", displayName: "Specialist C1", role: "SPECIALIST", skill: "C" },
  { login: "s1", displayName: "Specialist S1", role: "SPECIALIST", skill: "S" },
  { login: "s2", displayName: "Specialist S2", role: "SPECIALIST", skill: "S" },
  { login: "s3", displayName: "Specialist S3", role: "SPECIALIST", skill: "S" },
  { login: "p1", displayName: "Specialist P1", role: "SPECIALIST", skill: "P" },
  { login: "p2", displayName: "Specialist P2", role: "SPECIALIST", skill: "P" },
  { login: "p3", displayName: "Specialist P3", role: "SPECIALIST", skill: "P" },
];

export function passwordForLogin(login: string): string {
  return `${login}${SEED_PASSWORD_SUFFIX}`;
}

interface SeedTaskSpec {
  skill: SkillType;
  hours: number;
  row: number;
  name?: string;
  status?: TaskStatus;
  taskDeadlineOffsetWorkdays?: number;
}

interface SeedProjectSpec {
  code: string;
  name: string;
  deadlineOffsetWorkdays: number;
  budgetHours: number;
  tasks: SeedTaskSpec[];
}

const T = warsawToday();

function firstWorkingDayOnOrAfter(date: string): string {
  let d = date;
  while (!isWorkingDay(d)) {
    d = nextWorkingDayAfter(d);
  }
  return d;
}

const SEED_PROJECTS: SeedProjectSpec[] = [
  {
    code: "Z1",
    name: "Z1 Foundation Plant",
    deadlineOffsetWorkdays: 42,
    budgetHours: 600,
    tasks: [
      { skill: "P", hours: 120, row: 0, name: "CD-P" },
      { skill: "A", hours: 80, row: 0, name: "CD-A" },
      { skill: "B", hours: 64, row: 1, name: "BD-B" },
      { skill: "S", hours: 96, row: 2, name: "BD-S" },
      { skill: "E", hours: 72, row: 3, name: "BD-E" },
      { skill: "C", hours: 88, row: 4, name: "DD-C" },
    ],
  },
  {
    code: "Z2",
    name: "Z2 Optimization Plant",
    deadlineOffsetWorkdays: 52,
    budgetHours: 200,
    tasks: [
      { skill: "A", hours: 100, row: 0, name: "CD-A" },
      { skill: "S", hours: 90, row: 0, name: "CD-S" },
      { skill: "E", hours: 56, row: 1, status: "ON_HOLD", name: "DD-E" },
      { skill: "C", hours: 64, row: 1, name: "DD-C" },
    ],
  },
  {
    code: "Z3",
    name: "Z3 Expansion Plant",
    deadlineOffsetWorkdays: 30,
    budgetHours: 300,
    tasks: [
      { skill: "A", hours: 72, row: 0, name: "CD-A" },
      { skill: "B", hours: 48, row: 0, name: "CD-B" },
      { skill: "S", hours: 80, row: 1, name: "BD-S" },
      { skill: "E", hours: 40, row: 2, name: "DD-E" },
      { skill: "C", hours: 44, row: 2, taskDeadlineOffsetWorkdays: 5, name: "DD-C" },
    ],
  },
];

export async function runSeed(db: PrismaClient): Promise<void> {
  await db.auditLog.deleteMany({});
  await db.versionSnapshot.deleteMany({});
  await db.conflict.deleteMany({});
  await db.planEntry.deleteMany({});
  await db.availability.deleteMany({});
  await db.taskDependency.deleteMany({});
  await db.task.deleteMany({});
  await db.project.deleteMany({});
  await db.session.deleteMany({});
  await db.user.deleteMany({});

  const userByLogin = new Map<string, string>();
  for (const spec of SEED_USERS) {
    const user = await db.user.create({
      data: {
        login: spec.login,
        passwordHash: await argon2.hash(passwordForLogin(spec.login), {
          type: argon2.argon2id,
          memoryCost: 19456,
          timeCost: 2,
          parallelism: 1,
        }),
        displayName: spec.displayName,
        role: spec.role,
        skill: spec.skill,
      },
    });
    userByLogin.set(spec.login, user.id);
  }

  const taskIdByProjectAndIndex = new Map<string, string>();

  for (const spec of SEED_PROJECTS) {
    const deadline = addWorkingDays(T, spec.deadlineOffsetWorkdays);
    const project = await db.project.create({
      data: {
        code: spec.code,
        name: spec.name,
        deadline: toDate(deadline),
        budgetHours: spec.budgetHours,
      },
    });

    let number = 1;
    for (const taskSpec of spec.tasks) {
      const code = buildTaskCode(spec.code, taskSpec.skill, null, taskSpec.row, String(number).padStart(6, "0"));
      const task = await db.task.create({
        data: {
          projectId: project.id,
          taskCode: code,
          name: taskSpec.name ?? `Phase ${taskSpec.row + 1} - skill ${taskSpec.skill}`,
          requiredSkill: taskSpec.skill,
          estimatedHours: taskSpec.hours,
          rowIndex: taskSpec.row,
          status: taskSpec.status ?? "NOT_STARTED",
          taskDeadline:
            taskSpec.taskDeadlineOffsetWorkdays !== undefined
              ? toDate(addWorkingDays(T, taskSpec.taskDeadlineOffsetWorkdays))
              : null,
        },
      });
      taskIdByProjectAndIndex.set(`${spec.code}:${spec.tasks.indexOf(taskSpec)}`, task.id);
      number += 1;
    }
  }

  // Build pyramid dependencies
  for (const spec of SEED_PROJECTS) {
    const rows: string[][] = [];
    const maxRow = Math.max(...spec.tasks.map((t) => t.row));
    for (let r = 0; r <= maxRow; r += 1) {
      const rowTasks = spec.tasks
        .map((t, index) => ({ t, index }))
        .filter(({ t }) => t.row === r)
        .map(({ index }) => taskIdByProjectAndIndex.get(`${spec.code}:${index}`)!);
      rows.push(rowTasks);
    }
    for (let r = 0; r < rows.length - 1; r += 1) {
      for (const succ of rows[r + 1]) {
        for (const pred of rows[r]) {
          await db.taskDependency.create({
            data: { predecessorTaskId: pred, successorTaskId: succ },
          });
        }
      }
    }
  }

  const D1 = firstWorkingDayOnOrAfter(T);
  const D2 = addWorkingDays(D1, 1);

  const z1P = taskIdByProjectAndIndex.get("Z1:0")!;
  const z1A = taskIdByProjectAndIndex.get("Z1:1")!;
  const z2A = taskIdByProjectAndIndex.get("Z2:0")!;
  const z2S = taskIdByProjectAndIndex.get("Z2:1")!;
  const z2C = taskIdByProjectAndIndex.get("Z2:3")!;
  const z3A = taskIdByProjectAndIndex.get("Z3:0")!;

  const locked = (taskId: string, login: string, date: string, hours: number): Promise<unknown> =>
    db.planEntry.create({
      data: {
        taskId,
        userId: userByLogin.get(login)!,
        date: toDate(date),
        hours,
        locked: true,
      },
    });

  // Manual plan entries demonstrating manual assignments, overload and dependency violations.
  await Promise.all([
    locked(z1P, "p1", D1, 8),
    locked(z1P, "p2", D1, 6),
    locked(z1A, "a1", D1, 8),
    locked(z1A, "a1", D2, 4),
    locked(z2A, "a2", D1, 8),
    locked(z2S, "s1", D1, 8),
    locked(z2C, "c1", D2, 8),
    locked(z3A, "a2", D2, 8),
  ]);

  // Per-specialist task status rows for every assigned (task, user) combination.
  const statusSpecs: Array<[string, string, "NOT_STARTED" | "WORK_IN_PROGRESS" | "DONE" | "ON_HOLD"]> = [
    [z1P, "p1", "WORK_IN_PROGRESS"],
    [z1P, "p2", "NOT_STARTED"],
    [z1A, "a1", "WORK_IN_PROGRESS"],
    [z2A, "a2", "WORK_IN_PROGRESS"],
    [z2S, "s1", "WORK_IN_PROGRESS"],
    [z2C, "c1", "NOT_STARTED"],
    [z3A, "a2", "WORK_IN_PROGRESS"],
  ];
  await Promise.all(
    statusSpecs.map(([taskId, login, status]) =>
      db.taskUserStatus.upsert({
        where: { taskId_userId: { taskId, userId: userByLogin.get(login)! } },
        create: { taskId, userId: userByLogin.get(login)!, status },
        update: { status },
      }),
    ),
  );

  // Availability restrictions (limited availability / unavailability examples)
  const blockDates = (login: string, from: string, count: number, hours: number): Promise<unknown> => {
    const creates: Promise<unknown>[] = [];
    let d = from;
    for (let i = 0; i < count; i += 1) {
      creates.push(
        db.availability.create({
          data: { userId: userByLogin.get(login)!, date: toDate(d), availableHours: hours },
        }),
      );
      d = nextWorkingDayAfter(d);
    }
    return Promise.all(creates);
  };

  // A1 overloaded on D1: availability 4h but planned 8h.
  await db.availability.create({
    data: { userId: userByLogin.get("a1")!, date: toDate(D1), availableHours: 4 },
  });
  await Promise.all([blockDates("a1", D2, 9, 4), blockDates("p2", D1, 20, 6)]);
  // B1 fully unavailable for a long window -> Z3-BX-1 cannot be scheduled.
  await blockDates("b1", D1, 60, 0);

  // Task code assignment substitution for tasks with manual assignments
  const storage = new StorageService(db);
  for (const taskId of [z1A, z2A, z2S, z2C, z3A, z1P]) {
    await (storage as unknown as { updateTaskCodeForAssignment(id: string): Promise<void> }).updateTaskCodeForAssignment(taskId);
  }

  await storage.recomputeConflicts();
  await storage.captureVersion();
}

async function main(): Promise<void> {
  const db = new PrismaClient();
  try {
    await runSeed(db);
    const users = await db.user.findMany({ orderBy: { login: "asc" } });
    for (const user of users) {
      console.log(`login: ${user.login}  password: ${passwordForLogin(user.login)}`);
    }
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}