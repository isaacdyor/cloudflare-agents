import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAgent } from "agents/react";

// Optional: re-use existing UI components for consistency
import { Card } from "@/components/card/Card";
import { Button } from "@/components/button/Button";

interface WorkerInfo {
  status: string;
  chatId: string;
  workerId: string;
  name: string;
  purpose: string;
  [key: string]: unknown; // Allow additional properties
}

export default function AgentInfoPage() {
  const { id } = useParams<{ id: string }>();
  const [info, setInfo] = useState<WorkerInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const agent = useAgent({
    agent: "workerAgent",
    name: id ?? "default",
  });

  console.log("Agent:", agent);

  useEffect(() => {
    async function fetchInfo() {
      if (!id) return;
      console.log("Fetching info for agent:", id);
      try {
        const result = await agent.call("getWorkerInfo");
        setInfo(result as WorkerInfo);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }
    fetchInfo();
  }, [id, agent]);

  if (!id) return <p className="p-4">No agent ID provided.</p>;
  if (loading) return <p className="p-4">Loading agent data…</p>;
  if (error) return <p className="p-4 text-red-600">Error: {error}</p>;

  return (
    <div className="p-4 flex flex-col items-center w-full">
      <div className="w-full max-w-2xl">
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Worker Agent Details</h2>
          <pre className="whitespace-pre-wrap break-words text-sm">
            {JSON.stringify(info, null, 2)}
          </pre>
        </Card>
        <div className="mt-6 flex justify-center">
          <Link to="/">Back to Chat</Link>
        </div>
      </div>
    </div>
  );
}
