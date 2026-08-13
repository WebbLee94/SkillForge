import { describe, it, expect } from 'vitest';
import { pushModalScope, popModalScope, hasOpenModal } from '../modalScope';

describe('modalScope', () => {
  it('starts with no open modal', () => {
    expect(hasOpenModal()).toBe(false);
  });

  it('tracks push/pop of modal scopes', () => {
    expect(hasOpenModal()).toBe(false);
    pushModalScope();
    expect(hasOpenModal()).toBe(true);
    pushModalScope();
    expect(hasOpenModal()).toBe(true);
    popModalScope();
    expect(hasOpenModal()).toBe(true);
    popModalScope();
    expect(hasOpenModal()).toBe(false);
  });

  it('pop never goes below zero', () => {
    popModalScope();
    popModalScope();
    expect(hasOpenModal()).toBe(false);
  });
});
