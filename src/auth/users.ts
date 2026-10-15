// ---------------------------------------------------------------------------
// DEMO sign-in accounts — one per role. They exist only so the app can be shown without a backend.
// When Supabase Auth is connected, sign-in goes to Supabase and the role comes from profiles.role (see supabase/PLAN.md §10);
// this file and the demo-credentials card on the login page are then deleted.
// ---------------------------------------------------------------------------
import type { Role } from './access';

export interface DemoUser {
  role: Role;
  email: string;
  password: string;
  name: string;
  /** short label for the login tabs */
  tab: string;
}

export const DEMO_USERS: DemoUser[] = [
  { role: 'director', email: 'director@forgeflow.local', password: 'Dir@12345', name: 'Director', tab: 'Director' },
  { role: 'plant_head', email: 'planthead@forgeflow.local', password: 'Plant@12345', name: 'Plant Head', tab: 'Plant Head' },
  { role: 'accounts', email: 'accounts@forgeflow.local', password: 'Acc@12345', name: 'Accounts Team', tab: 'Accounts' },
  { role: 'qc', email: 'qc@forgeflow.local', password: 'Qc@12345', name: 'QC Inspector', tab: 'QC' },
  { role: 'operator', email: 'operator@forgeflow.local', password: 'Op@12345', name: 'Production / Store', tab: 'Operator' },
  { role: 'viewer', email: 'viewer@forgeflow.local', password: 'View@12345', name: 'Viewer', tab: 'Viewer' },
];

export const findDemoUser = (email: string, password: string) =>
  DEMO_USERS.find((u) => u.email.toLowerCase() === email.trim().toLowerCase() && u.password === password);

export const demoUserByEmail = (email: string) => DEMO_USERS.find((u) => u.email.toLowerCase() === email.toLowerCase());
