import { Router } from 'express';
import multer from 'multer';
import type { TemplatesService } from '../services/templatesService.js';
import { badRequest } from '../services/errors.js';
import { asyncHandler } from './helpers.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function templatesController(service: TemplatesService, maxUploadBytes: number): Router {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxUploadBytes },
  });

  router.get('/', (_req, res) => res.json(service.list()));
  router.get('/:id', (req, res) => res.json(service.get(req.params.id)));

  router.post(
    '/',
    upload.single('file'),
    asyncHandler(async (req, res) => {
      if (!req.file) throw badRequest('An .xlsx file is required (multipart field "file")');
      const layout = (req.body.layout as string) || 'auto';
      if (!['auto', 'grouped', 'days-across'].includes(layout)) {
        throw badRequest(`Unknown layout: ${layout}`);
      }
      const uploadedBy = (req.body.uploadedBy as string) || 'Unknown';
      const template = await service.upload(
        req.file,
        layout as 'auto' | 'grouped' | 'days-across',
        uploadedBy,
      );
      res.status(201).json(template);
    }),
  );

  router.patch('/:id', (req, res) => {
    res.json(service.update(req.params.id, req.body));
  });

  router.put(
    '/:id/file',
    upload.single('file'),
    asyncHandler(async (req, res) => {
      if (!req.file) throw badRequest('An .xlsx file is required (multipart field "file")');
      res.json(await service.replaceFile(req.params.id, req.file));
    }),
  );

  router.get(
    '/:id/file',
    asyncHandler(async (req, res) => {
      const { fileName, data } = await service.getFile(req.params.id);
      res.setHeader('Content-Type', XLSX_MIME);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
      res.send(data);
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      await service.remove(req.params.id);
      res.status(204).end();
    }),
  );

  return router;
}
