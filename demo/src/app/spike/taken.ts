/** Usernames reported as taken. Mirrored in server/username-api.mjs. */
export const TAKEN = ['admin', 'angular', 'giorgio'];

/** Username whose check fails (simulates an outage → onError → 'unreachable'). Mirrored in the server. */
export const FAILING = 'offline';

export interface Availability {
  available: boolean;
}
