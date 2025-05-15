import { Agent, unstable_callable, type Schedule } from "agents";

import {
  ThinkingStepOutputSchema,
  type Task,
  type WorkerAgentState,
} from "@/server/agents/agents.types";
import { generateId, generateObject, generateText } from "ai";
import { model } from "..";
import type { Env } from "../index";
import { z } from "zod";
export class WorkerAgent extends Agent<Env, WorkerAgentState> {
  async initialize(
    workerId: string,
    rawUserInput: string,
    objective: string,
    chatId: string
  ) {
    // Create initial think task to analyze purpose and plan
    const initialTask: Task = {
      id: generateId(),
      type: "think",
      status: "pending",
      description: "Initial analysis of agent purpose and planning",
      parameters: { rawUserInput, objective },
    };

    // Store the chat ID that created this worker along with its name, purpose, and the human-readable workerId
    await this.setState({
      workerId,
      rawUserInput,
      objective,
      chatId,
      isRunning: false,
      taskQueue: [initialTask],
      completedTasks: [],
    });

    return {
      status: "initialized",
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
  async reset() {
    // Create initial think task to analyze purpose and plan
    const initialTask: Task = {
      id: generateId(),
      type: "think",
      status: "pending",
      description: "Initial analysis of agent purpose and planning",
      parameters: {
        rawUserInput: this.state.rawUserInput,
        objective: this.state.objective,
      },
    };

    await this.setState({
      ...this.state,
      isRunning: false,
      taskQueue: [initialTask],
      completedTasks: [],
      currentTask: undefined,
    });
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

          const prompt = `You are an AI agent working towards the following objective: "${this.state.objective}"

Initial user input: "${this.state.rawUserInput}"

Progress so far:
${JSON.stringify(this.state.completedTasks)}

Please analyze the current situation and determine the next best step:

1. Review what has been accomplished so far
2. Assess what remains to be done to achieve the objective
3. Consider any potential obstacles or challenges
4. Determine if the objective has been fully achieved

Based on this analysis, propose the single next best action to take. If the objective has been fully achieved, set the "complete" field to true.

Respond with only the action as an imperative sentence without any additional text.`;
          console.log("Prompt:", prompt);
          // Ask the AI to propose the next action towards the agent's purpose
          const { object } = await generateObject({
            model,
            prompt,
            schema: ThinkingStepOutputSchema,
          });

          console.log("Response:", object);

          if (object.completionDecision.shouldComplete) {
            task.status = "completed";
            await this.setState({
              ...this.state,
              isRunning: false,
            });
            return;
          }

          let nextTask: Task;

          if (object.nextStep.type === "ACTION") {
            nextTask = {
              id: generateId(),
              type: "action",
              status: "pending",
              description: object.nextStep.actionDetails?.action ?? "",
              parameters: {},
            };
          } else {
            nextTask = {
              id: generateId(),
              type: "think",
              status: "pending",
              description: object.nextStep.thinkingDetails?.purpose ?? "",
              parameters: {},
            };
          }

          // Mark THINK task completed
          task.status = "completed";
          task.result = JSON.stringify(object);

          // Update state: remove THINK task, push ACTION task
          await this.setState({
            ...this.state,
            taskQueue: [...this.state.taskQueue.slice(1), nextTask],
            completedTasks: [...this.state.completedTasks, task],
          });

          // Schedule next execution immediately
          await this.scheduleNextExecution(1);
          break;
        }
        case "action": {
          console.log("Processing ACTION task");
          task.status = "running";

          // Use the AI to "execute" the action and get a result summary
          const { text: actionResult } = await generateText({
            model,
            prompt: `You are executing the following action: "${task.description}". Describe briefly the outcome of performing this action.`,
          });

          task.result = actionResult;
          task.status = "completed";

          // Prepare updated queue and completed lists
          const updatedCompleted = [...this.state.completedTasks, task];
          const updatedQueueAfterRemoval = this.state.taskQueue.slice(1);

          // After executing, add a THINK task to decide next step
          const nextThinkTask: Task = {
            id: generateId(),
            type: "think",
            status: "pending",
            description: "Reflect on progress and plan next action",
            parameters: {},
          };

          await this.setState({
            ...this.state,
            taskQueue: [...updatedQueueAfterRemoval, nextThinkTask],
            completedTasks: updatedCompleted,
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
          });
          // Continue processing
          await this.scheduleNextExecution(1);
        }
      }

      this.stop();
    } catch (error: any) {
      task.status = "failed";
      task.error = error.message;
      await this.setState({
        ...this.state,
        taskQueue: this.state.taskQueue.slice(1),
        completedTasks: [...this.state.completedTasks, task],
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
      workerId: this.state.workerId,
      rawUserInput: this.state.rawUserInput,
      objective: this.state.objective,
      chatId: this.state.chatId,
      queueLength: this.state.taskQueue.length,
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
