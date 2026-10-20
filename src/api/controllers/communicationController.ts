import { Request, Response } from 'express';

export class CommunicationController {
  constructor(private stores: any) {}

  listChannels = async (req: Request, res: Response): Promise<void> => {
    try {
      let channels: any[] = [];
      if (this.stores.communication) {
        channels = await this.stores.communication.listChannels();
      }
      res.json({ channels, count: channels.length });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'CHANNELS_FETCH_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  listConversations = async (req: Request, res: Response): Promise<void> => {
    try {
      let convos: any[] = [];
      if (this.stores.communication) {
        convos = await this.stores.communication.listConversations(req.query.channelId ? String(req.query.channelId) : undefined);
      }
      res.json({ conversations: convos, count: convos.length });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'CONVERSATIONS_FETCH_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  listCalendarEvents = async (req: Request, res: Response): Promise<void> => {
    try {
      let events: any[] = [];
      if (this.stores.calendar) {
        const since = req.query.since ? parseInt(String(req.query.since), 10) : Date.now() - (24 * 3600 * 1000);
        events = await this.stores.calendar.listUpcoming(since, undefined, req.query.limit ? parseInt(String(req.query.limit), 10) : undefined);
      }
      res.json({ events, count: events.length });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'CALENDAR_FETCH_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  createCalendarEvent = async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.body?.title || req.body?.startTime === undefined || req.body?.endTime === undefined) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Fields title, startTime, endTime are required', requestId: req.id }
        });
        return;
      }
      const id = `cal_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const event = {
        id,
        title: req.body.title,
        description: req.body.description,
        startTime: req.body.startTime,
        endTime: req.body.endTime,
        location: req.body.location,
        status: 'confirmed' as const,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      if (this.stores.calendar) {
        await this.stores.calendar.saveEvent(event);
      }
      res.status(201).json(event);
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'EVENT_CREATE_FAILED', message: err.message, requestId: req.id }
      });
    }
  };
}
