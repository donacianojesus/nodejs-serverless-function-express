// LLM JSON Schema definitions for syllabus parsing

export interface LLMAssignment {
    title: string;
    due_date: string; // ISO date string (YYYY-MM-DD)
    details?: string;
    priority?: 'low' | 'medium' | 'high' | 'urgent';
  }
  
  export interface LLMExam {
    title: string;
    date: string; // ISO date string (YYYY-MM-DD)
    time?: string; // Optional time (HH:MM AM/PM)
    details?: string;
    priority?: 'low' | 'medium' | 'high' | 'urgent';
  }
  
  export interface LLMActivity {
    title: string;
    details?: string;
    type?: 'reading' | 'class' | 'discussion' | 'other';
    priority?: 'low' | 'medium' | 'high' | 'urgent';
  }
  
  export interface LLMParsedSyllabus {
    assignments: LLMAssignment[];
    exams: LLMExam[];
    activities: LLMActivity[];
    course_info?: {
      course_name?: string;
      course_code?: string;
      semester?: string;
      year?: number;
    };
    confidence_score?: number; // 0-100
  }
  
  // JSON Schema for validation
  export const LLM_SCHEMA = {
    type: "object",
    properties: {
      assignments: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            due_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            details: { type: "string" },
            priority: { 
              type: "string", 
              enum: ["low", "medium", "high", "urgent"] 
            }
          },
          required: ["title", "due_date"]
        }
      },
      exams: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            time: { type: "string" },
            details: { type: "string" },
            priority: { 
              type: "string", 
              enum: ["low", "medium", "high", "urgent"] 
            }
          },
          required: ["title", "date"]
        }
      },
      activities: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            details: { type: "string" },
            type: { 
              type: "string", 
              enum: ["reading", "class", "discussion", "other"] 
            },
            priority: { 
              type: "string", 
              enum: ["low", "medium", "high", "urgent"] 
            }
          },
          required: ["title"]
        }
      },
      course_info: {
        type: "object",
        properties: {
          course_name: { type: "string" },
          course_code: { type: "string" },
          semester: { type: "string" },
          year: { type: "number" }
        }
      },
      confidence_score: { 
        type: "number", 
        minimum: 0, 
        maximum: 100 
      }
    },
    required: ["assignments", "exams", "activities"]
  };