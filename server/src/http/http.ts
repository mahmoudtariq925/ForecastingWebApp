// ============================================================================
// Framework-neutral HTTP types. Handlers speak only these — they never see
// Express (or, later, Azure Functions) request/response objects. An adapter
// translates between the host framework and these shapes, so a handler can be
// copied almost verbatim into an Azure Function.
// ============================================================================

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** An uploaded file, normalized away from any framework's representation. */
export interface UploadedFile {
  originalName: string;
  buffer: Buffer;
}

/** A normalized inbound request. */
export interface HttpRequest {
  params: Record<string, string>;
  query: Record<string, string | undefined>;
  body: unknown;
  file?: UploadedFile;
}

/** A binary download result (e.g. an .xlsx workbook). */
export interface FileDownload {
  fileName: string;
  contentType: string;
  data: Buffer;
}

/** A normalized outbound result. */
export interface HttpResult {
  status: number;
  json?: unknown;
  download?: FileDownload;
}

/** A handler: request in, result out. No framework, no side channels. */
export type Handler = (req: HttpRequest) => Promise<HttpResult>;

// Result helpers, so handlers read declaratively.
export const ok = (json: unknown): HttpResult => ({ status: 200, json });
export const created = (json: unknown): HttpResult => ({ status: 201, json });
export const noContent = (): HttpResult => ({ status: 204 });
export const fileDownload = (download: FileDownload): HttpResult => ({ status: 200, download });

export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
