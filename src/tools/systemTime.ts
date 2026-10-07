import { Tool } from '../runtime/types.js';

export const systemTimeTool: Tool = {
  definition: {
    name: 'getSystemTime',
    description: 'Retrieve the current local date and time of the system.',
    parameters: {
      type: 'OBJECT',
      properties: {}
    }
  },
  execute: async () => {
    const now = new Date();
    const options: Intl.DateTimeFormatOptions = { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short'
    };
    return { success: true, currentTime: now.toLocaleDateString('en-US', options) };
  }
};
