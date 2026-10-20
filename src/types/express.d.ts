import * as http from 'http';

declare module 'cors' {
  import { RequestHandler } from 'express';
  interface CorsOptions {
    origin?: boolean | string | RegExp | (string | RegExp)[] | ((origin: string | undefined, callback: (err: Error | null, origin?: any) => void) => void);
    methods?: string | string[];
    allowedHeaders?: string | string[];
    exposedHeaders?: string | string[];
    credentials?: boolean;
    maxAge?: number;
    preflightContinue?: boolean;
    optionsSuccessStatus?: number;
  }
  function cors(options?: CorsOptions): RequestHandler;
  export = cors;
}

declare module 'express' {
  export interface Request extends http.IncomingMessage {
    params: Record<string, string>;
    query: Record<string, any>;
    body: any;
    headers: http.IncomingHttpHeaders;
    id?: string;
    auth?: {
      userId?: string;
      workspaceId?: number;
      roles?: string[];
      isAuthorized: boolean;
      [key: string]: any;
    };
    app: Application;
    baseUrl: string;
    originalUrl: string;
    path: string;
    method: string;
    url: string;
    ip?: string;
  }

  export interface Response extends http.ServerResponse {
    status(code: number): this;
    sendStatus(code: number): this;
    json(body: any): this;
    send(body?: any): this;
    contentType(type: string): this;
    type(type: string): this;
    setHeader(name: string, value: number | string | readonly string[]): this;
    write(chunk: any, cb?: (error: Error | null | undefined) => void): boolean;
    end(cb?: () => void): this;
    end(chunk: any, cb?: () => void): this;
    sendFile(path: string, options?: any, fn?: (err?: Error) => void): void;
    download(path: string, filename?: string, fn?: (err?: Error) => void): void;
    links(links: any): this;
    location(url: string): this;
    redirect(url: string): void;
    redirect(status: number, url: string): void;
    render(view: string, options?: object, callback?: (err: Error, html: string) => void): void;
    headersSent: boolean;
    flushHeaders?(): void;
  }

  export type NextFunction = (err?: any) => void;

  export interface RequestHandler {
    (req: Request, res: Response, next: NextFunction): any;
  }

  export interface ErrorRequestHandler {
    (err: any, req: Request, res: Response, next: NextFunction): any;
  }

  export interface IRouterMatcher<T> {
    (path: string | RegExp, ...handlers: RequestHandler[]): T;
    (path: string | RegExp, ...handlers: any[]): T;
  }

  export interface IRouter {
    use(...handlers: (RequestHandler | ErrorRequestHandler | IRouter | any)[]): this;
    use(path: string | RegExp, ...handlers: (RequestHandler | ErrorRequestHandler | IRouter | any)[]): this;
    get: IRouterMatcher<this>;
    post: IRouterMatcher<this>;
    put: IRouterMatcher<this>;
    delete: IRouterMatcher<this>;
    patch: IRouterMatcher<this>;
    options: IRouterMatcher<this>;
    head: IRouterMatcher<this>;
    all: IRouterMatcher<this>;
  }

  export interface Router extends IRouter {}

  export interface Application extends IRouter {
    set(setting: string, val: any): this;
    get: ((setting: string) => any) & IRouterMatcher<this>;
    listen(port: number, hostname: string, callback?: () => void): http.Server;
    listen(port: number, callback?: () => void): http.Server;
    listen(callback?: () => void): http.Server;
  }

  export interface Express extends Application {}

  interface ExpressCore {
    (): Express;
    json(options?: any): RequestHandler;
    urlencoded(options?: any): RequestHandler;
    raw(options?: any): RequestHandler;
    text(options?: any): RequestHandler;
    static(root: string, options?: any): RequestHandler;
    Router(options?: any): Router;
  }

  const express: ExpressCore;
  export default express;
}
