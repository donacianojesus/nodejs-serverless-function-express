import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.status(200).json({ 
    message: 'LawBandit Calendar API',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      upload: '/api/upload (POST)'
    }
  });
}