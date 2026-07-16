// Domain types are shared with the API server — see shared/types.ts for the
// single source of truth. This module re-exports them so client code keeps
// importing from '../types'.
export type {
  ApprovalMap,
  Cycle,
  Entity,
  ForecastTemplate,
  LineItemConfig,
  Role,
  Settings,
  Submission,
  SubmissionStatus,
  TemplateCategory,
  TemplateLayout,
  User,
  Variance,
} from '../../shared/types';
