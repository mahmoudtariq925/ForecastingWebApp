// ============================================================================
// Repository interfaces — the persistence swap point. The SQLite
// implementations live in ./sqlite.ts; moving to Azure SQL means writing a
// new set of implementations of these interfaces and changing only the
// factory in ./index.ts. Services and controllers depend on these interfaces,
// never on a concrete database.
// ============================================================================
import type {
  ApprovalMap,
  Cycle,
  Entity,
  ForecastTemplate,
  Settings,
  Submission,
  SubmissionStatus,
  User,
  Variance,
} from '../../../shared/types';

export interface EntityRepository {
  list(): Entity[];
  /** Used by the seed only — entities are reference data with no write API. */
  insert(entity: Entity): void;
}

export interface UserRepository {
  list(): User[];
  getByEmail(email: string): User | null;
  create(user: User): void;
  update(email: string, patch: Partial<User>): User | null;
  remove(email: string): boolean;
}

export interface CycleRepository {
  list(): Cycle[];
  getById(id: string): Cycle | null;
  create(cycle: Cycle): void;
  update(id: string, patch: Partial<Cycle>): Cycle | null;
}

export interface SettingsRepository {
  get(): Settings;
  put(settings: Settings): void;
}

/** Template records; entity assignments live in their own table. */
export interface TemplateRecord extends Omit<ForecastTemplate, 'assignedEntities' | 'hasFile'> {
  /** Storage key of the uploaded workbook in FileStorage, if any. */
  fileKey?: string;
}

export interface TemplateRepository {
  list(): TemplateRecord[];
  getById(id: string): TemplateRecord | null;
  create(record: TemplateRecord): void;
  update(id: string, patch: Partial<TemplateRecord>): TemplateRecord | null;
  remove(id: string): boolean;
  getAssignments(templateId: string): string[];
  setAssignments(templateId: string, entities: string[]): void;
}

export interface SubmissionRepository {
  list(filter?: { period?: string; entity?: string }): Submission[];
  get(period: string, entity: string, templateId: string): Submission | null;
  upsert(submission: Submission): void;
}

export interface ApprovalRepository {
  getForCycle(cycleId: string): ApprovalMap;
  set(cycleId: string, entity: string, status: SubmissionStatus): void;
}

export interface VarianceRepository {
  list(): Variance[];
  /** Used by the seed only — variances are reference data with no write API. */
  insert(variance: Variance): void;
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
