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

    console.log('Processing request:', { 
      model, 
      messageCount: messages.length, 
      stream: !!stream,
      toolsEnabled: !!(tools && tools.length > 0),
      temperature: temperature
    });

    // Prepare the request to Fireworks API
    const fireworksPayload = {
      model,
      messages,
      // DeepSeek-V3-0324 optimized parameters
      temperature: temperature || 0.3, // DeepSeek optimized default
      top_p: top_p || 0.9,
      top_k: top_k || 40,
      max_tokens: max_tokens || 8192,
      presence_penalty: presence_penalty || 0,
      frequency_penalty: frequency_penalty || 0,
      stream: stream || false
    };

    // Add tools if provided
    if (tools && tools.length > 0) {
      fireworksPayload.tools = tools;
      if (tool_choice) {
        fireworksPayload.tool_choice = tool_choice;
      }
    }

    const fireworksHeaders = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Advanced-CoD-Studio/1.0'
    };

    // Handle streaming responses
    if (stream) {
      fireworksHeaders['Accept'] = 'text/event-stream';
      
      const response = await fetch('https://api.fireworks.ai/inference/v1/chat/completions', {
        method: 'POST',
        headers: fireworksHeaders,
        body: JSON.stringify(fireworksPayload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Fireworks API Error (Streaming):', response.status, errorText);
        
        // Handle specific DeepSeek-V3-0324 errors
        let errorMessage = errorText;
        if (response.status === 429) {
          errorMessage = 'Rate limit exceeded. DeepSeek-V3-0324 has usage limits.';
        } else if (response.status === 401) {
          errorMessage = 'Invalid API key or insufficient permissions for DeepSeek-V3-0324.';
        } else if (response.status === 400) {
          errorMessage = 'Invalid request format for DeepSeek-V3-0324. Check parameters.';
        }
        
        return res.status(response.status).json({ 
          error: 'API request failed',
          message: errorMessage 
        });
      }

      // Set headers for streaming
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (!response.body) {
        return res.status(500).json({ error: 'No response body from DeepSeek-V3-0324 API' });
      }

      // Handle streaming with proper async iteration
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
        console.error('Streaming error with DeepSeek-V3-0324:', error);
        res.write(`data: {"error": "Streaming interrupted"}\n\n`);
        res.end();
      }

    } else {
      // Handle non-streaming responses
      const response = await fetch('https://api.fireworks.ai/inference/v1/chat/completions', {
        method: 'POST',
        headers: fireworksHeaders,
        body: JSON.stringify(fireworksPayload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Fireworks API Error (Non-streaming):', response.status, errorText);
        
        // Handle specific DeepSeek-V3-0324 errors
        let errorMessage = errorText;
        if (response.status === 429) {
          errorMessage = 'Rate limit exceeded. DeepSeek-V3-0324 has usage limits.';
        } else if (response.status === 401) {
          errorMessage = 'Invalid API key or insufficient permissions for DeepSeek-V3-0324.';
        } else if (response.status === 400) {
          errorMessage = 'Invalid request format for DeepSeek-V3-0324. Check parameters.';
        } else if (response.status === 503) {
          errorMessage = 'DeepSeek-V3-0324 service temporarily unavailable. Try again later.';
        }
        
        return res.status(response.status).json({ 
          error: 'API request failed',
          message: errorMessage 
        });
      }

      const data = await response.json();
      
      // Log DeepSeek-V3-0324 usage stats
      if (data.usage) {
        console.log('DeepSeek-V3-0324 Usage:', {
          prompt_tokens: data.usage.prompt_tokens,
          completion_tokens: data.usage.completion_tokens,
          total_tokens: data.usage.total_tokens
        });
      }
      
      return res.status(200).json(data);
    }

  } catch (error) {
    console.error('Server error with DeepSeek-V3-0324:', error);
    
    // Enhanced error handling for DeepSeek-V3-0324
    let errorMessage = error.message;
    if (error.message.includes('fetch')) {
      errorMessage = 'Network error connecting to DeepSeek-V3-0324. Check your internet connection.';
    } else if (error.message.includes('timeout')) {
      errorMessage = 'Request timeout with DeepSeek-V3-0324. The model may be processing a complex request.';
    }
    
    return res.status(500).json({ 
      error: 'Internal server error',
      message: errorMessage 
    });
  }
};
