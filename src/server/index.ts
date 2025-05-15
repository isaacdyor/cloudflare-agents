import { routeAgentRequest, type AgentNamespace } from "agents";

import { openai } from "@ai-sdk/openai";
import { Chat } from "./agents/chat";
import { WorkerAgent } from "./agents/worker";
// import { env } from "cloudflare:workers";

export interface Env {
  Chat: AgentNamespace<Chat>;
  WorkerAgent: AgentNamespace<WorkerAgent>;
  ASSETS: Fetcher;
}

// Cloudflare AI Gateway
// const openai = createOpenAI({
//   apiKey: env.OPENAI_API_KEY,
//   baseURL: env.GATEWAY_BASE_URL,
// });

export const model = openai("gpt-4o-2024-11-20");

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
