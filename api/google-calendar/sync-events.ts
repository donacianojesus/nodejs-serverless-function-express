import { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleCalendarService } from '../services/googleCalendarService';
import { CalendarEvent } from '../types/shared';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { events, calendarId } = req.body;
    
    if (!events || !Array.isArray(events)) {
      return res.status(400).json({
        success: false,
        error: 'Events array is required'
      });
    }

    const service = new GoogleCalendarService();
    
    if (!service.isAuthenticated()) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated with Google Calendar'
      });
    }

    const result = await service.syncEvents(
      events as CalendarEvent[], 
      calendarId || 'primary'
    );
    
    res.json({
      success: result.success,
      data: result,
      message: result.success 
        ? `Successfully synced ${result.syncedEvents} events to Google Calendar`
        : `Synced ${result.syncedEvents} events, ${result.failedEvents} failed`
    });
  } catch (error) {
    console.error('Error syncing events:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to sync events to Google Calendar'
    });
  }
}
