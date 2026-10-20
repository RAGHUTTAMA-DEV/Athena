import { Router } from 'express';
import { CommunicationController } from '../controllers/communicationController.js';

export function registerCommunicationRoutes(app: Router, services: { stores: any }) {
  const controller = new CommunicationController(services.stores);

  app.get('/api/v1/communication/channels', controller.listChannels);
  app.get('/api/v1/communication/conversations', controller.listConversations);
  app.get('/api/v1/calendar/events', controller.listCalendarEvents);
  app.post('/api/v1/calendar/events', controller.createCalendarEvent);
}
