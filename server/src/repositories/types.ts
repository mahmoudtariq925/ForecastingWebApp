// ============================================================================
// Repository interfaces — the persistence contract used by services. Every
// method is async so the same interfaces work over any StorageProvider
// (local files, SQLite, Azure Blob Storage). Implementations live in
// ./jsonRepositories.ts and depend only on a StorageProvider — no SQL, no
// filesystem, no vendor concepts leak up to the services.
//
// Migrating to Azure requires NO changes to these interfaces.
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

export interface EntityRepository {
  list(): Promise<Entity[]>;
  /** Used by the seed only — entities are reference data with no write API. */
  insert(entity: Entity): Promise<void>;
}

export interface UserRepository {
  list(): Promise<User[]>;
  getByEmail(email: string): Promise<User | null>;
  create(user: User): Promise<void>;
  update(email: string, patch: Partial<User>): Promise<User | null>;
  remove(email: string): Promise<boolean>;
}

export interface CycleRepository {
  list(): Promise<Cycle[]>;
  getById(id: string): Promise<Cycle | null>;
  create(cycle: Cycle): Promise<void>;
  update(id: string, patch: Partial<Cycle>): Promise<Cycle | null>;
}

export interface SettingsRepository {
  get(): Promise<Settings | null>;
  put(settings: Settings): Promise<void>;
}

/** Template persistence record; entity assignments are managed alongside it. */
export interface TemplateRecord {
  id: string;
  name: string;
  fileName?: string;
  uploadedAt: string;
  uploadedBy: string;
  layout: 'grouped' | 'days-across';
  categories: { label: string; group?: string }[];
  /** Storage key of the uploaded workbook in FileStorage, if any. */
  fileKey?: string;
}

export interface TemplateRepository {
  list(): Promise<TemplateRecord[]>;
  getById(id: string): Promise<TemplateRecord | null>;
  create(record: TemplateRecord): Promise<void>;
  update(id: string, patch: Partial<TemplateRecord>): Promise<TemplateRecord | null>;
  remove(id: string): Promise<boolean>;
  getAssignments(templateId: string): Promise<string[]>;
  setAssignments(templateId: string, entities: string[]): Promise<void>;
}

export interface SubmissionRepository {
  list(filter?: { period?: string; entity?: string }): Promise<Submission[]>;
  get(period: string, entity: string, templateId: string): Promise<Submission | null>;
  upsert(submission: Submission): Promise<void>;
}

export interface ApprovalRepository {
  getForCycle(cycleId: string): Promise<ApprovalMap>;
  set(cycleId: string, entity: string, status: SubmissionStatus): Promise<void>;
}

export interface VarianceRepository {
  list(): Promise<Variance[]>;
  /** Used by the seed only — variances are reference data with no write API. */
  insert(variance: Variance): Promise<void>;
}

export interface Repositories {
  entities: EntityRepository;
  users: UserRepository;
  cycles: CycleRepository;
  settings: SettingsRepository;
  templates: TemplateRepository;
  submissions: SubmissionRepository;
  approvals: ApprovalRepository;
  variances: VarianceRepository;
}
