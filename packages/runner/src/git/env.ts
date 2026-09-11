/** Reads the token out of the same environment, so it never lands in a config file. */
const CREDENTIAL_HELPER = '!f() { echo username=x-access-token; echo password=$GITHUB_TOKEN; }; f';

const HELPER_KEY = 'credential.https://github.com.helper';

/**
 * What every agent subprocess and every terminal gets, so git and `gh` inherit the
 * stored sign-in. With no token the prompt is still turned off: a missing credential
 * should fail in a second rather than hang a turn on a dialog nobody can see.
 */
export function gitEnv(token: string | undefined): Record<string, string> {
  if (!token) return { GIT_TERMINAL_PROMPT: '0' };
  return {
    GITHUB_TOKEN: token,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '2',
    // The empty first entry resets whatever helper the machine configured for
    // github.com, so a credential manager cannot answer before ours does.
    GIT_CONFIG_KEY_0: HELPER_KEY,
    GIT_CONFIG_VALUE_0: '',
    GIT_CONFIG_KEY_1: HELPER_KEY,
    GIT_CONFIG_VALUE_1: CREDENTIAL_HELPER,
  };
}
