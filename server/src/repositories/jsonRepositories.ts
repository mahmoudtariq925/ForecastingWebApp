// ============================================================================
// Repository implementations over a StorageProvider. Each repository manages
// one JSON collection (or document) and knows nothing about the physical
// backend — the exact same code runs on local files, SQLite or Azure Blob.
// Persistence only: no business rules live here.
// ============================================================================
import type {
  ApprovalMap,
  Cycle,
  Entity,
  Settings,
  Submission,
  SubmissionStatus,
  User,
  Variance,
} from '../../../shared/types';
import type { StorageProvider } from '../storage/storageProvider.js';
import { JsonCollection, JsonDocument } from '../storage/jsonStore.js';
import type {
  ApprovalRepository,
  CycleRepository,
  EntityRepository,
  Repositories,
  SettingsRepository,
  SubmissionRepository,
  TemplateRecord,
  TemplateRepository,
  UserRepository,
  VarianceRepository,
} from './types.js';

class JsonEntityRepository implements EntityRepository {
  private col: JsonCollection<Entity>;
  constructor(p: StorageProvider) {
    this.col = new JsonCollection(p, 'entities', 'entities');
  }
  list(): Promise<Entity[]> {
    return this.col.all();
  }
  insert(entity: Entity): Promise<void> {
    return this.col.mutate((items) => ({ next: [...items, entity], result: undefined }));
  }
}

class JsonUserRepository implements UserRepository {
  private col: JsonCollection<User>;
  constructor(p: StorageProvider) {
    this.col = new JsonCollection(p, 'users', 'users');
  }
  list(): Promise<User[]> {
    return this.col.all();
  }
  async getByEmail(email: string): Promise<User | null> {
    return (await this.col.all()).find((u) => u.email === email) ?? null;
  }
  create(user: User): Promise<void> {
    return this.col.mutate((items) => ({ next: [...items, user], result: undefined }));
  }
  update(email: string, patch: Partial<User>): Promise<User | null> {
    return this.col.mutate((items) => {
      const idx = items.findIndex((u) => u.email === email);
      if (idx === -1) return { next: items, result: null };
      const updated: User = { ...items[idx], ...patch, email };
      const next = [...items];
      next[idx] = updated;
      return { next, result: updated };
    });
  }
  remove(email: string): Promise<boolean> {
    return this.col.mutate((items) => {
      const next = items.filter((u) => u.email !== email);
      return { next, result: next.length !== items.length };
    });
  }
}

class JsonCycleRepository implements CycleRepository {
  private col: JsonCollection<Cycle>;
  constructor(p: StorageProvider) {
    this.col = new JsonCollection(p, 'cycles', 'cycles');
  }
  list(): Promise<Cycle[]> {
    return this.col.all();
  }
  async getById(id: string): Promise<Cycle | null> {
    return (await this.col.all()).find((c) => c.id === id) ?? null;
  }
  create(cycle: Cycle): Promise<void> {
    // Newest cycle on top of the list.
    return this.col.mutate((items) => ({ next: [cycle, ...items], result: undefined }));
  }
  update(id: string, patch: Partial<Cycle>): Promise<Cycle | null> {
    return this.col.mutate((items) => {
      const idx = items.findIndex((c) => c.id === id);
      if (idx === -1) return { next: items, result: null };
      const updated: Cycle = { ...items[idx], ...patch, id };
      const next = [...items];
      next[idx] = updated;
      return { next, result: updated };
    });
  }
}

class JsonSettingsRepository implements SettingsRepository {
  private doc: JsonDocument<Settings | null>;
  constructor(p: StorageProvider) {
    this.doc = new JsonDocument<Settings | null>(p, 'settings', 'settings', null);
  }
  get(): Promise<Settings | null> {
    return this.doc.get();
  }
  put(settings: Settings): Promise<void> {
    return this.doc.set(settings);
  }
}

/** Stored template shape: the record plus its entity assignments. */
type StoredTemplate = TemplateRecord & { assignedEntities: string[] };

function toRecord(t: StoredTemplate): TemplateRecord {
  const { assignedEntities: _assignedEntities, ...record } = t;
  return record;
}

class JsonTemplateRepository implements TemplateRepository {
  private col: JsonCollection<StoredTemplate>;
  constructor(p: StorageProvider) {
    this.col = new JsonCollection(p, 'templates', 'templates');
  }
  async list(): Promise<TemplateRecord[]> {
    return (await this.col.all()).map(toRecord);
  }
  async getById(id: string): Promise<TemplateRecord | null> {
    const found = (await this.col.all()).find((t) => t.id === id);
    return found ? toRecord(found) : null;
  }
  create(record: TemplateRecord): Promise<void> {
    return this.col.mutate((items) => ({
      next: [...items, { ...record, assignedEntities: [] }],
      result: undefined,
    }));
  }
  update(id: string, patch: Partial<TemplateRecord>): Promise<TemplateRecord | null> {
    return this.col.mutate((items) => {
      const idx = items.findIndex((t) => t.id === id);
      if (idx === -1) return { next: items, result: null };
      const updated: StoredTemplate = { ...items[idx], ...patch, id };
      const next = [...items];
      next[idx] = updated;
      return { next, result: toRecord(updated) };
    });
  }
  remove(id: string): Promise<boolean> {
    return this.col.mutate((items) => {
      const next = items.filter((t) => t.id !== id);
      return { next, result: next.length !== items.length };
    });
  }
  async getAssignments(templateId: string): Promise<string[]> {
    return (await this.col.all()).find((t) => t.id === templateId)?.assignedEntities ?? [];
  }
  setAssignments(templateId: string, entities: string[]): Promise<void> {
    return this.col.mutate((items) => {
      const idx = items.findIndex((t) => t.id === templateId);
      if (idx === -1) return { next: items, result: undefined };
      const next = [...items];
      next[idx] = { ...items[idx], assignedEntities: [...entities] };
      return { next, result: undefined };
    });
  }
}

const submissionKey = (s: Pick<Submission, 'period' | 'entity' | 'templateId'>) =>
  `${s.period}::${s.entity}::${s.templateId}`;

class JsonSubmissionRepository implements SubmissionRepository {
  private col: JsonCollection<Submission>;
  constructor(p: StorageProvider) {
    this.col = new JsonCollection(p, 'submissions', 'submissions');
  }
  async list(filter?: { period?: string; entity?: string }): Promise<Submission[]> {
    let items = await this.col.all();
    if (filter?.period) items = items.filter((s) => s.period === filter.period);
    if (filter?.entity) items = items.filter((s) => s.entity === filter.entity);
    return items;
  }
  async get(period: string, entity: string, templateId: string): Promise<Submission | null> {
    const target = submissionKey({ period, entity, templateId });
    return (await this.col.all()).find((s) => submissionKey(s) === target) ?? null;
  }
  upsert(submission: Submission): Promise<void> {
    const target = submissionKey(submission);
    return this.col.mutate((items) => {
      const idx = items.findIndex((s) => submissionKey(s) === target);
      const next = [...items];
      if (idx === -1) next.push(submission);
      else next[idx] = submission;
      return { next, result: undefined };
    });
  }
}

class JsonApprovalRepository implements ApprovalRepository {
  private doc: JsonDocument<Record<string, ApprovalMap>>;
  constructor(p: StorageProvider) {
    this.doc = new JsonDocument<Record<string, ApprovalMap>>(p, 'approvals', 'approvals', {});
  }
  async getForCycle(cycleId: string): Promise<ApprovalMap> {
    return (await this.doc.get())[cycleId] ?? {};
  }
  set(cycleId: string, entity: string, status: SubmissionStatus): Promise<void> {
    return this.doc.mutate((current) => {
      const next = { ...current, [cycleId]: { ...(current[cycleId] ?? {}), [entity]: status } };
      return { next, result: undefined };
    });
  }
}

class JsonVarianceRepository implements VarianceRepository {
  private col: JsonCollection<Variance>;
  constructor(p: StorageProvider) {
    this.col = new JsonCollection(p, 'variances', 'variances');
  }
  list(): Promise<Variance[]> {
    return this.col.all();
  }
  insert(variance: Variance): Promise<void> {
    return this.col.mutate((items) => ({ next: [...items, variance], result: undefined }));
  }
}

export function createJsonRepositories(provider: StorageProvider): Repositories {
  return {
    entities: new JsonEntityRepository(provider),
    users: new JsonUserRepository(provider),
    cycles: new JsonCycleRepository(provider),
    settings: new JsonSettingsRepository(provider),
    templates: new JsonTemplateRepository(provider),
    submissions: new JsonSubmissionRepository(provider),
    approvals: new JsonApprovalRepository(provider),
    variances: new JsonVarianceRepository(provider),
  };
}
