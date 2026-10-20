import { Request, Response, NextFunction } from 'express';

export interface AuthContext {
  userId?: string;
  workspaceId?: number;
  roles?: string[];
  isAuthorized: boolean;
}

export function authMiddleware(requiredApiKey?: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Exclude health and documentation from auth
    if (req.path.startsWith('/health') || req.path.startsWith('/docs') || req.path.startsWith('/api/v1/openapi.json')) {
      return next();
    }

    const configuredKey = requiredApiKey || process.env.ATHENA_API_KEY;
    if (configuredKey) {
      const authHeader = req.headers.authorization;
      const customHeader = req.headers['x-api-key'] as string | undefined;
      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : customHeader;

      if (!token || token !== configuredKey) {
        return res.status(401).json({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid or missing API key',
            requestId: req.id,
            details: {}
          }
        });
      }
    }

    // Optional workspace context
    const wsHeader = req.headers['x-workspace-id'];
    const workspaceId = wsHeader ? parseInt(String(wsHeader), 10) : undefined;

    req.auth = {
      workspaceId,
      isAuthorized: true
    } as AuthContext;

    next();
  };
}
