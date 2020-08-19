  
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

Retrieves session by sessionId

`get(sessionId: string, noUpdate: boolean = false): Promise<Session>`

##### Parameters

- sessionId: Id of the session
- noUpdate: Update state of the session
- *Return value :* Returns new created session.

---
#### prototype.getAllSessions()

Retrieves all session ids which were active within the last n seconds.

`getAllSessions(secs: number): Promise<string[]>`

##### Parameters

- secs: The elapsed time since the last activity of the session. Returns total count of sessions If not defined or zero
- *Return value :* Returns the string array of all sessions.

---
#### prototype.getAllUsers()

Retrieves all user ids which were active within the last n seconds.

`getAllUsers(secs: number): Promise<string[]>`

##### Parameters

- secs: The elapsed time since the last activity of the session. Returns total count of sessions If not defined or zero
- *Return value :* Returns the string array of all users.

---
#### prototype.getUserSessions()

Retrieves session ids of single user which were active within the last n seconds.

`getUserSessions(userId: string, n: number = 0): Promise<string[]>`

##### Parameters

- userId: Id of the user
- n: The elapsed time since the last activity of the session.
- *Return value :* Returns the string array of all sessions for an user.

---
#### prototype.getOldestUserSession()

Retrieves oldest session of user

`getOldestUserSession(userId: string, noUpdate: boolean = false): Promise<Session>`

##### Parameters

- userId: Id of the user
- noUpdate: Update state of the session
- *Return value :* Returns new created session.

---
#### prototype.exists()

Returns true if sessionId exists, false otherwise

`exists(sessionId: string): Promise<Boolean>`

##### Parameters

- sessionId: Id of the session
- *Return value :* Returns Boolean.

---
#### prototype.kill()

Kills single session

`kill(sessionId: string): Promise<void>`

##### Parameters

- sessionId: Id of the session
- *Return value :* No return value.

---
#### prototype.killUser()

 Kills all sessions of user

 `killUser(userId: string): Promise<void>`

 ##### Parameters

- userId: Id of the user
- *Return value :* No return value.

---
#### prototype.killAll()

 Kills all sessions for application

 `killAll(): Promise<void>`

 ##### Parameters

- No parameter value
- *Return value :* No return value.

---
#### prototype.now()

Retrieves present time.

`now(): Promise<number>`

 ##### Parameters

- No parameter value
- *Return value :* Returns number.

---
#### prototype.quit()

Stops wipe timer

`quit(): void`

##### Parameters

- No parameter value
- *Return value :* No return value.

---
## Session

---
#### prototype.sessionId

Retrieves session id value

`sessionId(): string`

---
#### prototype.userId

Retrieves user id value

`userId(): string`

---
#### prototype.ttl

Retrieves Time-To-Live value

`ttl(): number`

---
#### prototype.lastAccess

Retrieves the time (unix) of last access

`lastAccess(): number`

---
#### prototype.expires

Retrieves the time (unix) that session be expired.

`expires(): number`

---
#### prototype.expiresIn

Retrieves duration that session be expired.

`expiresIn(): number`

---
#### prototype.valid

Retrieves validation of session and user with last access control.

`valid(): boolean`

---
#### prototype.idle

Retrieves idle duration in seconds.

`idle(): number`

---
#### prototype.[additionalField]

Retrieves information of writed additional field.

---
#### prototype.read()

Reads session info from redis server

`read(): Promise<void>`

---
#### prototype.get()

Retrieves user data from session.

`get(key): Promise<any>`

 ##### Parameters

- key: string | Array<String> | Object<String,*>
- *Return value :* No return value.

---
#### prototype.set()

Stores user data to session

`set(key, value): Promise<number>`

##### Parameters

- key: string | Object
- value: *
- *Return value :* Length of values.

---
#### prototype.kill()

Kills the session

`kill(): Promise<void>`

---
#### prototype.write()

Write session to redis server.

`write(): Promise<void>`

---

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
