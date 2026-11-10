/**
 * The dashboards the Charts tab lists, in the order it lists them (#567). To add
 * one, write a module that exports a `Dashboard` (dashboard.ts) and add it here:
 * nothing else changes, because the list, the cards, the routes and the palette
 * all read this array. The list of lists, kept short on purpose.
 */

import type { Dashboard } from './dashboard.ts';
import { explore } from './explore.tsx';
import { flow } from './flow.tsx';
import { mix } from './mix.tsx';
import { releases } from './releases.tsx';
import { sprints } from './sprints.tsx';
import { where } from './where.tsx';

export const DASHBOARDS: readonly Dashboard[] = [mix, releases, sprints, where, flow, explore];

export const dashboardNamed = (id: string): Dashboard | undefined => DASHBOARDS.find((d) => d.id === id);
