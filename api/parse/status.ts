import type { VercelRequest, VercelResponse } from '@vercel/node';
import { LLMParserService } from '../services/llmParser';

export default function handler(req: VercelRequest, res: VercelResponse) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });
  }

  try {
    const status = LLMParserService.getStatus();
    
    return res.status(200).json({
      success: true,
      data: {
        llm: status,
        parsing: {
          pdf: true,
          llm: status.available,
          regex: true
        },
        environment: {
          enableLLM: process.env.ENABLE_LLM_PARSING === 'true',
          model: process.env.LLM_MODEL || 'gpt-4o',
          maxTokens: process.env.LLM_MAX_TOKENS || '10000',
          temperature: process.env.LLM_TEMPERATURE || '0.1'
        }
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Failed to get parsing status',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}