// SQLite implementations of the repository interfaces. Everything here is
// plain SQL over better-sqlite3; nothing above this layer knows it's SQLite.
import type { Db } from '../db/index.js';
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

class SqliteEntityRepository implements EntityRepository {
  constructor(private db: Db) {}
  list(): Entity[] {
    return this.db.prepare('SELECT * FROM entities ORDER BY rowid').all() as Entity[];
  }
  insert(e: Entity): void {
    this.db
      .prepare('INSERT INTO entities (name, submitter, approver, total, delta, status) VALUES (@name, @submitter, @approver, @total, @delta, @status)')
      .run(e);
  }
}

class SqliteUserRepository implements UserRepository {
  constructor(private db: Db) {}
  list(): User[] {
    return this.db.prepare('SELECT * FROM users').all() as User[];
  }
  getByEmail(email: string): User | null {
    return (this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as User) ?? null;
  }
  create(user: User): void {
    this.db
      .prepare('INSERT INTO users (email, name, team, role, scope, last) VALUES (@email, @name, @team, @role, @scope, @last)')
      .run(user);
  }
  update(email: string, patch: Partial<User>): User | null {
    const current = this.getByEmail(email);
    if (!current) return null;
    const next = { ...current, ...patch, email };
    this.db
      .prepare('UPDATE users SET name=@name, team=@team, role=@role, scope=@scope, last=@last WHERE email=@email')
      .run(next);
    return next;
  }
  remove(email: string): boolean {
    return this.db.prepare('DELETE FROM users WHERE email = ?').run(email).changes > 0;
  }
}

class SqliteCycleRepository implements CycleRepository {
  constructor(private db: Db) {}
  list(): Cycle[] {
    const rows = this.db.prepare('SELECT * FROM cycles ORDER BY sort ASC').all() as (Cycle & {
      sort: number;
    })[];
    return rows.map(({ sort: _sort, ...c }) => c);
  }
  getById(id: string): Cycle | null {
    const row = this.db.prepare('SELECT * FROM cycles WHERE id = ?').get(id) as
      | (Cycle & { sort: number })
      | undefined;
    if (!row) return null;
    const { sort: _sort, ...c } = row;
    return c;
  }
  create(cycle: Cycle): void {
    // New cycles go on top of the list (lowest sort first).
    const min = (this.db.prepare('SELECT MIN(sort) AS m FROM cycles').get() as { m: number | null }).m ?? 1;
    this.db
      .prepare('INSERT INTO cycles (id, start, closes, status, subs, total, sort) VALUES (@id, @start, @closes, @status, @subs, @total, @sort)')
      .run({ ...cycle, sort: min - 1 });
  }
  update(id: string, patch: Partial<Cycle>): Cycle | null {
    const current = this.getById(id);
    if (!current) return null;
    const next = { ...current, ...patch, id };
    this.db
      .prepare('UPDATE cycles SET start=@start, closes=@closes, status=@status, subs=@subs, total=@total WHERE id=@id')
      .run(next);
    return next;
  }
}

class SqliteSettingsRepository implements SettingsRepository {
  constructor(private db: Db) {}
  get(): Settings {
    const row = this.db.prepare('SELECT json FROM settings WHERE id = 1').get() as
      | { json: string }
      | undefined;
    if (!row) throw new Error('Settings not seeded');
    return JSON.parse(row.json) as Settings;
  }
  put(settings: Settings): void {
    this.db
      .prepare('INSERT INTO settings (id, json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json')
      .run(JSON.stringify(settings));
  }
}

interface TemplateRow {
  id: string;
  name: string;
  file_name: string | null;
  file_key: string | null;
  uploaded_at: string;
  uploaded_by: string;
  layout: string;
  categories: string;
}

function rowToTemplate(row: TemplateRow): TemplateRecord {
  return {
    id: row.id,
    name: row.name,
    fileName: row.file_name ?? undefined,
    fileKey: row.file_key ?? undefined,
    uploadedAt: row.uploaded_at,
    uploadedBy: row.uploaded_by,
    layout: row.layout as TemplateRecord['layout'],
    categories: JSON.parse(row.categories),
  };
}

class SqliteTemplateRepository implements TemplateRepository {
  constructor(private db: Db) {}
  list(): TemplateRecord[] {
    return (this.db.prepare('SELECT * FROM templates ORDER BY uploaded_at ASC').all() as TemplateRow[]).map(rowToTemplate);
  }
  getById(id: string): TemplateRecord | null {
    const row = this.db.prepare('SELECT * FROM templates WHERE id = ?').get(id) as TemplateRow | undefined;
    return row ? rowToTemplate(row) : null;
  }
  create(record: TemplateRecord): void {
    this.db
      .prepare(
        `INSERT INTO templates (id, name, file_name, file_key, uploaded_at, uploaded_by, layout, categories)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.name,
        record.fileName ?? null,
        record.fileKey ?? null,
        record.uploadedAt,
        record.uploadedBy,
        record.layout,
        JSON.stringify(record.categories),
      );
  }
  update(id: string, patch: Partial<TemplateRecord>): TemplateRecord | null {
    const current = this.getById(id);
    if (!current) return null;
    const next = { ...current, ...patch, id };
    this.db
      .prepare(
        `UPDATE templates SET name=?, file_name=?, file_key=?, uploaded_at=?, uploaded_by=?, layout=?, categories=? WHERE id=?`,
      )
      .run(
        next.name,
        next.fileName ?? null,
        next.fileKey ?? null,
        next.uploadedAt,
        next.uploadedBy,
        next.layout,
        JSON.stringify(next.categories),
        id,
      );
    return next;
  }
  remove(id: string): boolean {
    return this.db.prepare('DELETE FROM templates WHERE id = ?').run(id).changes > 0;
  }
  getAssignments(templateId: string): string[] {
    return (
      this.db.prepare('SELECT entity FROM template_assignments WHERE template_id = ?').all(templateId) as {
        entity: string;
      }[]
    ).map((r) => r.entity);
  }
  setAssignments(templateId: string, entities: string[]): void {
    const del = this.db.prepare('DELETE FROM template_assignments WHERE template_id = ?');
    const ins = this.db.prepare('INSERT INTO template_assignments (template_id, entity) VALUES (?, ?)');
    this.db.transaction(() => {
      del.run(templateId);
      for (const entity of entities) ins.run(templateId, entity);
    })();
  }
}

interface SubmissionRow {
  period: string;
  entity: string;
  template_id: string;
  status: string;
  values_json: string;
  flags_json: string;
  comments_json: string;
  day_comments_json: string;
  starting_balance: number;
  updated_at: string;
}

function rowToSubmission(row: SubmissionRow): Submission {
  return {
    period: row.period,
    entity: row.entity,
    templateId: row.template_id,
    status: row.status as Submission['status'],
    values: JSON.parse(row.values_json),
    flags: JSON.parse(row.flags_json),
    comments: JSON.parse(row.comments_json),
    dayComments: JSON.parse(row.day_comments_json),
    startingBalance: row.starting_balance,
    updatedAt: row.updated_at,
  };
}

class SqliteSubmissionRepository implements SubmissionRepository {
  constructor(private db: Db) {}
  list(filter?: { period?: string; entity?: string }): Submission[] {
    const where: string[] = [];
    const params: string[] = [];
    if (filter?.period) {
      where.push('period = ?');
      params.push(filter.period);
    }
    if (filter?.entity) {
      where.push('entity = ?');
      params.push(filter.entity);
    }
    const sql = `SELECT * FROM submissions${where.length ? ' WHERE ' + where.join(' AND ') : ''}`;
    return (this.db.prepare(sql).all(...params) as SubmissionRow[]).map(rowToSubmission);
  }
  get(period: string, entity: string, templateId: string): Submission | null {
    const row = this.db
      .prepare('SELECT * FROM submissions WHERE period = ? AND entity = ? AND template_id = ?')
      .get(period, entity, templateId) as SubmissionRow | undefined;
    return row ? rowToSubmission(row) : null;
  }
  upsert(s: Submission): void {
    this.db
      .prepare(
        `INSERT INTO submissions (period, entity, template_id, status, values_json, flags_json, comments_json, day_comments_json, starting_balance, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(period, entity, template_id) DO UPDATE SET
           status = excluded.status,
           values_json = excluded.values_json,
           flags_json = excluded.flags_json,
           comments_json = excluded.comments_json,
           day_comments_json = excluded.day_comments_json,
           starting_balance = excluded.starting_balance,
           updated_at = excluded.updated_at`,
      )
      .run(
        s.period,
        s.entity,
        s.templateId,
        s.status,
        JSON.stringify(s.values),
        JSON.stringify(s.flags),
        JSON.stringify(s.comments),
        JSON.stringify(s.dayComments),
        s.startingBalance,
        s.updatedAt,
      );
  }
}

class SqliteApprovalRepository implements ApprovalRepository {
  constructor(private db: Db) {}
  getForCycle(cycleId: string): ApprovalMap {
    const rows = this.db.prepare('SELECT entity, status FROM approvals WHERE cycle_id = ?').all(cycleId) as {
      entity: string;
      status: SubmissionStatus;
    }[];
    return Object.fromEntries(rows.map((r) => [r.entity, r.status]));
  }
  set(cycleId: string, entity: string, status: SubmissionStatus): void {
    this.db
      .prepare(
        `INSERT INTO approvals (cycle_id, entity, status) VALUES (?, ?, ?)
         ON CONFLICT(cycle_id, entity) DO UPDATE SET status = excluded.status`,
      )
      .run(cycleId, entity, status);
  }
}

class SqliteVarianceRepository implements VarianceRepository {
  constructor(private db: Db) {}
  list(): Variance[] {
    return (
      this.db.prepare('SELECT ent, cat, day, prior, current, comment FROM variances ORDER BY id').all() as Variance[]
    );
  }
  insert(v: Variance): void {
    this.db
      .prepare('INSERT INTO variances (ent, cat, day, prior, current, comment) VALUES (@ent, @cat, @day, @prior, @current, @comment)')
      .run(v);
  }
}

export function createSqliteRepositories(db: Db): Repositories {
  return {
    entities: new SqliteEntityRepository(db),
    users: new SqliteUserRepository(db),
    cycles: new SqliteCycleRepository(db),
    settings: new SqliteSettingsRepository(db),
    templates: new SqliteTemplateRepository(db),
    submissions: new SqliteSubmissionRepository(db),
    approvals: new SqliteApprovalRepository(db),
    variances: new SqliteVarianceRepository(db),
  };
}
