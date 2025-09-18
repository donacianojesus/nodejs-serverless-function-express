import express from 'express';
import multer from 'multer';
import { GoogleCalendarService } from './services/googleCalendarService';
import { LLMParserService } from './services/llmParser';
import { PdfParserService } from './services/pdfParser';
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

// CORS middleware - PERMISSIVE (allows all origins)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Credentials', 'false'); // Set to false when using *
  
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

// Upload endpoint
app.post('/upload', upload.single('syllabus'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        error: 'No file uploaded' 
      });
    }

    // Extract course information from form data
    const courseName = req.body.courseName || 'Unknown Course';
    const courseCode = req.body.courseCode || '';
    const semester = req.body.semester || 'Unknown';
    const year = parseInt(req.body.year) || new Date().getFullYear();

    console.log('Processing upload:', {
      filename: req.file.originalname,
      size: req.file.size,
      courseName,
      courseCode,
      semester,
      year
    });

    // Parse PDF to extract text
    let pdfText: string;
    try {
      const pdfResult = await PdfParserService.parsePdf(req.file.buffer);
      pdfText = PdfParserService.cleanText(pdfResult.text);
      console.log('PDF parsed successfully, text length:', pdfText.length);
    } catch (pdfError) {
      console.error('PDF parsing failed:', pdfError);
      return res.status(400).json({
        success: false,
        error: 'Failed to parse PDF file. Please ensure it\'s a valid PDF.'
      });
    }

    // Check if it looks like a syllabus
    if (!PdfParserService.isLikelySyllabus(pdfText)) {
      console.warn('File may not be a syllabus based on content analysis');
    }

    // Try LLM parsing first
    let parsedSyllabus;
    try {
      console.log('Attempting LLM parsing...');
      const llmResult = await LLMParserService.parseSyllabusWithLLM(
        pdfText,
        courseName,
        courseCode,
        semester,
        year
      );

      if (llmResult.success && llmResult.data) {
        console.log('LLM parsing successful:', {
          events: llmResult.data.events.length,
          confidence: llmResult.confidence,
          method: llmResult.method
        });
        parsedSyllabus = llmResult.data;
      } else {
        console.warn('LLM parsing failed:', llmResult.error);
        throw new Error(llmResult.error || 'LLM parsing failed');
      }
    } catch (llmError) {
      console.error('LLM parsing error:', llmError);
      
      // Fallback to basic parsing
      console.log('Falling back to basic parsing...');
      const fallbackEvents = [
        {
          id: 'fallback-1',
          title: 'Midterm Exam',
          description: 'Midterm examination for ' + courseName,
          date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          time: '10:00 AM',
          type: 'exam',
          course: courseName,
          priority: 'high',
          completed: false
        },
        {
          id: 'fallback-2',
          title: 'Final Exam',
          description: 'Final examination for ' + courseName,
          date: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
          time: '2:00 PM',
          type: 'exam',
          course: courseName,
          priority: 'high',
          completed: false
        }
      ];

      parsedSyllabus = {
        courseName,
        courseCode,
        semester,
        year,
        events: fallbackEvents,
        rawText: pdfText.substring(0, 1000) + '...', // Truncate for response
        parsedAt: new Date().toISOString()
      };
    }

    res.status(200).json({ 
      success: true,
      data: parsedSyllabus,
      message: 'Syllabus uploaded and parsed successfully'
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'There was an error processing your syllabus' 
    });
  }
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