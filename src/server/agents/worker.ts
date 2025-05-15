import { Agent, unstable_callable, type Schedule } from "agents";

import type { Task, WorkerAgentState } from "@/server/agents/agents.types";
import { generateId, generateText } from "ai";
import { model } from "..";
import type { Env } from "../index";
export class WorkerAgent extends Agent<Env, WorkerAgentState> {
  async initialize(
    chatId: string,
    name: string,
    purpose: string,
    workerId: string
  ) {
    // Create initial think task to analyze purpose and plan
    const initialTask: Task = {
      id: generateId(),
      type: "think",
      status: "pending",
      priority: 1,
      description: "Initial analysis of agent purpose and planning",
      parameters: { purpose },
      createdAt: new Date(),
      retryCount: 0,
      maxRetries: 3,
    };

    // Store the chat ID that created this worker along with its name, purpose, and the human-readable workerId
    await this.setState({
      metadata: { chatId, name, workerId },
      purpose,
      isRunning: false,
      taskQueue: [initialTask],
      completedTasks: [],
      lastProcessedAt: new Date(),
    });

    // Start the agent to begin processing
    // await this.start();

    return {
      status: "initialized",
      metadata: { chatId, name, workerId },
      purpose,
    };
  }

  @unstable_callable()
  async start() {
    if (this.state.isRunning) return;

    console.log("Starting worker agent");

    await this.setState({
      ...this.state,
      isRunning: true,
    });

    // Start processing
    await this.processNextTask();
    return { status: "started" };
  }

  @unstable_callable()
  async stop() {
    if (!this.state.isRunning) return;

    await this.setState({
      ...this.state,
      isRunning: false,
    });
    return { status: "stopped" };
  }

  @unstable_callable()
  async processNextTask() {
    console.log("Processing next task");
    if (!this.state.isRunning) return;
    console.log("State:", this.state);

    const task = this.state.taskQueue[0];
    console.log("Task:", task);

    // If no pending tasks, mark agent as stopped (purpose fulfilled)
    if (!task) {
      await this.setState({
        ...this.state,
        isRunning: false,
      });
      return;
    }

    // Process the task based on its type
    try {
      switch (task.type) {
        case "think": {
          console.log("Processing THINK task");
          task.status = "running";
          task.startedAt = new Date();

          const prompt = `Your purpose is: "${this.state.purpose}". Based on your purpose, propose the single next best action you should take to make progress. Respond with only the action as an imperative sentence without any additional text.`;
          console.log("Prompt:", prompt);
          // Ask the AI to propose the next action towards the agent's purpose
          const { text: aiPlan } = await generateText({
            model,
            prompt,
          });

          console.log("AI plan:", aiPlan);

          const actionTask: Task = {
            id: generateId(),
            type: "action",
            status: "pending",
            priority: 1,
            description: aiPlan,
            parameters: {},
            createdAt: new Date(),
            retryCount: 0,
            maxRetries: 3,
          };

          // Mark THINK task completed
          task.status = "completed";
          task.completedAt = new Date();

          // Update state: remove THINK task, push ACTION task
          await this.setState({
            ...this.state,
            taskQueue: [...this.state.taskQueue.slice(1), actionTask],
            completedTasks: [...this.state.completedTasks, task],
            lastProcessedAt: new Date(),
          });

          // Schedule next execution immediately
          await this.scheduleNextExecution(1);
          break;
        }
        case "action": {
          console.log("Processing ACTION task");
          task.status = "running";
          task.startedAt = new Date();

          // Use the AI to "execute" the action and get a result summary
          const { text: actionResult } = await generateText({
            model,
            prompt: `You are executing the following action: "${task.description}". Describe briefly the outcome of performing this action.`,
          });

          task.result = actionResult;
          task.status = "completed";
          task.completedAt = new Date();

          // Prepare updated queue and completed lists
          const updatedCompleted = [...this.state.completedTasks, task];
          const updatedQueueAfterRemoval = this.state.taskQueue.slice(1);

          // After executing, add a THINK task to decide next step
          const nextThinkTask: Task = {
            id: generateId(),
            type: "think",
            status: "pending",
            priority: 1,
            description: "Reflect on progress and plan next action",
            parameters: {},
            createdAt: new Date(),
            retryCount: 0,
            maxRetries: 3,
          };

          await this.setState({
            ...this.state,
            taskQueue: [...updatedQueueAfterRemoval, nextThinkTask],
            completedTasks: updatedCompleted,
            lastProcessedAt: new Date(),
          });

          // Schedule next execution for remaining tasks
          await this.scheduleNextExecution(1);
          break;
        }
        default: {
          // For any unhandled task types, mark as failed
          task.status = "failed";
          task.error = `Unhandled task type: ${task.type}`;
          await this.setState({
            ...this.state,
            taskQueue: this.state.taskQueue.slice(1),
            completedTasks: [...this.state.completedTasks, task],
            lastProcessedAt: new Date(),
          });
          // Continue processing
          await this.scheduleNextExecution(1);
        }
      }
    } catch (error: any) {
      task.status = "failed";
      task.error = error.message;
      await this.setState({
        ...this.state,
        taskQueue: this.state.taskQueue.slice(1),
        completedTasks: [...this.state.completedTasks, task],
        lastProcessedAt: new Date(),
      });
      // Retry logic can be added here
      await this.scheduleNextExecution(5);
    }
  }

  private async scheduleNextExecution(seconds: number) {
    await this.schedule(
      new Date(Date.now() + seconds * 1000),
      "processNextTask" as keyof this
    );
  }

  @unstable_callable()
  async getWorkerInfo() {
    // Get all scheduled events
    const scheduledEvents = await this.listScheduledEvents();

    return {
      metadata: this.state.metadata,
      purpose: this.state.purpose,
      queueLength: this.state.taskQueue.length,
      lastProcessedAt: this.state.lastProcessedAt,
      completedTasks: this.state.completedTasks,
      taskQueue: this.state.taskQueue,
      isRunning: this.state.isRunning,
      scheduledEvents: scheduledEvents.map((event: Schedule<string>) => ({
        scheduledTime: new Date(event.time),
        method: event.callback,
        id: event.id,
      })),
    };
  }

  private async listScheduledEvents() {
    try {
      // Use the base Agent class's getSchedules method
      return await super.getSchedules();
    } catch (error) {
      console.error("Error getting scheduled events:", error);
      return [];
    }
  }
}
