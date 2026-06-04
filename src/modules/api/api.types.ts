import { IncomingMessage, ServerResponse } from "node:http";

export type QueryParams = Record<string, string | undefined>;

export interface ApiRequest {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  query: QueryParams;
}

export type ApiHandler = (request: ApiRequest) => Promise<unknown>;

export interface ApiRoute {
  method: "GET";
  path: string;
  handler: ApiHandler;
}
