import { Database } from 'sqlite';
import { CalendarEvent, CalendarStore } from '../types.js';

function rowToEvent(row: any): CalendarEvent {
  return {
    id: row.id,
    title: row.title,
    description: row.description || undefined,
    startTime: Number(row.start_time),
    endTime: Number(row.end_time),
    location: row.location || undefined,
    attendees: row.attendees ? JSON.parse(row.attendees) : undefined,
    reminders: row.reminders ? JSON.parse(row.reminders) : undefined,
    status: row.status,
    goalId: row.goal_id || undefined,
    taskId: row.task_id || undefined,
    scheduledJobId: row.scheduled_job_id || undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  };
}

export class SqliteCalendarStore implements CalendarStore {
  constructor(private db: Database) {}

  async saveEvent(event: CalendarEvent): Promise<CalendarEvent> {
    await this.db.run(
      `INSERT INTO calendar_events (
        id, title, description, start_time, end_time, location, attendees, reminders, status, goal_id, task_id, scheduled_job_id, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        location = excluded.location,
        attendees = excluded.attendees,
        reminders = excluded.reminders,
        status = excluded.status,
        goal_id = excluded.goal_id,
        task_id = excluded.task_id,
        scheduled_job_id = excluded.scheduled_job_id,
        metadata = excluded.metadata,
        updated_at = excluded.updated_at`,
      event.id,
      event.title,
      event.description || null,
      event.startTime,
      event.endTime,
      event.location || null,
      event.attendees ? JSON.stringify(event.attendees) : null,
      event.reminders ? JSON.stringify(event.reminders) : null,
      event.status,
      event.goalId || null,
      event.taskId || null,
      event.scheduledJobId || null,
      event.metadata ? JSON.stringify(event.metadata) : null,
      event.createdAt,
      event.updatedAt
    );
    return event;
  }

  async getEvent(id: string): Promise<CalendarEvent | null> {
    const row = await this.db.get(`SELECT * FROM calendar_events WHERE id = ?`, id);
    return row ? rowToEvent(row) : null;
  }

  async deleteEvent(id: string): Promise<boolean> {
    const res = await this.db.run(`DELETE FROM calendar_events WHERE id = ?`, id);
    return (res.changes ?? 0) > 0;
  }

  async listUpcoming(since: number, until?: number, limit = 50): Promise<CalendarEvent[]> {
    if (until !== undefined) {
      const rows = await this.db.all(
        `SELECT * FROM calendar_events WHERE start_time >= ? AND start_time <= ? AND status != 'cancelled' ORDER BY start_time ASC LIMIT ?`,
        since,
        until,
        limit
      );
      return rows.map(rowToEvent);
    }
    const rows = await this.db.all(
      `SELECT * FROM calendar_events WHERE start_time >= ? AND status != 'cancelled' ORDER BY start_time ASC LIMIT ?`,
      since,
      limit
    );
    return rows.map(rowToEvent);
  }

  async listEventsForGoal(goalId: string): Promise<CalendarEvent[]> {
    const rows = await this.db.all(
      `SELECT * FROM calendar_events WHERE goal_id = ? ORDER BY start_time ASC`,
      goalId
    );
    return rows.map(rowToEvent);
  }
}
