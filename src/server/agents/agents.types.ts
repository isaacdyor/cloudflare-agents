import { z } from "zod";

export interface Task {
  id: string; // Unique identifier for the task
  goal: string; // The goal of the task
  type: TaskType; // What kind of task it is
  parameters?: Record<string, unknown>; // Task-specific parameters
  prompt?: string; // Prompt for the task
  result?: unknown; // Output of the task
  error?: string; // Error message if failed
}

const taskTypes = ["think", "action"] as const;
export type TaskType = (typeof taskTypes)[number];

export interface WorkerAgentState {
  workerId: string;
  rawUserInput: string;
  objective: string;
  chatId: string;
  isRunning: boolean;
  currentTask?: Task;
  taskQueue: Task[];
  completedTasks: Task[];
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
