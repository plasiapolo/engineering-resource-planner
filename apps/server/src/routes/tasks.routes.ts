import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../app";

const createTaskSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().max(200).optional().default(""),
  requiredSkill: z.enum(["A", "B", "C", "E", "P", "S"]),
  estimatedHours: z.number().int().min(1),
  taskDeadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  rowIndex: z.number().int().min(0).optional(),
});

const updateTaskSchema = z
  .object({
    name: z.string().max(200).optional(),
    estimatedHours: z.number().int().min(1).optional(),
    taskDeadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    requiredSkill: z.enum(["A", "B", "C", "E", "P", "S"]).optional(),
    rowIndex: z.number().int().min(0).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field required" });

const statusSchema = z.object({
  status: z.enum(["NOT_STARTED", "WORK_IN_PROGRESS", "DONE", "ON_HOLD"]),
  actualWorkedHours: z.number().int().min(0).optional(),
});

const assignmentSchema = z.object({
  assignments: z
    .array(
      z.object({
        userId: z.string().min(1),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        hours: z.number().int().min(1).max(8),
      }),
    )
    .max(200),
});

const removeAssignmentSchema = z.object({
  userId: z.string().min(1),
});

export function registerTaskRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/tasks", async (request) => {
    request.requireUser();
    const tasks = await ctx.db.task.findMany({
      where: { deletedAt: null },
      include: {
        project: true,
        planEntries: { where: { deletedAt: null }, include: { user: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    const { toApiTask } = await import("../services/storage/mappers");
    return tasks.map(toApiTask);
  });

  app.post("/tasks", async (request, reply) => {
    const pm = request.requirePM();
    const parsed = createTaskSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    }
    const task = await ctx.storage.createTask(parsed.data, pm.id);
    return reply.code(201).send(task);
  });

  app.put("/tasks/:id", async (request, reply) => {
    const pm = request.requirePM();
    const { id } = request.params as { id: string };
    const parsed = updateTaskSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    }
    const task = await ctx.storage.updateTask(id, parsed.data, pm.id);
    return reply.send(task);
  });

  app.delete("/tasks/:id", async (request, reply) => {
    const pm = request.requirePM();
    const { id } = request.params as { id: string };
    await ctx.storage.deleteTask(id, pm.id);
    return reply.send({ ok: true });
  });

  app.put("/tasks/:id/status", async (request, reply) => {
    const user = request.requireUser();
    const { id } = request.params as { id: string };
    const parsed = statusSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    }
    try {
      const task = await ctx.storage.updateTaskStatus(
        id,
        user.id,
        user.role,
        parsed.data.status,
        parsed.data.actualWorkedHours,
      );
      return reply.send(task);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "Invalid status change" });
    }
  });

  app.post("/tasks/:id/assignments", async (request, reply) => {
    const pm = request.requirePM();
    const { id } = request.params as { id: string };
    const parsed = assignmentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    }
    try {
      const entries = await ctx.storage.assignTask(id, parsed.data.assignments, pm.id);
      return reply.code(201).send(entries);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "Invalid assignment" });
    }
  });

  app.post("/tasks/:id/assignments/remove", async (request, reply) => {
    const pm = request.requirePM();
    const { id } = request.params as { id: string };
    const parsed = removeAssignmentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    }
    try {
      await ctx.storage.removeAssignment(id, parsed.data.userId, pm.id);
      return reply.send({ ok: true });
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "Invalid request" });
    }
  });
}