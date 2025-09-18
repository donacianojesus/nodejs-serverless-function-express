// Shared types for the LawBandit Calendar application

export interface CalendarEvent {
    id: string;
    title: string;
    description?: string;
    date: Date;
    time?: string;
    type: EventType;
    course?: string;
    priority?: Priority;
    completed?: boolean;
  }
  
  export enum EventType {
    ASSIGNMENT = 'assignment',
    EXAM = 'exam',
    READING = 'reading',
    CLASS = 'class',
    DEADLINE = 'deadline',
    OTHER = 'other'
  }
  
  export enum Priority {
    LOW = 'low',
    MEDIUM = 'medium',
    HIGH = 'high',
    URGENT = 'urgent'
  }
  
  export interface ParsedSyllabus {
    courseName: string;
    courseCode?: string;
    semester?: string;
    year?: number;
    events: CalendarEvent[];
    rawText: string;
    parsedAt: Date;
  }
  
  export interface SyllabusUploadRequest {
    file: File;
    courseName?: string;
    courseCode?: string;
    semester?: string;
    year?: number;
  }
  
  export interface SyllabusUploadResponse {
    success: boolean;
    data?: ParsedSyllabus;
    error?: string;
  }
  
  export interface ApiResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
    message?: string;
  }
  
  export interface CalendarView {
    type: 'month' | 'week' | 'day';
    currentDate: Date;
    events: CalendarEvent[];
  }
  
  export interface FilterOptions {
    eventTypes?: EventType[];
    courses?: string[];
    dateRange?: {
      start: Date;
      end: Date;
    };
    priority?: Priority[];
  }
  
  export interface UserPreferences {
    defaultView: CalendarView['type'];
    showCompleted: boolean;
    notifications: boolean;
    theme: 'light' | 'dark' | 'auto';
    timeFormat: '12h' | '24h';
  }