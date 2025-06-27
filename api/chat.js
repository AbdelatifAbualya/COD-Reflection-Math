import { config } from 'dotenv';
config();

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function handleOptions(req, res) {
  res.setHeader('Vary', 'Origin');
  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
  return res.status(204).end();
}

// Function to call MCP tools
async function callMCPTool(toolName, parameters = {}) {
  try {
    const response = await fetch('https://model-context-protocol-mcp-with-ver-virid.vercel.app/api/server', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: parameters
        }
      })
    });

    const data = await response.json();
    return data.result?.content?.[0]?.text || 'No response from tool';
  } catch (error) {
    console.error('MCP Tool Error:', error);
    return `Tool error: ${error.message}`;
  }
}

// Check if message needs tool usage
function needsTools(message) {
  const toolKeywords = {
    Web Search: ['search', 'find', 'lookup', 'what is', 'latest', 'current news'],
    current_time: ['time', 'date', 'when', 'now'],
    calculate: ['calculate', 'math', 'compute', '+', '-', '*', '/', '=']
  };

  const lowerMessage = message.toLowerCase();
  
  for (const [tool, keywords] of Object.entries(toolKeywords)) {
    if (keywords.some(keyword => lowerMessage.includes(keyword))) {
      return tool;
    }
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return handleOptions(req, res);
  }

  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { messages, temperature, top_p, top_k, max_tokens, stream, model } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Invalid messages format' });
    }

    const apiKey = process.env.FIREWORKS_API_KEY;
    if (!apiKey) {
      throw new Error('FIREWORKS_API_KEY environment variable is not set');
    }

    const selectedModel = model || "accounts/fireworks/models/deepseek-v3-0324";
    
    // Get the last user message
    const lastMessage = messages[messages.length - 1];
    let enhancedMessages = [...messages];

    // Check if we need to use tools
    if (lastMessage.role === 'user') {
      const toolNeeded = needsTools(lastMessage.content);
      
      if (toolNeeded) {
        let toolResult = '';
        
        switch (toolNeeded) {
          case 'Web Search':
            // Extract search query from message
            const query = lastMessage.content.replace(/search|find|lookup|what is|latest|current news/gi, '').trim();
            toolResult = await callMCPTool('Web Search', { query, num_results: 3 });
            break;
            
          case 'current_time':
            toolResult = await callMCPTool('current_time');
            break;
            
          case 'calculate':
            // Extract mathematical expression
            const mathMatch = lastMessage.content.match(/[\d+\-*/().\s]+/);
            if (mathMatch) {
              toolResult = await callMCPTool('calculate', { expression: mathMatch[0].trim() });
            }
            break;
        }

        if (toolResult) {
          // Add tool result as system message
          enhancedMessages.push({
            role: 'system',
            content: `Tool Result: ${toolResult}`
          });
        }
      }
    }

    const response = await fetch('https://api.fireworks.ai/inference/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: enhancedMessages,
        temperature: temperature || 0.3,
        top_p: top_p || 0.9,
        top_k: top_k || 40,
        max_tokens: max_tokens || 8192,
        stream: stream || false
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Fireworks API error');
    }

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        res.write(chunk);
      }

      res.end();
    } else {
      const data = await response.json();
      return res.status(200).json(data);
    }

  } catch (error) {
    console.error('Chat API Error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}
