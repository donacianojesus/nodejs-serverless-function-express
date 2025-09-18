import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { CalendarEvent, EventType, Priority } from '../types/shared';

export interface GoogleCalendarEvent {
  summary: string;
  description?: string;
  start: {
    dateTime?: string;
    date?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
  };
  colorId?: string;
  reminders?: {
    useDefault: boolean;
  };
}

export interface GoogleCalendarSyncResult {
  success: boolean;
  syncedEvents: number;
  failedEvents: number;
  errors: string[];
  calendarId?: string;
}

export class GoogleCalendarService {
  private oauth2Client: OAuth2Client;
  private calendar: any;

  constructor() {
    // Determine redirect URI based on environment
    const redirectUri = process.env.NODE_ENV === 'production' 
      ? 'https://syllabus-to-calendar-jesus-donacianos-projects.vercel.app/google-auth-callback'
      : 'http://localhost:3000/google-auth-callback';
    
    // Initialize OAuth2 client with environment variables
    this.oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      redirectUri
    );
  }

  /**
   * Set credentials for the OAuth2 client
   */
  setCredentials(tokens: any) {
    this.oauth2Client.setCredentials(tokens);
    this.calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });
  }

  /**
   * Generate OAuth2 authorization URL
   */
  getAuthUrl(): string {
    const scopes = ['https://www.googleapis.com/auth/calendar'];
    
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent'
    });
  }

  /**
   * Exchange authorization code for tokens
   */
  async getTokens(code: string): Promise<any> {
    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);
    this.calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });
    return tokens;
  }

  /**
   * Check if the service is authenticated
   */
  isAuthenticated(): boolean {
    return this.oauth2Client.credentials.access_token !== undefined;
  }

  /**
   * Get user's calendars
   */
  async getCalendars(): Promise<any[]> {
    if (!this.calendar) {
      throw new Error('Not authenticated');
    }

    const response = await this.calendar.calendarList.list();
    return response.data.items || [];
  }

  /**
   * Create a new calendar
   */
  async createCalendar(name: string, description?: string): Promise<any> {
    if (!this.calendar) {
      throw new Error('Not authenticated');
    }

    const calendar = {
      summary: name,
      description: description || `Calendar created by LawBandit Calendar for ${name}`,
      timeZone: 'America/New_York'
    };

    const response = await this.calendar.calendars.insert({ requestBody: calendar });
    return response.data;
  }

  /**
   * Map CalendarEvent to Google Calendar event format
   */
  private mapToGoogleCalendarEvent(event: CalendarEvent): GoogleCalendarEvent {
    const startDate = new Date(event.date);
    const endDate = new Date(event.date);
    
    // Set end time to 1 hour after start time for assignments
    if (event.type === EventType.ASSIGNMENT || event.type === EventType.EXAM) {
      endDate.setHours(startDate.getHours() + 1);
    } else {
      endDate.setHours(startDate.getHours() + 0.5);
    }

    // Format dates for Google Calendar
    const startDateTime = startDate.toISOString();
    const endDateTime = endDate.toISOString();

    // Determine color based on event type
    let colorId = '1'; // Default blue
    switch (event.type) {
      case EventType.ASSIGNMENT:
        colorId = '5'; // Yellow
        break;
      case EventType.EXAM:
        colorId = '11'; // Red
        break;
      case EventType.READING:
        colorId = '10'; // Green
        break;
      case EventType.CLASS:
        colorId = '6'; // Orange
        break;
      case EventType.DEADLINE:
        colorId = '11'; // Red
        break;
      default:
        colorId = '1'; // Blue
    }

    return {
      summary: event.title,
      description: event.description || `Course: ${event.course || 'N/A'}\nType: ${event.type}\nPriority: ${event.priority || 'medium'}`,
      start: {
        dateTime: startDateTime
      },
      end: {
        dateTime: endDateTime
      },
      colorId,
      reminders: {
        useDefault: true
      }
    };
  }

  /**
   * Sync events to Google Calendar
   */
  async syncEvents(events: CalendarEvent[], calendarId: string = 'primary'): Promise<GoogleCalendarSyncResult> {
    if (!this.calendar) {
      throw new Error('Not authenticated');
    }

    const result: GoogleCalendarSyncResult = {
      success: true,
      syncedEvents: 0,
      failedEvents: 0,
      errors: [],
      calendarId
    };

    for (const event of events) {
      try {
        const googleEvent = this.mapToGoogleCalendarEvent(event);
        
        await this.calendar.events.insert({
          calendarId,
          requestBody: googleEvent
        });

        result.syncedEvents++;
      } catch (error) {
        result.failedEvents++;
        result.errors.push(`Failed to sync "${event.title}": ${error}`);
        console.error(`Error syncing event "${event.title}":`, error);
      }
    }

    result.success = result.failedEvents === 0;
    return result;
  }
}
