import { Request, Response } from 'express';

export class BrowserController {
  constructor(private stores: any) {}

  listProfiles = async (req: Request, res: Response): Promise<void> => {
    try {
      let profiles: any[] = [];
      if (this.stores.browserProfile) {
        profiles = await this.stores.browserProfile.list();
      }
      res.json({ profiles, count: profiles.length });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'PROFILES_FETCH_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  getSession = async (req: Request, res: Response): Promise<void> => {
    try {
      let profile = null;
      if (this.stores.browserProfile) {
        profile = await this.stores.browserProfile.get(req.params.id);
      }
      res.json({
        sessionId: req.params.id,
        profile,
        status: profile ? 'active' : 'idle',
        currentUrl: profile?.metadata?.currentUrl || 'about:blank'
      });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'SESSION_FETCH_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  getSnapshot = async (req: Request, res: Response): Promise<void> => {
    try {
      let profile = null;
      if (this.stores.browserProfile) {
        profile = await this.stores.browserProfile.get(req.params.id);
      }
      res.json({
        sessionId: req.params.id,
        capturedAt: Date.now(),
        screenshotUrl: profile?.metadata?.lastScreenshotUrl || null
      });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'SNAPSHOT_FETCH_FAILED', message: err.message, requestId: req.id }
      });
    }
  };
}
