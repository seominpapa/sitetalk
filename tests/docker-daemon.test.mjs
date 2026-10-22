import test from 'node:test';
import assert from 'node:assert/strict';
import {localDockerEnvironment} from '../scripts/docker-daemon.mjs';

test('Docker context overrides host and remote contexts cannot run isolated local tests', async()=>{
  await assert.rejects(localDockerEnvironment({DOCKER_CONTEXT:'remote',DOCKER_HOST:'unix:///local'},async context=>{
    assert.equal(context,'remote');return 'ssh://remote-server';
  }),/local daemon/);
});
test('Docker commands pin the verified local endpoint and remove context overrides',async()=>{
  const source={DOCKER_CONTEXT:'desktop',DOCKER_HOST:'ssh://ignored',PATH:'bin'};
  const result=await localDockerEnvironment(source,async context=>{
    assert.equal(context,'desktop');return 'unix:///desktop.sock';
  });
  assert.deepEqual(result,{DOCKER_HOST:'unix:///desktop.sock',PATH:'bin'});
  assert.equal(source.DOCKER_CONTEXT,'desktop');
});
test('explicit local host takes priority over the default context; otherwise resolve default',async()=>{
  assert.equal((await localDockerEnvironment({DOCKER_HOST:'unix:///local'},()=>{throw new Error('unexpected context');})).DOCKER_HOST,'unix:///local');
  assert.equal((await localDockerEnvironment({},async context=>{
    assert.equal(context,undefined);return 'npipe://./pipe/docker_engine';
  })).DOCKER_HOST,'npipe://./pipe/docker_engine');
});
