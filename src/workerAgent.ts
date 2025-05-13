import { Agent } from "agents";

/**
 * A minimal sub-worker agent. Each instance is its own Durable Object and can
 * be created on-the-fly by the main `Chat` agent.  For now it simply stores a
 * name, purpose and creation timestamp but can be extended later with richer
 * capabilities (chat, scheduling, etc.).
 */
export class WorkerAgent extends Agent<
  Env,
  {
    name?: string;
    purpose?: string;
    createdAt?: number;
  }
> {
  /**
   * Handle HTTP requests directed to the WorkerAgent.
   * Currently we support one endpoint:
   *   POST /init – set the initial metadata for the agent instance.
   */
  async onRequest(request: Request) {
    const url = new URL(request.url);

    // Initialise a freshly-created agent with metadata
    if (request.method === "POST" && url.pathname === "/init") {
      const { name, purpose } = (await request.json()) as {
        name?: string;
        purpose?: string;
      };

      this.setState({
        name,
        purpose,
        createdAt: Date.now(),
      });

      return new Response(`Initialised sub-agent \"${name}\"`, {
        status: 201,
      });
    }

    return new Response("OK");
  }
}
