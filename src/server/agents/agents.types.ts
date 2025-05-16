import { z } from "zod";

const taskStage = ["plan", "execute", "reflect", "conclude"] as const;
export type TaskStage = (typeof taskStage)[number];

export const taskStatus = [
  "pending",
  "running",
  "waiting",
  "completed",
  "failed",
] as const;
export type TaskStatus = (typeof taskStatus)[number];

export interface Task {
  id: string; // Unique identifier for the task
  goal: string; // The goal of the task

  stage: TaskStage; // What kind of task it is
  status: TaskStatus; // The status of the task

  parentTaskId?: string; // The ID of the parent task
  childTaskIds?: string[]; // The IDs of the child tasks

  parameters?: Record<string, unknown>; // Task-specific parameters

  result?: unknown; // Output of the task
  error?: string; // Error message if failed

  plan?: TrackedTasks;
}

export const agentStatus = [
  "idle",
  "running",
  "paused",
  "completed",
  "failed",
] as const;
export type AgentStatus = (typeof agentStatus)[number];

export interface WorkerAgentState {
  workerId: string;
  chatId: string;
  goal: string;
  status: AgentStatus;
  mainTask: Task;
  tasks: Record<string, Task>;
}

// The schema for the AI-generated task data
export const AIGeneratedStepSchema = z.object({
  title: z.string(),
  description: z.string(),
});

export const AIGeneratedStepsSchema = z.array(AIGeneratedStepSchema);

export const stepStatus = [
  "pending",
  "running",
  "completed",
  "failed",
] as const;
export type StepStatus = (typeof stepStatus)[number];

// The schema for the internal task representation with status tracking
export const TrackedTaskSchema = z.object({
  title: z.string(),
  description: z.string(),
  status: z.enum(stepStatus).default("pending"),
});

export const TrackedTasksSchema = z.array(TrackedTaskSchema);

export type TrackedTasks = z.infer<typeof TrackedTasksSchema>;
