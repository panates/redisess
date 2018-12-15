class RedisScript {

  constructor(src, numberOfKeys) {
    this._src = src;
    this._sha = null;
    this._numberOfKeys = numberOfKeys || 0;
  }

  execute(client, ...args) {
    return (this._sha ? Promise.resolve() : this._loadScript(client)).then(() =>
        client.evalsha(this._sha, this._numberOfKeys, ...args)
            .catch(err => {
              /* istanbul ignore next */
              if (!String(err).includes('NOSCRIPT'))
                throw err;
              return this._loadScript(client).then(() =>
                  client.evalsha(this._sha, this._numberOfKeys, ...args)
              );
            })
    );
  }

  _loadScript(client) {
    return client.script('load', this._src).then(resp => {
      /* istanbul ignore next */
      if (!resp)
        throw new Error('Unable to load redis script in to redis cache');
      this._sha = resp;
    });
  }

}

module.exports = RedisScript;
