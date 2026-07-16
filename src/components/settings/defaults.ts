import type { Settings } from '../../types';

/** Default variance / cycle rules used until the user changes them. */
export const DEFAULT_SETTINGS: Settings = {
  horizon: '30 days',
  frequency: 'Weekly (Mon → Fri close)',
  varianceThreshold: 15,
  minValueToTrigger: '50,000',
  exemptNewPeriods: "Yes — never flag days outside prior cycle's horizon",
  ssoProvider: 'Azure Active Directory · Tenant: contoso.onmicrosoft.com',
  allowedDomains: '@contoso.com',
};
