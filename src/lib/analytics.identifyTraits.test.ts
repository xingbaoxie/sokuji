import { describe, it, expect, vi } from 'vitest';

// analytics.ts pulls in shared/index, which mounts the whole app at module
// scope. Stub the one hook it actually needs so this stays a unit test of the
// trait builder rather than a boot of the application.
vi.mock('../../shared/index', () => ({ usePostHog: () => null }));

import { buildIdentifyTraits } from './analytics';

describe('buildIdentifyTraits', () => {
  it('attaches the address under both names PostHog reads', () => {
    expect(buildIdentifyTraits({ name: 'phalibai' }, 'reporter@example.com')).toEqual({
      name: 'phalibai',
      // What PostHog's own user lookup reads.
      $email: 'reporter@example.com',
      // What the person list displays and filters on. Without it a person
      // shows up under `name` and cannot be found by their address.
      email: 'reporter@example.com',
    });
  });

  it('leaves the traits alone when there is no address', () => {
    expect(buildIdentifyTraits({ name: 'phalibai' })).toEqual({ name: 'phalibai' });
  });

  it('does not let a trait of its own shadow the real address', () => {
    expect(buildIdentifyTraits({ email: 'stale@example.com' }, 'real@example.com')).toEqual({
      email: 'real@example.com',
      $email: 'real@example.com',
    });
  });
});
