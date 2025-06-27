import { createMcpHandler } from "@vercel/mcp-adapter";
import { z } from "zod";

const handler = createMcpHandler((server) => {
  // Web Search Tool
  server.tool(
    "Web Search", 
    { 
      query: z.string().describe("Search query"),
      num_results: z.number().optional().default(5).describe("Number of results")
    }, 
    async ({ query, num_results }) => {
      try {
        const response = await fetch(`https://api.tavily.com/search`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.TAVILY_API_KEY}`
          },
          body: JSON.stringify({
            query,
            max_results: num_results,
            search_depth: "basic"
          })
        });
        
        const data = await response.json();
        const results = data.results?.map((r: any) => 
          `**${r.title}**\n${r.content}\nSource: ${r.url}`
        ).join('\n\n') || 'No results found';
        
        return {
          content: [{ type: "text", text: results }]
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Search error: ${error.message}` }]
        };
      }
    }
  );

  // Current Time Tool
  server.tool(
    "current_time",
    {},
    async () => ({
      content: [{ 
        type: "text", 
        text: `Current time: ${new Date().toISOString()}` 
      }]
    })
  );

  // Calculator Tool
  server.tool(
    "calculate",
    { 
      expression: z.string().describe("Mathematical expression to evaluate")
    },
    async ({ expression }) => {
      try {
        // Simple safe evaluation (you might want to use a proper math parser)
        const result = Function('"use strict"; return (' + expression + ')')();
        return {
          content: [{ type: "text", text: `${expression} = ${result}` }]
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Calculation error: ${error.message}` }]
        };
      }
    }
  );

  // Keep your original echo tool
  server.tool("echo", { message: z.string() }, async ({ message }) => ({
    content: [{ type: "text", text: `Tool echo: ${message}` }],
  }));
});

export { handler as GET, handler as POST, handler as DELETE };
