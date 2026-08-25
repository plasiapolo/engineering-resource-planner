import type { ApiTask } from "../domain/types";

export function taskCodesOf(task: ApiTask): string[] {
  const parts = task.codePart.split("-");
  if (parts.length < 3) return [task.codePart];
  if (task.assignedUsers.length === 0) return [task.codePart];
  return task.assignedUsers.map((u) => {
    const p = [...parts];
    p[1] = u.login.toUpperCase();
    return p.join("-");
  });
}

export function taskCodesForSkill(task: ApiTask, specialists: Array<{ login: string; skill: string | null }>): string[] {
  const parts = task.codePart.split("-");
  if (parts.length < 3) return [task.codePart];
  const matching = specialists.filter((s) => s.skill === task.requiredSkill);
  if (matching.length === 0) return [task.codePart];
  return matching.map((s) => {
    const p = [...parts];
    p[1] = s.login.toUpperCase();
    return p.join("-");
  });
}