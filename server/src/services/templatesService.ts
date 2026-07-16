import { randomUUID } from 'node:crypto';
import type { ForecastTemplate, TemplateLayout } from '../../../shared/types';
import { parseTemplateBuffer } from '../../../shared/excelTemplate';
import type { Repositories, TemplateRecord } from '../repositories/index.js';
import type { FileStorage } from '../storage/fileStorage.js';
import { badRequest, notFound } from './errors.js';

/**
 * Template management: uploads store the physical .xlsx in FileStorage and a
 * database record referencing it; the structure is parsed server-side from
 * the workbook (authoritative — the client never sends parsed structure).
 */
export class TemplatesService {
  constructor(
    private repos: Repositories,
    private files: FileStorage,
  ) {}

  private toDto(record: TemplateRecord): ForecastTemplate {
    const { fileKey, ...rest } = record;
    return {
      ...rest,
      assignedEntities: this.repos.templates.getAssignments(record.id),
      hasFile: Boolean(fileKey),
    };
  }

  list(): ForecastTemplate[] {
    return this.repos.templates.list().map((t) => this.toDto(t));
  }

  get(id: string): ForecastTemplate {
    const record = this.repos.templates.getById(id);
    if (!record) throw notFound('Template');
    return this.toDto(record);
  }

  async upload(
    file: { originalname: string; buffer: Buffer },
    layout: TemplateLayout | 'auto',
    uploadedBy: string,
  ): Promise<ForecastTemplate> {
    const parsed = await parseTemplateBuffer(file.buffer, layout);
    const id = `tpl-${randomUUID()}`;
    const fileKey = await this.files.put(`${id}.xlsx`, file.buffer);
    this.repos.templates.create({
      id,
      name: file.originalname.replace(/\.xlsx$/i, ''),
      fileName: file.originalname,
      fileKey,
      uploadedAt: new Date().toISOString(),
      uploadedBy,
      layout: parsed.layout,
      categories: parsed.categories,
    });
    this.repos.templates.setAssignments(id, []);
    return this.get(id);
  }

  update(
    id: string,
    patch: { name?: string; layout?: TemplateLayout; assignedEntities?: string[] },
  ): ForecastTemplate {
    const record = this.repos.templates.getById(id);
    if (!record) throw notFound('Template');
    if (patch.layout && patch.layout !== 'grouped' && patch.layout !== 'days-across') {
      throw badRequest(`Unknown layout: ${patch.layout}`);
    }
    this.repos.templates.update(id, {
      name: patch.name?.trim() || record.name,
      layout: patch.layout ?? record.layout,
    });
    if (patch.assignedEntities) {
      this.repos.templates.setAssignments(id, patch.assignedEntities);
    }
    return this.get(id);
  }

  /** Replace the workbook: re-parse the structure and swap the stored file. */
  async replaceFile(
    id: string,
    file: { originalname: string; buffer: Buffer },
  ): Promise<ForecastTemplate> {
    const record = this.repos.templates.getById(id);
    if (!record) throw notFound('Template');
    const parsed = await parseTemplateBuffer(file.buffer, record.layout);
    const fileKey = await this.files.put(`${id}.xlsx`, file.buffer);
    this.repos.templates.update(id, {
      fileKey,
      fileName: file.originalname,
      layout: parsed.layout,
      categories: parsed.categories,
      uploadedAt: new Date().toISOString(),
    });
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    const record = this.repos.templates.getById(id);
    if (!record) throw notFound('Template');
    if (record.fileKey) await this.files.delete(record.fileKey);
    this.repos.templates.remove(id);
  }

  async getFile(id: string): Promise<{ fileName: string; data: Buffer }> {
    const record = this.repos.templates.getById(id);
    if (!record) throw notFound('Template');
    if (!record.fileKey) throw notFound('Template file');
    return {
      fileName: record.fileName ?? `${record.name}.xlsx`,
      data: await this.files.get(record.fileKey),
    };
  }
}
