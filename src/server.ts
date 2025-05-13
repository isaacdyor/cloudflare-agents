import {
  Agent,
  routeAgentRequest,
  type AgentNamespace,
  type Schedule,
  getAgentByName,
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
// import { env } from "cloudflare:workers";

interface Env {
  Chat: AgentNamespace<Chat>;
  WorkerAgent: AgentNamespace<WorkerAgent>;
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

  async createWorkerAgent() {
    const workerId = `worker-${generateId()}`;
    const workerAgent = await getAgentByName<Env, WorkerAgent>(
      this.env.WorkerAgent,
      workerId
    );

    // Call the initialize method with this chat's ID
    const result = await workerAgent.initialize(this.ctx.id.toString());

    return {
      workerId,
      workerAgent,
      result,
    };
  }

  async onRequest(request: Request) {
    const url = new URL(request.url);
    console.log("onRequest", url.pathname, request.method);
    if (url.pathname.endsWith("/test-worker") && request.method === "POST") {
      const { workerId, result } = await this.createWorkerAgent();
      return new Response(
        JSON.stringify({
          message: `just create worker with id: ${workerId}`,
          result,
        }),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    }
    return super.onRequest(request);
  }
}

interface WorkerAgentState {
  chatId: string;
}
export class WorkerAgent extends Agent<Env, WorkerAgentState> {
  async initialize(chatId: string) {
    // Store the chat ID that created this worker
    await this.setState({ chatId });
    return { status: "initialized", chatId, workerId: this.ctx.id.toString() };
  }

  async onRequest(request: Request) {
    const url = new URL(request.url);
    console.log("Agent who created me", this.state.chatId);
    if (url.pathname.endsWith("/owner") && request.method === "GET") {
      return new Response(
        JSON.stringify({ message: `I was created by ${this.state.chatId}` }),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    }
    return super.onRequest(request);
  }
}

/**
 * Worker entry point that routes incoming requests to the appropriate handler
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/check-open-ai-key") {
      const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
      return Response.json({
        success: hasOpenAIKey,
      });
    }
    if (!process.env.OPENAI_API_KEY) {
      console.error(
        "OPENAI_API_KEY is not set, don't forget to set it locally in .dev.vars, and use `wrangler secret bulk .dev.vars` to upload it to production"
      );
    }
    return (
      // Route the request to our agent or return 404 if not found
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
