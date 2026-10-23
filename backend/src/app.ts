import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from './lib/db';
import { bus } from './lib/events';
import { HttpError } from './lib/errors';
import { createRfq, getRfqDetails, listRfqs, placeBid } from './service';
import { bidSchema, rfqSchema } from './schemas';

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
  fn(req, res).catch(next);

export function createApp() {
  const app = express();
  // CORS_ORIGIN: comma-separated allowed origins (e.g. the Vercel URL). Unset = allow all.
  const origins = (process.env.CORS_ORIGIN ?? '').split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean);
  app.use(cors(origins.length ? { origin: origins } : undefined));
  app.use(express.json());

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date() }));
  app.get('/api/suppliers', wrap(async (_req, res) => res.json(await prisma.supplier.findMany({ orderBy: { name: 'asc' } }))));
  app.get('/api/rfqs', wrap(async (_req, res) => res.json(await listRfqs())));
  app.post('/api/rfqs', wrap(async (req, res) => res.status(201).json(await createRfq(rfqSchema.parse(req.body)))));
  app.get('/api/rfqs/:id', wrap(async (req, res) => res.json(await getRfqDetails(req.params.id))));
  app.post('/api/rfqs/:id/bids', wrap(async (req, res) => res.status(201).json(await placeBid(req.params.id, bidSchema.parse(req.body)))));

  // Server-Sent Events: emits {rfqId} whenever any RFQ changes; clients refetch.
  app.get('/api/events', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    const onUpdate = (rfqId: string) => res.write(`data: ${JSON.stringify({ rfqId })}\n\n`);
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    bus.on('rfq', onUpdate);
    req.on('close', () => {
      clearInterval(ping);
      bus.off('rfq', onUpdate);
    });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'Validation failed', details: err.issues });
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details });
    if ((err as { type?: string })?.type === 'entity.parse.failed' || err instanceof SyntaxError)
      return res.status(400).json({ error: 'Malformed JSON body' });
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') return res.status(409).json({ error: `Duplicate value for ${String(err.meta?.target ?? 'unique field')}` });
      if (err.code === 'P2003') return res.status(400).json({ error: 'Referenced record does not exist' });
      if (err.code === 'P2025') return res.status(404).json({ error: 'Record not found' });
    }
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}
