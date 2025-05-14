import {
  Agent,
  routeAgentRequest,
  type AgentNamespace,
  type Schedule,
  getAgentByName,
  unstable_callable,
} from "agents";

import { unstable_getSchedulePrompt } from "agents/schedule";

import { AIChatAgent } from "agents/ai-chat-agent";
import {
  createDataStreamResponse,
  generateId,
  streamText,
  type StreamTextOnFinishCallback,
  type ToolSet,
} from "ai";
import { openai } from "@ai-sdk/openai";
import { processToolCalls } from "./utils";
import { tools, executions } from "./tools";
import type { AgentMetadata, WorkerAgentState, Task } from "./types";
import { TaskStatus } from "./types";
// import { env } from "cloudflare:workers";

export interface Env {
  Chat: AgentNamespace<Chat>;
  WorkerAgent: AgentNamespace<WorkerAgent>;
  ASSETS: Fetcher;
}

const model = openai("gpt-4o-2024-11-20");
// Cloudflare AI Gateway
// const openai = createOpenAI({
//   apiKey: env.OPENAI_API_KEY,
//   baseURL: env.GATEWAY_BASE_URL,
// });

/**
 * Chat Agent implementation that handles real-time AI chat interactions
 */
export class Chat extends AIChatAgent<Env> {
  /**
   * Handles incoming chat messages and manages the response stream
   * @param onFinish - Callback function executed when streaming completes
   */

  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    options?: { abortSignal?: AbortSignal }
  ) {
    // const mcpConnection = await this.mcp.connect(
    //   "https://path-to-mcp-server/sse"
    // );

    // Collect all tools, including MCP tools
    const allTools = {
      ...tools,
      ...this.mcp.unstable_getAITools(),
    };

    // Create a streaming response that handles both text and tool outputs
    const dataStreamResponse = createDataStreamResponse({
      execute: async (dataStream) => {
        // Process any pending tool calls from previous messages
        // This handles human-in-the-loop confirmations for tools
        const processedMessages = await processToolCalls({
          messages: this.messages,
          dataStream,
          tools: allTools,
          executions,
        });

        // Stream the AI response using GPT-4
        const result = streamText({
          model,
          system: `You are a helpful assistant that can do various tasks... 

${unstable_getSchedulePrompt({ date: new Date() })}

If the user asks to schedule a task, use the schedule tool to schedule the task.
`,
          messages: processedMessages,
          tools: allTools,
          onFinish: async (args) => {
            onFinish(
              args as Parameters<StreamTextOnFinishCallback<ToolSet>>[0]
            );
            // await this.mcp.closeConnection(mcpConnection.id);
          },
          onError: (error) => {
            console.error("Error while streaming:", error);
          },
          maxSteps: 10,
        });

        // Merge the AI response stream with tool execution outputs
        result.mergeIntoDataStream(dataStream);
      },
    });

    return dataStreamResponse;
  }
  async executeTask(description: string, task: Schedule<string>) {
    await this.saveMessages([
      ...this.messages,
      {
        id: generateId(),
        role: "user",
        content: `Running scheduled task: ${description}`,
        createdAt: new Date(),
      },
    ]);
  }

  async createWorkerAgent(name: string, purpose: string) {
    const workerId = `worker-${generateId()}`;
    const workerAgent = await getAgentByName<Env, WorkerAgent>(
      this.env.WorkerAgent,
      workerId
    );

    // Call the initialize method with this chat's ID, the worker's name, purpose, and the human-readable workerId
    const result = await workerAgent.initialize(
      this.ctx.id.toString(),
      name,
      purpose,
      workerId
    );

    return {
      workerId,
      workerAgent,
      result,
    };
  }

  getEnvBinding<T>(key: string): T {
    return this.env[key as keyof Env] as T;
  }
}

export class WorkerAgent extends Agent<Env, WorkerAgentState> {
  async initialize(
    chatId: string,
    name: string,
    purpose: string,
    workerId: string
  ) {
    // Store the chat ID that created this worker along with its name, purpose, and the human-readable workerId
    await this.setState({
      metadata: { chatId, name, workerId },
      purpose,
      isRunning: false,
      taskQueue: [],
      completedTasks: [],
      lastProcessedAt: new Date(),
    });
    return {
      status: "initialized",
      metadata: { chatId, name, workerId },
      purpose,
    };
  }

  @unstable_callable()
  async start() {
    if (this.state.isRunning) return;

    await this.setState({
      ...this.state,
      isRunning: true,
    });
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
  private async processNextTask() {
    if (!this.state.isRunning) return;

    const task = this.state.taskQueue[0];
    if (!task) {
      // No tasks in queue, schedule check in 5 seconds
      await this.scheduleNextExecution(5);
      return;
    }

    // Process the task
    try {
      task.status = TaskStatus.RUNNING;
      task.startedAt = new Date();

      // TODO: Implement actual task processing based on type
      // For now, just mark as completed
      task.status = TaskStatus.COMPLETED;
      task.completedAt = new Date();

      // Move task to completed and remove from queue
      await this.setState({
        ...this.state,
        taskQueue: this.state.taskQueue.slice(1),
        completedTasks: [...this.state.completedTasks, task],
        lastProcessedAt: new Date(),
      });

      // Schedule next execution in 1 second
      await this.scheduleNextExecution(1);
    } catch (error: any) {
      task.status = TaskStatus.FAILED;
      task.error = error.message;
      // TODO: Implement retry logic
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
    return {
      status: this.state.isRunning ? "running" : "stopped",
      metadata: this.state.metadata,
      purpose: this.state.purpose,
      queueLength: this.state.taskQueue.length,
      completedTasks: this.state.completedTasks.length,
      lastProcessedAt: this.state.lastProcessedAt,
    };
  }
}

/**
 * Worker entry point that routes incoming requests to the appropriate handler
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    // Endpoint to let the UI check if OPENAI_API_KEY is configured
    if (url.pathname === "/check-open-ai-key") {
      const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
      return Response.json({ success: hasOpenAIKey });
    }

    // Log helpful message if key is missing
    if (!process.env.OPENAI_API_KEY) {
      console.error(
        "OPENAI_API_KEY is not set, don't forget to set it locally in .dev.vars, and use `wrangler secret bulk .dev.vars` to upload it to production"
      );
    }

    // First, try to handle any Agent/Durable Object request
    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) {
      return agentResponse;
    }

    // Next, attempt to serve static assets (JS, CSS, images, etc.)
    if (env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request.url);
      if (assetResponse.status !== 404) {
        return assetResponse;
      }

      // For any unknown path, fall back to serving the SPA entrypoint (index.html)
      const url = new URL(request.url);
      url.pathname = "/index.html";
      const htmlResponse = await env.ASSETS.fetch(url.toString());
      if (htmlResponse.status !== 404) {
        // Ensure correct content-type header for browsers
        const newHeaders = new Headers(htmlResponse.headers);
        newHeaders.set("content-type", "text/html;charset=UTF-8");
        return new Response(htmlResponse.body, {
          status: htmlResponse.status,
          headers: newHeaders,
        });
      }
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
