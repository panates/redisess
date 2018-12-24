/* eslint-disable */
require('./support/env');
const assert = require('assert');
const redisess = require('..');
const Redis = require('ioredis');
const waterfall = require('putil-waterfall');
const {rejects, doesNotReject} = require('rejected-or-not');

assert.rejects = assert.rejects || rejects;
assert.doesNotReject = assert.doesNotReject || doesNotReject;

describe('SessionManager', function() {

  let redis;
  let sm;
  let sessionIds = [];
  let _now;

  before((done) => {
    redis = new Redis();
    redis.once('ready', done);
    redis.once('error', done);
    sm = redisess(redis, {
      namespace: 'smtest',
      wipeInterval: 60000,
      additionalFields: ['peerIp', 'userAgent']
    });
  });

  before(() => sm.killAll());

  before(() => redis.script('flush'));

  after(() => redis.quit());

  it('should constructor validate arguments', function() {
    assert.throws(() => {
      redisess();
    }, /You must provide redis instance/);
    redisess(redis, 'myapp');
  });

  it('should set namespace while construct', function() {
    const sm = redisess(redis, {namespace: 'abc'});
    assert.strictEqual(sm.namespace, 'abc');
  });

  it('should set ttl while construct', function() {
    const sm = redisess(redis, {ttl: 60});
    assert.strictEqual(sm._ttl, 60);
  });

  it('should create() validate arguments', function() {
    return assert.rejects(() => sm.create(),
        /You must provide userId/);
  });

  it('should countForUser() validate arguments', function() {
    return assert.rejects(() => sm.countForUser(),
        /You must provide userId/);
  });

  it('should get() validate arguments', function() {
    return assert.rejects(() => sm.get(),
        /You must provide sessionId/);
  });

  it('should getUserSessions() validate arguments', function() {
    return assert.rejects(() => sm.getUserSessions(),
        /You must provide userId/);
  });

  it('should getOldestUserSession() validate arguments', function() {
    return assert.rejects(() => sm.getOldestUserSession(),
        /You must provide userId/);
  });

  it('should exists() validate arguments', function() {
    return assert.rejects(() => sm.exists(),
        /You must provide sessionId/);
  });

  it('should kill() validate arguments', function() {
    return assert.rejects(() => sm.kill(),
        /You must provide sessionId/);
  });

  it('should killUser() validate arguments', function() {
    return assert.rejects(() => sm.killUser(),
        /You must provide userId/);
  });

  it('should now() return redis server time', function() {
    return sm.now().then((n) => {
      assert(n);
      _now = n;
    });
  });

  it('should create session', function() {
    let t = _now - 10;
    return waterfall.every([1, 1, 1, 2, 3, 2, 1, 4, 2, 5], (next, k, i) => {
      sm._now = () => (t - (i * 10));
      return sm.create('user' + k, {ttl: 50, peerIp: '192.168.0.' + (11 - i)})
          .then((sess) => {
            delete sm._now;
            const t = i * 10 + 10;
            assert(sess);
            assert(sess.sessionId);
            assert.strictEqual(sess.userId, 'user' + k);
            assert.strictEqual(sess.peerIp, '192.168.0.' + (11-i));
            assert(sess.idle >= t && sess.idle < t + 10, t);
            assert.strictEqual(sess.manager, sm);
            assert(sess.expiresIn <= 50 - t && sess.expiresIn > 50 - t - 10);
            sessionIds.push(sess.sessionId);
          });
    });
  });

  it('should count() return session count', function() {
    return sm.count().then((c) => {
      assert.strictEqual(c, 10);
    });
  });

  it('should count() return active session count which active within given time', function() {
    return sm.count(40).then((c) => {
      assert.strictEqual(c, 4);
    });
  });

  it('should countForUser() return session count of single user', function() {
    return sm.countForUser('user1').then((c) => {
      assert.strictEqual(c, 4);
    });
  });

  it('should countForUser() return active session count of user which active within given time', function() {
    return sm.countForUser('user1', 40).then((c) => {
      assert.strictEqual(c, 3);
    });
  });

  it('should getAllSession() return all session ids', function() {
    return sm.getAllSession().then((sessions) => {
      assert(sessions);
      assert.strictEqual(Object.keys(sessions).length, 10);
    });
  });

  it('should getAllSession() return all session ids  which active within given time', function() {
    return sm.getAllSession(20).then((sessions) => {
      assert(sessions);
      assert.strictEqual(Object.keys(sessions).length, 2);
    });
  });

  it('should getUserSessions() return all session ids of user', function() {
    return sm.getUserSessions('user1').then((sessions) => {
      assert(sessions);
      assert.strictEqual(Object.keys(sessions).length, 4);
    });
  });

  it('should getUserSessions() return all session ids of user which active within given time', function() {
    return sm.getUserSessions('user1', 50).then((sessions) => {
      assert(sessions);
      assert.strictEqual(Object.keys(sessions).length, 3);
    });
  });

  it('should getOldestUserSession() return oldest session of user without updating idle time', function() {
    return sm.getOldestUserSession('user1', true).then(sess => {
      assert(sess);
      assert(sess.sessionId);
      assert.strictEqual(sess.userId, 'user1');
      assert.strictEqual(sess.peerIp, '192.168.0.5');
      assert.strictEqual(sess.idle, 70);
    });
  });

  it('should getOldestUserSession() return oldest session of user', function() {
    return sm.getOldestUserSession('user1').then(sess => {
      assert(sess);
      assert(sess.sessionId);
      assert.strictEqual(sess.userId, 'user1');
      assert.strictEqual(sess.peerIp, '192.168.0.5');
      assert.strictEqual(sess.idle, 0);
    });
  });

  it('should getAllUsers() return all user ids', function() {
    return sm.getAllUsers().then((users) => {
      assert(users);
      assert.strictEqual(Object.keys(users).length, 5);
    });
  });

  it('should getAllUsers() return all user ids which active within given time', function() {
    return sm.getAllUsers(50).then((sessions) => {
      assert(sessions);
      assert.strictEqual(Object.keys(sessions).length, 2);
    });
  });

  it('should create session with default options', function() {
    sm._now = () => _now - 200;
    return sm.create('user7').then((sess) => {
      delete sm._now;
      assert(sess);
      assert(sess.sessionId);
      assert.strictEqual(sess.ttl, 30 * 60);
    });
  });

  it('should get session without updating idle time', function() {
    return sm.get(sessionIds[0], true).then((sess) => {
      assert(sess);
      assert(sess.sessionId);
      assert.strictEqual(sess.userId, 'user1');
      assert.strictEqual(sess.peerIp, '192.168.0.11');
      assert(sess.idle > 0);
    });
  });

  it('should get session with updating idle time (default)', function() {
    return sm.get(sessionIds[0]).then((sess) => {
      assert(sess);
      assert(sess.sessionId);
      assert.strictEqual(sess.userId, 'user1');
      assert.strictEqual(sess.peerIp, '192.168.0.11');
      assert.strictEqual(sess.idle, 0);
    });
  });

  it('should exists() check if session exists', function() {
    return sm.exists(sessionIds[0])
        .then((b) => assert(b))
        .then(() => sm.exists('unknown')
            .then((b) => assert(!b)));
  });

  it('should set values to session', function() {
    return sm.get(sessionIds[sessionIds.length - 1]).then(session =>
        session.set('val1', 123)
            .then(r => assert.strictEqual(r, 1)));
  });

  it('should set map of values to session', function() {
    return sm.get(sessionIds[sessionIds.length - 1]).then(session =>
        session.set({
          val2: '234',
          val3: 'abc',
          val4: new Date(0),
          val5: Buffer.from('Hello World'),
          val6: {a: 1, b: '2', c: 3.3}
        })
            .then(r => assert.strictEqual(r, 5)));
  });

  it('should get values from session', function() {
    return sm.get(sessionIds[sessionIds.length - 1]).then(session =>
        session.get('val1')
            .then(v => assert.strictEqual(v, 123)));
  });

  it('should get array of values from session', function() {
    return sm.get(sessionIds[sessionIds.length - 1]).then(session =>
        session.get(['val1', 'val2', 'val3', 'val4', 'val5', 'val6'])
            .then(v => assert.deepStrictEqual(v,
                [123, '234', 'abc',
                  new Date(0),
                  Buffer.from('Hello World'),
                  {a: 1, b: '2', c: 3.3}
                ]
            )));
  });

  it('should get map of values from session', function() {
    return sm.get(sessionIds[sessionIds.length - 1]).then(session =>
        session.get({val2: 0, val3: 0, val4: 0})
            .then(v => assert.deepStrictEqual(v, {
              val2: '234',
              val3: 'abc',
              val4: new Date(0)
            })));
  });

  it('should kill() remove session', function() {
    const sessionId = sessionIds.pop();
    return waterfall([
      () => sm.kill(sessionId),
      () => sm.exists(sessionId).then((b) => assert(!b)),
      () => sm.get(sessionId).then((sess) => assert(!sess))
    ]);
  });

  it('should killUser() remove all sessions of the user', function() {
    let sessionId;
    return waterfall([
      () => sm.getUserSessions('user4').then(ids => {sessionId = ids[0];}),
      () => sm.exists(sessionId).then(b => assert.strictEqual(b, true)),
      () => sm.killUser('user4'),
      () => sm.exists(sessionId).then(b => assert.strictEqual(b, false))
    ]);
  });

  it('should wipe expired sessions', function() {
    return sm._wipe().then(() => {
      return sm.count().then(c => assert.strictEqual(c, 6));
    });
  });

  it('should killAll() remove all sessions of the user', function() {
    return waterfall([
      () => sm.count().then(c => assert(c > 0)),
      () => sm.killAll(),
      () => sm.count().then(c => assert.strictEqual(c, 0))
    ]);
  });

  it('should create immortal session', function() {
    sm._now = () => _now - 200;
    let sid;
    return waterfall([
      () => sm.create('user6', {ttl: 0}).then((sess) => {
        delete sm._now;
        assert(sess);
        assert(sess.sessionId);
        assert.strictEqual(sess.ttl, 0);
        assert.strictEqual(sess.expiresIn, 0);
        sid = sess.sessionId;
      }),

      //() => sm._wipe(),

      () => sm.get(sid).then(sess => assert(sess))

    ]);

  });

  it('should wipe periodically', function(done) {
    this.slow(500);
    sm._wipeInterval = 1;
    const oldWipe = sm._wipe;
    let k = 0;
    sm._wipe = () => {
      k++;
      return oldWipe.call(sm);
    };
    sm._wipe();
    setTimeout(() => {
      sm._wipeInterval = 6000;
      sm._wipe = oldWipe;
      if (k > 5)
        return done();
      done(new Error('Failed'));
    }, 100);
  });

});
