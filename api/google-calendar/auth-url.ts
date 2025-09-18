import { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleCalendarService } from '../services/googleCalendarService';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const service = new GoogleCalendarService();
    const authUrl = service.getAuthUrl();
    
    res.json({
      success: true,
      data: { authUrl }
    });
  } catch (error) {
    console.error('Error generating auth URL:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate authorization URL'
    });
  }
}
