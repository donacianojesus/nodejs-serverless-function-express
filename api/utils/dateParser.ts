import { parse, format, isValid, addDays, addWeeks, startOfWeek, endOfWeek } from 'date-fns';

export interface DateParseResult {
  date: Date | null;
  confidence: 'high' | 'medium' | 'low';
  originalText: string;
  parsedFormat?: string;
}

export class DateParserService {
  // Common date formats found in syllabi
  private static readonly DATE_FORMATS = [
    'MM/dd/yyyy',
    'M/d/yyyy',
    'MM/dd/yy',
    'M/d/yy',
    'yyyy-MM-dd',
    'MM-dd-yyyy',
    'M-d-yyyy',
    'MMMM dd, yyyy',
    'MMMM d, yyyy',
    'MMM dd, yyyy',
    'MMM d, yyyy',
    'dd MMM yyyy',
    'd MMM yyyy',
    'MMMM dd',
    'MMM dd',
    'MM/dd',
    'M/d',
  ];

  // Relative date patterns
  private static readonly RELATIVE_PATTERNS = [
    /week\s+(\d+)/i,
    /day\s+(\d+)/i,
    /class\s+(\d+)/i,
    /session\s+(\d+)/i,
  ];

  /**
   * Parse a date string using multiple formats
   */
  static parseDate(dateString: string, referenceDate: Date = new Date()): DateParseResult {
    const cleanString = dateString.trim();
    
    // Try exact format matches first
    for (const format of this.DATE_FORMATS) {
      try {
        const parsed = parse(cleanString, format, referenceDate);
        if (isValid(parsed)) {
          return {
            date: parsed,
            confidence: 'high',
            originalText: dateString,
            parsedFormat: format,
          };
        }
      } catch (error) {
        // Continue to next format
        continue;
      }
    }

    // Try relative date patterns
    const relativeResult = this.parseRelativeDate(cleanString, referenceDate);
    if (relativeResult) {
      return relativeResult;
    }

    // Try JavaScript's native date parsing as fallback
    try {
      const nativeDate = new Date(cleanString);
      if (isValid(nativeDate)) {
        return {
          date: nativeDate,
          confidence: 'medium',
          originalText: dateString,
          parsedFormat: 'native',
        };
      }
    } catch (error) {
      // Native parsing failed
    }

    return {
      date: null,
      confidence: 'low',
      originalText: dateString,
    };
  }

  /**
   * Parse relative dates like "Week 3", "Day 5"
   */
  private static parseRelativeDate(dateString: string, referenceDate: Date): DateParseResult | null {
    for (const pattern of this.RELATIVE_PATTERNS) {
      const match = dateString.match(pattern);
      if (match) {
        const number = parseInt(match[1], 10);
        
        // For now, assume each week is 7 days from the reference date
        // This is a simplified approach - in a real app, you'd want more context
        const calculatedDate = addWeeks(referenceDate, number - 1);
        
        return {
          date: calculatedDate,
          confidence: 'medium',
          originalText: dateString,
          parsedFormat: 'relative',
        };
      }
    }
    
    return null;
  }

  /**
   * Extract all dates from a text string
   */
  static extractDates(text: string, referenceDate: Date = new Date()): DateParseResult[] {
    // Common date patterns in text
    const datePatterns = [
      // MM/DD/YYYY or M/D/YYYY
      /\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/g,
      // Month DD, YYYY or Month D, YYYY
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/gi,
      // DD Month YYYY or D Month YYYY
      /\b\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/gi,
      // YYYY-MM-DD
      /\b\d{4}-\d{1,2}-\d{1,2}\b/g,
      // Week X patterns
      /\b(week|day|class|session)\s+\d+\b/gi,
    ];

    const foundDates: DateParseResult[] = [];
    const seenDates = new Set<string>();

    for (const pattern of datePatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const dateString = match[0];
        
        // Avoid duplicates
        if (seenDates.has(dateString.toLowerCase())) {
          continue;
        }
        seenDates.add(dateString.toLowerCase());

        const result = this.parseDate(dateString, referenceDate);
        if (result.date) {
          foundDates.push(result);
        }
      }
    }

    // Sort by confidence and date
    return foundDates.sort((a, b) => {
      if (a.confidence !== b.confidence) {
        const confidenceOrder = { high: 3, medium: 2, low: 1 };
        return confidenceOrder[b.confidence] - confidenceOrder[a.confidence];
      }
      return a.date && b.date ? a.date.getTime() - b.date.getTime() : 0;
    });
  }

  /**
   * Format date for display
   */
  static formatDate(date: Date, formatString: string = 'MMMM dd, yyyy'): string {
    return format(date, formatString);
  }

  /**
   * Check if a date is in the future
   */
  static isFutureDate(date: Date, referenceDate: Date = new Date()): boolean {
    return date > referenceDate;
  }

  /**
   * Check if a date is within a reasonable academic year range
   */
  static isReasonableAcademicDate(date: Date, referenceDate: Date = new Date()): boolean {
    const oneYearAgo = addDays(referenceDate, -365);
    const twoYearsFromNow = addDays(referenceDate, 730);
    
    return date >= oneYearAgo && date <= twoYearsFromNow;
  }
}