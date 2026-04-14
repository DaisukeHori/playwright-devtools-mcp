import type { Page, Browser, BrowserContext, CDPSession } from "playwright";

export interface BrowserSession {
  id: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  cdpSession: CDPSession;
  consoleLogs: ConsoleLogEntry[];
  networkRequests: NetworkRequestEntry[];
  createdAt: number;
}

export interface ConsoleLogEntry {
  type: string;
  text: string;
  timestamp: number;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
  stackTrace?: string;
}

export interface NetworkRequestEntry {
  id: string;
  url: string;
  method: string;
  resourceType: string;
  status?: number;
  statusText?: string;
  requestHeaders: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestPostData?: string;
  responseSize?: number;
  timing?: NetworkTiming;
  failed?: boolean;
  failureText?: string;
  timestamp: number;
  mimeType?: string;
  cdpRequestId?: string;
  securityDetails?: unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _responseRef?: any;
}

export interface NetworkTiming {
  startTime: number;
  domainLookupStart?: number;
  domainLookupEnd?: number;
  connectStart?: number;
  connectEnd?: number;
  sslStart?: number;
  sslEnd?: number;
  requestStart?: number;
  responseStart?: number;
  responseEnd?: number;
  totalMs: number;
}

export interface PerformanceMetrics {
  navigationTiming: Record<string, number>;
  resourceTiming: ResourceTimingEntry[];
  coreWebVitals: CoreWebVitals;
}

export interface ResourceTimingEntry {
  name: string;
  entryType: string;
  startTime: number;
  duration: number;
  transferSize: number;
  initiatorType: string;
}

export interface CoreWebVitals {
  lcp?: number;
  fid?: number;
  cls?: number;
  fcp?: number;
  ttfb?: number;
}

export interface StorageData {
  type: "localStorage" | "sessionStorage" | "cookies" | "indexedDB";
  entries: StorageEntry[];
  totalSize: number;
  count: number;
}

export interface StorageEntry {
  key: string;
  value: string;
  size: number;
  // Cookie-specific fields
  domain?: string;
  path?: string;
  expires?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
}

export interface DOMNode {
  tag: string;
  id?: string;
  classes?: string[];
  attributes?: Record<string, string>;
  text?: string;
  children?: DOMNode[];
  childCount?: number;
}

export interface ElementProperties {
  tag: string;
  id?: string;
  classes: string[];
  attributes: Record<string, string>;
  computedStyles?: Record<string, string>;
  boundingBox?: { x: number; y: number; width: number; height: number };
  innerText?: string;
  innerHTML?: string;
  accessibility?: {
    role?: string;
    name?: string;
    description?: string;
  };
}

export interface SecurityInfo {
  protocol?: string;
  cipher?: string;
  issuer?: string;
  validFrom?: string;
  validTo?: string;
  subjectName?: string;
  sanList?: string[];
}

export interface SecurityHeaders {
  url: string;
  headers: Record<string, string>;
  analysis: SecurityHeaderAnalysis[];
}

export interface SecurityHeaderAnalysis {
  header: string;
  present: boolean;
  value?: string;
  rating: "good" | "warning" | "missing" | "bad";
  recommendation?: string;
}

export interface ToolResponse {
  success: boolean;
  data: unknown;
  metadata: {
    timestamp: number;
    duration?: number;
    sessionId: string;
  };
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}
