import { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleCalendarService } from '../services/googleCalendarService';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { code } = req.body;
    
    if (!code) {
      return res.status(400).json({
        success: false,
        error: 'Authorization code is required'
      });
    }

    const service = new GoogleCalendarService();
    const tokens = await service.getTokens(code);
    
    res.json({
      success: true,
      data: { tokens, authenticated: true }
    });
  } catch (error) {
    console.error('Error in auth callback:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to authenticate with Google Calendar'
    });
  }
}
