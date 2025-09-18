import express from 'express';
import { GoogleCalendarService } from './services/googleCalendarService';
import { CalendarEvent } from './types/shared';

const router = express.Router();
let googleCalendarService: GoogleCalendarService;

// Lazy initialization of GoogleCalendarService to ensure environment variables are loaded
const getGoogleCalendarService = () => {
  if (!googleCalendarService) {
    googleCalendarService = new GoogleCalendarService();
  }
  return googleCalendarService;
};

/**
 * GET /api/google-calendar/auth-url
 * Get Google Calendar OAuth2 authorization URL
 */
router.get('/auth-url', (req, res) => {
  try {
    const authUrl = getGoogleCalendarService().getAuthUrl();
    return res.json({
      success: true,
      data: {
        authUrl
      }
    });
  } catch (error) {
    console.error('Error generating auth URL:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to generate authorization URL'
    });
  }
});

/**
 * POST /api/google-calendar/auth-callback
 * Exchange authorization code for tokens
 */
router.post('/auth-callback', async (req, res) => {
  try {
    const { code } = req.body;
    
    if (!code) {
      return res.status(400).json({
        success: false,
        error: 'Authorization code is required'
      });
    }

    const tokens = await getGoogleCalendarService().getTokens(code);
    
    return res.json({
      success: true,
      data: {
        tokens,
        authenticated: true
      }
    });
  } catch (error) {
    console.error('Error in auth callback:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to authenticate with Google Calendar'
    });
  }
});

/**
 * POST /api/google-calendar/sync-events
 * Sync events to Google Calendar
 */
router.post('/sync-events', async (req, res) => {
  try {
    const { events, calendarId } = req.body;
    
    if (!events || !Array.isArray(events)) {
      return res.status(400).json({
        success: false,
        error: 'Events array is required'
      });
    }

    if (!getGoogleCalendarService().isAuthenticated()) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated with Google Calendar'
      });
    }

    const result = await getGoogleCalendarService().syncEvents(
      events as CalendarEvent[], 
      calendarId || 'primary'
    );
    
    return res.json({
      success: result.success,
      data: result,
      message: result.success 
        ? `Successfully synced ${result.syncedEvents} events to Google Calendar`
        : `Synced ${result.syncedEvents} events, ${result.failedEvents} failed`
    });
  } catch (error) {
    console.error('Error syncing events:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to sync events to Google Calendar'
    });
  }
});

/**
 * GET /api/google-calendar/status
 * Check authentication status
 */
router.get('/status', (req, res) => {
  return res.json({
    success: true,
    data: {
      authenticated: getGoogleCalendarService().isAuthenticated()
    }
  });
});

export default router;