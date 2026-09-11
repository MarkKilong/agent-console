import { describe, expect, it } from 'vitest';
import { gitEnv } from '../../packages/runner/src/git/env.js';

describe('gitEnv', () => {
  it('only turns the prompt off when nothing is signed in', () => {
    expect(gitEnv(undefined)).toEqual({ GIT_TERMINAL_PROMPT: '0' });
  });

  it('points github.com at the token, resetting the machine helper first', () => {
    expect(gitEnv('gho_test')).toEqual({
      GITHUB_TOKEN: 'gho_test',
      GIT_TERMINAL_PROMPT: '0',
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'credential.https://github.com.helper',
      GIT_CONFIG_VALUE_0: '',
      GIT_CONFIG_KEY_1: 'credential.https://github.com.helper',
      GIT_CONFIG_VALUE_1: '!f() { echo username=x-access-token; echo password=$GITHUB_TOKEN; }; f',
    });
  });
});
