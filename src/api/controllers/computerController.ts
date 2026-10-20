import { Request, Response } from 'express';
import { ComputerController as CoreComputerController } from '../../computer/computerController.js';
import * as fs from 'fs';

export class ComputerPlatformController {
  private computer = CoreComputerController.getInstance();

  inspectScreen = async (req: Request, res: Response): Promise<void> => {
    try {
      const screenInfo = await this.computer.inspectScreen();
      let base64Image: string | undefined;
      if (screenInfo.screenshotPath && fs.existsSync(screenInfo.screenshotPath)) {
        base64Image = fs.readFileSync(screenInfo.screenshotPath).toString('base64');
      }
      res.json({
        dimensions: screenInfo.dimensions,
        activeWindow: screenInfo.activeWindow,
        screenshotBase64: base64Image ? `data:image/png;base64,${base64Image}` : undefined
      });
    } catch (err: any) {
      res.status(503).json({
        error: { code: 'COMPUTER_UNSUPPORTED', message: err.message, requestId: req.id }
      });
    }
  };

  listWindows = async (req: Request, res: Response): Promise<void> => {
    try {
      const windows = await this.computer.listWindows();
      res.json({ windows, count: windows.length });
    } catch (err: any) {
      res.status(503).json({
        error: { code: 'COMPUTER_UNSUPPORTED', message: err.message, requestId: req.id }
      });
    }
  };

  focusWindow = async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.body?.target) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Field "target" is required', requestId: req.id }
        });
        return;
      }
      const focused = await this.computer.focusWindow(req.body.target);
      res.json({ success: focused });
    } catch (err: any) {
      res.status(403).json({
        error: { code: 'PERMISSION_DENIED', message: err.message, requestId: req.id }
      });
    }
  };
}
