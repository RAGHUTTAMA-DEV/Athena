import { CalendarEvent, CalendarStore } from '../storage/stores/types.js';
import { EventBus } from '../background/eventBus.js';
import { EventPipeline } from '../proactive/eventPipeline.js';

/**
 * Natural language relative time parser for deadlines and reminders.
 */
export function parseRelativeDeadline(input: string, baseTime = Date.now()): number {
  const text = input.trim().toLowerCase();
  const baseDate = new Date(baseTime);

  // 1. "in X minutes" / "in X mins" / "in X min"
  const minMatch = text.match(/^in\s+(\d+)\s*(?:minutes?|mins?|m)$/i);
  if (minMatch) {
    return baseTime + parseInt(minMatch[1], 10) * 60 * 1000;
  }

  // 2. "in X hours" / "in X hrs" / "in X h"
  const hrMatch = text.match(/^in\s+(\d+)\s*(?:hours?|hrs?|h)$/i);
  if (hrMatch) {
    return baseTime + parseInt(hrMatch[1], 10) * 3600 * 1000;
  }

  // 3. "in X days" / "in X d"
  const dayMatch = text.match(/^in\s+(\d+)\s*(?:days?|d)$/i);
  if (dayMatch) {
    return baseTime + parseInt(dayMatch[1], 10) * 86400 * 1000;
  }

  // 4. "tomorrow morning" -> 09:00 AM next day
  if (text.includes('tomorrow morning')) {
    const nextDay = new Date(baseTime);
    nextDay.setDate(nextDay.getDate() + 1);
    nextDay.setHours(9, 0, 0, 0);
    return nextDay.getTime();
  }

  // 5. "tomorrow afternoon" -> 14:00 (2 PM) next day
  if (text.includes('tomorrow afternoon')) {
    const nextDay = new Date(baseTime);
    nextDay.setDate(nextDay.getDate() + 1);
    nextDay.setHours(14, 0, 0, 0);
    return nextDay.getTime();
  }

  // 6. "tomorrow evening" -> 18:00 (6 PM) next day
  if (text.includes('tomorrow evening')) {
    const nextDay = new Date(baseTime);
    nextDay.setDate(nextDay.getDate() + 1);
    nextDay.setHours(18, 0, 0, 0);
    return nextDay.getTime();
  }

  // 7. "tomorrow" -> 09:00 AM next day
  if (text === 'tomorrow') {
    const nextDay = new Date(baseTime);
    nextDay.setDate(nextDay.getDate() + 1);
    nextDay.setHours(9, 0, 0, 0);
    return nextDay.getTime();
  }

  // 8. "next monday", "next friday", etc.
  const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  for (let i = 0; i < daysOfWeek.length; i++) {
    if (text.includes(`next ${daysOfWeek[i]}`)) {
      const targetDay = i;
      const currentDay = baseDate.getDay();
      let diff = targetDay - currentDay;
      if (diff <= 0) diff += 7;
      const targetDate = new Date(baseTime);
      targetDate.setDate(targetDate.getDate() + diff);
      targetDate.setHours(9, 0, 0, 0);
      return targetDate.getTime();
    }
  }

  // 9. Standard ISO or Date.parse
  const parsed = Date.parse(input);
  if (!isNaN(parsed)) {
    return parsed;
  }

  // Default fallback: 1 hour from now
  return baseTime + 3600 * 1000;
}

export class CalendarEngine {
  private store: CalendarStore;
  private eventBus?: EventBus;
  private eventPipeline?: EventPipeline;
  private triggeredReminders: Set<string> = new Set();

  constructor(
    store: CalendarStore,
    eventBus?: EventBus,
    eventPipeline?: EventPipeline
  ) {
    this.store = store;
    this.eventBus = eventBus;
    this.eventPipeline = eventPipeline;
  }

  async createEvent(params: {
    id?: string;
    title: string;
    description?: string;
    startTime: number;
    endTime: number;
    location?: string;
    attendees?: string[];
    reminders?: number[]; // minutes before event
    status?: 'confirmed' | 'tentative' | 'cancelled';
    goalId?: string;
    taskId?: string;
    metadata?: Record<string, any>;
  }): Promise<CalendarEvent> {
    const eventId = params.id || `cal_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = Date.now();

    const event: CalendarEvent = {
      id: eventId,
      title: params.title,
      description: params.description,
      startTime: params.startTime,
      endTime: params.endTime,
      location: params.location,
      attendees: params.attendees,
      reminders: params.reminders || [15], // default 15m reminder
      status: params.status || 'confirmed',
      goalId: params.goalId,
      taskId: params.taskId,
      metadata: params.metadata,
      createdAt: now,
      updatedAt: now
    };

    const saved = await this.store.saveEvent(event);

    if (this.eventBus) {
      await this.eventBus.publish('calendar:event_created', {
        eventId: saved.id,
        title: saved.title,
        startTime: saved.startTime,
        goalId: saved.goalId
      });
    }

    return saved;
  }

  async getEvent(id: string): Promise<CalendarEvent | null> {
    return this.store.getEvent(id);
  }

  async listUpcoming(since = Date.now(), until?: number, limit = 50): Promise<CalendarEvent[]> {
    return this.store.listUpcoming(since, until, limit);
  }

  async deleteEvent(id: string): Promise<boolean> {
    const ok = await this.store.deleteEvent(id);
    if (ok && this.eventBus) {
      await this.eventBus.publish('calendar:event_deleted', { eventId: id });
    }
    return ok;
  }

  async cancelEvent(id: string): Promise<CalendarEvent | null> {
    const event = await this.store.getEvent(id);
    if (!event) return null;
    event.status = 'cancelled';
    event.updatedAt = Date.now();
    await this.store.saveEvent(event);

    if (this.eventBus) {
      await this.eventBus.publish('calendar:event_cancelled', { eventId: id, title: event.title });
    }
    return event;
  }

  /**
   * Scans upcoming events and fires reminder alerts if within threshold.
   */
  async checkAndTriggerDueReminders(currentTime = Date.now()): Promise<number> {
    // Look ahead 2 hours
    const upcoming = await this.store.listUpcoming(currentTime, currentTime + 2 * 3600 * 1000);
    let triggeredCount = 0;

    for (const event of upcoming) {
      const reminders = event.reminders || [15];
      for (const remMin of reminders) {
        const reminderTime = event.startTime - (remMin * 60 * 1000);
        const reminderKey = `${event.id}_rem_${remMin}`;

        // If reminderTime is past or within 60s, and not yet triggered
        if (currentTime >= reminderTime && currentTime < event.startTime && !this.triggeredReminders.has(reminderKey)) {
          this.triggeredReminders.add(reminderKey);
          triggeredCount++;

          const payload = {
            eventId: event.id,
            title: event.title,
            startTime: event.startTime,
            startsInMinutes: Math.max(0, Math.round((event.startTime - currentTime) / (60 * 1000))),
            goalId: event.goalId,
            taskId: event.taskId
          };

          if (this.eventBus) {
            await this.eventBus.publish('calendar:deadline_approaching', payload);
          }

          if (this.eventPipeline) {
            await this.eventPipeline.processEvent({
              id: `evt_cal_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
              topic: 'calendar:deadline_approaching',
              priority: 'high',
              source: 'calendar_engine',
              goalId: event.goalId,
              taskId: event.taskId,
              payload,
              status: 'pending',
              retryCount: 0,
              maxRetries: 3,
              timestamp: Date.now()
            });
          }
        }
      }
    }

    return triggeredCount;
  }
}
