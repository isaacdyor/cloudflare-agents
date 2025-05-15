import { z } from "zod";

export interface Task {
  id: string; // Unique identifier for the task
  type: TaskType; // What kind of task it is
  status: TaskStatus; // Current state of the task
  description: string; // Human-readable description
  parameters: Record<string, unknown>; // Task-specific parameters
  artifactIds: string[];
  result?: unknown; // Output of the task
  error?: string; // Error message if failed
}

const taskTypes = ["think", "action"] as const;
export type TaskType = (typeof taskTypes)[number];

const taskStatuses = [
  "pending",
  "running",
  "completed",
  "failed",
  "blocked",
  "cancelled",
] as const;
export type TaskStatus = (typeof taskStatuses)[number];

export interface Artifact {
  id: string;
  name: string; // optional, for easier lookup (e.g., "poem_1_draft")
  type: string; // e.g., "poem", "code", "image", "file", etc.
  content: unknown; // raw content or structured output
}

export interface WorkerAgentState {
  workerId: string;
  rawUserInput: string;
  objective: string;
  chatId: string;

  isRunning: boolean;
  currentTask?: Task;
  taskQueue: Task[];
  completedTasks: Task[];

  artifacts: Record<string, Artifact>;
}

// Define the schema for artifact operations
export const ArtifactOperationSchema = z
  .object({
    type: z.enum(["CREATE", "UPDATE", "NONE"]),
    artifactDetails: z.object({
      name: z.string(),
      type: z.string(),
      content: z.unknown(),
    }),
    artifactToUpdateId: z.string().optional(),
  })
  .optional();

// Define the schema for next steps
export const NextStepSchema = z.object({
  // Type of the step to take
  type: z.enum(["THINKING", "ACTION"]),

  // Artifact IDs that would be helpful for the next step
  requiredArtifactIds: z.array(z.string()),

  thinkingDetails: z
    .object({
      purpose: z.string(),
      focusQuestions: z.array(z.string()).optional(),
    })
    .optional(),

  actionDetails: z
    .object({
      action: z.string(),
      parameters: z.record(z.any()),
      expectedOutcome: z.string().optional(),
    })
    .optional(),
  // Rationale for this step
  rationale: z.string(),
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
  // Any artifacts that should be created or updated
  artifactOperation: ArtifactOperationSchema,
  // Artifact IDs that would be helpful for the next step
  requiredArtifactIds: z.array(z.string()),
});

// Type inference
export type ThinkingStepOutput = z.infer<typeof ThinkingStepOutputSchema>;
export type ActionStepOutput = z.infer<typeof ActionStepOutputSchema>;
