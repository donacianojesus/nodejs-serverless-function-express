import express from 'express';
import multer from 'multer';
import { GoogleCalendarService } from './services/googleCalendarService';
import { CalendarEvent } from './types/shared';

const app = express();

// Configure multer for file uploads
const upload = multer({ storage: multer.memoryStorage() });

// Initialize Google Calendar service
let googleCalendarService: GoogleCalendarService;

// Lazy initialization of GoogleCalendarService to ensure environment variables are loaded
const getGoogleCalendarService = () => {
  if (!googleCalendarService) {
    googleCalendarService = new GoogleCalendarService();
  }
  return googleCalendarService;
};

// Middleware
app.use(express.json());

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'https://syllabus-to-calendar-jesus-donacianos-projects.vercel.app');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'LawBandit Calendar API'
  });
});

// Upload endpoint (placeholder - you'll need to implement this)
app.post('/upload', upload.single('syllabus'), (req, res) => {
  res.status(200).json({ 
    message: 'Upload endpoint - implement your syllabus parsing logic here',
    success: true 
  });
});

// Google Calendar endpoints
app.get('/api/google-calendar/auth-url', (req, res) => {
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

app.post('/api/google-calendar/auth-callback', async (req, res) => {
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

app.post('/api/google-calendar/set-credentials', (req, res) => {
  try {
    const { tokens } = req.body;
    
    if (!tokens) {
      return res.status(400).json({
        success: false,
        error: 'Tokens are required'
      });
    }

    getGoogleCalendarService().setCredentials(tokens);
    
    return res.json({
      success: true,
      data: {
        authenticated: getGoogleCalendarService().isAuthenticated()
      }
    });
  } catch (error) {
    console.error('Error setting credentials:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to set credentials'
    });
  }
});

app.post('/api/google-calendar/sync-events', async (req, res) => {
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

app.get('/api/google-calendar/calendars', async (req, res) => {
  try {
    if (!getGoogleCalendarService().isAuthenticated()) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated with Google Calendar'
      });
    }

    const calendars = await getGoogleCalendarService().getCalendars();
    
    return res.json({
      success: true,
      data: {
        calendars
      }
    });
  } catch (error) {
    console.error('Error fetching calendars:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch calendars'
    });
  }
});

app.post('/api/google-calendar/create-calendar', async (req, res) => {
  try {
    const { name, description } = req.body;
    
    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Calendar name is required'
      });
    }

    if (!getGoogleCalendarService().isAuthenticated()) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated with Google Calendar'
      });
    }

    const calendar = await getGoogleCalendarService().createCalendar(name, description);
    
    return res.json({
      success: true,
      data: {
        calendar
      }
    });
  } catch (error) {
    console.error('Error creating calendar:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to create calendar'
    });
  }
});

app.get('/api/google-calendar/status', (req, res) => {
  return res.json({
    success: true,
    data: {
      authenticated: getGoogleCalendarService().isAuthenticated()
    }
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    message: 'LawBandit Calendar API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      upload: '/upload (POST)',
      googleCalendar: '/api/google-calendar'
    }
  });
});

export default app;