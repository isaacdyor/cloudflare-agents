export interface Task {
  id: string; // Unique identifier for the task
  type: TaskType; // What kind of task it is
  status: TaskStatus; // Current state of the task
  priority: number; // For queue ordering
  description: string; // Human-readable description
  parameters: Record<string, any>; // Task-specific parameters
  result?: any; // Output of the task
  error?: string; // Error message if failed
  createdAt: Date; // When task was created
  startedAt?: Date; // When task started processing
  completedAt?: Date; // When task finished
  retryCount: number; // Number of retry attempts
  maxRetries: number; // Maximum retry attempts allowed
  dependencies?: string[]; // IDs of tasks this depends on
  parentTaskId?: string; // ID of parent task if this is a subtask
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

export interface AgentMetadata {
  chatId: string;
  name: string;
  workerId: string;
}

export interface WorkerAgentState {
  purpose: string;
  metadata: AgentMetadata;
  isRunning: boolean;
  currentTask?: Task;
  taskQueue: Task[];
  completedTasks: Task[];
  lastProcessedAt: Date;
}
