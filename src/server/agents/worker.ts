import { Agent, unstable_callable } from "agents";

import {
  ActionStepOutputSchema,
  ThinkingStepOutputSchema,
  type Task,
  type WorkerAgentState,
} from "@/server/agents/agents.types";
import { generateId, generateObject } from "ai";
import { model } from "..";
import type { Env } from "../index";

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
      goal: "Initial analysis of agent purpose and planning",
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

    if (!task) {
      await this.setState({
        ...this.state,
        isRunning: false,
      });
      return;
    }

    await this.processTask(task);
  }

  private getBasePrompt(): string {
    return `You are an AI agent working towards the following objective: "${this.state.objective}"

Initial user input: "${this.state.rawUserInput}"

Progress so far:
${this.state.completedTasks.map((task, index) => `Step ${index + 1}: {Goal: ${task.goal}, Result: ${task.result}}`).join("\n")}



Remember:
1. If you need to create or modify any artifacts, specify this in your response
2. List any artifact IDs that would be helpful for the next step
3. Be specific and detailed in your actions and reasoning
`;
  }

  private async processTask(task: Task) {
    try {
      switch (task.type) {
        case "think": {
          console.log("Processing THINK task");
          const thinkingPrompt = `${this.getBasePrompt()}

Please analyze the current situation and determine the next best step. Your goal is to achieve the objective: "${task.goal}}"

1. Review what has been accomplished so far
2. Assess what remains to be done to achieve the objective
3. Consider any potential obstacles or challenges
4. Determine if the objective has been fully achieved

Important Guidelines:
- Choose "THINKING" type if you need to analyze, plan, or make decisions
- Choose "ACTION" type if you need to perform any concrete task or operation
- Be explicit about which artifacts would be helpful for the next step

Based on this analysis, propose the single next best action to take. If the objective has been fully achieved, set the "complete" field to true.`;

          const { object } = await generateObject({
            model,
            prompt: thinkingPrompt,
            schema: ThinkingStepOutputSchema,
          });

          task.prompt = thinkingPrompt;

          console.log("Thinking step output:", object);

          if (object.completionDecision.shouldComplete) {
            return this.completeTask(task, object.reasoning);
          }

          const nextTask = {
            id: generateId(),
            type: object.nextStep.type,
            goal: object.nextStep.goal,
          };
          return this.updateTaskQueue(task, nextTask, object.reasoning);
        }

        case "action": {
          console.log("Processing ACTION task");
          const actionPrompt = `${this.getBasePrompt()}

The goal of your current task is: "${task.goal}"

Your task is to:
1. Execute the action and provide a detailed result in the "result" field
2. After completing the action, reflect on what needs to be done next
3. Specify if any artifacts need to be created or updated
4. List any artifact IDs that would be helpful for the next step

Guidelines for artifact operations:
- If you need to create a new artifact, specify its name, type, and content
- If you need to update an existing artifact, specify its ID and the new content
- If no artifact operations are needed, specify "NONE" as the operation type

Important: The next step MUST be a "think" type task where you reflect on:
- What was accomplished in this action
- What new information or insights were gained
- What should be the next focus based on the objective
- Any potential challenges or considerations for the next steps

Provide a clear and specific result of the action taken in the "result" field, and ensure the nextStep is always a "think" type task with a clear goal for reflection.`;

          const { object } = await generateObject({
            model,
            prompt: actionPrompt,
            schema: ActionStepOutputSchema,
          });

          task.prompt = actionPrompt;

          console.log("Action step output:", object);

          // Create next thinking task
          const nextTask: Task = {
            id: generateId(),
            type: "think",
            goal: object.nextStep.goal,
            parameters: object.nextStep.parameters,
          };

          return this.updateTaskQueue(task, nextTask, object.result);
        }
      }
    } catch (error: any) {
      task.error = error.message;
      return this.handleTaskError(task);
    }
  }

  private async completeTask(task: Task, result: string) {
    task.result = result;
    await this.setState({
      ...this.state,
      isRunning: false,
      taskQueue: this.state.taskQueue.slice(1),
      completedTasks: [...this.state.completedTasks, task],
    });
  }

  private async updateTaskQueue(task: Task, nextTask: Task, result: string) {
    task.result = result;
    await this.setState({
      ...this.state,
      taskQueue: [...this.state.taskQueue.slice(1), nextTask],
      completedTasks: [...this.state.completedTasks, task],
    });
    await this.scheduleNextExecution(1);
  }

  private async handleTaskError(task: Task) {
    await this.setState({
      ...this.state,
      taskQueue: this.state.taskQueue.slice(1),
      completedTasks: [...this.state.completedTasks, task],
    });
    await this.scheduleNextExecution(5);
  }

  private async scheduleNextExecution(seconds: number) {
    await this.schedule(
      new Date(Date.now() + seconds * 1000),
      "processNextTask" as keyof this
    );
  }

  @unstable_callable()
  async getWorkerInfo() {
    return {
      workerId: this.state.workerId,
      rawUserInput: this.state.rawUserInput,
      objective: this.state.objective,
      chatId: this.state.chatId,
      queueLength: this.state.taskQueue.length,
      completedTasks: this.state.completedTasks,
      taskQueue: this.state.taskQueue,
      isRunning: this.state.isRunning,
    };
  }
}
