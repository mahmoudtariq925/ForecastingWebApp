// Thin services over the repositories for the simpler resources. Business
// rules (duplicate checks, key/status validation) live here so handlers stay
// pure request/response shaping and repositories stay pure persistence.
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
import type { Repositories } from '../repositories/index.js';
import { badRequest, conflict, notFound } from './errors.js';

export class EntitiesService {
  constructor(private repos: Repositories) {}
  list(): Promise<Entity[]> {
    return this.repos.entities.list();
  }
}

export class UsersService {
  constructor(private repos: Repositories) {}
  list(): Promise<User[]> {
    return this.repos.users.list();
  }
  async create(user: User): Promise<User> {
    if (!user.name?.trim() || !user.email?.trim()) throw badRequest('Name and email are required');
    const email = user.email.trim().toLowerCase();
    if (await this.repos.users.getByEmail(email)) {
      throw conflict('A user with this email already exists');
    }
    const created: User = { ...user, email, name: user.name.trim() };
    await this.repos.users.create(created);
    return created;
  }
  async update(email: string, patch: Partial<User>): Promise<User> {
    const updated = await this.repos.users.update(email, patch);
    if (!updated) throw notFound('User');
    return updated;
  }
  async remove(email: string): Promise<void> {
    if (!(await this.repos.users.remove(email))) throw notFound('User');
  }
}

export class CyclesService {
  constructor(private repos: Repositories) {}
  list(): Promise<Cycle[]> {
    return this.repos.cycles.list();
  }
  async create(cycle: Cycle): Promise<Cycle> {
    if (!cycle.id?.trim()) throw badRequest('Cycle ID is required');
    if (await this.repos.cycles.getById(cycle.id)) {
      throw conflict(`Cycle ${cycle.id} already exists`);
    }
    await this.repos.cycles.create(cycle);
    return cycle;
  }
  async update(id: string, patch: Partial<Cycle>): Promise<Cycle> {
    const updated = await this.repos.cycles.update(id, patch);
    if (!updated) throw notFound('Cycle');
    return updated;
  }
}

export class SettingsService {
  constructor(private repos: Repositories) {}
  async get(): Promise<Settings> {
    const settings = await this.repos.settings.get();
    if (!settings) throw notFound('Settings');
    return settings;
  }
  async put(settings: Settings): Promise<Settings> {
    await this.repos.settings.put(settings);
    return settings;
  }
}

export class SubmissionsService {
  constructor(private repos: Repositories) {}
  list(filter?: { period?: string; entity?: string }): Promise<Submission[]> {
    return this.repos.submissions.list(filter);
  }
  async get(period: string, entity: string, templateId: string): Promise<Submission> {
    const sub = await this.repos.submissions.get(period, entity, templateId);
    if (!sub) throw notFound('Submission');
    return sub;
  }
  async upsert(submission: Submission): Promise<Submission> {
    if (!submission.period || !submission.entity || !submission.templateId) {
      throw badRequest('period, entity and templateId are required');
    }
    const stored: Submission = { ...submission, updatedAt: new Date().toISOString() };
    await this.repos.submissions.upsert(stored);
    return stored;
  }
}

export class ApprovalsService {
  constructor(private repos: Repositories) {}
  getForCycle(cycleId: string): Promise<ApprovalMap> {
    return this.repos.approvals.getForCycle(cycleId);
  }
  async decide(cycleId: string, entity: string, status: SubmissionStatus): Promise<ApprovalMap> {
    if (!['approved', 'rejected', 'pending', 'submitted'].includes(status)) {
      throw badRequest(`Invalid approval status: ${status}`);
    }
    await this.repos.approvals.set(cycleId, entity, status);
    return this.repos.approvals.getForCycle(cycleId);
  }
}

export class VariancesService {
  constructor(private repos: Repositories) {}
  list(): Promise<Variance[]> {
    return this.repos.variances.list();
  }
}
