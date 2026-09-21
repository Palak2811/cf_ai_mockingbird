// Worker entry point. Agent traffic (/agents/prep-agent/:session/...) goes to PrepAgent;
// everything else is served from static assets (the React app) by the assets binding.
import { routeAgentRequest } from "agents";

export { PrepAgent } from "./agent";
export { PrepWorkflow } from "./workflow";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") return Response.json({ ok: true });
    return (await routeAgentRequest(request, env)) ?? new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
