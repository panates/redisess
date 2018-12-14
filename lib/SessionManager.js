const crypto = require('crypto');
const {ArgumentError} = require('errorex');
const waterfall = require('putil-waterfall');

/**
 *
 */
class SessionManager {

  /**
   *
   * @param {Object} client
   * @param {string} appName
   * @param {Object} [options]
   * @param {Object} [options.namespace='ssm']
   * @param {number} [options.ttl] Time-To-Live value in seconds
   * @param {number} [options.wipeInterval=1000]
   */
  constructor(client, appName, options) {
    if (!(client && typeof client.hmget === 'function'))
      throw new ArgumentError('You must provide redis instance');
    if (!appName)
      throw new ArgumentError('You must provide application name');
    options = options || {};
    this._client = client;
    this._appName = appName;
    this._ns = (options.namespace || 'sm');
    this._ttl = Number(options.ttl) >= 0 ? Number(options.ttl) : (30 * 60);
    this._timediff = null; // Difference between local time and redis server time in seconds
    this._wipeInterval = options.wipeInterval || 1000;
    this._wipeTimer = null;
    client.once('close', () => this.quit());
  }

  get namespace() {
    return this._ns;
  }

  /**
   * Get the amount of sessions within the last n seconds.
   * Get all session count if n is not defined or zero
   * @param {number} [n]
   * @return {Promise<Number>}
   */
  count(n) {
    return this._getClient().then(client => {
      n = Number(n);
      const prefix = this._ns + ':' + this._appName;
      return client.zcount(prefix + ':ACTIVITY',
          (n ? Math.floor(this._now() - n) : '-inf'), '+inf')
          .then(resp => {
            return Number(resp);
          });
    });
  }

  /**
   * Creates new session
   *
   * @param {string} userId
   * @param {Object} [options]
   * @param {number} [options.ttl] Time-To-Live value in seconds
   * @param {Object} [options.data] Additional data to set for this sessions
   * @param {Boolean} [options.immutable=false] If set to true the session will not be refreshed on session use. Instead it will run out exactly after the defined ttl. Default: false
   * @param options
   */
  create(userId, options) {
    if (!userId)
      return Promise.reject(new ArgumentError('You must provide userId'));

    options = options || {};
    const ttl = Number(options.ttl) >= 0 ? Number(options.ttl) : this._ttl;
    const sessionId = this._createSessionId();
    const session = new Session(this, {
      sessionId,
      userId,
      ttl
    });

    return session.update().then(() => session);
  }

  /**
   * Retrieves session by sessionId
   *
   * @param {string} sessionId
   * @param {boolean} [noUpdate=false]
   * @return {Promise<Session>}
   */
  get(sessionId, noUpdate) {
    if (!sessionId)
      return Promise.reject(new ArgumentError('You must provide sessionId'));
    const session = new Session(this, {sessionId});
    return session.refresh().then(() => {
      if (!session.valid)
        return undefined;
      if (noUpdate)
        return session;
      return session.update().then(() => session);
    });
  }

  /**
   * Retrieves all session ids which were active within the last n seconds.
   *
   * @param {number} [n=10]
   * @return {Promise<Array<String>>}
   */
  getAllSession(n) {
    return this._getClient().then(client => {
      n = Number(n);
      const prefix = this._ns + ':' + this._appName;
      return client.zrevrangebyscore(prefix + ':ACTIVITY',
          '+inf',
          (n ? Math.floor(this._now() - n) : '-inf')
      );
    });
  }

  /**
   * Retrieves all user ids which were active within the last n seconds.
   *
   * @param {number} [n=10]
   * @return {Promise<Array<String>>}
   */
  getAllUsers(n) {
    return this._getClient().then(client => {
      n = Number(n);
      const prefix = this._ns + ':' + this._appName;
      return client.zrevrangebyscore(prefix + ':USERS',
          '+inf',
          (n ? Math.floor(this._now() - n) : '-inf')
      );
    });
  }

  /**
   * Retrieves session ids of single user which were active within the last n seconds.
   *
   * @param {string} userId
   * @param {number} [n=10]
   * @return {Promise<Array<String>>}
   */
  getUserSessions(userId, n) {
    if (!userId)
      return Promise.reject(new ArgumentError('You must provide userId'));
    return this._getClient().then(client => {
      n = Number(n);
      const prefix = this._ns + ':' + this._appName;
      return client.zrevrangebyscore(prefix + ':user_' + userId,
          '+inf',
          (n ? Math.floor(this._now() - n) : '-inf'));
    });
  }

  /**
   * Returns true if sessionId exists, false otherwise,
   *
   * @param {string} sessionId
   * @return {Promise<Boolean>}
   */
  exists(sessionId) {
    if (!sessionId)
      return Promise.reject(new ArgumentError('You must provide sessionId'));
    return this._getClient().then(client => {
      const prefix = this._ns + ':' + this._appName;
      return client.exists(prefix + ':sess_' + sessionId)
          .then(resp => !!Number(resp));
    });
  }

  /**
   * Kills single session
   *
   * @param {string} sessionId
   * @return {Promise<Boolean>}
   */
  kill(sessionId) {
    if (!sessionId)
      return Promise.reject(new ArgumentError('You must provide sessionId'));
    return this.get(sessionId, true)
        .then(session => !!session && session.kill());
  }

  /**
   * Kills all sessions of user
   *
   * @param {string} userId
   * @return {Promise<Boolean>}
   */
  killUser(userId) {
    if (!userId)
      return Promise.reject(new ArgumentError('You must provide userId'));
    return this.getUserSessions(userId).then(sessions => {
      return waterfall.every(sessions, (next, sid) => this.kill(sid));
    });
  }

  /**
   * Kills all sessions for application
   *
   * @return {Promise}
   */
  killAll() {
    return this._getClient().then(client => {
      const prefix = this._ns + ':' + this._appName;
      return client.eval(`
          -- find keys with wildcard
          local keysToDelete = redis.call('keys', ARGV[1]) 
          --if there are any keys
          if unpack(keysToDelete) ~= nil then
            --delete all
            return redis.call(\'del\', unpack(keysToDelete)) 
          else 
            return 0 --if no keys to delete
          end`,
          0, //no keys names passed, only one argument ARGV[1]
          prefix + ':*' // Pattern
      ).then(() => true);
    });
  }

  now() {
    return this._client.time().then((resp) => {
      // Synchronize redis server time with local time
      this._timediff = (Date.now() / 1000) -
          Math.floor(Number(resp[0]) + (Number(resp[1]) / 1000000));
      return this._now();
    });
  }

  /* istanbul ignore next */
  /**
   *
   */
  quit() {
    clearTimeout(this._wipeInterval);
    this._wipeInterval = null;
  }

  // noinspection JSMethodCanBeStatic
  /**
   *
   * @return {string}
   * @private
   */
  _createSessionId() {
    return crypto.randomBytes(16).toString('hex');
  }

  _now() {
    return Math.floor(Date.now() / 1000 + this._timediff);
  }

  _getClient() {
    if (!this._wipeTimer)
      this._wipeTimer =
          setTimeout(() => this._wipe(), this._wipeInterval).unref();
    if (this._timediff == null)
      return this.now().then(() => this._client);
    return Promise.resolve(this._client);
  }

  _getPipeline() {
    /* istanbul ignore next */
    return this._getClient().then(client => {
      if (typeof client.pipeline === 'function')
        return client.pipeline();
      if (typeof client.multi === 'function')
        return client.multi();
      throw new Error('Client instance must support pipeline or multi');
    });
  }

  _wipe() {
    clearTimeout(this._wipeTimer);
    this._wipeTimer = null;
    return this._getClient().then(client => {
      const prefix = this._ns + ':' + this._appName;
      return client.eval(`
          -- find keys with wildcard
          local matches = redis.call("zrevrangebyscore", ARGV[1]..":EXPIRES", ARGV[2], "-inf")
          if unpack(matches) == nil then
            return 0 
          end
          -- Iterate keys
          for _,key in ipairs(matches) do
            local userId = redis.call("HGET", ARGV[1]..":sess_"..key, "us")
            if userId ~= nil then
              redis.call('zrem', ARGV[1]..":user_"..userId, key)            
            end
            redis.call("del", ARGV[1]..":sess_"..key)            
          end          
          redis.call("zrem", ARGV[1]..":ACTIVITY", unpack(matches))
          redis.call("zrem", ARGV[1]..":EXPIRES", unpack(matches))                    
          `,
          0, //no keys names passed, only one argument ARGV[1]
          prefix,
          this._now()
      );
    });
  }

}

class Session {

  /**
   *
   * @param {SessionManager} manager
   * @param {Object} prop
   * @param {string} prop.sessionId
   * @param {string} [prop.userId]
   * @param {number} [prop.ttl]
   * @constructor
   */
  constructor(manager, prop) {
    this._manager = manager;
    this._sessionId = prop.sessionId;
    this._userId = prop.userId;
    this._ttl = prop.ttl || 0;
    this._lastAccess = 0;
    this._expires = 0;
  }

  get manager() {
    return this._manager;
  }

  get sessionId() {
    return this._sessionId;
  }

  get userId() {
    return this._userId;
  }

  get ttl() {
    return this._ttl;
  }

  get lastAccess() {
    return this._lastAccess;
  }

  get expires() {
    return this._expires;
  }

  get expiresIn() {
    return this._expires ?
        this._expires - this.manager._now() : 0;
  }

  get valid() {
    return !!(this._sessionId && this._userId && this._lastAccess);
  }

  get idle() {
    return this.manager._now() - this.lastAccess;
  }

  refresh() {
    const manager = this._manager;
    const key = manager._ns + ':' + manager._appName +
        ':sess_' + this.sessionId;
    return manager._getClient().then(client =>
        client.hmget(key, 'us', 'la', 'ex', 'ttl').then(resp => {
          this._userId = resp[0];
          this._lastAccess = Number(resp[1]) || 0;
          this._expires = Number(resp[2]) || 0;
          this._ttl = Number(resp[3]) || 0;
        })
    );
  }

  update() {
    const manager = this._manager;
    return manager._getPipeline().then(pipeline => {
      this._prepareUpdate(pipeline);
      return pipeline.exec().then((resp) => {
        /* istanbul ignore next */
        if (!String(resp).includes('OK'))
          throw new Error('Unexpected response returned');
      });
    });

  }

  /**
   *
   * @return {Promise<Boolean>}
   */
  kill() {
    const manager = this._manager;
    return manager._getPipeline().then(pipeline => {
      const prefix = manager._ns + ':' + manager._appName;
      const {sessionId, userId} = this;
      pipeline.zrem(prefix + ':ACTIVITY', sessionId);
      pipeline.zrem(prefix + ':EXPIRES', sessionId);
      pipeline.zrem(prefix + ':user_' + userId, sessionId);
      pipeline.del(prefix + ':sess_' + sessionId);
      pipeline.exists(prefix + ':sess_' + sessionId);
      return pipeline.exec()
          .then(resp => {
            // If already exists return false
            /* istanbul ignore next */
            if (Number(resp[4][1]))
              return false;
            /* remove userId from users set, if user has no session */
            return manager._getClient().then(client =>
                client.zcount(prefix + ':user_' + userId, '+inf', '-inf')
                    .then(c => {
                      /* istanbul ignore next */
                      if (c)
                        return true;
                      return client.zrem(prefix + ':USERS', userId)
                          .then(() => true);
                    })
            );
          });
    });
  }

  /**
   *
   * @param {Object} pipeline
   * @return {Object}
   * @private
   */
  _prepareUpdate(pipeline) {
    const manager = this._manager;
    this._lastAccess = manager._now();
    this._expires = this._ttl ?
        this._lastAccess + this._ttl : 0;

    const {sessionId, userId, lastAccess, expires, ttl} = this;
    const prefix = manager._ns + ':' + manager._appName;

    // Keep userId in a sorted list per application
    // Score keeps last access time
    pipeline.zadd(prefix + ':USERS', lastAccess, userId);

    // Keep sessionId:userId in the activity sorted list
    // Score keeps last access time of session
    pipeline.zadd(prefix + ':ACTIVITY', lastAccess, sessionId);

    // Keep sessionId and userId in the expiry sorted list
    // Score keeps expiry time.
    if (this._expires)
      pipeline.zadd(prefix + ':EXPIRES', expires, sessionId);

    // Keep sessionId in a sorted list per user
    // Score keeps last access time
    pipeline.zadd(prefix + ':user_' + userId, lastAccess, sessionId);

    // Update last access and expiry values of session
    pipeline.hmset(prefix + ':sess_' + sessionId, {
      us: userId,
      la: lastAccess,
      ex: expires,
      ttl
    });

    return pipeline;
  }

}

/**
 * Expose `SessionManager`.
 */
module.exports = SessionManager;
