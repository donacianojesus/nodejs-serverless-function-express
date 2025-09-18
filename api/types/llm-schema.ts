// LLM Schema definitions for syllabus parsing

export interface LLMParsedSyllabus {
  assignments: LLMAssignment[];
  exams: LLMExam[];
  activities: LLMActivity[];
  course_info: {
    course_name: string;
    course_code: string;
    semester: string;
    year: number;
  };
  confidence_score: number;
}

export interface LLMAssignment {
  title: string;
  due_date: string; // YYYY-MM-DD format
  details?: string;
  priority?: 'urgent' | 'high' | 'medium' | 'low';
}

export interface LLMExam {
  title: string;
  date: string; // YYYY-MM-DD format
  time?: string;
  details?: string;
  priority?: 'urgent' | 'high' | 'medium' | 'low';
}

export interface LLMActivity {
  title: string;
  details?: string;
  type?: 'reading' | 'assignment' | 'exam' | 'other';
  priority?: 'urgent' | 'high' | 'medium' | 'low';
}

export const LLM_SCHEMA = {
  type: "object",
  properties: {
    assignments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          due_date: { type: "string", format: "date" },
          details: { type: "string" },
          priority: { type: "string", enum: ["urgent", "high", "medium", "low"] }
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
          date: { type: "string", format: "date" },
          time: { type: "string" },
          details: { type: "string" },
          priority: { type: "string", enum: ["urgent", "high", "medium", "low"] }
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
          type: { type: "string", enum: ["reading", "assignment", "exam", "other"] },
          priority: { type: "string", enum: ["urgent", "high", "medium", "low"] }
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
      },
      required: ["course_name", "course_code", "semester", "year"]
    },
    confidence_score: { type: "number", minimum: 0, maximum: 100 }
  },
  required: ["assignments", "exams", "activities", "course_info", "confidence_score"]
};