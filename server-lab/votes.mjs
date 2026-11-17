import {readSeries, visibleEpisodes} from './series.mjs';

export function initVotes(db) {
 db.exec(`
  CREATE TABLE IF NOT EXISTS episode_polls (
   episode_id INTEGER PRIMARY KEY REFERENCES series_episodes(id) ON DELETE CASCADE,
   question TEXT NOT NULL, first_option TEXT NOT NULL, second_option TEXT NOT NULL,
   closes_at INTEGER NOT NULL, result_note TEXT, result_episode_id INTEGER REFERENCES series_episodes(id) ON DELETE SET NULL,
   first_total INTEGER, second_total INTEGER
  );
  CREATE TABLE IF NOT EXISTS episode_votes (
   episode_id INTEGER NOT NULL REFERENCES episode_polls(episode_id) ON DELETE CASCADE,
   user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
   choice INTEGER NOT NULL CHECK(choice IN (0,1)), updated_at INTEGER NOT NULL,
   PRIMARY KEY(episode_id,user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_episode_votes_actor ON episode_votes(user_id);
 `);
}

export function exportUserVotes(db, userId) {
 return db.prepare('SELECT episode_id AS episodeId,choice,updated_at AS updatedAt FROM episode_votes WHERE user_id=? ORDER BY episode_id').all(userId);
}

function tally(db, episodeId, authorId) {
 const counts = [0,0];
 const rows = db.prepare(`SELECT v.choice,count(*) AS n FROM episode_votes v
  WHERE v.episode_id=? AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE
   (b.blocker_id=v.user_id AND b.blocked_id=?) OR (b.blocker_id=? AND b.blocked_id=v.user_id))
  GROUP BY v.choice`).all(episodeId,authorId,authorId);
 for (const row of rows) counts[row.choice] = row.n;
 return counts;
}

function validText(value,limit) {
 return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= limit;
}

export function handleVotes({db, res, route, method, viewer, user, body, send, check, now, atomic}) {
 const match = route.match(/^\/api\/series\/([a-z0-9-]+)\/episodes\/([1-9][0-9]{0,14})\/poll(?:\/(vote|result))?$/);
 if (!match) return false;
 const [,slug,rawId,action] = match;
 const id = Number(rawId);
 const actor = (user || viewer)?.id || '';
 const series = readSeries(db,slug,actor);
 check(series,404,'Сезон недоступен');
 const episodes = visibleEpisodes(db,series.id);
 const episode = episodes.find(item => item.id === id);
 check(episode,404,'Эпизод недоступен');
 const owner = actor === series.owner_id;
 const poll = db.prepare('SELECT * FROM episode_polls WHERE episode_id=?').get(id);
 const currentTime = now();
 const closed = poll && currentTime >= poll.closes_at;
 const response = (status,data) => {
  send(res,status,data,{'Cache-Control':'private, no-store'});
  return true;
 };
 if (method === 'GET' && !action) {
  const payload = {owner,canVote:Boolean(actor) && !owner,poll:null,continuations:[]};
  if (poll) {
   const later = episodes.filter(item => item.position > episode.position);
   const continuation = later.find(item => item.id === poll.result_episode_id);
   const result = poll.result_note && continuation ? {
    note:poll.result_note, href:'/series/'+encodeURIComponent(slug)+'#episode-'+continuation.id
   } : null;
   payload.poll = {
    question:poll.question,options:[poll.first_option,poll.second_option],
    closesAt:poll.closes_at,closed,mine: actor ? db.prepare('SELECT choice FROM episode_votes WHERE episode_id=? AND user_id=?').get(id,actor)?.choice ?? null : null,
    counts:closed ? (poll.result_note ? [poll.first_total,poll.second_total] : tally(db,id,series.owner_id)) : null,
    result
   };
   if (owner && closed && !poll.result_note) payload.continuations = later.map(({id,title})=>({id,title}));
  }
  return response(200,payload);
 }
 check(actor,401,'Войдите в аккаунт');
 if (!action && method === 'POST') {
  check(owner,403,'Голосование создаёт автор сезона');
  check(!poll,409,'Голосование уже существует');
  check(validText(body.question,180) && Array.isArray(body.options) && body.options.length === 2 &&
   body.options.every(value => validText(value,80)),400,'Укажите вопрос и два варианта');
  const options = body.options.map(value => value.trim());
  check(options[0].toLowerCase() !== options[1].toLowerCase(),400,'Варианты должны отличаться');
  check(Number.isSafeInteger(body.closesAt) && body.closesAt > currentTime &&
   body.closesAt <= currentTime + 30*86400000,400,'Укажите срок голосования в пределах 30 дней');
  db.prepare('INSERT INTO episode_polls(episode_id,question,first_option,second_option,closes_at) VALUES(?,?,?,?,?)')
   .run(id,body.question.trim(),...options,body.closesAt);
  return response(201,{created:true});
 }
 check(poll,404,'Голосование не найдено');
 if (action === 'vote' && ['POST','DELETE'].includes(method)) {
  check(!owner,403,'Автор не участвует в голосовании зрителей');
  check(!closed,409,'Голосование завершено');
  if (method === 'DELETE') {
   db.prepare('DELETE FROM episode_votes WHERE episode_id=? AND user_id=?').run(id,actor);
  } else {
   check(body.choice === 0 || body.choice === 1,400,'Выберите один из двух вариантов');
   db.prepare(`INSERT INTO episode_votes(episode_id,user_id,choice,updated_at) VALUES(?,?,?,?)
    ON CONFLICT(episode_id,user_id) DO UPDATE SET choice=excluded.choice,updated_at=excluded.updated_at`).run(id,actor,body.choice,currentTime);
  }
  return response(200,{saved:true});
 }
 if (action === 'result' && method === 'POST') {
  check(owner,403,'Итоги публикует автор');
  check(closed,409,'Дождитесь окончания голосования');
  check(validText(body.note,400),400,'Опишите продолжение (до 400 символов)');
  const target = episodes.find(item => item.id === body.episodeId && item.position > episode.position);
  check(target,400,'Выберите опубликованный следующий эпизод в этом сезоне');
  if (poll.result_note) {
   check(poll.result_note === body.note.trim() && poll.result_episode_id === target.id,409,'Итог уже опубликован');
   return response(200,{published:true});
  }
  atomic(() => {
   const counts = tally(db,id,series.owner_id);
   db.prepare('UPDATE episode_polls SET result_note=?,result_episode_id=?,first_total=?,second_total=? WHERE episode_id=?')
    .run(body.note.trim(),target.id,...counts,id);
  });
  return response(201,{published:true});
 }
 check(false,405,'Метод не поддерживается');
}
