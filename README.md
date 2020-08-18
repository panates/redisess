  
[![NPM Version][npm-image]][npm-url]
[![NPM Downloads][downloads-image]][downloads-url]
[![Build Status][travis-image]][travis-url]
[![Test Coverage][coveralls-image]][coveralls-url]

[![Dependencies][dependencies-image]][dependencies-url]
[![DevDependencies][devdependencies-image]][devdependencies-url]
[![Package Quality][quality-image]][quality-url]


## Redisess

Redis session manager for NodeJS 

## Installation

```bash
$ npm install redisess --save
```

## Basic Usage

The example blow show how can you use Redisess in a simple express applicaiton.

```js
const express = require("express");
const Redis = require("ioredis");
const {SessionManager} = require("redisess");
const redis = new Redis(); 

const manager = new SessionManager(redis, {
    namespace: 'myapp',
    additionalFields: ['groupId'],
    ttl: 120 // Default Time-To-Live value in seconds: 120 seconds
  });

const app = express();
 
app.get('/login', async function (req, res) {
  const userName = req.query.userName;
  const pass = req.query.password;
  //...Login application logic here
  
  const session = await sm.create(userName, {
      ttl: 240, // You can overwrite ttl value per session
      groupId: 111 // You can store additional values
  }); 
  res.send('Your session id is '+session.sessionId);
});

app.get('/killSession/:sessionid', async function (req, res) {
  await sm.kill(req.params.sessionid); 
  res.send('Session ' + req.params.sessionid + ' is closed');
});

app.get('/killUser/:userId', async function (req, res) {
  await sm.killUser(req.params.userId); 
  res.send('All sessions for user "' + req.params.userId +'" are closed.');
})
 
app.listen(3000);

```


---
## SessionManager



### prototype.count()

Returns the number of sessions within the last n seconds. Get all session count if n is not defined or zero

`count(secs: number = 0): Promise<number>`

##### Parameters

- secs: The elapsed time since the last activity of the session. Returns total count of sessions If not defined or zero
- *Return value :* Returns the number of sessions.


---
### prototype.countForUser()

Retrieves session count of single user which were active within the last n seconds.

`countForUser(userId: string, secs: number = 0): Promise<number>`

##### Parameters

- userId: Id of the user
- secs: The elapsed time since the last activity of the session. Returns total count of sessions If not defined or zero
- *Return value :* Returns the number of sessions.


---
### prototype.create()

Creates a new session for the user

`create(userId: string, props?: { ttl?: number, [index: string]: any }): Promise<Session>`

##### Parameters

- userId: Id of the user
- props: Additional properties 
    - ttl: Time-To-Live value in seconds
    - *...: Additional fields
- *Return value :* Returns new created session.


---
#### prototype.get()


---
#### prototype.getAllSessions()


---
#### prototype.getAllUsers()


---
#### prototype.getUserSessions()


---
#### prototype.getOldestUserSession()


---
#### prototype.exists()


---
#### prototype.kill()


---
#### prototype.killUser()


---
#### prototype.killAll()


---
#### prototype.now()


---
#### prototype.quit()



---
## Session

---
#### prototype.sessionId


---
#### prototype.userId


---
#### prototype.ttl


---
#### prototype.lastAccess


---
#### prototype.expires


---
#### prototype.expiresIn


---
#### prototype.valid


---
#### prototype.idle


---
#### prototype.[additionalField]


---
#### prototype.read()


---
#### prototype.get()


---
#### prototype.set()


---
#### prototype.kill()


---
#### prototype.write()


---
#### prototype.write()


## Node Compatibility

  - node >= 8.x
  
## Change log

To see changelog click [here](https://github.com/panates/redisess/commits/master)

  
### License
Available under [MIT](LICENSE) license.

[npm-image]: https://img.shields.io/npm/v/redisess.svg
[npm-url]: https://npmjs.org/package/redisess
[travis-image]: https://img.shields.io/travis/panates/redisess/master.svg
[travis-url]: https://travis-ci.org/panates/redisess
[coveralls-image]: https://img.shields.io/coveralls/panates/redisess/master.svg
[coveralls-url]: https://coveralls.io/r/panates/redisess
[downloads-image]: https://img.shields.io/npm/dm/redisess.svg
[downloads-url]: https://npmjs.org/package/redisess
[dependencies-image]: https://david-dm.org/panates/redisess/status.svg
[dependencies-url]:https://david-dm.org/panates/redisess
[devdependencies-image]: https://david-dm.org/panates/redisess/dev-status.svg
[devdependencies-url]:https://david-dm.org/panates/redisess?type=dev
[quality-image]: http://npm.packagequality.com/shield/redisess.png
[quality-url]: http://packagequality.com/#?package=redisess
