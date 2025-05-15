import { Agent, unstable_callable, type Schedule } from "agents";

import {
  ActionStepOutputSchema,
  ThinkingStepOutputSchema,
  type Artifact,
  type Task,
  type WorkerAgentState,
} from "@/server/agents/agents.types";
import { generateId, generateObject } from "ai";
import { model } from "..";
import type { Env } from "../index";

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
      artifactIds: [],
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
      artifacts: {},
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
      artifactIds: [],
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

    this.stop();
  }

  private getBasePrompt(task: Task): string {
    const artifactsList = task.artifactIds
      .map((id) => {
        const artifact = this.state.artifacts[id];
        return `- ${artifact.name} (${artifact.type}): ${JSON.stringify(artifact.content)}`;
      })
      .join("\n");

    return `You are an AI agent working towards the following objective: "${this.state.objective}"

Initial user input: "${this.state.rawUserInput}"

Progress so far:
${JSON.stringify(this.state.completedTasks)}

Available artifacts for this task:
${artifactsList}

Remember:
1. If you need to create or modify any artifacts, specify this in your response
2. List any artifact IDs that would be helpful for the next step
3. Be specific and detailed in your actions and reasoning
`;
  }

  private async processTask(task: Task) {
    task.status = "running";

    try {
      switch (task.type) {
        case "think": {
          console.log("Processing THINK task");
          const thinkingPrompt = `${this.getBasePrompt(task)}

Please analyze the current situation and determine the next best step:

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

          if (object.completionDecision.shouldComplete) {
            return this.completeTask(task, JSON.stringify(object));
          }

          const nextTask = this.createNextTask(
            object.nextStep,
            object.nextStep.requiredArtifactIds
          );
          return this.updateTaskQueue(task, nextTask, JSON.stringify(object));
        }

        case "action": {
          console.log("Processing ACTION task");
          const actionPrompt = `${this.getBasePrompt(task)}

You are executing the following action: "${task.description}"

Your task is to:
1. Execute the action and provide a detailed result
2. Specify if any artifacts need to be created or updated
3. List any artifact IDs that would be helpful for the next step

Guidelines for artifact operations:
- If you need to create a new artifact, specify its name, type, and content
- If you need to update an existing artifact, specify its ID and the new content
- If no artifact operations are needed, specify "NONE" as the operation type

Provide a clear and specific result of the action taken.`;

          const { object } = await generateObject({
            model,
            prompt: actionPrompt,
            schema: ActionStepOutputSchema,
          });

          // Handle artifact operations
          if (object.artifactOperation) {
            switch (object.artifactOperation.type) {
              case "CREATE": {
                if (object.artifactOperation.artifactDetails) {
                  const artifactDetails =
                    object.artifactOperation.artifactDetails;
                  const newArtifact = await this.createArtifact({
                    name: artifactDetails.name,
                    type: artifactDetails.type,
                    content: artifactDetails.content,
                  });
                  object.requiredArtifactIds.push(newArtifact.id);
                }
                break;
              }
              case "UPDATE": {
                if (
                  object.artifactOperation.artifactToUpdateId &&
                  object.artifactOperation.artifactDetails
                ) {
                  await this.updateArtifact(
                    object.artifactOperation.artifactToUpdateId,
                    object.artifactOperation.artifactDetails
                  );
                }
                break;
              }
            }
          }

          // Create next thinking task
          const nextTask: Task = {
            id: generateId(),
            type: "think",
            status: "pending",
            description: "Reflect on action result and plan next step",
            parameters: {},
            artifactIds: object.requiredArtifactIds,
          };

          return this.updateTaskQueue(task, nextTask, JSON.stringify(object));
        }
      }
    } catch (error: any) {
      task.status = "failed";
      task.error = error.message;
      return this.handleTaskError(task);
    }
  }

  private async completeTask(task: Task, result: string) {
    task.status = "completed";
    task.result = result;
    await this.setState({
      ...this.state,
      isRunning: false,
      taskQueue: this.state.taskQueue.slice(1),
      completedTasks: [...this.state.completedTasks, task],
    });
  }

  private createNextTask(nextStep: any, artifactIds: string[]): Task {
    return {
      id: generateId(),
      type: nextStep.type === "THINKING" ? "think" : "action",
      status: "pending",
      description:
        nextStep.type === "THINKING"
          ? (nextStep.thinkingDetails?.purpose ?? "")
          : (nextStep.actionDetails?.action ?? ""),
      parameters: {},
      artifactIds,
    };
  }

  private async updateTaskQueue(task: Task, nextTask: Task, result: string) {
    task.status = "completed";
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

  @unstable_callable()
  async createArtifact(artifact: Omit<Artifact, "id">) {
    const newArtifact: Artifact = {
      ...artifact,
      id: generateId(),
    };

    await this.setState({
      ...this.state,
      artifacts: {
        ...this.state.artifacts,
        [newArtifact.id]: newArtifact,
      },
    });

    return newArtifact;
  }

  @unstable_callable()
  async getArtifact(artifactId: string) {
    const artifact = this.state.artifacts[artifactId];
    if (!artifact) {
      throw new Error(`Artifact with ID ${artifactId} not found`);
    }
    return artifact;
  }

  @unstable_callable()
  async updateArtifact(
    artifactId: string,
    updates: Partial<Omit<Artifact, "id">>
  ) {
    const existingArtifact = this.state.artifacts[artifactId];
    if (!existingArtifact) {
      throw new Error(`Artifact with ID ${artifactId} not found`);
    }

    const updatedArtifact: Artifact = {
      ...existingArtifact,
      ...updates,
    };

    await this.setState({
      ...this.state,
      artifacts: {
        ...this.state.artifacts,
        [artifactId]: updatedArtifact,
      },
    });

    return updatedArtifact;
  }

  @unstable_callable()
  async deleteArtifact(artifactId: string) {
    const existingArtifact = this.state.artifacts[artifactId];
    if (!existingArtifact) {
      throw new Error(`Artifact with ID ${artifactId} not found`);
    }

    const { [artifactId]: deletedArtifact, ...remainingArtifacts } =
      this.state.artifacts;

    await this.setState({
      ...this.state,
      artifacts: remainingArtifacts,
    });

    return deletedArtifact;
  }
}
