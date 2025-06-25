module.exports = async (req, res) => {
  // Handle CORS for all requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST requests for the main functionality
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get Fireworks API key from environment variables
    const apiKey = process.env.FIREWORKS_API_KEY;
    if (!apiKey) {
      console.error('FIREWORKS_API_KEY environment variable not set');
      return res.status(500).json({ 
        error: 'Server configuration error',
        message: 'API key not configured. Please check server environment variables.' 
      });
    }

    // Extract the request body
    const { model, messages, temperature, top_p, top_k, max_tokens, presence_penalty, frequency_penalty, stream, tools, tool_choice } = req.body;

    // Validate required fields
    if (!model || !messages) {
      console.error('Missing required fields in request:', { model: !!model, messages: !!messages });
      return res.status(400).json({ 
        error: 'Bad request',
        message: 'Missing required fields: model and messages' 
      });
    }

    console.log('Processing request for model:', model, { 
      messageCount: messages.length, 
      stream: !!stream,
      toolsEnabled: !!(tools && tools.length > 0),
      temperature: temperature
    });

    // Prepare the request to Fireworks API
    const fireworksPayload = {
      model,
      messages,
      temperature: temperature !== undefined ? temperature : 0.3, // Default if not provided
      top_p: top_p !== undefined ? top_p : 0.9,
      top_k: top_k !== undefined ? top_k : 40,
      max_tokens: max_tokens || 8192,
      presence_penalty: presence_penalty || 0,
      frequency_penalty: frequency_penalty || 0,
      stream: stream || false // Note: CoD stages are non-streaming in frontend logic
    };

    if (tools && tools.length > 0) {
      fireworksPayload.tools = tools;
      if (tool_choice) {
        fireworksPayload.tool_choice = tool_choice;
      }
    }

    const fireworksHeaders = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Enhanced-CoD-Studio/2.0' // Updated user agent
    };

    // Handle streaming responses (though frontend CoD logic is non-streaming for stages)
    if (stream) {
      fireworksHeaders['Accept'] = 'text/event-stream';
      
      const response = await fetch('https://api.fireworks.ai/inference/v1/chat/completions', {
        method: 'POST',
        headers: fireworksHeaders,
        body: JSON.stringify(fireworksPayload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Fireworks API Error (Streaming, Model: ${model}):`, response.status, errorText);
        let errorMessage = `API request failed for model ${model}. ${errorText}`;
        // Add specific error messages if needed based on model behavior
        return res.status(response.status).json({ error: 'API request failed', message: errorMessage });
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      // CORS headers already set

      if (!response.body) {
        return res.status(500).json({ error: `No response body from API for model ${model}` });
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          res.write(chunk);
        }
        res.end();
      } catch (error) {
        console.error(`Streaming error (Model: ${model}):`, error);
        res.write(`data: {"error": "Streaming interrupted for model ${model}"}\n\n`);
        res.end();
      }

    } else { // Handle non-streaming responses (used by CoD stages)
      const response = await fetch('https://api.fireworks.ai/inference/v1/chat/completions', {
        method: 'POST',
        headers: fireworksHeaders,
        body: JSON.stringify(fireworksPayload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Fireworks API Error (Non-streaming, Model: ${model}):`, response.status, errorText);
        let errorMessage = `API request failed for model ${model}. ${errorText}`;
         if (response.status === 429) {
          errorMessage = `Rate limit exceeded for model ${model}. Check usage limits.`;
        } else if (response.status === 401) {
          errorMessage = `Invalid API key or insufficient permissions for model ${model}.`;
        } else if (response.status === 400) {
          errorMessage = `Invalid request format for model ${model}. Check parameters. Details: ${errorText}`;
        } else if (response.status === 503) {
          errorMessage = `Service for model ${model} temporarily unavailable. Try again later.`;
        }
        return res.status(response.status).json({ error: 'API request failed', message: errorMessage });
      }

      const data = await response.json();
      if (data.usage) {
        console.log(`API Usage (Model: ${model}):`, {
          prompt_tokens: data.usage.prompt_tokens,
          completion_tokens: data.usage.completion_tokens,
          total_tokens: data.usage.total_tokens
        });
      }
      return res.status(200).json(data);
    }

  } catch (error) {
    console.error('Server error:', error);
    let errorMessage = error.message;
    if (error.message.includes('fetch')) {
      errorMessage = 'Network error connecting to the API. Check your internet connection or API endpoint.';
    } else if (error.message.includes('timeout')) {
      errorMessage = 'Request timeout with the API. The model may be processing a complex request or the service is slow.';
    }
    return res.status(500).json({ error: 'Internal server error', message: errorMessage });
  }
};
