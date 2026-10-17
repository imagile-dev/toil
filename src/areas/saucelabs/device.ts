import { z } from 'zod';
import { saucelabsArea } from './area.js';
import { countOf, id, parseChoice, RDA, sauce } from './client.js';

/**
 * The real-device catalog and its live availability. Enum filters are taken
 * in any case and sent in Sauce's upper case, because the API reads the form
 * exactly as filled in.
 */

const DEVICE_OS = ['ANDROID', 'IOS'] as const;
const DEVICE_TYPES = ['PHONE', 'TABLET'] as const;
const DEVICE_STATES = ['AVAILABLE', 'IN_USE', 'CLEANING', 'MAINTENANCE', 'REBOOTING', 'OFFLINE'] as const;

export const deviceListCommand = saucelabsArea.command({
  path: ['saucelabs', 'device', 'list'],
  description: 'List real devices your account can use',
  input: z.object({
    name: z.string().optional().describe('Device name (regex), for example "iPhone.*" or "Samsung Galaxy S2[34].*"'),
    os: z.string().optional().describe('Operating system: android or ios'),
    osVersion: z.string().optional().describe('OS major version or regex, for example 17 or "1[78]"'),
    type: z.string().optional().describe('Device type: phone or tablet'),
  }),
  writes: false,
  options: [
    { flags: '--name <regex>', field: 'name', description: 'Device name (regex), for example "iPhone.*" or "Samsung Galaxy S2[34].*"' },
    { flags: '--os <os>', field: 'os', description: 'Operating system: android or ios' },
    { flags: '--os-version <version>', field: 'osVersion', description: 'OS major version or regex, for example 17 or "1[78]"' },
    { flags: '--type <type>', field: 'type', description: 'Device type: phone or tablet' },
  ],
  examples: [{}, { name: 'iPhone.*', os: 'ios', osVersion: '17', type: 'phone' }],
  run: async (input, ctx) => {
    const data = await sauce<unknown>(ctx, `${RDA}/devices`, {
      query: {
        deviceName: input.name,
        os: parseChoice(input.os, DEVICE_OS, '--os'),
        osVersion: input.osVersion,
        deviceType: parseChoice(input.type, DEVICE_TYPES, '--type'),
      },
    });
    return { count: countOf(data), devices: data };
  },
});

export const deviceGetCommand = saucelabsArea.command({
  path: ['saucelabs', 'device', 'get'],
  description: "Get one device's full descriptor (hardware, OS, screen)",
  input: z.object({ deviceId: z.string().describe('Device ID, for example iPhone_15_real') }),
  writes: false,
  args: [{ name: 'device-id', field: 'deviceId', description: 'Device ID, for example iPhone_15_real', required: true }],
  examples: [{ deviceId: 'iPhone_15_real' }],
  run: async (input, ctx) => sauce(ctx, `/v1/rdc/devices/${id(input.deviceId)}`),
});

export const deviceStatusCommand = saucelabsArea.command({
  path: ['saucelabs', 'device', 'status'],
  description: 'Live availability of real devices (AVAILABLE, IN_USE, CLEANING, ...)',
  input: z.object({
    state: z.string().optional().describe('Only devices in this state: available, in_use, cleaning, maintenance, rebooting, offline'),
    name: z.string().optional().describe('Device name (regex)'),
    privateOnly: z.boolean().optional().describe("Only your organization's private devices"),
  }),
  writes: false,
  options: [
    { flags: '--state <state>', field: 'state', description: 'Only devices in this state: available, in_use, cleaning, maintenance, rebooting, offline' },
    { flags: '--name <regex>', field: 'name', description: 'Device name (regex)' },
    { flags: '--private-only', field: 'privateOnly', description: "Only your organization's private devices" },
  ],
  examples: [{}, { state: 'available', name: 'iPhone.*', privateOnly: true }],
  run: async (input, ctx) => {
    const data = await sauce<{ devices?: unknown[] } | undefined>(ctx, `${RDA}/devices/status`, {
      query: {
        state: parseChoice(input.state, DEVICE_STATES, '--state'),
        deviceName: input.name,
        privateOnly: input.privateOnly ? true : undefined,
      },
    });
    return { count: countOf(data, 'devices'), devices: data?.devices ?? [] };
  },
});

export const deviceCommands = [deviceListCommand, deviceGetCommand, deviceStatusCommand];
