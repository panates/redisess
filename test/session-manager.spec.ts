import './_support/env';
import Redis from 'ioredis';
import promisify from 'putil-promisify';
import { SessionManager } from '../src';

describe('SessionManager', () => {
  let client: Redis;
  let sm: any;
  const sessionIds = [];
  let _now: number;

  beforeAll(done => {
    client = new Redis();
    const callDone = e => {
      client.removeListener('ready', done);
      client.removeListener('error', done);
      done(e);
    };
    client.once('ready', callDone);
    client.once('error', callDone);
  });

  beforeAll(async () => {
    sm = new SessionManager(client, {
      namespace: 'smtest',
      wipeInterval: 60000,
      additionalFields: ['peerIp', 'userAgent'],
    });
    await sm.killAll();
    await promisify.fromCallback(cb => client.script('FLUSH', cb));
  });

  afterAll(() => client.disconnect());

  it('should constructor validate arguments', () => {
    // @ts-ignore
    expect(() => new SessionManager()).toThrow(
      'You must provide redis instance',
    );

    expect(() => new SessionManager(client, {})).not.toThrow();
  });

  it('should set namespace while construct', () => {
    const sm2 = new SessionManager(client, { namespace: 'abc' });
    expect(sm2.namespace).toEqual('abc');
  });

  it('should set ttl while construct', () => {
    const sm2 = new SessionManager(client, { ttl: 60 });
    expect(sm2.ttl).toEqual(60);
  });

  it('should create() validate arguments', async () => {
    await expect(
      // @ts-ignore
      () => sm.create(),
    ).rejects.toThrow('You must provide userId');
  });

  it('should countForUser() validate arguments', async () => {
    await expect(
      // @ts-ignore
      () => sm.countForUser(),
    ).rejects.toThrow('You must provide userId');
  });

  it('should get() validate arguments', async () => {
    await expect(
      // @ts-ignore
      () => sm.get(),
    ).rejects.toThrow('You must provide sessionId');
  });

  it('should getUserSessions() validate arguments', async () => {
    await expect(
      // @ts-ignore
      () => sm.getUserSessions(),
    ).rejects.toThrow('You must provide userId');
  });

  it('should getOldestUserSession() validate arguments', async () => {
    await expect(
      // @ts-ignore
      () => sm.getOldestUserSession(),
    ).rejects.toThrow('You must provide userId');
  });

  it('should exists() validate arguments', async () => {
    await expect(
      // @ts-ignore
      () => sm.exists(),
    ).rejects.toThrow('You must provide sessionId');
  });

  it('should kill() validate arguments', async () => {
    await expect(
      // @ts-ignore
      () => sm.kill(),
    ).rejects.toThrow('You must provide sessionId');
  });

  it('should killUser() validate arguments', async () => {
    await expect(
      // @ts-ignore
      () => sm.killUser(),
    ).rejects.toThrow('You must provide userId');
  });

  it('should now() return redis server time', async () => {
    const n = await sm.now();
    expect(typeof n).toEqual('number');
    _now = n;
  });

  it('should create session', async () => {
    const t = _now - 10;
    for (const [i, k] of [1, 1, 1, 2, 3, 2, 1, 4, 2, 5].entries()) {
      sm._backend.now = () => t - i * 10;
      const sess = await sm.create('user' + k, {
        ttl: 50,
        peerIp: '192.168.0.' + (11 - i),
      });
      delete sm._backend.now;
      const j = i * 10 + 10;
      expect(sess).toBeDefined();
      expect(sess.sessionId).toBeDefined();
      expect(sess.userId).toStrictEqual('user' + k);
      expect(sess.peerIp).toStrictEqual('192.168.0.' + (11 - i));
      expect(sess.idle).toBeGreaterThanOrEqual(j);
      expect(sess.idle).toBeLessThan(j + 10);
      expect(sess.expiresIn).toBeLessThanOrEqual(50 - j);
      expect(sess.expiresIn).toBeGreaterThan(50 - j - 10);
      sessionIds.push(sess.sessionId);
    }
  });

  it('should count() return session count', async () => {
    const c = await sm.count();
    expect(c).toStrictEqual(10);
  });

  it('should count() return active session count which active within given time', async () => {
    const c = await sm.count(40);
    expect(c).toStrictEqual(4);
  });

  it('should countForUser() return session count of single user', async () => {
    const c = await sm.countForUser('user1');
    expect(c).toStrictEqual(4);
  });

  it('should countForUser() return active session count of user which active within given time', async () => {
    const c = await sm.countForUser('user1', 40);
    expect(c).toStrictEqual(3);
  });

  it('should getAllSessions() return all session ids', async () => {
    const sessions = await sm.getAllSessions();
    expect(sessions).toBeDefined();
    expect(Object.keys(sessions).length).toEqual(10);
  });

  it('should getAllSessions() return all session ids  which active within given time', async () => {
    const sessions = await sm.getAllSessions(20);
    expect(sessions).toBeDefined();
    expect(Object.keys(sessions).length).toEqual(2);
  });

  it('should getUserSessions() return all session ids of user', async () => {
    const sessions = await sm.getUserSessions('user1');
    expect(sessions).toBeDefined();
    expect(Object.keys(sessions).length).toEqual(4);
  });

  it('should getUserSessions() return all session ids of user which active within given time', async () => {
    const sessions = await sm.getUserSessions('user1', 50);
    expect(sessions).toBeDefined();
    expect(Object.keys(sessions).length).toEqual(3);
  });

  it('should getOldestUserSession() return oldest session of user without updating idle time', async () => {
    const session = await sm.getOldestUserSession('user1', true);
    expect(session).toBeDefined();
    expect(session.sessionId).toBeDefined();
    expect(session.userId).toEqual('user1');
    expect(session.peerIp).toEqual('192.168.0.5');
    expect(session.idle).toEqual(70);
  });

  it('should getOldestUserSession() return oldest session of user', async () => {
    const session = await sm.getOldestUserSession('user1');
    expect(session).toBeDefined();
    expect(session.sessionId).toBeDefined();
    expect(session.userId).toEqual('user1');
    expect(session.peerIp).toEqual('192.168.0.5');
    expect(session.idle).toEqual(0);
  });

  it('should getAllUsers() return all user ids', async () => {
    const users = await sm.getAllUsers();
    expect(Object.keys(users).length).toEqual(5);
  });

  it('should getAllUsers() return all user ids which active within given time', async () => {
    const users = await sm.getAllUsers(50);
    expect(Object.keys(users).length).toEqual(2);
  });

  it('should create session with default options', async () => {
    sm._now = () => _now - 200;
    const session = await sm.create('user7');
    delete sm._now;
    expect(session).toBeDefined();
    expect(session.sessionId).toBeDefined();
    expect(session.ttl).toEqual(30 * 60);
  });

  it('should get session without updating idle time', async () => {
    const session = await sm.get(sessionIds[0], true);
    expect(session).toBeDefined();
    expect(session.sessionId).toBeDefined();
    expect(session.userId).toEqual('user1');
    expect(session.peerIp).toEqual('192.168.0.11');
    expect(session.idle).toBeGreaterThan(0);
  });

  it('should get session with updating idle time (default)', async () => {
    const session = await sm.get(sessionIds[0]);
    expect(session).toBeDefined();
    expect(session.sessionId).toBeDefined();
    expect(session.userId).toEqual('user1');
    expect(session.peerIp).toEqual('192.168.0.11');
    expect(session.idle).toEqual(0);
  });

  it('should exists() check if session exists', async () => {
    let b = await sm.exists(sessionIds[0]);
    expect(b).toBeTruthy();
    b = await sm.exists('unknown');
    expect(b).not.toBeTruthy();
  });

  it('should set values to session', async () => {
    const sess = await sm.get(sessionIds[sessionIds.length - 1]);
    const r = await sess.set('val1', 123);
    expect(r).toStrictEqual(1);
  });

  it('should set map of values to session', async () => {
    const session = await sm.get(sessionIds[sessionIds.length - 1]);
    const r = await session.set({
      val2: '234',
      val3: 'abc',
      val4: new Date(0),
      val5: Buffer.from('Hello World'),
      val6: { a: 1, b: '2', c: 3.3 },
    });
    expect(r).toStrictEqual(5);
  });

  it('should get values from session', async () => {
    const session = await sm.get(sessionIds[sessionIds.length - 1]);
    const v = await session.get('val1');
    expect(v).toStrictEqual(123);
  });

  it('should get array of values from session', async () => {
    const session = await sm.get(sessionIds[sessionIds.length - 1]);
    const v = await session.get([
      'val1',
      'val2',
      'val3',
      'val4',
      'val5',
      'val6',
    ]);
    expect(v).toEqual([
      123,
      '234',
      'abc',
      new Date(0),
      Buffer.from('Hello World'),
      { a: 1, b: '2', c: 3.3 },
    ]);
  });

  it('should get map of values from session', async () => {
    const session = await sm.get(sessionIds[sessionIds.length - 1]);
    const v = await session.get({ val2: 0, val3: 0, val4: 0 });
    expect(v).toEqual({
      val2: '234',
      val3: 'abc',
      val4: new Date(0),
    });
  });

  it('should kill() remove session', async () => {
    const sessionId = sessionIds.pop();
    await sm.kill(sessionId);
    const b = await sm.exists(sessionId);
    expect(b).not.toBeTruthy();
    const sess = await sm.get(sessionId);
    expect(sess).not.toBeDefined();
  });

  it('should killUser() remove all sessions of the user', async () => {
    const ids = await sm.getUserSessions('user4');
    const sessionId = ids[0];
    let b = await sm.exists(sessionId);
    expect(b).toBeTruthy();
    await sm.killUser('user4');
    b = await sm.exists(sessionId);
    expect(b).not.toBeTruthy();
  });

  it('should wipe expired sessions', async () => {
    await sm.wipe();
    const c = await sm.count();
    expect(c).toStrictEqual(6);
  });

  it('should killAll() remove all sessions of the user', async () => {
    let c = await sm.count();
    expect(c).toBeGreaterThan(0);
    await sm.killAll();
    c = await sm.count();
    expect(c).toEqual(0);
  });

  it('should create immortal session', async () => {
    sm._now = () => _now - 200;
    const session = await sm.create('user6', { ttl: 0 });
    delete sm._now;
    expect(session).toBeDefined();
    expect(session.sessionId).toBeDefined();
    expect(session.ttl).toStrictEqual(0);
    expect(session.expiresIn).toStrictEqual(0);
    const sess2 = await sm.get(session.sessionId);
    expect(sess2).toBeDefined();
  });

  it('should wipe periodically', done => {
    const oldWipeInterval = sm._backend.wipeInterval;
    sm._backend.wipeInterval = 1;
    const oldWipe = sm._backend.wipe;
    let k = 0;
    // @ts-ignore
    sm._backend.wipe = () => {
      k++;
      return oldWipe.call(sm._backend);
    };
    setTimeout(() => {
      sm._backend.wipeInterval = oldWipeInterval;
      delete sm._backend.wipe;
      if (k > 5) return done();
      done(new Error('Failed'));
    }, 100).unref();
    sm.wipe().catch(() => undefined);
  });
});
