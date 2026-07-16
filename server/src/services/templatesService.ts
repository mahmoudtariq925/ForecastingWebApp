import { randomUUID } from 'node:crypto';
import type { ForecastTemplate, TemplateLayout } from '../../../shared/types';
import { parseTemplateBuffer } from '../../../shared/excelTemplate';
import type { Repositories, TemplateRecord } from '../repositories/index.js';
import type { FileStorage } from '../storage/fileStorage.js';
import { badRequest, notFound } from './errors.js';

/**
 * Template management: uploads store the physical .xlsx via FileStorage and a
 * persistence record referencing it; the structure is parsed server-side from
 * the workbook (authoritative — the client never sends parsed structure).
 * Persistence and file storage are both abstracted, so this service is
 * unaffected by the storage backend.
 */
export class TemplatesService {
  constructor(
    private repos: Repositories,
    private files: FileStorage,
  ) {}

  private async toDto(record: TemplateRecord): Promise<ForecastTemplate> {
    const { fileKey, ...rest } = record;
    return {
      ...rest,
      assignedEntities: await this.repos.templates.getAssignments(record.id),
      hasFile: Boolean(fileKey),
    };
  }

  async list(): Promise<ForecastTemplate[]> {
    const records = await this.repos.templates.list();
    return Promise.all(records.map((t) => this.toDto(t)));
  }

  async get(id: string): Promise<ForecastTemplate> {
    const record = await this.repos.templates.getById(id);
    if (!record) throw notFound('Template');
    return this.toDto(record);
  }

  async upload(
    file: { originalName: string; buffer: Buffer },
    layout: TemplateLayout | 'auto',
    uploadedBy: string,
  ): Promise<ForecastTemplate> {
    if (!['auto', 'grouped', 'days-across'].includes(layout)) {
      throw badRequest(`Unknown layout: ${layout}`);
    }
    const parsed = await parseTemplateBuffer(file.buffer, layout);
    const id = `tpl-${randomUUID()}`;
    const fileKey = await this.files.put(`${id}.xlsx`, file.buffer);
    await this.repos.templates.create({
      id,
      name: file.originalName.replace(/\.xlsx$/i, ''),
      fileName: file.originalName,
      fileKey,
      uploadedAt: new Date().toISOString(),
      uploadedBy,
      layout: parsed.layout,
      categories: parsed.categories,
    });
    await this.repos.templates.setAssignments(id, []);
    return this.get(id);
  }

  async update(
    id: string,
    patch: { name?: string; layout?: TemplateLayout; assignedEntities?: string[] },
  ): Promise<ForecastTemplate> {
    const record = await this.repos.templates.getById(id);
    if (!record) throw notFound('Template');
    if (patch.layout && patch.layout !== 'grouped' && patch.layout !== 'days-across') {
      throw badRequest(`Unknown layout: ${patch.layout}`);
    }
    await this.repos.templates.update(id, {
      name: patch.name?.trim() || record.name,
      layout: patch.layout ?? record.layout,
    });
    if (patch.assignedEntities) {
      await this.repos.templates.setAssignments(id, patch.assignedEntities);
    }
    return this.get(id);
  }

  /** Replace the workbook: re-parse the structure and swap the stored file. */
  async replaceFile(
    id: string,
    file: { originalName: string; buffer: Buffer },
  ): Promise<ForecastTemplate> {
    const record = await this.repos.templates.getById(id);
    if (!record) throw notFound('Template');
    const parsed = await parseTemplateBuffer(file.buffer, record.layout);
    const fileKey = await this.files.put(`${id}.xlsx`, file.buffer);
    await this.repos.templates.update(id, {
      fileKey,
      fileName: file.originalName,
      layout: parsed.layout,
      categories: parsed.categories,
      uploadedAt: new Date().toISOString(),
    });
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    const record = await this.repos.templates.getById(id);
    if (!record) throw notFound('Template');
    if (record.fileKey) await this.files.delete(record.fileKey);
    await this.repos.templates.remove(id);
  }

  async getFile(id: string): Promise<{ fileName: string; data: Buffer }> {
    const record = await this.repos.templates.getById(id);
    if (!record) throw notFound('Template');
    if (!record.fileKey) throw notFound('Template file');
    return {
      fileName: record.fileName ?? `${record.name}.xlsx`,
      data: await this.files.get(record.fileKey),
    };
  }
}
