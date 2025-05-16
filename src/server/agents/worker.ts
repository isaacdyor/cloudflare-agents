import { Agent, unstable_callable } from "agents";

import {
  AIGeneratedStepsSchema,
  type Task,
  type WorkerAgentState,
} from "@/server/agents/agents.types";
import { generateId, generateObject } from "ai";
import type { Env } from "../index";
import { model } from "..";

export class WorkerAgent extends Agent<Env, WorkerAgentState> {
  async initialize(workerId: string, chatId: string, goal: string) {
    // Create initial think task to analyze purpose and plan
    const initialTask: Task = {
      id: generateId(),
      stage: "plan",
      status: "pending",
      goal,
    };

    // Store the chat ID that created this worker along with its name, purpose, and the human-readable workerId
    await this.setState({
      workerId,
      chatId,
      goal,
      status: "idle",
      mainTask: initialTask,
      tasks: { [initialTask.id]: initialTask },
    });
  }

  @unstable_callable()
  async start() {
    if (this.state.status !== "idle" && this.state.status !== "paused") return;

    console.log("Starting worker agent");

    await this.setState({
      ...this.state,
      status: "running",
    });

    // Start processing
    await this.processNextTask();
    return { status: "started" };
  }

  @unstable_callable()
  async stop() {
    if (this.state.status !== "running") return;

    await this.setState({
      ...this.state,
      status: "paused",
    });
    return { status: "paused" };
  }

  @unstable_callable()
  async reset() {
    // Create initial think task to analyze purpose and plan
    const initialTask: Task = {
      id: generateId(),
      stage: "plan",
      status: "pending",
      goal: "Write a blog post about the benefits of using AI agents",
    };

    await this.setState({
      ...this.state,
      status: "idle",
      mainTask: initialTask,
      tasks: { [initialTask.id]: initialTask },
    });
  }

  @unstable_callable()
  async processNextTask() {
    console.log("Processing next task");
    if (this.state.status !== "running") return;

    const task = await this.findNextTask();
    console.log("Task:", task);

    if (!task) {
      await this.setState({
        ...this.state,
        status: "completed",
      });
      return;
    }

    await this.processTask(task);
  }

  private async processTask(task: Task) {
    await this.updateTask({ ...task, status: "running" });
    switch (task.stage) {
      case "plan":
        await this.processPlanTask(task);
        break;
      case "execute":
        await this.processExecuteTask(task);
        break;
      case "reflect":
        await this.processReflectTask(task);
        break;
      case "conclude":
        await this.processConcludeTask(task);
        break;
    }
  }

  private async processPlanTask(task: Task) {
    if (task.childTaskIds?.length === 0) {
      const { object: plan } = await generateObject({
        model,
        prompt: `Generate a strategic plan to accomplish the following objective: ${task.goal}

Create a clear, sequential list of tasks that need to be completed. Each task should:
1. Include a brief, action-oriented title
2. Contain a concise description (1-2 sentences) explaining WHAT needs to be accomplished

Focus only on WHAT needs to be done, not HOW to do it. Break the objective into logical, manageable steps without specifying implementation details.`,
        schema: AIGeneratedStepsSchema,
      });

      await this.updateTask({
        ...task,
        plan: plan.map((step) => ({
          ...step,
          status: "pending",
        })),
      });

      const { object: firstStep } = await generateObject({
        model,
        prompt: `Generate a strategic plan to accomplish the following objective: ${task.goal}

Create a clear, sequential list of tasks that need to be completed. Each task should:
1. Include a brief, action-oriented title
2. Contain a concise description (1-2 sentences) explaining WHAT needs to be accomplished

Focus only on WHAT needs to be done, not HOW to do it. Break the objective into logical, manageable steps without specifying implementation details.`,
        schema: AIGeneratedStepsSchema,
      });
    }
  }

  // this either executes or creates a new task
  private async processExecuteTask(task: Task) {
    console.log("Processing execute task");
  }

  private async processReflectTask(task: Task) {
    console.log("Processing reflect task");
  }

  private async processConcludeTask(task: Task) {
    console.log("Processing conclude task");
  }

  private async findNextTask() {
    const findPendingTask = (task: Task): Task | null => {
      // If current task is pending, return it
      if (task.status === "pending") {
        return task;
      }

      // Check all children
      const childTasks = (task.childTaskIds || [])
        .map((id) => this.state.tasks[id])
        .filter((child) => child !== undefined);

      // Recursively check each child
      for (const child of childTasks) {
        const pendingTask = findPendingTask(child);
        if (pendingTask) {
          return pendingTask;
        }
      }

      // No pending task found in this branch
      return null;
    };

    // Start search from main task
    return findPendingTask(this.state.mainTask);
  }

  private async updateTask(task: Task) {
    await this.setState({
      ...this.state,
      tasks: { ...this.state.tasks, [task.id]: task },
    });
  }

  @unstable_callable()
  async getWorkerInfo() {
    return {
      workerId: this.state.workerId,
      goal: this.state.goal,
      chatId: this.state.chatId,
      tasks: this.state.tasks,
      status: this.state.status,
    };
  }
}
