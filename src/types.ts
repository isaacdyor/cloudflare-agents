export interface AgentMetadata {
  chatId: string;
  name: string;
  workerId: string;
}

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

export enum TaskType {
  THINK = "think", // AI decision making
  ACTION = "action", // Tool execution
  VERIFY = "verify", // Result verification
  CLEANUP = "cleanup", // Cleanup operations
  SCHEDULE = "schedule", // For scheduling future tasks
  MONITOR = "monitor", // For monitoring tasks
  REPORT = "report", // For reporting results
}

export enum TaskStatus {
  PENDING = "pending", // Waiting to be processed
  RUNNING = "running", // Currently being processed
  COMPLETED = "completed", // Successfully finished
  FAILED = "failed", // Failed to complete
  BLOCKED = "blocked", // Waiting on dependencies
  CANCELLED = "cancelled", // Explicitly cancelled
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
