/* eslint-disable */
import './support/env';
import assert from 'assert';
import {SessionManager} from '../src';
import promisify from 'putil-promisify';
import Redis from 'ioredis';

describe('SessionManager', function () {

    let client: Redis;
    let sm: SessionManager;
    let sessionIds = [];
    let _now;

    before((done) => {
        client = new Redis();
        const callDone = (e?) => {
            client.removeListener('ready', done);
            client.removeListener('error', done);
            done(e);
        };
        client.once('ready', callDone);
        client.once('error', callDone);
    });
    
    before(async function () {
        sm = new SessionManager(client, {
            namespace: 'smtest',
            wipeInterval: 60000,
            additionalFields: ['peerIp', 'userAgent']
        });
        await sm.killAll();
        await promisify.fromCallback(cb => client.script('FLUSH', cb));
    });

    after(async () => {
        await client.disconnect();
    });
    
    it('should constructor validate arguments', function () {
        assert.throws(() => {
            // @ts-ignore
            new SessionManager();
        }, /You must provide redis instance/);
        // @ts-ignore
        new SessionManager(client, 'myapp');
    });

    it('should set namespace while construct', function () {
        const sm = new SessionManager(client, {namespace: 'abc'});
        assert.strictEqual(sm.namespace, 'abc');
    });

    it('should set ttl while construct', function () {
        const sm = new SessionManager(client, {ttl: 60});
        assert.strictEqual(sm.ttl, 60);
    });

    it('should create() validate arguments', function () {
        // @ts-ignore
        return assert.rejects(() => sm.create(),
            /You must provide userId/);
    });

    it('should countForUser() validate arguments', function () {
        // @ts-ignore
        return assert.rejects(() => sm.countForUser(),
            /You must provide userId/);
    });

    it('should get() validate arguments', function () {
        // @ts-ignore
        return assert.rejects(() => sm.get(),
            /You must provide sessionId/);
    });

    it('should getUserSessions() validate arguments', function () {
        // @ts-ignore
        return assert.rejects(() => sm.getUserSessions(),
            /You must provide userId/);
    });

    it('should getOldestUserSession() validate arguments', function () {
        // @ts-ignore
        return assert.rejects(() => sm.getOldestUserSession(),
            /You must provide userId/);
    });

    it('should exists() validate arguments', function () {
        // @ts-ignore
        return assert.rejects(() => sm.exists(),
            /You must provide sessionId/);
    });

    it('should kill() validate arguments', function () {
        // @ts-ignore
        return assert.rejects(() => sm.kill(),
            /You must provide sessionId/);
    });

    it('should killUser() validate arguments', function () {
        // @ts-ignore
        return assert.rejects(() => sm.killUser(),
            /You must provide userId/);
    });

    it('should now() return redis server time', async function () {
        const n = await sm.now();
        assert.strictEqual(typeof n, 'number');
        _now = n;
    });

    it('should create session', async function () {
        let t = _now - 10;
        for (const [i, k] of [1, 1, 1, 2, 3, 2, 1, 4, 2, 5].entries()) {
            // @ts-ignore
            sm._now = () => (t - (i * 10));
            const sess = await sm.create('user' + k, {
                ttl: 50,
                peerIp: '192.168.0.' + (11 - i)
            });
            // @ts-ignore
            delete sm._now;
            const j = i * 10 + 10;
            assert(sess);
            assert(sess.sessionId);
            assert.strictEqual(sess.userId, 'user' + k);
            assert.strictEqual(sess.peerIp, '192.168.0.' + (11 - i));
            assert(sess.idle >= j && sess.idle < j + 10);
            assert(sess.expiresIn <= 50 - j && sess.expiresIn > 50 - j - 10);
            sessionIds.push(sess.sessionId);
        }
    });

    it('should count() return session count', async function () {
        const c = await sm.count();
        assert.strictEqual(c, 10);
    });

    it('should count() return active session count which active within given time', async function () {
        const c = await sm.count(40);
        assert.strictEqual(c, 4);
    });

    it('should countForUser() return session count of single user', async function () {
        const c = await sm.countForUser('user1')
        assert.strictEqual(c, 4);
    });

    it('should countForUser() return active session count of user which active within given time', async function () {
        const c = await sm.countForUser('user1', 40)
        assert.strictEqual(c, 3);
    });

    it('should getAllSessions() return all session ids', async function () {
        // @ts-ignore
        const sessions = await sm.getAllSessions()
        assert(sessions);
        assert.strictEqual(Object.keys(sessions).length, 10);
    });

    it('should getAllSessions() return all session ids  which active within given time', async function () {
        const sessions = await sm.getAllSessions(20)
        assert(sessions);
        assert.strictEqual(Object.keys(sessions).length, 2);
    });

    it('should getUserSessions() return all session ids of user', async function () {
        const sessions = await sm.getUserSessions('user1')
        assert(sessions);
        assert.strictEqual(Object.keys(sessions).length, 4);
    });

    it('should getUserSessions() return all session ids of user which active within given time', async function () {
        const sessions = await sm.getUserSessions('user1', 50)
        assert(sessions);
        assert.strictEqual(Object.keys(sessions).length, 3);
    });

    it('should getOldestUserSession() return oldest session of user without updating idle time', async function () {
        const sess = await sm.getOldestUserSession('user1', true)
        assert(sess);
        assert(sess.sessionId);
        assert.strictEqual(sess.userId, 'user1');
        assert.strictEqual(sess.peerIp, '192.168.0.5');
        assert.strictEqual(sess.idle, 70);
    });

    it('should getOldestUserSession() return oldest session of user', async function () {
        const sess = await sm.getOldestUserSession('user1')
        assert(sess);
        assert(sess.sessionId);
        assert.strictEqual(sess.userId, 'user1');
        assert.strictEqual(sess.peerIp, '192.168.0.5');
        assert.strictEqual(sess.idle, 0);
    });

    it('should getAllUsers() return all user ids', async function () {
        const users = await sm.getAllUsers();
        assert(users);
        assert.strictEqual(Object.keys(users).length, 5);
    });

    it('should getAllUsers() return all user ids which active within given time', async function () {
        const sessions = await sm.getAllUsers(50);
        assert(sessions);
        assert.strictEqual(Object.keys(sessions).length, 2);
    });

    it('should create session with default options', async function () {
        // @ts-ignore
        sm._now = () => _now - 200;
        const sess = await sm.create('user7');
        // @ts-ignore
        delete sm._now;
        assert(sess);
        assert(sess.sessionId);
        assert.strictEqual(sess.ttl, 30 * 60);
    });

    it('should get session without updating idle time', async function () {
        const sess = await sm.get(sessionIds[0], true);
        assert(sess);
        assert(sess.sessionId);
        assert.strictEqual(sess.userId, 'user1');
        assert.strictEqual(sess.peerIp, '192.168.0.11');
        assert(sess.idle > 0);
    });

    it('should get session with updating idle time (default)', async function () {
        const sess = await sm.get(sessionIds[0])
        assert(sess);
        assert(sess.sessionId);
        assert.strictEqual(sess.userId, 'user1');
        assert.strictEqual(sess.peerIp, '192.168.0.11');
        assert.strictEqual(sess.idle, 0);
    });

    it('should exists() check if session exists', async function () {
        let b = await sm.exists(sessionIds[0]);
        assert(b);
        b = await sm.exists('unknown');
        assert(!b);
    });

    it('should set values to session', async function () {
        const sess = await sm.get(sessionIds[sessionIds.length - 1])
        const r = await sess.set('val1', 123);
        assert.strictEqual(r, 1);
    });

    it('should set map of values to session', async function () {
        const session = await sm.get(sessionIds[sessionIds.length - 1]);
        const r = await session.set({
            val2: '234',
            val3: 'abc',
            val4: new Date(0),
            val5: Buffer.from('Hello World'),
            val6: {a: 1, b: '2', c: 3.3}
        });
        assert.strictEqual(r, 5);
    });

    it('should get values from session', async function () {
        const session = await sm.get(sessionIds[sessionIds.length - 1]);
        const v = await session.get('val1');
        assert.strictEqual(v, 123);
    });

    it('should get array of values from session', async function () {
        const session = await sm.get(sessionIds[sessionIds.length - 1]);
        const v = await session.get(['val1', 'val2', 'val3', 'val4', 'val5', 'val6']);
        assert.deepStrictEqual(v,
            [123, '234', 'abc',
                new Date(0),
                Buffer.from('Hello World'),
                {a: 1, b: '2', c: 3.3}
            ]
        );
    });

    it('should get map of values from session', async function () {
        const session = await sm.get(sessionIds[sessionIds.length - 1]);
        const v = await session.get({val2: 0, val3: 0, val4: 0});
        assert.deepStrictEqual(v, {
            val2: '234',
            val3: 'abc',
            val4: new Date(0)
        });
    });

    it('should kill() remove session', async function () {
        const sessionId = sessionIds.pop();
        await sm.kill(sessionId);
        const b = await await sm.exists(sessionId);
        assert(!b);
        const sess = await sm.get(sessionId);
        assert(!sess);
    });

    it('should killUser() remove all sessions of the user', async function () {
        let sessionId;
        const ids = await sm.getUserSessions('user4');
        sessionId = ids[0];
        let b = await sm.exists(sessionId);
        assert.strictEqual(b, true);
        await sm.killUser('user4');
        b = await sm.exists(sessionId);
        assert.strictEqual(b, false);
    });

    it('should wipe expired sessions', async function () {
        await sm.wipe();
        const c = await sm.count();
        assert.strictEqual(c, 6);
    });

    it('should killAll() remove all sessions of the user', async function () {
        let c = await sm.count();
        assert(c > 0);
        await sm.killAll();
        c = await sm.count();
        assert.strictEqual(c, 0);
    });

    it('should create immortal session', async function () {
        // @ts-ignore
        sm._now = () => _now - 200;
        let sid;
        const sess = await sm.create('user6', {ttl: 0});
        // @ts-ignore
        delete sm._now;
        assert(sess);
        assert(sess.sessionId);
        assert.strictEqual(sess.ttl, 0);
        assert.strictEqual(sess.expiresIn, 0);
        sid = sess.sessionId;
        const sess2 = await sm.get(sid);
        assert(sess2);
    });

    it('should wipe periodically', function (done) {
        this.slow(500);
        // @ts-ignore
        sm._wipeInterval = 1;
        const oldWipe = sm.wipe;
        let k = 0;
        sm.wipe = () => {
            k++;
            return oldWipe.call(sm);
        };
        sm.wipe();
        setTimeout(() => {
            // @ts-ignore
            sm._wipeInterval = 6000;
            delete sm.wipe;
            if (k > 5)
                return done();
            done(new Error('Failed'));
        }, 100).unref();
    });

});
