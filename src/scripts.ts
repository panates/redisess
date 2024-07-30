export function getKillScript(): string {
  return `
    local prefix = ARGV[1]
    local sessionId = ARGV[2]
    local userId = ARGV[3]
    
    redis.call("zrem", prefix..":ACTIVITY", sessionId)          
    redis.call("zrem", prefix..":EXPIRES", sessionId)
    redis.call("zrem", prefix..":user_"..userId, sessionId)
    redis.call("del", prefix..":sess_"..sessionId)        
    if (redis.call("zcount", prefix..":user_"..userId, "+inf", "-inf")>0) then
      redis.call("zrem", prefix..":USERS", userId)
    end          
    return 1
`;
}

export function getKillAllScript(): string {
  return `
    -- find keys with wildcard
    local matches = redis.call("keys", ARGV[1]) 
    --if there are any keys
    if unpack(matches) ~= nil then
      --delete all
      return redis.call("del", unpack(matches)) 
    else 
      return 0 --if no keys to delete
    end
  `;
}

export function getWriteScript(additionalFields?: string[]) {
  let s = '';
  if (additionalFields) {
    for (let i = 0; i < additionalFields.length; i++) {
      s += ', "f' + i + '", ARGV[' + (7 + i) + ']';
    }
  }

  return `
    local prefix = ARGV[1]
    local lastAccess = tonumber(ARGV[2])
    local userId = ARGV[3]
    local sessionId = ARGV[4]
    local expires = tonumber(ARGV[5])
    local ttl = tonumber(ARGV[6])
    
    redis.call("zadd", prefix..":USERS", lastAccess, userId) 
    redis.call("zadd", prefix..":ACTIVITY", lastAccess, sessionId)          
    redis.call("zadd", prefix..":user_"..userId, lastAccess, sessionId)
    redis.call("hmset", prefix..":sess_"..sessionId, "us", userId, "la", lastAccess, "ex", expires, "ttl", ttl${s})                       
    if (expires > 0) then
      redis.call("zadd", prefix..":EXPIRES", expires, sessionId)
    else
      redis.call("zrem", prefix..":EXPIRES", sessionId)
    end          
    return 1
    `;
}

export function getWipeScript(): string {
  return `
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
`;
}
