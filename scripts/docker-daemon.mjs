import assert from 'node:assert/strict';

export async function localDockerEnvironment(source,inspect) {
  const endpoint=source.DOCKER_CONTEXT
    ? await inspect(source.DOCKER_CONTEXT)
    : source.DOCKER_HOST || await inspect();
  assert.match(endpoint,/^(unix:\/\/|npipe:\/\/)/,'Docker tests require a local daemon, not a remote Docker endpoint');
  const {DOCKER_CONTEXT,...environment}=source;
  return {...environment,DOCKER_HOST:endpoint};
}
