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

// Define the schema for next steps
export const NextStepSchema = z.object({
  // Type of the step to take
  type: z.enum(taskTypes),

  goal: z
    .string()
    .describe(
      "The purpose of the step. This is what the next step will try to accomplish"
    ),
  parameters: z.record(z.any()).optional(),
  // Rationale for this step
  rationale: z
    .string()
    .describe(
      "The rationale for the step. This is why the next step is necessary"
    ),
});

// Define the schema for the completion decision
export const CompletionDecisionSchema = z.object({
  shouldComplete: z.boolean(),
  reason: z.string(),
});

// Define the schema for the thinking step output
export const ThinkingStepOutputSchema = z.object({
  // The actual reasoning/thought process
  reasoning: z.string(),
  nextStep: NextStepSchema,
  completionDecision: CompletionDecisionSchema,
});

// Define the schema for action step output
export const ActionStepOutputSchema = z.object({
  // The execution result
  result: z.string(),
  nextStep: NextStepSchema,
});

// Type inference
export type ThinkingStepOutput = z.infer<typeof ThinkingStepOutputSchema>;
export type ActionStepOutput = z.infer<typeof ActionStepOutputSchema>;
